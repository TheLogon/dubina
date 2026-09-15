import {
  commandTextFromUtterance,
  normalizePhrase,
  phraseContained,
} from "../voice/matchCommand";

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

export function matchDictationStart(spoken: string): { remainder: string } | null {
  const needle = commandTextFromUtterance(spoken);
  if (!needle) return null;

  let best: { trigger: string; idx: number } | null = null;
  for (const trigger of DICTATION_START_PHRASES) {
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
  const needle = commandTextFromUtterance(spoken);
  if (!needle) return false;
  return DICTATION_STOP_PHRASES.some((s) => phraseContained(needle, s));
}
