/**
 * Phase 22 Plan 22-08 — Cohort retention heatmap (ADMIN-08).
 *
 * Pure presentational CSS-grid heatmap. No new chart primitive — grid layout
 * per UI-SPEC line 279 with cell density via `color-mix(in srgb, ...)`.
 *
 * K-anonymity contract (T-22-10 mitigation, D-08): cells with active_users < 10
 * render as "<10" instead of the exact count + retention pct. The server
 * (admin_get_cohort_retention RPC + cohort_retention view) exposes RAW counts;
 * suppression is enforced HERE in the display layer.
 *
 * Performance: `will-change: transform` on grid for smooth toggle expand;
 * v1.3 virtualization deferred.
 *
 * Browser support: color-mix() requires Safari ≥ 16.4 / Chrome ≥ 111 — both
 * inside the ES2022 / DOM Lib target per CLAUDE.md.
 */
import { Fragment, useMemo } from 'react';

import { EmptyState } from '@/components/ui/EmptyState';

export interface CohortCell {
  cohort_week: string; // YYYY-MM-DD (Monday-anchored)
  day_offset: number; // 0..90
  active_users: number; // RAW count; <10 triggers k-anonymity
  retention_pct: number; // 0..100
  cohort_size: number; // total signups in this cohort week
}

export interface CohortHeatmapProps {
  rows: CohortCell[];
  /** Total day columns to render; defaults to 91 (UI-SPEC line 279). */
  totalDays?: number;
  /** k-anonymity threshold; cells with active_users < threshold render "<10". */
  kAnonymityThreshold?: number;
}

const DEFAULT_DAYS = 91;
const DEFAULT_K = 10;

function formatCohortLabel(cohortWeek: string): string {
  // "Week of {date}" per UI-SPEC line 544.
  try {
    const d = new Date(cohortWeek + 'T00:00:00Z');
    return `Week of ${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;
  } catch {
    return `Week of ${cohortWeek}`;
  }
}

interface CellTooltipInputs {
  cohort_week: string;
  day_offset: number;
  active_users: number;
  retention_pct: number;
  cohort_size: number;
  suppressed: boolean;
}

function formatCellTooltip({
  cohort_week,
  day_offset,
  active_users,
  retention_pct,
  cohort_size,
  suppressed,
}: CellTooltipInputs): string {
  // UI-SPEC line 546:
  //   "{pct}% retention · {active_users}/{cohort_size} users active on day {day} of cohort starting {date}"
  if (suppressed) {
    return `Hidden for privacy · fewer than ${DEFAULT_K} users active on day ${day_offset} of cohort starting ${cohort_week}`;
  }
  return (
    `${Math.round(retention_pct)}% retention · ${active_users}/${cohort_size} users ` +
    `active on day ${day_offset} of cohort starting ${cohort_week}`
  );
}

function formatCellAriaLabel({
  cohort_week,
  day_offset,
  active_users,
  retention_pct,
  cohort_size,
  suppressed,
}: CellTooltipInputs): string {
  if (suppressed) {
    return `Hidden for privacy — fewer than ${DEFAULT_K} users active on day ${day_offset} of cohort starting ${cohort_week}`;
  }
  return `${Math.round(retention_pct)} percent retention, ${active_users} of ${cohort_size} users active on day ${day_offset} of cohort starting ${cohort_week}`;
}

export function CohortHeatmap({
  rows,
  totalDays = DEFAULT_DAYS,
  kAnonymityThreshold = DEFAULT_K,
}: CohortHeatmapProps) {
  // Group rows by cohort_week. Each cohort row becomes a label + N day cells.
  const cohorts = useMemo(() => {
    const map = new Map<string, Map<number, CohortCell>>();
    for (const r of rows) {
      let inner = map.get(r.cohort_week);
      if (!inner) {
        inner = new Map();
        map.set(r.cohort_week, inner);
      }
      inner.set(r.day_offset, r);
    }
    // Sort cohort_week DESC (most recent first) — matches RPC ordering.
    return Array.from(map.entries()).sort(([a], [b]) => (a < b ? 1 : -1));
  }, [rows]);

  if (cohorts.length === 0) {
    return (
      <div className="flex justify-center">
        <EmptyState
          title="No cohort data yet"
          body="The cohort matview refreshes daily at 02:00 UTC. Check back tomorrow."
        />
      </div>
    );
  }

  // Tailwind v4 dynamic-class caveat: arbitrary values with underscores work
  // when used verbatim; we keep the test's exact substring match by using
  // the literal class string. Adjust totalDays at the data layer if needed.
  const gridClass =
    totalDays === DEFAULT_DAYS
      ? 'grid grid-cols-[120px_repeat(91,_minmax(8px,_1fr))] gap-px'
      : `grid gap-px`;

  const gridStyle =
    totalDays === DEFAULT_DAYS
      ? { willChange: 'transform' as const }
      : {
          willChange: 'transform' as const,
          gridTemplateColumns: `120px repeat(${totalDays}, minmax(8px, 1fr))`,
        };

  return (
    <div>
      <div
        data-testid="cohort-heatmap-grid"
        role="table"
        aria-label="Cohort retention heatmap"
        className={gridClass}
        style={gridStyle}
      >
        {cohorts.map(([cohortWeek, dayMap]) => {
          const cells: React.ReactNode[] = [];
          // Label cell.
          cells.push(
            <div
              key={`label-${cohortWeek}`}
              data-testid={`cohort-row-label-${cohortWeek}`}
              role="rowheader"
              className="text-[11px] font-medium text-[var(--color-text-secondary)] truncate px-2 py-1 bg-[var(--color-surface-elevated)]"
            >
              {formatCohortLabel(cohortWeek)}
            </div>,
          );
          // Day cells (0..totalDays-1).
          for (let d = 0; d < totalDays; d++) {
            const cell = dayMap.get(d);
            if (!cell) {
              cells.push(
                <div
                  key={`empty-${cohortWeek}-${d}`}
                  data-testid={`cohort-empty-${cohortWeek}-${d}`}
                  role="cell"
                  aria-label={`No data for day ${d} of cohort starting ${cohortWeek}`}
                  className="h-3 bg-transparent"
                />,
              );
              continue;
            }
            const suppressed = cell.active_users < kAnonymityThreshold;
            const densityPct = suppressed ? 0 : Math.max(0, Math.min(100, Math.round(cell.retention_pct)));
            const tooltipInputs: CellTooltipInputs = {
              cohort_week: cell.cohort_week,
              day_offset: cell.day_offset,
              active_users: cell.active_users,
              retention_pct: cell.retention_pct,
              cohort_size: cell.cohort_size,
              suppressed,
            };
            cells.push(
              <div
                key={`cell-${cohortWeek}-${d}`}
                data-testid={`cohort-cell-${cohortWeek}-${d}`}
                role="cell"
                aria-label={formatCellAriaLabel(tooltipInputs)}
                title={formatCellTooltip(tooltipInputs)}
                className="h-3 flex items-center justify-center text-[9px] text-[var(--color-text)] font-medium"
                style={{
                  backgroundColor: `color-mix(in srgb, var(--color-primary) ${densityPct}%, var(--color-surface))`,
                }}
              >
                {suppressed && <span className="text-[10px] leading-none">&lt;10</span>}
              </div>,
            );
          }
          return <Fragment key={cohortWeek}>{cells}</Fragment>;
        })}
      </div>
      <div
        data-testid="cohort-heatmap-legend"
        className="mt-4 flex items-center gap-3"
        aria-label="Cohort retention density legend"
      >
        <div
          className="h-3 flex-1 rounded-pill"
          style={{
            background:
              'linear-gradient(to right, var(--color-surface) 0%, var(--color-primary) 100%)',
          }}
          aria-hidden
        />
        <div className="flex items-center gap-2 text-[10px] text-[var(--color-text-secondary)]">
          <span>0%</span>
          <span>25%</span>
          <span>50%</span>
          <span>75%</span>
          <span>100%</span>
        </div>
      </div>
    </div>
  );
}

export default CohortHeatmap;
