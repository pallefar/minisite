/**
 * Phase 19 Plan 19-06a — PartnerKpiCard.
 *
 * Spec references:
 *   - 19-UI-SPEC.md §/partner/dashboard KPI card anatomy
 *   - 19-PATTERNS.md §C.4 KPI primitive composition
 *
 * Per UI-SPEC accent-reserved-for list: the KPI value is one of 6 accent-using
 * elements per surface. Body text + caption use the secondary token (NOT accent).
 *
 * Typography budget per UI-SPEC /partner/dashboard:
 *   - `text-3xl`  KPI value  (1 size per card)
 *   - `text-xs`   label + delta (1 size per card)
 * → 2 sizes per card; 2 weights (semibold value, normal label/delta).
 */
import { type ReactNode } from 'react';
import { Card } from '@/components/ui/Card';
import { useCountUp } from '@/hooks/useCountUp';

export type KpiFormat = 'count' | 'currency';

export interface PartnerKpiCardProps {
  label: string;
  /** Raw numeric value. For currency, pass cents — the formatter converts to dollars. */
  value: number;
  /** Percent delta vs prev 30d (positive/negative number); null when no comparison. */
  deltaPct: number | null;
  icon: ReactNode;
  format?: KpiFormat;
}

function formatCount(n: number): string {
  return Math.round(n).toLocaleString('en-US');
}

function formatCurrency(cents: number): string {
  const dollars = Math.round(cents) / 100;
  return `$${dollars.toFixed(2)}`;
}

export function PartnerKpiCard({
  label,
  value,
  deltaPct,
  icon,
  format = 'count',
}: PartnerKpiCardProps): ReactNode {
  const animated = useCountUp(value, { duration: 800 });
  const displayed = format === 'currency' ? formatCurrency(animated) : formatCount(animated);

  const deltaText =
    deltaPct === null || deltaPct === 0
      ? '—'
      : `${deltaPct > 0 ? '+' : ''}${Math.round(deltaPct)}% vs prev 30d`;
  const deltaTone =
    deltaPct === null || deltaPct === 0
      ? 'text-[var(--color-text-secondary)]'
      : deltaPct > 0
        ? 'text-[var(--color-success)]'
        : 'text-[var(--color-danger)]';

  return (
    <Card span={3} padding="md">
      <div className="flex items-center justify-between gap-2 mb-2">
        <p className="text-xs font-semibold text-[var(--color-text-secondary)] uppercase tracking-[0.04em]">
          {label}
        </p>
        <span aria-hidden className="text-[var(--color-text-tertiary)]">
          {icon}
        </span>
      </div>
      <p
        aria-live="polite"
        className="text-3xl font-semibold text-[var(--color-primary)] tabular-nums leading-tight"
      >
        {displayed}
      </p>
      <p className={`text-xs ${deltaTone} mt-1`}>{deltaText}</p>
    </Card>
  );
}
