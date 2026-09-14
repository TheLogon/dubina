import { motion } from "framer-motion";

type Props = {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  ariaLabel?: string;
};

export function Switch({ checked, onChange, disabled, ariaLabel }: Props) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      disabled={disabled}
      className={`switch ${checked ? "is-on" : ""}`}
      onClick={() => onChange(!checked)}
    >
      <motion.span
        className="switch__thumb"
        animate={{ x: checked ? 22 : 0 }}
        transition={{ type: "spring", stiffness: 520, damping: 34 }}
      />
    </button>
  );
}
