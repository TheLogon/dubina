import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { ScenarioStep } from "../types/scenario";
import { STEP_LABELS } from "../types/scenario";
import { AppPicker } from "./AppPicker";

type Props = {
  step: ScenarioStep;
  onChange: (step: ScenarioStep) => void;
  onRemove: () => void;
};

export function StepCard({ step, onChange, onRemove }: Props) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: step.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.85 : 1,
  };

  const needsApp = step.type === "open_app" || step.type === "close_app";
  const noConfig =
    step.type === "open_browser" ||
    step.type === "media_play_pause" ||
    step.type === "media_next" ||
    step.type === "media_previous";

  return (
    <div ref={setNodeRef} style={style} className="step-card">
      <button
        type="button"
        className="step-card__handle"
        aria-label="Перетащить"
        {...attributes}
        {...listeners}
      >
        ⋮⋮
      </button>

      <div className="step-card__body">
        <div className="step-card__label">{STEP_LABELS[step.type]}</div>

        {step.type === "delay" ? (
          <label className="field">
            <span>Секунды</span>
            <input
              type="number"
              min={0}
              step={0.5}
              value={step.seconds ?? 2}
              onChange={(e) =>
                onChange({
                  ...step,
                  seconds: Number(e.target.value) || 0,
                })
              }
            />
          </label>
        ) : step.type === "open_url" ? (
          <label className="field">
            <span>Адрес сайта</span>
            <input
              type="url"
              placeholder="https://music.yandex.ru"
              value={step.value}
              onChange={(e) => onChange({ ...step, value: e.target.value })}
            />
          </label>
        ) : needsApp ? (
          <div className="field">
            <span>{step.type === "open_app" ? "Программа" : "Что закрыть"}</span>
            <AppPicker
              value={step.value}
              onChange={(app) => onChange({ ...step, value: app.path })}
            />
          </div>
        ) : noConfig ? (
          <p className="muted step-card__hint">
            {step.type === "open_browser"
              ? "Откроет браузер по умолчанию"
              : "Системная медиа-клавиша (Spotify, Яндекс Музыка и т.д.)"}
          </p>
        ) : null}
      </div>

      <button
        type="button"
        className="btn btn--danger step-card__remove"
        onClick={onRemove}
      >
        ×
      </button>
    </div>
  );
}
