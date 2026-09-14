export type StepType =
  | "open_app"
  | "close_app"
  | "open_url"
  | "delay"
  | "open_browser"
  | "media_play_pause"
  | "media_next"
  | "media_previous"
  | "play_music";

export interface ScenarioStep {
  id: string;
  type: StepType;
  value: string;
  seconds?: number;
}

export interface Scenario {
  id: string;
  phrase: string;
  steps: ScenarioStep[];
  createdAt: string;
  updatedAt: string;
  builtin?: boolean;
}

export type AppView = "home" | "scenarios" | "editor" | "settings" | "docs";

export type ListenerState = "idle" | "wake" | "listening" | "running" | "error" | "dictation";

export const STEP_LABELS: Record<StepType, string> = {
  open_app: "Открыть программу",
  close_app: "Закрыть программу",
  open_url: "Открыть сайт",
  delay: "Задержка",
  open_browser: "Открыть браузер",
  media_play_pause: "Play / Pause",
  media_next: "Следующий трек",
  media_previous: "Предыдущий трек",
  play_music: "Включить музыку",
};

export function createStep(type: StepType): ScenarioStep {
  const id = crypto.randomUUID();
  switch (type) {
    case "delay":
      return { id, type, value: "", seconds: 2 };
    case "open_url":
      return { id, type, value: "https://" };
    default:
      return { id, type, value: "" };
  }
}

export function createEmptyScenario(): Scenario {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    phrase: "",
    steps: [],
    createdAt: now,
    updatedAt: now,
  };
}
