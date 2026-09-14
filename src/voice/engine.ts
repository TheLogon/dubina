import { normalizePhrase } from "../store/scenarios";
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

export class MicPermissionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MicPermissionError";
  }
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

  handlers.onStatus("Микрофон ок. Загрузка Vosk…");

  try {
    return await startVosk(mediaStream, handlers);
  } catch (e) {
    mediaStream.getTracks().forEach((t) => t.stop());
    const detail = e instanceof Error ? e.message : String(e);
    console.error("[dubina:vosk]", e);
    handlers.onError(`Не удалось запустить Vosk: ${detail}`);
    throw e;
  }
}

async function startVosk(
  mediaStream: MediaStream,
  handlers: SpeechEngineHandlers,
): Promise<VoiceController> {
  const sampleRate = 16000;
  const modelUrl = new URL(MODEL_PATH, window.location.origin).href;
  handlers.onStatus("Загрузка модели распознавания…");

  const probe = await fetch(modelUrl, { method: "GET", headers: { Range: "bytes=0-0" } });
  if (!probe.ok && probe.status !== 206) {
    throw new Error(`Модель не найдена (${probe.status}): ${MODEL_PATH}`);
  }

  const createModel = await loadVoskCreateModel();
  const model = await createModel(modelUrl);

  
  const recognizer = new model.KaldiRecognizer(sampleRate);

  recognizer.on("partialresult", (message) => {
    const partial = message.result?.partial?.trim();
    if (partial) handlers.onPartial(partial);
  });

  recognizer.on("result", (message) => {
    const text = message.result?.text?.trim();
    if (text) handlers.onFinal(text);
  });

  const audioContext = new AudioContext({ sampleRate });
  if (audioContext.state === "suspended") await audioContext.resume();

  
  const source = audioContext.createMediaStreamSource(mediaStream);
  const processor = audioContext.createScriptProcessor(2048, 1, 1);
  let ready = true;
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
  const keepAliveTimer = window.setInterval(keepAlive, 2500);

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
