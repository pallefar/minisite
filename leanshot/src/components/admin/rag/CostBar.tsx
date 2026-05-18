/**
 * Phase 50 Plan 50-02 — CostBar.
 *
 * Inline 4px progress bar showing month-to-date spend vs cap.
 * UI-SPEC §Color "cost-cap indicator" threshold rule:
 *   pct  < 80  → success
 *   80 ≤ pct < 100 → warning
 *   pct ≥ 100 → danger
 *
 * No new primitive — composes existing CSS tokens only.
 */

export interface CostBarProps {
  mtdUsd: number;
  capUsd: number;
}

function colorFor(pct: number): string {
  if (pct >= 100) return 'var(--color-danger)';
  if (pct >= 80) return 'var(--color-warning)';
  return 'var(--color-success)';
}

export function CostBar({ mtdUsd, capUsd }: CostBarProps) {
  const safeCap = capUsd > 0 ? capUsd : 1; // avoid /0; spec assumes capUsd > 0
  const pct = Math.min(100, Math.max(0, (mtdUsd / safeCap) * 100));
  const color = colorFor(pct);
  const label = `${mtdUsd.toFixed(2)} of ${capUsd.toFixed(2)} USD month-to-date, ${pct.toFixed(0)} percent of cap`;

  return (
    <div className="w-full">
      <div
        role="progressbar"
        aria-valuenow={Math.round(pct)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label}
        className="h-1 rounded-pill bg-[var(--color-surface-elevated)] overflow-hidden"
      >
        <div
          className="h-full rounded-pill"
          style={{ width: `${pct}%`, backgroundColor: color }}
        />
      </div>
      <p className="mt-1 text-xs font-mono tabular-nums text-[var(--color-text-secondary)]">
        ${mtdUsd.toFixed(2)} of ${capUsd.toFixed(2)} MTD · {pct.toFixed(0)}%
      </p>
    </div>
  );
}

export default CostBar;
