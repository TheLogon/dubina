import { normalizePhrase } from "./matchCommand";
import { requestMicrophoneAccess } from "./micPermission";
import { loadVoskCreateModel } from "./loadVosk";
import { WAKE_WORDS } from "./wake";

export function extractWakeAndCommand(text: string): {
  woke: boolean;
  command: string;
  normalized: string;
} {
  const normalized = normalizePhrase(text);
  if (!normalized) return { woke: false, command: "", normalized };

  for (const wake of WAKE_WORDS) {
    const idx = normalized.indexOf(wake);
    if (idx >= 0) {
      const command = normalized.slice(idx + wake.length).trim();
      return { woke: true, command, normalized };
    }
  }

  return { woke: false, command: "", normalized };
}

export type SpeechEngineHandlers = {
  onPartial: (text: string) => void;
  onFinal: (text: string) => void;
  onError: (message: string) => void;
  onStatus: (message: string) => void;
};

export type VoiceController = {
  stop: () => void;
  keepAlive: () => void;
};

const MODEL_PATH = "/vosk-ru-small.bin";

type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((ev: SpeechRecognitionEventLike) => void) | null;
  onerror: ((ev: { error?: string }) => void) | null;
  onend: (() => void) | null;
};

type SpeechRecognitionEventLike = {
  resultIndex: number;
  results: ArrayLike<{
    isFinal: boolean;
    0: { transcript: string };
  }>;
};

type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

export class MicPermissionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MicPermissionError";
  }
}

function getSpeechRecognitionCtor(): SpeechRecognitionCtor | null {
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export async function startVoiceController(
  inputDeviceId: string,
  handlers: SpeechEngineHandlers,
): Promise<VoiceController> {
  handlers.onStatus("Запрос доступа к микрофону…");

  let mediaStream: MediaStream;
  try {
    mediaStream = await requestMicrophoneAccess(inputDeviceId);
  } catch (e) {
    const denied =
      e instanceof Error &&
      (e.name === "NotAllowedError" || e.name === "PermissionDeniedError");
    const msg = denied
      ? "Нет доступа к микрофону. Нажми «Разрешить микрофон» и подтверди в системе."
      : e instanceof Error
        ? e.message
        : "Не удалось получить микрофон";
    handlers.onError(msg);
    throw new MicPermissionError(msg);
  }

  const Rec = getSpeechRecognitionCtor();
  if (Rec) {
    handlers.onStatus("Слушаю… скажи «Дубина»");
    try {
      const controller = startWebSpeech(Rec, handlers);
      mediaStream.getTracks().forEach((t) => t.stop());
      return controller;
    } catch (e) {
      console.warn("[dubina:speech] web speech failed, vosk fallback", e);
    }
  }

  handlers.onStatus("Микрофон ок. Загрузка Vosk…");
  try {
    return await startVosk(mediaStream, handlers);
  } catch (e) {
    mediaStream.getTracks().forEach((t) => t.stop());
    const detail = e instanceof Error ? e.message : String(e);
    console.error("[dubina:vosk]", e);
    handlers.onError(`Не удалось запустить распознавание: ${detail}`);
    throw e;
  }
}

function startWebSpeech(
  Rec: SpeechRecognitionCtor,
  handlers: SpeechEngineHandlers,
): VoiceController {
  let stopped = false;
  let restartTimer: number | null = null;
  const rec = new Rec();
  rec.lang = "ru-RU";
  rec.continuous = true;
  rec.interimResults = true;
  rec.maxAlternatives = 1;

  rec.onresult = (event) => {
    let interim = "";
    let finalText = "";
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const piece = event.results[i]?.[0]?.transcript?.trim() ?? "";
      if (!piece) continue;
      if (event.results[i].isFinal) finalText += (finalText ? " " : "") + piece;
      else interim += (interim ? " " : "") + piece;
    }
    if (interim) handlers.onPartial(interim);
    if (finalText) handlers.onFinal(finalText);
  };

  rec.onerror = (ev) => {
    if (stopped) return;
    const err = ev.error ?? "";
    if (err === "no-speech" || err === "aborted") return;
    if (err === "not-allowed") {
      handlers.onError("Нет доступа к распознаванию речи Windows");
    }
  };

  const kick = () => {
    if (stopped) return;
    try {
      rec.start();
    } catch {
      
    }
  };

  rec.onend = () => {
    if (stopped) return;
    if (restartTimer) window.clearTimeout(restartTimer);
    restartTimer = window.setTimeout(kick, 180);
  };

  kick();
  handlers.onStatus("Слушаю… скажи «Дубина»");

  const keepAlive = () => {
    if (stopped) return;
    kick();
  };

  return {
    keepAlive,
    stop: () => {
      stopped = true;
      if (restartTimer) window.clearTimeout(restartTimer);
      try {
        rec.onend = null;
        rec.abort();
      } catch {
        
      }
    },
  };
}

async function startVosk(
  mediaStream: MediaStream,
  handlers: SpeechEngineHandlers,
): Promise<VoiceController> {
  const sampleRate = 16000;
  const modelUrl = new URL(MODEL_PATH, window.location.origin).href;
  handlers.onStatus("Загрузка модели распознавания…");

  const probe = await fetch(modelUrl, {
    method: "GET",
    headers: { Range: "bytes=0-0" },
  });
  if (!probe.ok && probe.status !== 206) {
    throw new Error(`Модель не найдена (${probe.status}): ${MODEL_PATH}`);
  }

  const createModel = await loadVoskCreateModel();
  const model = await createModel(modelUrl);

  const wakeGrammar = JSON.stringify([
    ...WAKE_WORDS,
    ...WAKE_WORDS.map((w) => w.charAt(0).toUpperCase() + w.slice(1)),
    "Дубина",
    "Дубину",
    "Дубине",
  ]);

  let recognizer = new model.KaldiRecognizer(sampleRate, wakeGrammar);

  const bind = () => {
    recognizer.on("partialresult", (message) => {
      const partial = message.result?.partial?.trim();
      if (partial) handlers.onPartial(partial);
    });
    recognizer.on("result", (message) => {
      const text = message.result?.text?.trim();
      if (text) handlers.onFinal(text);
    });
  };
  bind();

  const audioContext = new AudioContext({ sampleRate });
  if (audioContext.state === "suspended") await audioContext.resume();

  const source = audioContext.createMediaStreamSource(mediaStream);
  const processor = audioContext.createScriptProcessor(4096, 1, 1);
  let ready = true;
  let fullMode = false;
  processor.onaudioprocess = (event) => {
    if (!ready) return;
    try {
      recognizer.acceptWaveform(event.inputBuffer);
    } catch (err) {
      console.warn("[dubina:vosk] waveform", err);
    }
  };

  const mute = audioContext.createGain();
  mute.gain.value = 0;
  source.connect(processor);
  processor.connect(mute);
  mute.connect(audioContext.destination);

  handlers.onStatus("Слушаю… скажи «Дубина»");

  const keepAlive = () => {
    if (audioContext.state === "suspended") {
      void audioContext.resume();
    }
  };

  const onVis = () => keepAlive();
  document.addEventListener("visibilitychange", onVis);
  window.addEventListener("focus", onVis);
  const keepAliveTimer = window.setInterval(keepAlive, 4000);

  const switchFull = () => {
    if (fullMode) return;
    fullMode = true;
    try {
      recognizer = new model.KaldiRecognizer(sampleRate);
      bind();
    } catch (e) {
      console.warn("[dubina:vosk] full mode", e);
    }
  };

  const originalOnPartial = handlers.onPartial;
  const originalOnFinal = handlers.onFinal;
  handlers.onPartial = (t) => {
    const { woke } = extractWakeAndCommand(t);
    if (woke) switchFull();
    originalOnPartial(t);
  };
  handlers.onFinal = (t) => {
    const { woke } = extractWakeAndCommand(t);
    if (woke) switchFull();
    originalOnFinal(t);
  };

  return {
    keepAlive,
    stop: () => {
      ready = false;
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("focus", onVis);
      window.clearInterval(keepAliveTimer);
      try {
        processor.disconnect();
        source.disconnect();
        mute.disconnect();
        void audioContext.close();
        mediaStream.getTracks().forEach((t) => t.stop());
        model.terminate();
      } catch {
        
      }
    },
  };
}
