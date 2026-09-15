import {
  BROWSER_PHRASES,
  MUSIC_PHRASES,
  NEXT_PHRASES,
  PAUSE_PHRASES,
  PREV_PHRASES,
  RESUME_PHRASES,
  WEATHER_PHRASES,
} from "../commands/builtins";
import { listChatterTopics } from "../commands/chatter";
import {
  DICTATION_START_PHRASES,
  DICTATION_STOP_PHRASES,
} from "../commands/dictation";
import { WAKE_FORMS_RU } from "../voice/wake";

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
  const chatter = listChatterTopics();

  return (
    <div className="panel docs">
      <div className="panel__head">
        <div>
          <h2 className="panel__title">Документация</h2>
          <p className="panel__sub">
            Обращение «Дубина», затем команда. Можно говорить свободно — имя и
            лишние слова отбрасываются.
          </p>
        </div>
        <button type="button" className="btn btn--ghost" onClick={onBack}>
          Назад
        </button>
      </div>

      <div className="docs__body">
        <Section
          title="Пробуждение"
          lead="Пока не услышит имя — команды не выполняются. Подходят все падежи. После ответа можно говорить следующую команду без повторного «Дубина». Круг на главной тоже включает режим слушания."
          example="«Дубина» · «Дубину» · «Дубина, включи музыку»"
          phrases={[...WAKE_FORMS_RU, "dubina"]}
        />

        <Section
          title="Свободная речь"
          lead="Не обязательно говорить только команду. Фраза может быть грязной — Дубина вытащит смысл."
          example="«Дубина емае включи уже музыку» → включи музыку"
          phrases={[
            "дубина включи уже музыку",
            "дубина скажи погоду",
            "включи музыку пожалуйста",
          ]}
        />

        <Section
          title="Музыка"
          lead="Откроет плеер из настроек, дождётся запуска и нажмёт play."
          example="«Дубина вруби музон»"
          phrases={MUSIC_PHRASES}
        />

        <Section
          title="Пауза и продолжить"
          lead="Системные медиа-клавиши: пауза / play для текущего плеера."
          example="«Дубина поставь на паузу»"
          phrases={[...PAUSE_PHRASES, ...RESUME_PHRASES]}
        />

        <Section
          title="Треки"
          lead="Следующий и предыдущий трек."
          example="«Дубина включи следующую» · «Дубина следующий трек»"
          phrases={[...NEXT_PHRASES, ...PREV_PHRASES]}
        />

        <Section
          title="Погода"
          lead="Скажет краткую погоду вслух. Если сеть недоступна — откроет Яндекс Погоду."
          example="«Дубина скажи погоду»"
          phrases={WEATHER_PHRASES}
        />

        <Section
          title="Браузер"
          lead="Открывает браузер по умолчанию."
          phrases={BROWSER_PHRASES}
        />

        <Section
          title="Диктовка"
          lead="Пишет сказанное в активное поле (чат, мессенджер). Перед стартом кликни в поле ввода. На Mac нужен «Универсальный доступ»."
          example="«Дубина напиши текст» → говори → «стоп»"
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
            программу, сайт, задержку, медиа. Фраза тоже ищется внутри свободной
            речи после «Дубина».
          </p>
        </section>
      </div>
    </div>
  );
}
