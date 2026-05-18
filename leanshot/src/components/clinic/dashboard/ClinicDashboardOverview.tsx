/**
 * Phase 30 Plan 04 — ClinicDashboardOverview (CLIN-05/08).
 *
 * 4 stat cards in a responsive 3-column grid:
 *   1. Pending alerts (primary focal point — shadow-md + 20px figure)
 *   2. Ack rate (7 days)
 *   3. Below dosing range
 *   4. Alert types breakdown
 *
 * Reads from SECDEF accessors ONLY (direct mv_* reads revoked at DB level
 * per Plan 30-00 Wave 0 deviation). See use-clinic-metrics.ts.
 *
 * Color tokens per 30-UI-SPEC §Color:
 *   --color-amber (#e0af4e) — NOT --color-warning — for pending/degraded state
 *   --color-success — for healthy/zero-pending state
 *   --color-danger — for ack rate < 50%
 *   --color-text-tertiary — for zero-count state / staleness caption
 *
 * Staleness caption: text-[13px] text-[var(--color-text-tertiary)]
 * "Updated every 15 minutes · Last: {relative time}"
 *
 * Components are React.lazy-loaded from the parent route.
 */

import { cn } from '@/lib/helpers';
import { Card, CardHeader } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { Skeleton } from '@/components/ui/Skeleton';
import { useClinicMetrics } from './use-clinic-metrics';

// ---------------------------------------------------------------------------
// Relative time helper (no external dependency needed)
// ---------------------------------------------------------------------------

function relativeTime(date: Date | null): string {
  if (!date) return '';
  const diffMs = Date.now() - date.getTime();
  const mins = Math.floor(diffMs / 60_000);
  const hours = Math.floor(diffMs / 3_600_000);
  const days = Math.floor(diffMs / 86_400_000);
  if (days >= 1) return `${days}d ago`;
  if (hours >= 1) return `${hours}h ago`;
  if (mins >= 1) return `${mins}m ago`;
  return 'just now';
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface ClinicDashboardOverviewProps {
  orgId: string;
  className?: string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ClinicDashboardOverview({ orgId, className }: ClinicDashboardOverviewProps) {
  const {
    pendingThisWeek,
    ackRatePct,
    belowDosingRange,
    alertTypeBreakdown,
    lastRefreshedAt,
    isLoading,
  } = useClinicMetrics(orgId);

  // Loading state: 4 skeleton placeholders in the same grid positions
  if (isLoading) {
    return (
      <section
        aria-labelledby="clinic-overview-heading"
        className={cn('space-y-4', className)}
        data-testid="clinic-dashboard-overview"
      >
        <h1
          id="clinic-overview-heading"
          className="text-[20px] font-semibold text-[var(--color-text)]"
        >
          Clinic overview
        </h1>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Skeleton className="h-32 rounded-lg" />
          <Skeleton className="h-32 rounded-lg" />
          <Skeleton className="h-32 rounded-lg" />
          <Skeleton className="h-32 rounded-lg" />
        </div>
      </section>
    );
  }

  // Empty state: no data yet (all zeros + no refresh timestamp)
  const isEmpty =
    !lastRefreshedAt &&
    pendingThisWeek === 0 &&
    belowDosingRange === 0 &&
    ackRatePct === null &&
    alertTypeBreakdown.dose_adherence === 0 &&
    alertTypeBreakdown.dose_variance === 0;

  if (isEmpty) {
    return (
      <section
        aria-labelledby="clinic-overview-heading"
        className={cn('space-y-4', className)}
        data-testid="clinic-dashboard-overview"
      >
        <h1
          id="clinic-overview-heading"
          className="text-[20px] font-semibold text-[var(--color-text)]"
        >
          Clinic overview
        </h1>
        <EmptyState
          title="No data yet"
          body="Metrics appear after the first nightly alert scan. Check back tomorrow."
        />
      </section>
    );
  }

  // Pending alerts color: amber when > 0, success when 0
  const pendingFigureClass = cn(
    'font-semibold leading-tight tabular-nums',
    'text-[20px]',
    pendingThisWeek > 0
      ? 'text-[var(--color-amber)]'
      : 'text-[var(--color-success)]',
  );

  // Ack rate color coding per UI-SPEC
  const ackRateFigureClass = cn(
    'text-[16px] font-semibold leading-tight tabular-nums',
    ackRatePct === null
      ? 'text-[var(--color-text-tertiary)]'
      : ackRatePct >= 80
        ? 'text-[var(--color-success)]'
        : ackRatePct >= 50
          ? 'text-[var(--color-amber)]'
          : 'text-[var(--color-danger)]',
  );

  // Below dosing range color: amber when > 0, tertiary when 0
  const belowDosingFigureClass = cn(
    'text-[16px] font-semibold leading-tight tabular-nums',
    belowDosingRange > 0
      ? 'text-[var(--color-amber)]'
      : 'text-[var(--color-text-tertiary)]',
  );

  const stalenessLabel = lastRefreshedAt
    ? `Updated every 15 minutes · Last: ${relativeTime(lastRefreshedAt)}`
    : 'Updated every 15 minutes';

  return (
    <section
      aria-labelledby="clinic-overview-heading"
      className={cn('space-y-4', className)}
      data-testid="clinic-dashboard-overview"
    >
      <h1
        id="clinic-overview-heading"
        className="text-[20px] font-semibold text-[var(--color-text)]"
      >
        Clinic overview
      </h1>

      {/* Stat card grid: 3-col on md+, single-col on mobile */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Card 1: Pending alerts — PRIMARY FOCAL POINT (shadow-md) */}
        <Card
          variant="elevated"
          className="shadow-md"
          data-testid="stat-card-pending-alerts"
        >
          <CardHeader title="Pending alerts" />
          <p
            className={pendingFigureClass}
            aria-label={`Pending alerts: ${pendingThisWeek}`}
            data-testid="pending-alerts-figure"
          >
            {pendingThisWeek}
          </p>
          <p className="text-[13px] text-[var(--color-text-tertiary)] mt-1">This week</p>
        </Card>

        {/* Card 2: Ack rate (7 days) */}
        <Card
          variant="elevated"
          className="shadow-sm"
          data-testid="stat-card-ack-rate"
        >
          <CardHeader title="Ack rate (7 days)" />
          <p
            className={ackRateFigureClass}
            aria-label={`Ack rate (7 days): ${ackRatePct !== null ? `${ackRatePct}%` : 'no data'}`}
            data-testid="ack-rate-figure"
          >
            {ackRatePct !== null ? `${ackRatePct}%` : '—'}
          </p>
        </Card>

        {/* Card 3: Below dosing range */}
        <Card
          variant="elevated"
          className="shadow-sm"
          data-testid="stat-card-below-dosing-range"
        >
          <CardHeader title="Below dosing range" />
          <p
            className={belowDosingFigureClass}
            aria-label={`Below dosing range: ${belowDosingRange}`}
            data-testid="below-dosing-range-figure"
          >
            {belowDosingRange}
          </p>
          <p className="text-[13px] text-[var(--color-text-tertiary)] mt-1">This week</p>
        </Card>

        {/* Card 4: Alert types breakdown */}
        <Card
          variant="elevated"
          className="shadow-sm"
          data-testid="stat-card-alert-types"
        >
          <CardHeader title="Alert types" />
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-[15px]">
              <span className="text-[var(--color-text-secondary)]">Missed doses</span>
              <span className="font-semibold tabular-nums">{alertTypeBreakdown.dose_adherence}</span>
            </div>
            <div className="flex items-center justify-between text-[15px]">
              <span className="text-[var(--color-text-secondary)]">Dose variance</span>
              <span className="font-semibold tabular-nums">{alertTypeBreakdown.dose_variance}</span>
            </div>
          </div>
        </Card>
      </div>

      {/* Staleness caption — text-[13px] text-[var(--color-text-tertiary)] per UI-SPEC */}
      <p
        className="text-[13px] text-[var(--color-text-tertiary)]"
        data-testid="staleness-caption"
      >
        {stalenessLabel}
      </p>
    </section>
  );
}

export default ClinicDashboardOverview;
