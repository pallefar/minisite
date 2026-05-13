/**
 * Phase 10 Plan 10-06 — RosterMobileCard.
 *
 * Mobile card-stack rendering (<768px). Each card:
 *   - Patient name (top) + score chip (top-right)
 *   - 2×2 signal grid: last dose / weight arrow / symptom severity / days since injection
 *   - Tap to drill in (same click + PostHog handler as RosterRow)
 *   - Long-press to enter selection mode (wired by Plan 10-10; this plan exposes
 *     the onLongPress prop stub but does not implement selection)
 *
 * Per D-14: uses existing Card primitive; 80px min-height.
 * Per UI-SPEC: article role, tabIndex=0, aria-label with key signals.
 */
import { AlertCircle, ArrowDown, ArrowUp, Minus } from 'lucide-react';

import { Card } from '@/components/ui/Card';
import { CLINIC_EVENTS, scoreBucket } from '@/lib/clinic-events';
import type { RankRosterRow, ReadOnlyPermissionMap } from '@/types/snapshot';
import { ScoreChip } from './ScoreChip';

export interface RosterMobileCardProps {
  row: RankRosterRow;
  slug: string;
  orgId: string;
  permissionMap: ReadOnlyPermissionMap;
}

function relativeTime(iso: string | null): string {
  if (!iso) return '—';
  const diffMs = Date.now() - new Date(iso).getTime();
  const days = Math.floor(diffMs / 86_400_000);
  const hours = Math.floor(diffMs / 3_600_000);
  if (days >= 1) return `${days}d ago`;
  if (hours >= 1) return `${hours}h ago`;
  const mins = Math.floor(diffMs / 60_000);
  return mins > 0 ? `${mins}m ago` : 'just now';
}

export function RosterMobileCard({
  row,
  slug,
  orgId,
  permissionMap,
}: RosterMobileCardProps) {
  const daysSince = row.days_since_injection >= 999 ? '—' : `${row.days_since_injection}d`;
  const daysSinceWarning = row.days_since_injection >= 14 && row.days_since_injection < 999;

  const handleDrillIn = (e: React.MouseEvent | React.KeyboardEvent) => {
    if ('key' in e && e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).posthog?.capture(CLINIC_EVENTS.PATIENT_DRILLED_IN, {
        org_id: orgId,
        score_bucket: scoreBucket(row.score),
      });
    } catch {
      // PostHog unavailable — ignore
    }

    window.history.pushState({}, '', `/clinic/${slug}/patient/${row.user_id}`);
    window.dispatchEvent(new PopStateEvent('popstate'));
  };

  return (
    <article
      tabIndex={0}
      role="article"
      aria-label={`${row.display_name}, score ${row.score}, last dose ${relativeTime(row.last_injection_at)}`}
      className="cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] rounded-card min-h-[80px]"
      onClick={handleDrillIn}
      onKeyDown={handleDrillIn}
      data-testid={`roster-card-${row.user_id}`}
    >
      <Card variant="default" padding="sm" className="min-h-[80px]">
        {/* Top row: name + score chip */}
        <div className="flex items-start justify-between gap-2 mb-3">
          <span className="text-[15px] font-semibold text-[var(--color-text)] leading-tight">
            {row.display_name}
          </span>
          <div onClick={(e) => e.stopPropagation()}>
            <ScoreChip
              score={row.score}
              breakdown={row.breakdown}
              canViewBreakdown={permissionMap.canViewBreakdown}
            />
          </div>
        </div>

        {/* 2×2 signal grid */}
        <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-[13px]">
          {/* Last dose */}
          <div>
            <span className="text-[var(--color-text-tertiary)] block text-[11px] uppercase tracking-[0.05em] font-medium mb-0.5">
              Last dose
            </span>
            <span className="text-[var(--color-text-secondary)] numerals-tabular">
              {relativeTime(row.last_injection_at)}
            </span>
          </div>

          {/* Weight trend */}
          <div>
            <span className="text-[var(--color-text-tertiary)] block text-[11px] uppercase tracking-[0.05em] font-medium mb-0.5">
              Weight
            </span>
            <span>
              {row.weight_trend_arrow === 'up' ? (
                <ArrowUp size={14} className="text-[var(--color-sage)]" aria-label="Trending up" />
              ) : row.weight_trend_arrow === 'down' ? (
                <ArrowDown size={14} className="text-[var(--color-warning)]" aria-label="Trending down" />
              ) : (
                <Minus size={14} className="text-[var(--color-text-tertiary)]" aria-label="No trend" />
              )}
            </span>
          </div>

          {/* Symptom severity */}
          <div>
            <span className="text-[var(--color-text-tertiary)] block text-[11px] uppercase tracking-[0.05em] font-medium mb-0.5">
              Symptoms
            </span>
            <span className="text-[var(--color-text-secondary)] numerals-tabular">
              {row.recent_symptom_severity}/5
            </span>
          </div>

          {/* Days since injection */}
          <div>
            <span className="text-[var(--color-text-tertiary)] block text-[11px] uppercase tracking-[0.05em] font-medium mb-0.5">
              Days since
            </span>
            <span>
              {daysSinceWarning ? (
                <span className="inline-flex items-center gap-1 text-[var(--color-warning)]">
                  <AlertCircle size={12} aria-hidden />
                  {daysSince}
                </span>
              ) : (
                <span className="text-[var(--color-text-secondary)] numerals-tabular">{daysSince}</span>
              )}
            </span>
          </div>
        </div>
      </Card>
    </article>
  );
}
