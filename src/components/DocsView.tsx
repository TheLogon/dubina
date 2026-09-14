import {
  BUILTIN_SCENARIOS,
  MUSIC_PHRASES,
} from "../commands/builtins";
import { listChatterTopics } from "../commands/chatter";
import {
  DICTATION_START_PHRASES,
  DICTATION_STOP_PHRASES,
} from "../commands/dictation";

type Props = {
  onBack: () => void;
};

type DocBlock = {
  title: string;
  lead: string;
  example?: string;
  phrases: string[];
};

function Phrases({ items }: { items: string[] }) {
  return (
    <ul className="docs__phrases">
      {items.map((p) => (
        <li key={p}>
          <code>«{p}»</code>
        </li>
      ))}
    </ul>
  );
}

function Section({ title, lead, example, phrases }: DocBlock) {
  return (
    <section className="docs__section">
      <h3 className="docs__h">{title}</h3>
      <p className="docs__lead">{lead}</p>
      {example && <p className="docs__example">Пример: {example}</p>}
      <Phrases items={phrases} />
    </section>
  );
}

export function DocsView({ onBack }: Props) {
  const mediaPhrases = BUILTIN_SCENARIOS.map((s) => s.phrase);
  const chatter = listChatterTopics();

  return (
    <div className="panel docs">
      <div className="panel__head">
        <div>
          <h2 className="panel__title">Документация</h2>
          <p className="panel__sub">
            Все встроенные команды. Сначала скажи «Дубина», потом фразу.
          </p>
        </div>
        <button type="button" className="btn btn--ghost" onClick={onBack}>
          Назад
        </button>
      </div>

      <div className="docs__body">
        <Section
          title="Пробуждение"
          lead="Пока не услышит имя — команды не выполняются."
          example="«Дубина» или «Дубина, включи музыку»"
          phrases={["дубина", "дубину", "дубины", "dubina"]}
        />

        <Section
          title="Музыка"
          lead="Откроет плеер из настроек, дождётся запуска и нажмёт play."
          example="«Дубина, включи музыку»"
          phrases={MUSIC_PHRASES}
        />

        <Section
          title="Браузер и медиа"
          lead="Управление браузером и системными медиа-клавишами."
          phrases={mediaPhrases}
        />

        <Section
          title="Диктовка"
          lead="Пишет сказанное в активное поле (чат, мессенджер). Перед стартом кликни в поле ввода. На Mac нужен «Универсальный доступ»."
          example="«Дубина, напиши текст» → говори → «стоп»"
          phrases={DICTATION_START_PHRASES}
        />

        <Section
          title="Стоп диктовки"
          lead="Пока идёт диктовка, эти фразы завершают режим."
          phrases={DICTATION_STOP_PHRASES}
        />

        <section className="docs__section">
          <h3 className="docs__h">Болтовня</h3>
          <p className="docs__lead">
            Короткие ответы без сценария. Случайная реплика из списка.
          </p>
          <div className="docs__chatter">
            {chatter.map((topic) => (
              <div key={topic.triggers[0]} className="docs__chatter-card">
                <div className="docs__chatter-triggers">
                  {topic.triggers.map((t) => (
                    <code key={t}>«{t}»</code>
                  ))}
                </div>
                <p className="docs__chatter-replies muted">
                  Ответы: {topic.replies.map((r) => `«${r}»`).join(", ")}
                </p>
              </div>
            ))}
          </div>
        </section>

        <section className="docs__section">
          <h3 className="docs__h">Свои сценарии</h3>
          <p className="docs__lead">
            Во вкладке «Сценарии» можно добавить фразу и шаги: открыть
            программу, сайт, задержку, медиа. Они работают так же — после
            «Дубина».
          </p>
        </section>
      </div>
    </div>
  );
}
