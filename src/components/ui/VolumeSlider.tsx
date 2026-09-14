type Props = {
  label: string;
  value: number;
  onChange: (value: number) => void;
};

export function VolumeSlider({ label, value, onChange }: Props) {
  const pct = Math.round(Math.min(1, Math.max(0, value)) * 100);

  return (
    <div className="field field--settings">
      <span>
        {label} — {pct}%
      </span>
      <div className="vslider">
        <div className="vslider__track" aria-hidden>
          <div className="vslider__fill" style={{ width: `${pct}%` }} />
        </div>
        <div
          className="vslider__thumb"
          style={{ left: `${pct}%` }}
          aria-hidden
        />
        <input
          className="vslider__input"
          type="range"
          min={0}
          max={100}
          value={pct}
          onChange={(e) => onChange(Number(e.target.value) / 100)}
          aria-label={label}
        />
      </div>
    </div>
  );
}
