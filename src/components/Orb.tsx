import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import type { ListenerState } from "../types/scenario";

type Props = {
  state: ListenerState;
};

const STATE_HINT: Record<ListenerState, string> = {
  idle: "Скажи «Дубина»",
  wake: "А?",
  listening: "Слушаю…",
  running: "Выполняю…",
  error: "Не понял",
  dictation: "Диктовка…",
};

export function Orb({ state }: Props) {
  const [pulse, setPulse] = useState(0);

  useEffect(() => {
    if (state !== "idle") return;
    const id = window.setInterval(() => setPulse((p) => p + 1), 2400);
    return () => window.clearInterval(id);
  }, [state]);

  const active = state !== "idle";

  return (
    <div className="orb-wrap">
      <motion.div
        className={`orb orb--${state}`}
        animate={{
          scale: active ? [1, 1.06, 1] : [1, 1.03, 1],
          boxShadow:
            state === "listening" || state === "dictation"
              ? [
                  "0 0 40px rgba(232, 168, 56, 0.35)",
                  "0 0 70px rgba(232, 168, 56, 0.55)",
                  "0 0 40px rgba(232, 168, 56, 0.35)",
                ]
              : state === "running"
                ? [
                    "0 0 36px rgba(72, 201, 176, 0.35)",
                    "0 0 64px rgba(72, 201, 176, 0.5)",
                    "0 0 36px rgba(72, 201, 176, 0.35)",
                  ]
                : [
                    "0 0 28px rgba(232, 168, 56, 0.2)",
                    "0 0 48px rgba(232, 168, 56, 0.32)",
                    "0 0 28px rgba(232, 168, 56, 0.2)",
                  ],
        }}
        transition={{
          duration: state === "listening" || state === "dictation" ? 1.2 : 2.4,
          repeat: Infinity,
          ease: "easeInOut",
        }}
        key={pulse}
      >
        <span className="orb__core" />
        <span className="orb__ring" />
      </motion.div>
      <motion.p
        className="orb__hint"
        key={state}
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25 }}
      >
        {STATE_HINT[state]}
      </motion.p>
    </div>
  );
}
