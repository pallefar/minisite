/**
 * Phase 25 Plan 02 — PhiAccessLogTab.
 *
 * Renders the patient-facing "Who has viewed my data" section in SettingsPage.
 * Shows a paginated table of PHI access events (25 rows/page) with accessor
 * display name, timestamp, viewed fields, and reason.
 *
 * Satisfies HIPAA right-of-accounting-of-disclosures (HIPAA-14 / D-08).
 * Mirrors PatientActivityModal ARIA + Skeleton + EmptyState patterns (Phase 10 Plan 10-09).
 *
 * CRITICAL (D-08 + PatientActivityModal D-19):
 * This component deliberately does NOT call posthog capture.
 * Patient transparency surfaces over-instrumented = surveillance theater.
 * Meta-auditing that a patient viewed their own access log violates the D-08/D-19
 * explicit decision. Do not add posthog calls here.
 */

import { ChevronLeft, ChevronRight, Shield } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { Skeleton } from '@/components/ui/Skeleton';
import { usePhiAccessLog } from './use-phi-access-log';

const LIMIT = 25;

export function PhiAccessLogTab() {
  const [offset, setOffset] = useState(0);
  const { rows, loading, error, hasMore, total, refresh } = usePhiAccessLog(offset, LIMIT);

  const handlePrev = () => setOffset((o) => Math.max(0, o - LIMIT));
  const handleNext = () => setOffset((o) => o + LIMIT);

  const start = offset + 1;
  const end = offset + rows.length;

  if (loading) {
    return (
      <div className="space-y-2 py-2" role="status" aria-live="polite" aria-busy>
        <Skeleton className="h-10 w-full rounded-lg" />
        <Skeleton className="h-10 w-full rounded-lg" />
        <Skeleton className="h-10 w-full rounded-lg" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="py-6 text-center space-y-3">
        <p className="text-[14px] text-[var(--color-text-secondary)]">
          Couldn&apos;t load your PHI access log. Check your connection and try again.
        </p>
        <Button size="sm" onClick={refresh}>
          Retry
        </Button>
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <EmptyState
        inline
        illustration={<Shield className="size-8 opacity-40" aria-hidden />}
        title="No PHI access logged yet."
        body="Your clinic or care team has not viewed your personal health information."
      />
    );
  }

  return (
    <div className="space-y-3">
      <div role="list" className="space-y-2">
        {rows.map((row) => (
          <div
            key={row.id}
            role="listitem"
            className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-elevated)] px-4 py-3 text-[13px] space-y-1"
          >
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <span className="font-semibold text-[var(--color-text)]">
                {row.actor_display_name ?? 'Staff member'}
              </span>
              <time
                dateTime={row.accessed_at}
                className="text-[var(--color-text-tertiary)] shrink-0"
              >
                {new Date(row.accessed_at).toLocaleString()}
              </time>
            </div>
            <p className="text-[var(--color-text-secondary)]">
              <span className="font-medium text-[var(--color-text)]">Viewed:&nbsp;</span>
              {row.accessed_fields.join(', ')}
            </p>
            {row.reason && <p className="text-[var(--color-text-tertiary)] italic">{row.reason}</p>}
          </div>
        ))}
      </div>

      {/* Pagination footer */}
      {total > LIMIT && (
        <div className="flex items-center justify-between pt-3 mt-3 border-t border-[var(--color-border)]">
          <span className="text-[13px] text-[var(--color-text-secondary)]">
            Showing {start}–{end} of {total}
          </span>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="ghost"
              disabled={offset === 0}
              onClick={handlePrev}
              leadingIcon={<ChevronLeft className="size-4" />}
              aria-label="Previous page"
            >
              Previous
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={!hasMore}
              onClick={handleNext}
              aria-label="Next page"
            >
              Next
              <ChevronRight className="size-4 ms-1" aria-hidden />
            </Button>
          </div>
        </div>
      )}

      {/* HIPAA right-of-accounting-of-disclosures footer */}
      <div className="pt-3 border-t border-[var(--color-border)]">
        <p className="text-[12px] text-[var(--color-text-secondary)] leading-relaxed">
          This log records every time a member of your care team accessed your health data. If you
          believe an entry is incorrect, contact your clinic or email{' '}
          <a
            href="mailto:support@leanshot.app"
            className="underline underline-offset-2 hover:text-[var(--color-text)] transition-colors"
          >
            support@leanshot.app
          </a>
          .
        </p>
      </div>
    </div>
  );
}
