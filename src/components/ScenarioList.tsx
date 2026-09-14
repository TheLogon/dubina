import { motion } from "framer-motion";
import type { Scenario } from "../types/scenario";

type Props = {
  scenarios: Scenario[];
  onCreate: () => void;
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
  onRun: (id: string) => void;
};

export function ScenarioList({
  scenarios,
  onCreate,
  onEdit,
  onDelete,
  onRun,
}: Props) {
  return (
    <div className="panel">
      <div className="panel__head">
        <div>
          <h2 className="panel__title">Сценарии</h2>
          <p className="panel__sub">
            Встроенные: музыка, браузер, «напиши текст» (диктовка в чат),
            болтовня — «привет», «как дела»…
          </p>
        </div>
        <button type="button" className="btn btn--primary" onClick={onCreate}>
          Новый сценарий
        </button>
      </div>

      {scenarios.length === 0 ? (
        <div className="empty">
          <p>Пока пусто. Создай первый сценарий — например «пора поработать».</p>
          <button type="button" className="btn btn--ghost" onClick={onCreate}>
            Создать
          </button>
        </div>
      ) : (
        <ul className="scenario-list">
          {scenarios.map((s, i) => (
            <motion.li
              key={s.id}
              className="scenario-row"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.04 }}
            >
              <div className="scenario-row__main">
                <strong>«{s.phrase || "без фразы"}»</strong>
                <span>{s.steps.length} шагов</span>
              </div>
              <div className="scenario-row__actions">
                <button type="button" className="btn btn--ghost" onClick={() => onRun(s.id)}>
                  Запуск
                </button>
                <button type="button" className="btn btn--ghost" onClick={() => onEdit(s.id)}>
                  Изменить
                </button>
                <button
                  type="button"
                  className="btn btn--danger"
                  onClick={() => onDelete(s.id)}
                >
                  Удалить
                </button>
              </div>
            </motion.li>
          ))}
        </ul>
      )}
    </div>
  );
}
