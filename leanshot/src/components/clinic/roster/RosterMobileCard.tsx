/**
 * Phase 10 Plan 10-06 — RosterMobileCard.
 * Phase 10 Plan 10-10 — Extended with isSelected + onToggleSelect + long-press
 *   to enter selection mode (500ms touchstart threshold).
 *
 * Mobile card-stack rendering (<768px). Each card:
 *   - Patient name (top) + score chip (top-right)
 *   - 2×2 signal grid: last dose / weight arrow / symptom severity / days since injection
 *   - Tap to drill in (same click + PostHog handler as RosterRow)
 *   - Long-press 500ms → enters selection mode (fires onLongPressSelectMode)
 *     When in selection mode (onToggleSelect provided): tap selects/deselects.
 *
 * Per D-14: uses existing Card primitive; 80px min-height.
 * Per UI-SPEC: article role, tabIndex=0, aria-label with key signals.
 *
 * Bulk checkbox: 40×40 hit target (shown when onToggleSelect is provided).
 */
import { AlertCircle, ArrowDown, ArrowUp, Minus } from 'lucide-react';
import { useRef } from 'react';
import { Card } from '@/components/ui/Card';
import { CLINIC_EVENTS, scoreBucket } from '@/lib/clinic-events';
import { cn } from '@/lib/helpers';
import type { RankRosterRow, ReadOnlyPermissionMap } from '@/types/snapshot';
import { ScoreChip } from './ScoreChip';

const LONG_PRESS_MS = 500;

export interface RosterMobileCardProps {
  row: RankRosterRow;
  slug: string;
  orgId: string;
  permissionMap: ReadOnlyPermissionMap;
  /** Plan 10-10: whether this card is currently selected for bulk action. */
  isSelected?: boolean;
  /** Plan 10-10: toggle selection. When provided, long-press enters selection mode. */
  onToggleSelect?: (userId: string) => void;
  /** Plan 10-10: called on long-press (500ms) to enter selection mode globally. */
  onLongPressSelectMode?: () => void;
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
  isSelected = false,
  onToggleSelect,
  onLongPressSelectMode,
}: RosterMobileCardProps) {
  const daysSince = row.days_since_injection >= 999 ? '—' : `${row.days_since_injection}d`;
  const daysSinceWarning = row.days_since_injection >= 14 && row.days_since_injection < 999;
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const didLongPressRef = useRef(false);

  const handleDrillIn = () => {
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

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    if (onToggleSelect) {
      onToggleSelect(row.user_id);
    } else {
      handleDrillIn();
    }
  };

  // Long-press handlers
  const handleTouchStart = () => {
    didLongPressRef.current = false;
    if (!onLongPressSelectMode && !onToggleSelect) return;
    longPressTimerRef.current = setTimeout(() => {
      didLongPressRef.current = true;
      onLongPressSelectMode?.();
      // Also toggle this card into selection
      onToggleSelect?.(row.user_id);
    }, LONG_PRESS_MS);
  };

  const handleTouchEnd = () => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  };

  const handleCardClick = (e: React.MouseEvent) => {
    if (didLongPressRef.current) {
      e.preventDefault();
      didLongPressRef.current = false;
      return;
    }
    // If in selection mode (onToggleSelect provided), tap selects
    if (onToggleSelect) {
      onToggleSelect(row.user_id);
      return;
    }
    handleDrillIn();
  };

  return (
    <article
      tabIndex={0}
      role="article"
      aria-label={`${row.display_name}, score ${row.score}, last dose ${relativeTime(row.last_injection_at)}`}
      aria-selected={onToggleSelect ? isSelected : undefined}
      className={cn(
        'cursor-pointer focus-visible:outline-none focus-visible:ring-2',
        'focus-visible:ring-[var(--color-primary)] rounded-card min-h-[80px]',
        isSelected && 'ring-2 ring-[var(--color-primary)]',
      )}
      onClick={handleCardClick}
      onKeyDown={handleKeyDown}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      onTouchCancel={handleTouchEnd}
      data-testid={`roster-card-${row.user_id}`}
    >
      <Card variant="default" padding="sm" className="min-h-[80px]">
        {/* Top row: checkbox (if in selection mode) + name + score chip */}
        <div className="flex items-start justify-between gap-2 mb-3">
          <div className="flex items-start gap-2">
            {/* Checkbox: shown when onToggleSelect is available */}
            {onToggleSelect && (
              <div
                role="checkbox"
                aria-checked={isSelected}
                aria-label={`Select ${row.display_name}`}
                tabIndex={-1}
                className="inline-flex items-center justify-center w-10 h-10 rounded-lg flex-shrink-0"
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleSelect(row.user_id);
                }}
              >
                <span
                  className={cn(
                    'w-5 h-5 rounded-md border-2 flex items-center justify-center',
                    isSelected
                      ? 'bg-[var(--color-primary)] border-[var(--color-primary)]'
                      : 'border-[var(--color-border)]',
                  )}
                  aria-hidden
                >
                  {isSelected && (
                    <svg width="10" height="8" viewBox="0 0 10 8" fill="none">
                      <path
                        d="M1 4L3.5 6.5L9 1"
                        stroke="white"
                        strokeWidth="1.8"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  )}
                </span>
              </div>
            )}
            <span className="text-[15px] font-semibold text-[var(--color-text)] leading-tight">
              {row.display_name}
            </span>
          </div>
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
