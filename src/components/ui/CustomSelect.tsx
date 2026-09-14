import { useEffect, useId, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";

export type SelectOption = {
  value: string;
  label: string;
};

type Props = {
  label: string;
  value: string;
  options: SelectOption[];
  placeholder?: string;
  onChange: (value: string) => void;
};

export function CustomSelect({
  label,
  value,
  options,
  placeholder = "По умолчанию",
  onChange,
}: Props) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const listId = useId();

  const selected =
    options.find((o) => o.value === value)?.label ||
    (value === "" ? placeholder : value);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  return (
    <div className="field field--settings" ref={rootRef}>
      <span>{label}</span>
      <button
        type="button"
        className={`cselect ${open ? "is-open" : ""}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="cselect__value">{selected}</span>
        <motion.span
          className="cselect__chev"
          animate={{ rotate: open ? 180 : 0 }}
          transition={{ duration: 0.2 }}
        >
          ▾
        </motion.span>
      </button>

      <AnimatePresence>
        {open && (
          <motion.ul
            id={listId}
            role="listbox"
            className="cselect__menu"
            initial={{ opacity: 0, y: -6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.98 }}
            transition={{ duration: 0.16 }}
          >
            <li>
              <button
                type="button"
                role="option"
                className={value === "" ? "is-active" : ""}
                onClick={() => {
                  onChange("");
                  setOpen(false);
                }}
              >
                {placeholder}
              </button>
            </li>
            {options.map((o) => (
              <li key={o.value}>
                <button
                  type="button"
                  role="option"
                  className={value === o.value ? "is-active" : ""}
                  onClick={() => {
                    onChange(o.value);
                    setOpen(false);
                  }}
                >
                  {o.label}
                </button>
              </li>
            ))}
          </motion.ul>
        )}
      </AnimatePresence>
    </div>
  );
}
