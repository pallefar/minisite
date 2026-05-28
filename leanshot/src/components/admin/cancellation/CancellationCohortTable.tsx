/**
 * Phase 40 Plan 40-06 — CancellationCohortTable.
 *
 * Cohort breakdown table per UI-SPEC Surface 3 "Cohort breakdown table" (lines 319-330):
 *   - Rows = cohort, Columns: Cohort | Pause | Discount | Extended trial | Downgrade | Best offer
 *   - Acceptance rate cells bold when ≥ 30%
 *   - "Best offer" column: Badge tone=info with offer type name
 *   - Sticky first column on mobile horizontal scroll
 */
import { ArrowDownToLine, BadgePercent, CalendarPlus, PauseCircle } from 'lucide-react';
import { useMemo } from 'react';
import { Badge } from '@/components/ui/Badge';
import { cn } from '@/lib/helpers';
import type { RoiViewRow } from './CancellationRoiKpiTiles';

const OFFER_TYPES = ['pause', 'discount', 'extended_trial', 'downgrade'] as const;
type OfferType = (typeof OFFER_TYPES)[number];

const OFFER_LABELS: Record<OfferType, string> = {
  pause: 'Pause',
  discount: 'Discount',
  extended_trial: 'Extended trial',
  downgrade: 'Downgrade',
};

const OFFER_ICONS: Record<OfferType, React.ReactNode> = {
  pause: <PauseCircle size={11} aria-hidden />,
  discount: <BadgePercent size={11} aria-hidden />,
  extended_trial: <CalendarPlus size={11} aria-hidden />,
  downgrade: <ArrowDownToLine size={11} aria-hidden />,
};

interface CohortRow {
  cohortId: string;
  rates: Record<OfferType, number>; // acceptance rate 0-100
  bestOffer: OfferType | null;
}

function computeCohortRows(rows: RoiViewRow[]): CohortRow[] {
  // Group by cohort_id
  const cohortMap = new Map<string, Record<OfferType, { accepted: number; shown: number }>>();

  for (const row of rows) {
    const cohortId = row.cohort_id ?? '(unassigned)';
    if (!cohortMap.has(cohortId)) {
      cohortMap.set(cohortId, {
        pause: { accepted: 0, shown: 0 },
        discount: { accepted: 0, shown: 0 },
        extended_trial: { accepted: 0, shown: 0 },
        downgrade: { accepted: 0, shown: 0 },
      });
    }
    const entry = cohortMap.get(cohortId)!;
    if (OFFER_TYPES.includes(row.offer_type as OfferType)) {
      const ot = row.offer_type as OfferType;
      entry[ot].accepted += row.accepted_count ?? 0;
      entry[ot].shown += row.shown_count ?? 0;
    }
  }

  return Array.from(cohortMap.entries()).map(([cohortId, counts]) => {
    const rates = {} as Record<OfferType, number>;
    let bestOffer: OfferType | null = null;
    let bestRate = -1;

    for (const ot of OFFER_TYPES) {
      const rate = counts[ot].shown > 0 ? (counts[ot].accepted / counts[ot].shown) * 100 : 0;
      rates[ot] = rate;
      if (rate > bestRate) {
        bestRate = rate;
        bestOffer = ot;
      }
    }

    return { cohortId, rates, bestOffer };
  });
}

interface CancellationCohortTableProps {
  rows: RoiViewRow[];
  loading: boolean;
}

export function CancellationCohortTable({ rows, loading }: CancellationCohortTableProps) {
  const cohortRows = useMemo(() => computeCohortRows(rows), [rows]);

  if (loading) {
    return (
      <div className="animate-pulse space-y-2">
        {[...Array(3)].map((_, i) => (
          <div key={i} className="h-10 bg-[var(--color-border)] rounded" />
        ))}
      </div>
    );
  }

  if (cohortRows.length === 0) {
    return (
      <p className="text-[13px] text-[var(--color-text-secondary)] py-4 text-center">
        No cohort data available in the selected range.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto -mx-2 px-2">
      <table
        className="w-full border-collapse"
        aria-label="Cohort breakdown: acceptance rate per offer type"
      >
        <thead>
          <tr className="border-b border-[var(--color-border)]">
            <th
              className="sticky left-0 z-10 bg-[var(--color-surface)] text-start text-[12px] font-semibold text-[var(--color-text-secondary)] uppercase tracking-[0.04em] px-3 py-2.5 min-w-[140px]"
              scope="col"
            >
              Cohort
            </th>
            {OFFER_TYPES.map((ot) => (
              <th
                key={ot}
                className="text-start text-[12px] font-semibold text-[var(--color-text-secondary)] uppercase tracking-[0.04em] px-3 py-2.5 min-w-[90px]"
                scope="col"
              >
                {OFFER_LABELS[ot]}
              </th>
            ))}
            <th
              className="text-start text-[12px] font-semibold text-[var(--color-text-secondary)] uppercase tracking-[0.04em] px-3 py-2.5 min-w-[120px]"
              scope="col"
            >
              Best offer
            </th>
          </tr>
        </thead>
        <tbody>
          {cohortRows.map((row) => (
            <tr
              key={row.cohortId}
              className="border-b border-[var(--color-border)] hover:bg-[var(--color-surface-elevated)] transition-colors"
            >
              <td
                className="sticky left-0 z-10 bg-[var(--color-surface)] px-3 py-2.5 text-[13px] font-medium text-[var(--color-text)] min-w-[140px]"
                style={{ backgroundColor: 'var(--color-surface)' }}
              >
                <span className="truncate block max-w-[140px]" title={row.cohortId}>
                  {row.cohortId}
                </span>
              </td>
              {OFFER_TYPES.map((ot) => {
                const rate = row.rates[ot];
                return (
                  <td
                    key={ot}
                    className={cn(
                      'px-3 py-2.5 text-[13px] tabular-nums text-[var(--color-text)]',
                      rate >= 30 && 'font-bold text-[var(--color-success)]',
                    )}
                  >
                    {rate > 0 ? `${rate.toFixed(1)} %` : '—'}
                  </td>
                );
              })}
              <td className="px-3 py-2.5">
                {row.bestOffer && row.rates[row.bestOffer] > 0 ? (
                  <Badge tone="info" leadingIcon={OFFER_ICONS[row.bestOffer]}>
                    {OFFER_LABELS[row.bestOffer]}
                  </Badge>
                ) : (
                  <span className="text-[13px] text-[var(--color-text-tertiary)]">—</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
