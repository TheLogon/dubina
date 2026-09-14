import { normalizePhrase } from "../store/scenarios";

export const DICTATION_START_PHRASES = [
  "напиши текст",
  "пиши текст",
  "режим диктовки",
  "включи диктовку",
  "начни диктовку",
  "надиктуй",
  "печатай текст",
  "диктовка",
  "печатай",
];

export const DICTATION_STOP_PHRASES = [
  "стоп диктовка",
  "стоп диктовку",
  "конец диктовки",
  "останови диктовку",
  "хватит писать",
  "закончил",
  "закончила",
  "готово",
  "хватит",
  "стоп",
  "достаточно",
];

const START_TRIGGERS = DICTATION_START_PHRASES;
const STOP_TRIGGERS = DICTATION_STOP_PHRASES;

export function matchDictationStart(spoken: string): { remainder: string } | null {
  const needle = normalizePhrase(spoken);
  if (!needle) return null;

  let best: { trigger: string; idx: number } | null = null;
  for (const trigger of START_TRIGGERS) {
    const t = normalizePhrase(trigger);
    const idx = needle.indexOf(t);
    if (idx < 0) continue;
    if (!best || t.length > best.trigger.length) {
      best = { trigger: t, idx };
    }
  }
  if (!best) return null;

  const after = needle.slice(best.idx + best.trigger.length).trim();
  return { remainder: after };
}

export function isDictationStop(spoken: string): boolean {
  const needle = normalizePhrase(spoken);
  if (!needle) return false;
  return STOP_TRIGGERS.some((s) => {
    const t = normalizePhrase(s);
    return needle === t || needle.endsWith(` ${t}`) || needle.startsWith(`${t} `);
  });
}
