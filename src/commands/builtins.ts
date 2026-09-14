import type { Scenario } from "../types/scenario";
import type { AppSettings } from "../store/settings";
import { normalizePhrase } from "../store/scenarios";

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
  "музыка",
  "play music",
];

export const BUILTIN_SCENARIOS: Scenario[] = [
  builtin("browser", "открой браузер", [
    { id: "b1", type: "open_browser", value: "" },
  ]),
  builtin("browser2", "открой интернет", [
    { id: "b2", type: "open_browser", value: "" },
  ]),
  builtin("pause", "пауза", [
    { id: "m1", type: "media_play_pause", value: "" },
  ]),
  builtin("pause2", "поставь на паузу", [
    { id: "m2", type: "media_play_pause", value: "" },
  ]),
  builtin("play", "продолжи", [
    { id: "m3", type: "media_play_pause", value: "" },
  ]),
  builtin("play2", "play", [
    { id: "m4", type: "media_play_pause", value: "" },
  ]),
  builtin("next", "следующий трек", [
    { id: "m5", type: "media_next", value: "" },
  ]),
  builtin("next2", "следующий", [
    { id: "m6", type: "media_next", value: "" },
  ]),
  builtin("prev", "предыдущий трек", [
    { id: "m7", type: "media_previous", value: "" },
  ]),
  builtin("prev2", "предыдущий", [
    { id: "m8", type: "media_previous", value: "" },
  ]),
];

export function findBuiltinByPhrase(
  spoken: string,
  settings?: AppSettings,
): Scenario | undefined {
  const needle = normalizePhrase(spoken);
  if (!needle) return undefined;

  const isMusic = MUSIC_PHRASES.some((p) => {
    const n = normalizePhrase(p);
    return needle === n || needle.includes(n);
  });

  if (isMusic) {
    return builtin("play_music", "включи музыку", [
      {
        id: "music1",
        type: "play_music",
        value: settings?.musicAppPath ?? "",
      },
    ]);
  }

  const exact = BUILTIN_SCENARIOS.find(
    (s) => normalizePhrase(s.phrase) === needle,
  );
  if (exact) return exact;

  return BUILTIN_SCENARIOS.find((s) => {
    const p = normalizePhrase(s.phrase);
    return needle === p || needle.includes(p) || p.includes(needle);
  });
}
