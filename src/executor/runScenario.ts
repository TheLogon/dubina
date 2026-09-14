import { invoke } from "@tauri-apps/api/core";
import type { Scenario, ScenarioStep } from "../types/scenario";
import { playActionSafe } from "../audio/soundPlayer";

export type RunProgress = {
  index: number;
  total: number;
  step: ScenarioStep;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runStep(step: ScenarioStep): Promise<void> {
  switch (step.type) {
    case "delay": {
      const sec = Math.max(0, step.seconds ?? 1);
      await sleep(sec * 1000);
      break;
    }
    case "open_url": {
      await invoke("open_url", { url: step.value.trim() });
      break;
    }
    case "open_app": {
      await invoke("open_app", { name: step.value.trim() });
      break;
    }
    case "close_app": {
      await invoke("close_app", { name: step.value.trim() });
      break;
    }
    case "open_browser": {
      await invoke("open_default_browser");
      break;
    }
    case "media_play_pause": {
      await invoke("media_key", { action: "play_pause" });
      break;
    }
    case "media_next": {
      await invoke("media_key", { action: "next" });
      break;
    }
    case "media_previous": {
      await invoke("media_key", { action: "previous" });
      break;
    }
    case "play_music": {
      await invoke("start_music_player", { appPath: step.value.trim() });
      break;
    }
    default:
      break;
  }
}

export async function runScenario(
  scenario: Scenario,
  onProgress?: (p: RunProgress) => void,
  signal?: { cancelled: boolean },
): Promise<void> {
  const total = scenario.steps.length;
  for (let i = 0; i < total; i++) {
    if (signal?.cancelled) return;
    const step = scenario.steps[i];
    onProgress?.({ index: i, total, step });
    await runStep(step);
  }
  if (signal?.cancelled) return;
  playActionSafe("ok");
}
