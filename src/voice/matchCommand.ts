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
      if (!ht) continue;
      if (tokensClose(ht, nt)) {
        found = i;
        break;
      }
    }
    if (found < 0) return false;
    from = found + 1;
  }
  return true;
}

function tokensClose(a: string, b: string): boolean {
  if (a === b) return true;
  if (a.length < 4 || b.length < 4) return false;
  if (a.startsWith(b) || b.startsWith(a)) {
    return Math.abs(a.length - b.length) <= 3;
  }
  if (a.slice(0, 4) === b.slice(0, 4) && Math.abs(a.length - b.length) <= 2) {
    return true;
  }
  return false;
}

export function isFocusedCommandUtterance(spoken: string, phrase: string): boolean {
  return phraseContained(spoken, phrase);
}

export function isLikelyAmbientSpeech(_spoken: string): boolean {
  return false;
}

export function scorePhraseMatch(spoken: string, phrase: string): number {
  const spokenNorm = normalizePhrase(spoken);
  const phraseNorm = normalizePhrase(phrase);
  if (!spokenNorm || !phraseNorm) return 0;
  if (!phraseContained(spokenNorm, phraseNorm)) return 0;
  if (spokenNorm === phraseNorm) return 10_000 + phraseNorm.length;
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
  return stripWakeWords(text);
}

export function isLikelyTtsEcho(text: string): boolean {
  const n = normalizePhrase(text);
  if (!n) return true;
  const echoes = new Set([
    "а",
    "да",
    "ну",
    "что",
    "слушаю",
    "говори",
    "я тут",
    "ок",
    "готово",
    "не понял",
    "повтори",
  ]);
  if (echoes.has(n)) return true;
  const tokens = significantTokens(n);
  return tokens.length === 0;
}

export const STOP_PHRASES = [
  "стоп",
  "старт",
  "стопт",
  "стопа",
  "стопи",
  "stop",
  "stub",
  "топ",
  "хватит",
  "отмена",
  "отмени",
  "остановись",
  "останови",
  "прекрати",
  "всё",
  "все",
];

export function isStopPhrase(text: string): boolean {
  const n = normalizePhrase(commandTextFromUtterance(text) || text);
  if (!n) return false;
  if (STOP_PHRASES.includes(n)) return true;
  const toks = significantTokens(n);
  if (toks.length === 1 && STOP_PHRASES.includes(toks[0] ?? "")) return true;
  if (toks.length <= 2 && toks.some((t) => t === "стоп" || t === "старт" || t === "stop")) {
    return !/(?:музык|музон|диктов|писат|трек|песн)/.test(n);
  }
  return false;
}

const INCOMPLETE_STARTERS = new Set([
  "открой",
  "поставь",
  "скажи",
  "сделай",
  "выключи",
  "выруби",
  "останови",
  "переключи",
  "напиши",
  "набери",
  "open",
]);

export function isIncompleteCommandFragment(text: string): boolean {
  const n = normalizePhrase(commandTextFromUtterance(text));
  if (!n) return false;
  const toks = n.split(/\s+/).filter(Boolean);
  if (toks.length !== 1) return false;
  const tok = toks[0] ?? "";
  if (/^(?:включи|вруби|запусти|ключи|музык[а-яё]*|музон[а-яё]*)$/.test(tok)) {
    return false;
  }
  return INCOMPLETE_STARTERS.has(tok);
}

export function mergeCommandFragments(a: string, b: string): string {
  const left = normalizePhrase(a);
  const right = normalizePhrase(b);
  if (!left) return right;
  if (!right) return left;
  if (right.startsWith(left)) return right;
  if (left.startsWith(right)) return left;
  if (left.includes(right)) return left;
  if (right.includes(left)) return right;
  return `${left} ${right}`.replace(/\s+/g, " ").trim();
}
