import { normalizePhrase } from "./matchCommand";
import { requestMicrophoneAccess } from "./micPermission";
import { loadVoskCreateModel } from "./loadVosk";
import { WAKE_WORDS } from "./wake";

function looksLikeWakeToken(tok: string): boolean {
  if (!tok) return false;
  if (WAKE_WORDS.includes(tok)) return true;
  if (tok.length >= 5 && /[кгтд]абина$/.test(tok)) return true;
  if (tok.length >= 4 && /^(?:д|т|р|л|у|к|г)?убин[аыуеой]*$/.test(tok)) return true;
  if (tok.length >= 4 && /^(?:у)?бейна$/.test(tok)) return true;
  if (tok.length >= 4 && /^бин[аыуеой]*$/.test(tok)) return true;
  if (tok.length >= 5 && /бина$/.test(tok)) return true;
  return false;
}

export function extractWakeAndCommand(text: string): {
  woke: boolean;
  command: string;
  normalized: string;
} {
  const normalized = normalizePhrase(text);
  if (!normalized) return { woke: false, command: "", normalized };

  const wakes = [...WAKE_WORDS].sort((a, b) => b.length - a.length);
  for (const wake of wakes) {
    const idx = normalized.indexOf(wake);
    if (idx < 0) continue;
    if (idx > 0 && normalized[idx - 1] !== " ") continue;
    const after = idx + wake.length;
    if (after < normalized.length && normalized[after] !== " ") continue;
    const command = normalized.slice(after).trim();
    return { woke: true, command, normalized };
  }

  const tokens = normalized.split(/\s+/).filter(Boolean);
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i] ?? "";
    const next = tokens[i + 1] ?? "";
    const pairSpace = next ? `${tok} ${next}` : "";
    const pairJoin = next ? `${tok}${next}` : "";

    if (
      looksLikeWakeToken(tok) ||
      (pairSpace && wakes.includes(pairSpace)) ||
      (pairJoin && looksLikeWakeToken(pairJoin))
    ) {
      const skip = pairSpace && (wakes.includes(pairSpace) || looksLikeWakeToken(pairJoin)) ? 2 : 1;
      const command = tokens.slice(i + skip).join(" ").trim();
      return { woke: true, command, normalized };
    }

    for (const wake of wakes) {
      if (
        tok === wake ||
        (tok.length >= 5 && (wake.startsWith(tok) || tok.startsWith(wake)))
      ) {
        const command = tokens.slice(i + 1).join(" ").trim();
        return { woke: true, command, normalized };
      }
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

  const stopMic = () => {
    try {
      mediaStream.getTracks().forEach((t) => t.stop());
    } catch {
      
    }
  };

  handlers.onStatus("Микрофон ок. Запуск распознавания…");
  try {
    const vosk = await startVosk(mediaStream, handlers);
    handlers.onStatus("Слушаю вас");
    return vosk;
  } catch (e) {
    console.warn("[dubina:vosk] fallback to web speech", e);
    stopMic();
  }

  const Rec = getSpeechRecognitionCtor();
  if (Rec) {
    handlers.onStatus("Слушаю вас");
    try {
      return startWebSpeech(Rec, handlers);
    } catch (err) {
      console.warn("[dubina:speech] web speech failed", err);
    }
  }

  handlers.onError("Не удалось запустить распознавание");
  throw new Error("Не удалось запустить распознавание");
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
      handlers.onError("Нет доступа к распознаванию речи");
      return;
    }
    if (restartTimer) window.clearTimeout(restartTimer);
    restartTimer = window.setTimeout(kick, 320);
  };

  const kick = () => {
    if (stopped) return;
    try {
      rec.start();
    } catch {
      try {
        rec.stop();
      } catch {
        
      }
      if (restartTimer) window.clearTimeout(restartTimer);
      restartTimer = window.setTimeout(() => {
        if (stopped) return;
        try {
          rec.start();
        } catch {
          
        }
      }, 250);
    }
  };

  rec.onend = () => {
    if (stopped) return;
    if (restartTimer) window.clearTimeout(restartTimer);
    restartTimer = window.setTimeout(kick, 180);
  };

  kick();

  return {
    keepAlive: () => {
      if (stopped) return;
      kick();
    },
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

  const audioContext = new AudioContext();
  if (audioContext.state === "suspended") await audioContext.resume();

  const sampleRate = audioContext.sampleRate;
  const recognizer = new model.KaldiRecognizer(sampleRate);

  recognizer.on("partialresult", (message) => {
    const partial = message.result?.partial?.trim();
    if (partial) {
      console.info("[dubina:vosk:partial]", partial);
      handlers.onPartial(partial);
    }
  });
  recognizer.on("result", (message) => {
    const text = message.result?.text?.trim();
    if (text) {
      console.info("[dubina:vosk:final]", text);
      handlers.onFinal(text);
    }
  });

  const source = audioContext.createMediaStreamSource(mediaStream);
  const processor = audioContext.createScriptProcessor(4096, 1, 1);
  let ready = true;
  let lastLevelLog = 0;
  let boostBuf: AudioBuffer | null = null;

  processor.onaudioprocess = (event) => {
    if (!ready) return;
    try {
      const input = event.inputBuffer;
      const channel = input.getChannelData(0);
      let peak = 0;
      for (let i = 0; i < channel.length; i++) {
        const v = Math.abs(channel[i] ?? 0);
        if (v > peak) peak = v;
      }
      const now = performance.now();
      if (peak > 0.008 && now - lastLevelLog > 2000) {
        lastLevelLog = now;
        console.info("[dubina:vosk] mic level", peak.toFixed(3));
      }

      let feed: AudioBuffer = input;
      if (peak > 0.0008 && peak < 0.22) {
        const gain = Math.min(10, 0.35 / peak);
        if (
          !boostBuf ||
          boostBuf.length !== channel.length ||
          boostBuf.sampleRate !== input.sampleRate
        ) {
          boostBuf = audioContext.createBuffer(
            1,
            channel.length,
            input.sampleRate,
          );
        }
        const out = boostBuf.getChannelData(0);
        for (let i = 0; i < channel.length; i++) {
          const s = (channel[i] ?? 0) * gain;
          out[i] = s > 1 ? 1 : s < -1 ? -1 : s;
        }
        feed = boostBuf;
      }
      recognizer.acceptWaveform(feed);
    } catch (err) {
      console.warn("[dubina:vosk] waveform", err);
    }
  };

  const mute = audioContext.createGain();
  mute.gain.value = 0;
  source.connect(processor);
  processor.connect(mute);
  mute.connect(audioContext.destination);

  const keepAlive = () => {
    if (audioContext.state === "suspended") {
      void audioContext.resume();
    }
    for (const track of mediaStream.getAudioTracks()) {
      if (track.readyState === "live" && track.muted) {
        console.warn("[dubina:vosk] track muted", track.label);
      }
    }
  };

  const onVis = () => keepAlive();
  document.addEventListener("visibilitychange", onVis);
  window.addEventListener("focus", onVis);
  const keepAliveTimer = window.setInterval(keepAlive, 4000);

  keepAlive();
  console.info("[dubina:vosk] ready", {
    sampleRate,
    tracks: mediaStream.getAudioTracks().map((t) => ({
      label: t.label,
      enabled: t.enabled,
      muted: t.muted,
      readyState: t.readyState,
    })),
  });

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
