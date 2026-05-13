/**
 * Phase 10 Plan 10-06 — RosterRow.
 *
 * One <tr> row in the desktop RosterTable grid. Renders:
 *   ScoreChip | patient name | last-dose relative-time | weight-trend arrow
 *   | recent_symptom_severity N/5 | days-since-injection | missed-dose icon
 *
 * Click handler:
 *   1. Fires PostHog clinic_patient_drilled_in with { org_id, score_bucket }
 *      — FORBIDDEN properties: patient_user_id, patient_name, raw score.
 *   2. Navigates to /clinic/{slug}/patient/{user_id}.
 *
 * Realtime row flash (D-17): 200ms accent-tint fade-in, respects
 * prefers-reduced-motion via useReducedMotion().
 *
 * Keyboard: tabIndex=0, Enter/Space activates drill-in.
 * Accessibility: role="row", each cell role="gridcell".
 */
import { useEffect, useRef, useState } from 'react';

import { AlertCircle, ArrowDown, ArrowUp, Minus } from 'lucide-react';

import { cn } from '@/lib/helpers';
import { CLINIC_EVENTS, scoreBucket } from '@/lib/clinic-events';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import type { RankRosterRow } from '@/types/snapshot';
import type { ReadOnlyPermissionMap } from '@/types/snapshot';
import { ScoreChip } from './ScoreChip';

export interface RosterRowProps {
  row: RankRosterRow;
  slug: string;
  orgId: string;
  permissionMap: ReadOnlyPermissionMap;
  /** When true, the row flashes briefly (Realtime signal update). */
  flash?: boolean;
  onFlashComplete?: () => void;
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

export function RosterRow({
  row,
  slug,
  orgId,
  permissionMap,
  flash = false,
  onFlashComplete,
}: RosterRowProps) {
  const reducedMotion = useReducedMotion();
  const [isFlashing, setIsFlashing] = useState(false);
  const ariaLiveRef = useRef<HTMLSpanElement>(null);

  // Trigger flash animation when `flash` prop becomes true
  useEffect(() => {
    if (!flash) return;
    setIsFlashing(true);
    const duration = reducedMotion ? 0 : 200;
    const timer = setTimeout(() => {
      setIsFlashing(false);
      onFlashComplete?.();
    }, duration);
    return () => clearTimeout(timer);
  }, [flash, reducedMotion, onFlashComplete]);

  const handleDrillIn = (e: React.MouseEvent | React.KeyboardEvent) => {
    if ('key' in e && e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();

    // PHI-safe PostHog event — only bucket, no raw score or patient id
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).posthog?.capture(CLINIC_EVENTS.PATIENT_DRILLED_IN, {
        org_id: orgId,
        score_bucket: scoreBucket(row.score),
      });
    } catch {
      // PostHog unavailable — ignore
    }

    // Navigate
    window.history.pushState({}, '', `/clinic/${slug}/patient/${row.user_id}`);
    window.dispatchEvent(new PopStateEvent('popstate'));
  };

  const daysSince = row.days_since_injection >= 999 ? '—' : `${row.days_since_injection}d`;
  const daysSinceWarning = row.days_since_injection >= 14 && row.days_since_injection < 999;

  return (
    <tr
      role="row"
      tabIndex={0}
      className={cn(
        'border-b border-[var(--color-border)] transition-colors cursor-pointer',
        'hover:bg-[var(--color-surface-elevated)] focus-visible:outline-none',
        'focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--color-primary)]',
        isFlashing && !reducedMotion && 'animate-row-flash',
        isFlashing && reducedMotion && 'opacity-70',
      )}
      onClick={handleDrillIn}
      onKeyDown={handleDrillIn}
      data-testid={`roster-row-${row.user_id}`}
    >
      {/* Score chip cell — aria-live announcement co-located here to keep HTML
          valid (span cannot be a direct sibling of td, only inside a td). */}
      <td role="gridcell" className="pl-4 pr-3 py-3.5 w-[72px]">
        {isFlashing && (
          <span ref={ariaLiveRef} role="status" aria-live="polite" className="sr-only">
            {row.display_name.split(' ')[0]}&apos;s data updated.
          </span>
        )}
        <div onClick={(e) => e.stopPropagation()}>
          <ScoreChip
            score={row.score}
            breakdown={row.breakdown}
            canViewBreakdown={permissionMap.canViewBreakdown}
          />
        </div>
      </td>

      {/* Patient name */}
      <td
        role="gridcell"
        className="px-3 py-3.5 text-[15px] font-medium text-[var(--color-text)] min-w-[140px]"
      >
        {row.display_name}
      </td>

      {/* Last dose */}
      <td
        role="gridcell"
        className="px-3 py-3.5 text-[13px] text-[var(--color-text-secondary)] numerals-tabular"
      >
        {relativeTime(row.last_injection_at)}
      </td>

      {/* Weight trend */}
      <td role="gridcell" className="px-3 py-3.5">
        {row.weight_trend_arrow === 'up' ? (
          <ArrowUp
            size={16}
            className="text-[var(--color-sage)]"
            aria-label="Trending up"
          />
        ) : row.weight_trend_arrow === 'down' ? (
          <ArrowDown
            size={16}
            className="text-[var(--color-warning)]"
            aria-label="Trending down"
          />
        ) : (
          <Minus
            size={16}
            className="text-[var(--color-text-tertiary)]"
            aria-label="No trend"
          />
        )}
      </td>

      {/* Symptom severity */}
      <td
        role="gridcell"
        className="px-3 py-3.5 text-[13px] numerals-tabular text-[var(--color-text-secondary)]"
      >
        {row.recent_symptom_severity}/5
      </td>

      {/* Days since injection */}
      <td
        role="gridcell"
        className="px-3 py-3.5 text-[13px] numerals-tabular"
      >
        {daysSinceWarning ? (
          <span className="inline-flex items-center gap-1 text-[var(--color-warning)]">
            <AlertCircle size={14} aria-hidden />
            {daysSince}
          </span>
        ) : (
          <span className="text-[var(--color-text-secondary)]">{daysSince}</span>
        )}
      </td>

      {/* Missed-dose flag */}
      <td role="gridcell" className="px-3 pr-4 py-3.5">
        {row.missed_dose_flag ? (
          <AlertCircle
            size={16}
            className="text-[var(--color-warning)]"
            aria-label="Missed dose"
          />
        ) : (
          <Minus
            size={16}
            className="text-[var(--color-text-tertiary)]"
            aria-label="On schedule"
          />
        )}
      </td>
    </tr>
  );
}
