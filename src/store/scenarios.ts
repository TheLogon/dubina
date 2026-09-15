import type { Scenario, ScenarioStep, StepType } from "../types/scenario";
import {
  commandTextFromUtterance,
  normalizePhrase,
  pickBestPhraseMatch,
} from "../voice/matchCommand";

export { normalizePhrase };

const STORAGE_KEY = "dubina.scenarios.v1";

const VALID_STEPS = new Set<StepType>([
  "open_app",
  "close_app",
  "open_url",
  "delay",
  "open_browser",
  "media_play_pause",
  "media_next",
  "media_previous",
  "play_music",
]);

function sanitizeScenario(raw: Scenario): Scenario {
  return {
    ...raw,
    steps: (raw.steps ?? []).filter((s): s is ScenarioStep =>
      VALID_STEPS.has(s.type as StepType),
    ),
  };
}

export function loadScenarios(): Scenario[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Scenario[];
    return Array.isArray(parsed) ? parsed.map(sanitizeScenario) : [];
  } catch {
    return [];
  }
}

export function saveScenarios(scenarios: Scenario[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(scenarios));
}

export function upsertScenario(
  scenarios: Scenario[],
  scenario: Scenario,
): Scenario[] {
  const idx = scenarios.findIndex((s) => s.id === scenario.id);
  const next = [...scenarios];
  const updated = { ...scenario, updatedAt: new Date().toISOString() };
  if (idx >= 0) next[idx] = updated;
  else next.unshift(updated);
  saveScenarios(next);
  return next;
}

export function deleteScenario(scenarios: Scenario[], id: string): Scenario[] {
  const next = scenarios.filter((s) => s.id !== id);
  saveScenarios(next);
  return next;
}

export function findScenarioByPhrase(
  scenarios: Scenario[],
  spoken: string,
): Scenario | undefined {
  const text = commandTextFromUtterance(spoken);
  if (!text) return undefined;
  return pickBestPhraseMatch(text, scenarios, (s) => s.phrase);
}
