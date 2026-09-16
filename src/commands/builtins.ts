import type { Scenario } from "../types/scenario";
import type { AppSettings } from "../store/settings";
import {
  commandTextFromUtterance,
  isFocusedCommandUtterance,
  normalizePhrase,
} from "../voice/matchCommand";

function builtin(
  id: string,
  phrase: string,
  steps: Scenario["steps"],
): Scenario {
  const now = new Date().toISOString();
  return {
    id: `builtin:${id}`,
    phrase,
    steps,
    createdAt: now,
    updatedAt: now,
    builtin: true,
  };
}

export const MUSIC_PHRASES = [
  "включи музыку",
  "вруби музыку",
  "запусти музыку",
  "открой музыку",
  "включить музыку",
  "запустить музыку",
  "включи музыка",
  "вруби музыка",
  "запусти музыка",
  "ключи музыку",
  "ключи музыка",
  "включи музон",
  "вруби музон",
  "запусти музон",
  "включи треки",
  "вруби треки",
  "запусти треки",
  "включи яндекс музыку",
  "вруби яндекс музыку",
  "открой яндекс музыку",
  "запусти яндекс музыку",
  "включи спотифай",
  "вруби спотифай",
  "открой спотифай",
  "запусти спотифай",
  "включи spotify",
  "вруби spotify",
  "play music",
  "start music",
  "музыка",
  "музыку",
  "музыки",
  "музон",
  "яндекс музыка",
];

function looksLikeMusicStart(text: string): boolean {
  if (firstMatchingPhrase(text, MUSIC_PHRASES)) return true;
  const n = normalizePhrase(text);
  if (!n) return false;
  if (
    /^(?:включи|вруби|запусти|ключи|включить|запустить)$/.test(n)
  ) {
    return true;
  }
  if (/^(?:музык[а-яё]*|музон[а-яё]*|spotify|спотиф[а-яё]*)$/.test(n)) {
    return true;
  }
  if (/^(?:старт|start|play|стоп|stop)$/.test(n)) {
    return false;
  }
  const hasMusic =
    /(?:^|\s)(?:музык[а-яё]*|музон[а-яё]*|spotify|спотиф[а-яё]*)(?:\s|$)/.test(
      n,
    ) || (/яндекс/.test(n) && /музык/.test(n));
  const hasStart =
    /(?:^|\s)(?:включи|вруби|запусти|открой|включить|запустить)(?:\s|$)/.test(
      n,
    );
  return hasMusic && hasStart;
}

export function isMusicStartPhrase(text: string): boolean {
  return looksLikeMusicStart(commandTextFromUtterance(text) || text);
}

export const PAUSE_PHRASES = [
  "пауза",
  "на паузу",
  "поставь на паузу",
  "поставь паузу",
  "поставь на паузе",
  "сделай паузу",
  "включи паузу",
  "стоп музыка",
  "останови музыку",
  "останови трек",
  "останови воспроизведение",
  "выключи музыку",
  "выруби музыку",
  "pause",
  "stop music",
];

export const RESUME_PHRASES = [
  "продолжи",
  "продолжи музыку",
  "продолжи воспроизведение",
  "продолжай",
  "сними с паузы",
  "убери паузу",
  "сними паузу",
  "играй",
  "играй дальше",
  "давай дальше",
  "воспроизведи",
  "play",
  "resume",
];

export const NEXT_PHRASES = [
  "следующий трек",
  "следующая песня",
  "следующую песню",
  "следующий",
  "следующая",
  "следующую",
  "включи следующий",
  "включи следующую",
  "включи следующий трек",
  "включи следующую песню",
  "вруби следующий",
  "вруби следующую",
  "вруби следующий трек",
  "переключи трек",
  "переключи песню",
  "дальше трек",
  "трек дальше",
  "песня дальше",
  "некст",
  "next",
  "next track",
  "skip",
];

export const PREV_PHRASES = [
  "предыдущий трек",
  "предыдущая песня",
  "предыдущую песню",
  "предыдущий",
  "предыдущая",
  "предыдущую",
  "включи предыдущий",
  "включи предыдущую",
  "включи предыдущий трек",
  "вруби предыдущий",
  "вруби предыдущую",
  "верни трек",
  "верни песню",
  "назад трек",
  "трек назад",
  "песня назад",
  "прошлый трек",
  "прошлую песню",
  "previous",
  "prev",
  "previous track",
];

export const WEATHER_PHRASES = [
  "скажи погоду",
  "какая погода",
  "погода",
  "что по погоде",
  "погода сейчас",
];

export const BROWSER_PHRASES = [
  "открой браузер",
  "открой интернет",
  "открой хром",
  "открой chrome",
  "запусти браузер",
];

function firstMatchingPhrase(text: string, phrases: string[]): string | undefined {
  let best: string | undefined;
  let bestLen = 0;
  for (const p of phrases) {
    if (!isFocusedCommandUtterance(text, p)) continue;
    if (p.length > bestLen) {
      best = p;
      bestLen = p.length;
    }
  }
  return best;
}

export const BUILTIN_SCENARIOS: Scenario[] = [
  builtin("browser", "открой браузер", [
    { id: "b1", type: "open_browser", value: "" },
  ]),
  builtin("browser2", "открой интернет", [
    { id: "b2", type: "open_browser", value: "" },
  ]),
  builtin("pause", "поставь на паузу", [
    { id: "m1", type: "media_play_pause", value: "" },
  ]),
  builtin("play", "продолжи", [
    { id: "m3", type: "media_play_pause", value: "" },
  ]),
  builtin("next", "следующий трек", [
    { id: "m5", type: "media_next", value: "" },
  ]),
  builtin("prev", "предыдущий трек", [
    { id: "m7", type: "media_previous", value: "" },
  ]),
  builtin("play_music", "включи музыку", [
    { id: "music1", type: "play_music", value: "" },
  ]),
];

export function isWeatherRequest(spoken: string): boolean {
  const text = commandTextFromUtterance(spoken);
  return WEATHER_PHRASES.some((p) => isFocusedCommandUtterance(text, p));
}

export async function fetchWeatherLine(): Promise<string> {
  try {
    const res = await fetch("https://wttr.in/?format=%l:+%c+%t,+ветер+%w&lang=ru", {
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error(String(res.status));
    const line = (await res.text()).trim().replace(/\s+/g, " ");
    return line || "Погоду не получил";
  } catch {
    try {
      await openWeatherPage();
      return "Открыл погоду в браузере";
    } catch {
      return "Не смог узнать погоду";
    }
  }
}

async function openWeatherPage() {
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("open_url", { url: "https://yandex.ru/pogoda" });
}

export function findBuiltinByPhrase(
  spoken: string,
  settings?: AppSettings,
): Scenario | undefined {
  const text = commandTextFromUtterance(spoken);
  if (!text) return undefined;

  if (firstMatchingPhrase(text, NEXT_PHRASES)) {
    return builtin("next", "следующий трек", [
      { id: "m5", type: "media_next", value: "" },
    ]);
  }
  if (firstMatchingPhrase(text, PREV_PHRASES)) {
    return builtin("prev", "предыдущий трек", [
      { id: "m7", type: "media_previous", value: "" },
    ]);
  }
  if (firstMatchingPhrase(text, PAUSE_PHRASES)) {
    return builtin("pause", "поставь на паузу", [
      { id: "m1", type: "media_play_pause", value: "" },
    ]);
  }
  if (firstMatchingPhrase(text, RESUME_PHRASES)) {
    return builtin("play", "продолжи", [
      { id: "m3", type: "media_play_pause", value: "" },
    ]);
  }
  if (looksLikeMusicStart(text)) {
    return builtin("play_music", "включи музыку", [
      {
        id: "music1",
        type: "play_music",
        value: settings?.musicAppPath ?? "",
      },
    ]);
  }
  if (firstMatchingPhrase(text, BROWSER_PHRASES)) {
    return builtin("browser", "открой браузер", [
      { id: "b1", type: "open_browser", value: "" },
    ]);
  }

  return undefined;
}

export function normalizeBuiltinNeedle(spoken: string): string {
  return normalizePhrase(commandTextFromUtterance(spoken));
}
