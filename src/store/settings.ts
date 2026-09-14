export type AppSettings = {
  inputDeviceId: string;
  outputDeviceId: string;
  outputVolume: number;
  closeToTray: boolean;
  autostart: boolean;
  
  musicAppPath: string;
  musicAppName: string;
};

const STORAGE_KEY = "dubina.settings.v1";

export const DEFAULT_SETTINGS: AppSettings = {
  inputDeviceId: "",
  outputDeviceId: "",
  outputVolume: 0.85,
  closeToTray: true,
  autostart: false,
  musicAppPath: "",
  musicAppName: "",
};

export function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<AppSettings>;
    return {
      ...DEFAULT_SETTINGS,
      ...parsed,
      outputVolume: clampVolume(parsed.outputVolume ?? DEFAULT_SETTINGS.outputVolume),
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings: AppSettings): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

export function clampVolume(value: number): number {
  if (Number.isNaN(value)) return DEFAULT_SETTINGS.outputVolume;
  return Math.min(1, Math.max(0, value));
}

export type AudioDeviceOption = {
  deviceId: string;
  label: string;
};

export async function listAudioDevices(): Promise<{
  inputs: AudioDeviceOption[];
  outputs: AudioDeviceOption[];
}> {
  try {
    await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch {
    
  }

  const devices = await navigator.mediaDevices.enumerateDevices();
  const inputs: AudioDeviceOption[] = [];
  const outputs: AudioDeviceOption[] = [];

  for (const d of devices) {
    const option = {
      deviceId: d.deviceId,
      label:
        d.label ||
        (d.kind === "audioinput"
          ? `Микрофон ${inputs.length + 1}`
          : `Динамик ${outputs.length + 1}`),
    };
    if (d.kind === "audioinput") inputs.push(option);
    if (d.kind === "audiooutput") outputs.push(option);
  }

  return { inputs, outputs };
}
