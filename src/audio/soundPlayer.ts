import { invoke } from "@tauri-apps/api/core";
import { clampVolume, loadSettings } from "../store/settings";

export type SoundAction = "wake" | "ok" | "error";

const PHRASES: Record<SoundAction, string[]> = {
  wake: ["А?", "Да", "Слушаю", "Ну", "Что?", "Говори", "Я тут"],
  ok: ["Ок", "Готово"],
  error: ["Не понял", "Повтори"],
};

export function allTtsPhrases(): string[] {
  return Object.values(PHRASES).flat();
}

let speaking = false;
let muteUntil = 0;
let outputVolume = loadSettings().outputVolume;
let cacheReady = false;

export function isSpeechMuted(): boolean {
  return speaking || Date.now() < muteUntil;
}

export function applyAudioOutputSettings(opts: {
  outputDeviceId?: string;
  outputVolume?: number;
}): void {
  if (opts.outputVolume !== undefined) {
    outputVolume = clampVolume(opts.outputVolume);
  }
}

function pickRandom(list: string[]): string {
  return list[Math.floor(Math.random() * list.length)] ?? list[0] ?? "";
}

export async function warmTtsCache(): Promise<void> {
  cacheReady = true;
}

export async function speak(text: string): Promise<void> {
  const t = text.trim();
  if (!t || speaking) return;
  speaking = true;
  muteUntil = Date.now() + 30_000;
  try {
    await speakWeb(t);
  } catch {
    try {
      await invoke("tts_speak", { text: t, volume: outputVolume });
    } catch {
      
    }
  } finally {
    speaking = false;
    muteUntil = Date.now() + 550;
  }
}

function speakWeb(text: string): Promise<void> {
  return new Promise((resolve) => {
    if (!("speechSynthesis" in window)) {
      resolve();
      return;
    }
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "ru-RU";
    u.volume = outputVolume;
    u.rate = 1.15;
    const voices = window.speechSynthesis.getVoices();
    const ru = voices.find((v) => v.lang.toLowerCase().startsWith("ru"));
    if (ru) u.voice = ru;
    u.onend = () => resolve();
    u.onerror = () => resolve();
    window.speechSynthesis.speak(u);
  });
}

export async function playAction(action: SoundAction): Promise<void> {
  const phrase = pickRandom(PHRASES[action]);
  if (!phrase) return;
  await speak(phrase);
}

export function playActionSafe(action: SoundAction): void {
  void playAction(action).catch(() => {});
}

export function speakSafe(text: string): void {
  void speak(text).catch(() => {});
}

export function isTtsCacheReady(): boolean {
  return cacheReady;
}

{
  const s = loadSettings();
  applyAudioOutputSettings({ outputVolume: s.outputVolume });
}
