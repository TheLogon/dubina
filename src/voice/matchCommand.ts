import { WAKE_WORDS } from "./wake";

export function normalizePhrase(text: string): string {
  return text
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const FILLERS = new Set([
  "а",
  "и",
  "ну",
  "же",
  "бы",
  "ли",
  "то",
  "вот",
  "там",
  "тут",
  "это",
  "уже",
  "давай",
  "пожалуйста",
  "просто",
  "короче",
  "типа",
  "какбы",
  "как",
  "емае",
  "емаё",
  "блять",
  "блин",
  "сука",
  "наконец",
  "скорее",
  "сейчас",
  "мне",
  "можно",
  "можешь",
  "сделай",
]);

export function stripWakeWords(text: string): string {
  let n = normalizePhrase(text);
  const wakes = [...WAKE_WORDS].sort((a, b) => b.length - a.length);
  for (const w of wakes) {
    n = n
      .split(" ")
      .filter((tok) => tok !== w)
      .join(" ");
  }
  return n.replace(/\s+/g, " ").trim();
}

export function significantTokens(text: string): string[] {
  return normalizePhrase(text)
    .split(" ")
    .filter((t) => t.length > 1 && !FILLERS.has(t));
}

export function phraseContained(spoken: string, phrase: string): boolean {
  const spokenNorm = normalizePhrase(spoken);
  const phraseNorm = normalizePhrase(phrase);
  if (!spokenNorm || !phraseNorm) return false;
  if (spokenNorm === phraseNorm) return true;
  if (spokenNorm.includes(phraseNorm)) return true;

  const hay = significantTokens(spokenNorm);
  const needle = significantTokens(phraseNorm);
  if (needle.length === 0) return false;

  let from = 0;
  for (const nt of needle) {
    let found = -1;
    for (let i = from; i < hay.length; i++) {
      const ht = hay[i];
      if (ht === nt || ht.includes(nt) || nt.includes(ht)) {
        found = i;
        break;
      }
    }
    if (found < 0) return false;
    from = found + 1;
  }
  return true;
}

export function scorePhraseMatch(spoken: string, phrase: string): number {
  const spokenNorm = normalizePhrase(spoken);
  const phraseNorm = normalizePhrase(phrase);
  if (!spokenNorm || !phraseNorm) return 0;
  if (spokenNorm === phraseNorm) return 10_000 + phraseNorm.length;
  if (!phraseContained(spokenNorm, phraseNorm)) return 0;
  if (spokenNorm.includes(phraseNorm)) return 5_000 + phraseNorm.length;
  return 1_000 + phraseNorm.length * 10;
}

export function pickBestPhraseMatch<T>(
  spoken: string,
  items: T[],
  getPhrase: (item: T) => string,
): T | undefined {
  let best: T | undefined;
  let bestScore = 0;
  for (const item of items) {
    const score = scorePhraseMatch(spoken, getPhrase(item));
    if (score > bestScore) {
      bestScore = score;
      best = item;
    }
  }
  return bestScore > 0 ? best : undefined;
}

export function commandTextFromUtterance(text: string): string {
  const stripped = stripWakeWords(text);
  return stripped || normalizePhrase(text);
}
