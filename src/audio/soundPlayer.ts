import { invoke } from "@tauri-apps/api/core";
import { clampVolume, loadSettings } from "../store/settings";

export type SoundAction = "wake" | "ok" | "error";

const PHRASES: Record<SoundAction, string[]> = {
  wake: ["А?", "Да", "Слушаю", "Ну", "Что?", "Говори", "Я тут"],
  ok: ["Ок", "Готово", "Выполнил"],
  error: ["Не понял", "Повтори"],
};

const BULK_SOUND_URL = "/sounds/bulk.mp3";

export function allTtsPhrases(): string[] {
  return Object.values(PHRASES).flat();
}

let speaking = false;
let muteUntil = 0;
let outputVolume = loadSettings().outputVolume;
let wakeVoiceEnabled = loadSettings().wakeVoiceEnabled;
let doneVoiceEnabled = loadSettings().doneVoiceEnabled;
let cacheReady = false;
let bulkAudio: HTMLAudioElement | null = null;

export function isSpeechMuted(): boolean {
  return speaking || Date.now() < muteUntil;
}

export function applyAudioOutputSettings(opts: {
  outputDeviceId?: string;
  outputVolume?: number;
  wakeVoiceEnabled?: boolean;
  doneVoiceEnabled?: boolean;
}): void {
  if (opts.outputVolume !== undefined) {
    outputVolume = clampVolume(opts.outputVolume);
  }
  if (opts.wakeVoiceEnabled !== undefined) {
    wakeVoiceEnabled = opts.wakeVoiceEnabled;
  }
  if (opts.doneVoiceEnabled !== undefined) {
    doneVoiceEnabled = opts.doneVoiceEnabled;
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
  if (!t) return;
  if (speaking && "speechSynthesis" in window) {
    try {
      window.speechSynthesis.cancel();
    } catch {
      
    }
  }
  speaking = true;
  try {
    await speakWeb(t);
  } catch {
    try {
      await invoke("tts_speak", { text: t, volume: outputVolume });
    } catch {
      
    }
  } finally {
    speaking = false;
    muteUntil = Date.now() + 350;
  }
}

function speakWeb(text: string): Promise<void> {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      resolve();
    };

    if (!("speechSynthesis" in window)) {
      finish();
      return;
    }

    try {
      window.speechSynthesis.cancel();
    } catch {
      
    }

    const u = new SpeechSynthesisUtterance(text);
    u.lang = "ru-RU";
    u.volume = outputVolume;
    u.rate = 1.15;
    const voices = window.speechSynthesis.getVoices();
    const ru = voices.find((v) => v.lang.toLowerCase().startsWith("ru"));
    if (ru) u.voice = ru;
    u.onend = finish;
    u.onerror = finish;
    const maxMs = Math.min(6000, 700 + text.length * 90);
    window.setTimeout(finish, maxMs);
    try {
      window.speechSynthesis.speak(u);
    } catch {
      finish();
    }
  });
}

async function playBulkSound(): Promise<void> {
  try {
    if (!bulkAudio) {
      bulkAudio = new Audio(BULK_SOUND_URL);
    }
    bulkAudio.pause();
    bulkAudio.currentTime = 0;
    bulkAudio.volume = outputVolume;
    muteUntil = Date.now() + 120;
    await bulkAudio.play();
  } catch {
    
  }
}

export async function playAction(action: SoundAction): Promise<void> {
  if (action === "wake") {
    if (!wakeVoiceEnabled) {
      await playBulkSound();
      return;
    }
    const phrase = pickRandom(PHRASES.wake);
    if (!phrase) return;
    await speak(phrase);
    return;
  }

  if (action === "ok") {
    if (!doneVoiceEnabled) return;
    const phrase = pickRandom(PHRASES.ok);
    if (!phrase) return;
    await speak(phrase);
    return;
  }

  const phrase = pickRandom(PHRASES.error);
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
  applyAudioOutputSettings({
    outputVolume: s.outputVolume,
    wakeVoiceEnabled: s.wakeVoiceEnabled,
    doneVoiceEnabled: s.doneVoiceEnabled,
  });
}
