/**
 * Phase 10 Plan 10-07 — ClinicDrillInSubBar.
 *
 * Sub-bar rendered below ClinicContextBar on the drill-in route. Provides:
 *   - Back-to-roster button (← Roster label hidden on <md, icon always visible)
 *   - Patient first name + last initial heading
 *   - Joined relative-time + sharing scope summary metadata line
 *   - "Refreshed {relative-time}" (right-aligned, only shown when lastFetchedAt is set)
 *   - Refresh IconButton (re-fires clinic-snapshot Edge Function)
 *   - View activity IconButton (opens PatientActivityModal — Plan 10-09)
 *
 * Per 10-UI-SPEC §"Operator-side: Drill-in" copywriting table:
 *   - Back label: "← Roster" (hidden on <md)
 *   - Back aria-label: "Back to roster"
 *   - Refresh aria-label: "Refresh patient data"
 *   - View activity aria-label: "View this patient's activity log"
 *
 * D-15 (LOCKED, full-screen mobile drill-in): mobile back button is always
 * visible; "← Roster" label only visible at md+ breakpoint.
 */

import { Activity, ChevronLeft, RefreshCw } from 'lucide-react';
import { Button, IconButton } from '@/components/ui/Button';
import { cn } from '@/lib/helpers';

export interface ClinicDrillInSubBarProps {
  /** Patient first name + last initial (e.g. "Sarah K."). */
  patientName: string;
  /** ISO timestamp of when the patient joined the org. */
  joinedAt: string | null;
  /** Human-readable summary of consent scope, e.g. "Sharing 8 of 10 data types". */
  scopeSummary: string;
  /** When the snapshot was last fetched (null = loading / not yet fetched). */
  lastFetchedAt: Date | null;
  onBack: () => void;
  onRefresh: () => void;
  /** Opens PatientActivityModal (Plan 10-09). */
  onViewActivity: () => void;
  className?: string;
}

function relativeTime(date: Date | string | null): string {
  if (!date) return '';
  const d = date instanceof Date ? date : new Date(date);
  if (isNaN(d.getTime())) return '';
  const diffMs = Date.now() - d.getTime();
  const mins = Math.floor(diffMs / 60_000);
  const hours = Math.floor(diffMs / 3_600_000);
  const days = Math.floor(diffMs / 86_400_000);
  const months = Math.floor(diffMs / (30 * 86_400_000));
  if (months >= 1) return `${months}mo ago`;
  if (days >= 1) return `${days}d ago`;
  if (hours >= 1) return `${hours}h ago`;
  if (mins >= 1) return `${mins}m ago`;
  return 'just now';
}

export function ClinicDrillInSubBar({
  patientName,
  joinedAt,
  scopeSummary,
  lastFetchedAt,
  onBack,
  onRefresh,
  onViewActivity,
  className,
}: ClinicDrillInSubBarProps) {
  const joinedRelative = joinedAt ? relativeTime(joinedAt) : null;
  const refreshedRelative = lastFetchedAt ? relativeTime(lastFetchedAt) : null;

  return (
    <div
      data-testid="drill-in-sub-bar"
      className={cn(
        'flex items-center gap-3 px-4 md:px-6 h-14 border-b border-[var(--color-border)] bg-[var(--color-surface)]',
        className,
      )}
    >
      {/* Back-to-roster CTA */}
      <Button
        variant="ghost"
        size="sm"
        onClick={onBack}
        aria-label="Back to roster"
        leadingIcon={<ChevronLeft className="size-4" aria-hidden />}
        data-testid="drill-in-back-button"
      >
        <span className="hidden md:inline">Roster</span>
      </Button>

      {/* Divider */}
      <span aria-hidden className="hidden md:inline text-[var(--color-border)] text-lg">|</span>

      {/* Patient identity + metadata */}
      <div className="flex-1 min-w-0">
        <h1
          className="text-[18px] font-semibold text-[var(--color-text)] truncate leading-tight"
          data-testid="drill-in-patient-name"
        >
          {patientName}
        </h1>
        <p className="text-[13px] text-[var(--color-text-secondary)] truncate leading-tight">
          {joinedRelative && (
            <span>
              Joined {joinedRelative}&nbsp;&middot;&nbsp;
            </span>
          )}
          <span data-testid="drill-in-scope-summary">{scopeSummary}</span>
        </p>
      </div>

      {/* Right-side: Refreshed timestamp + Refresh + View activity */}
      <div className="flex items-center gap-2 shrink-0">
        {refreshedRelative && (
          <span
            className="hidden lg:inline text-[13px] text-[var(--color-text-tertiary)]"
            data-testid="drill-in-refreshed"
          >
            Refreshed {refreshedRelative}
          </span>
        )}

        <IconButton
          aria-label="Refresh patient data"
          variant="ghost"
          size="sm"
          onClick={onRefresh}
          data-testid="drill-in-refresh-button"
        >
          <RefreshCw className="size-4" aria-hidden />
        </IconButton>

        <IconButton
          aria-label="View this patient's activity log"
          variant="ghost"
          size="sm"
          onClick={onViewActivity}
          data-testid="drill-in-view-activity-button"
        >
          <Activity className="size-4" aria-hidden />
        </IconButton>
      </div>
    </div>
  );
}

export default ClinicDrillInSubBar;
