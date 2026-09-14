import { useMemo, useState } from "react";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { motion, AnimatePresence } from "framer-motion";
import type { Scenario, ScenarioStep, StepType } from "../types/scenario";
import { STEP_LABELS, createStep } from "../types/scenario";
import { StepCard } from "./StepCard";
import { runScenario } from "../executor/runScenario";

type Props = {
  scenario: Scenario;
  onChange: (scenario: Scenario) => void;
  onSave: () => void;
  onCancel: () => void;
};

const ADDABLE: StepType[] = [
  "open_app",
  "close_app",
  "open_url",
  "delay",
  "open_browser",
  "media_play_pause",
  "media_next",
  "media_previous",
];

export function ScenarioEditor({ scenario, onChange, onSave, onCancel }: Props) {
  const [testing, setTesting] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const ids = useMemo(() => scenario.steps.map((s) => s.id), [scenario.steps]);

  function updateSteps(steps: ScenarioStep[]) {
    onChange({ ...scenario, steps });
  }

  function onDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = scenario.steps.findIndex((s) => s.id === active.id);
    const newIndex = scenario.steps.findIndex((s) => s.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;
    updateSteps(arrayMove(scenario.steps, oldIndex, newIndex));
  }

  function addStep(type: StepType) {
    updateSteps([...scenario.steps, createStep(type)]);
  }

  async function handleTest() {
    setError(null);
    if (!scenario.phrase.trim()) {
      setError("Сначала впиши фразу.");
      return;
    }
    if (scenario.steps.length === 0) {
      setError("Добавь хотя бы один шаг.");
      return;
    }
    setTesting(true);
    setProgress("Запуск…");
    try {
      await runScenario(scenario, ({ index, total, step }) => {
        setProgress(
          `Шаг ${index + 1}/${total}: ${STEP_LABELS[step.type]}`,
        );
      });
      setProgress("Готово");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка выполнения");
      setProgress(null);
    } finally {
      setTesting(false);
    }
  }

  function handleSave() {
    setError(null);
    if (!scenario.phrase.trim()) {
      setError("Впиши фразу, по которой запускать сценарий.");
      return;
    }
    onSave();
  }

  return (
    <div className="panel editor">
      <div className="panel__head">
        <div>
          <h2 className="panel__title">Редактор сценария</h2>
          <p className="panel__sub">Фраза → шаги → проверка → сохранить</p>
        </div>
        <button type="button" className="btn btn--ghost" onClick={onCancel}>
          Назад
        </button>
      </div>

      <label className="field field--lg">
        <span>Что сказать после обращения к Дубине</span>
        <input
          type="text"
          placeholder="пора поработать"
          value={scenario.phrase}
          onChange={(e) => onChange({ ...scenario, phrase: e.target.value })}
          autoFocus
        />
      </label>

      <div className="editor__steps-head">
        <h3>Шаги</h3>
        <p>Перетаскивай карточки, чтобы поменять порядок</p>
        <p className="muted">
          Музыку лучше через встроенную команду «включи музыку» (плеер в
          настройках). Здесь — свои сценарии.
        </p>
      </div>

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={ids} strategy={verticalListSortingStrategy}>
          <div className="steps">
            <AnimatePresence initial={false}>
              {scenario.steps.map((step) => (
                <motion.div
                  key={step.id}
                  layout
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                >
                  <StepCard
                    step={step}
                    onChange={(next) =>
                      updateSteps(
                        scenario.steps.map((s) => (s.id === next.id ? next : s)),
                      )
                    }
                    onRemove={() =>
                      updateSteps(scenario.steps.filter((s) => s.id !== step.id))
                    }
                  />
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        </SortableContext>
      </DndContext>

      {scenario.steps.length === 0 && (
        <p className="muted">Пока нет шагов — добавь действие ниже.</p>
      )}

      <div className="add-steps">
        {ADDABLE.map((type) => (
          <button
            key={type}
            type="button"
            className="btn btn--chip"
            onClick={() => addStep(type)}
          >
            + {STEP_LABELS[type]}
          </button>
        ))}
      </div>

      {(error || progress) && (
        <div className={`banner ${error ? "banner--error" : "banner--ok"}`}>
          {error ?? progress}
        </div>
      )}

      <div className="editor__footer">
        <button
          type="button"
          className="btn btn--ghost"
          disabled={testing}
          onClick={() => void handleTest()}
        >
          {testing ? "Проверка…" : "Проверить"}
        </button>
        <button type="button" className="btn btn--primary" onClick={handleSave}>
          Сохранить
        </button>
      </div>
    </div>
  );
}
