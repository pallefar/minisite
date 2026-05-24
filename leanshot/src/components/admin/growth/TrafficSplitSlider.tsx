/**
 * Phase 39 Plan 39-07 — TrafficSplitSlider (UI-SPEC Variant traffic share).
 *
 * Composition: Input type=range + 5 preset Pills (10/20/50/80/90).
 *
 * The Pills are the snappable presets; the range input handles arbitrary
 * values between them. Both surfaces call the same onChange callback.
 *
 * Tokens-only: range input style uses Tailwind utility classes only — NO
 * inline hex literals. The Pill primitive provides --color-primary accent
 * when active (UI-SPEC accent reserved-for list).
 */
import { Pill } from '@/components/ui/Pill';

export interface TrafficSplitSliderProps {
  /** 0..100 — current variant traffic share percent. */
  value: number;
  onChange: (next: number) => void;
}

const PRESETS = [10, 20, 50, 80, 90] as const;

export function TrafficSplitSlider({
  value,
  onChange,
}: TrafficSplitSliderProps): React.JSX.Element {
  return (
    <div className="flex flex-col gap-3">
      <div
        className="flex items-center gap-3"
        role="group"
        aria-label="Variant traffic share"
      >
        <input
          type="range"
          min={0}
          max={100}
          step={1}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          className="flex-1 accent-[var(--color-primary)]"
          aria-label="Variant traffic share"
        />
        <span className="text-sm font-bold tabular-nums w-12 text-right">
          {value}%
        </span>
      </div>
      <div className="flex flex-wrap gap-2">
        {PRESETS.map((p) => (
          <Pill
            key={p}
            size="sm"
            active={value === p}
            onClick={() => onChange(p)}
          >
            {p}%
          </Pill>
        ))}
      </div>
    </div>
  );
}

export default TrafficSplitSlider;
