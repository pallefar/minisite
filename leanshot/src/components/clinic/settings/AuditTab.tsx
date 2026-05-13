/**
 * Phase 10 Plan 10-08 — AuditTab.
 *
 * Composition root for the org-owner audit surface. Visible only when the
 * user has `audit_log.read` permission (gated in ClinicSettingsPage NAV).
 *
 * Structure:
 *   - Dismissible 13-month retention notice (per-session via sessionStorage)
 *   - AuditFilterBar (3 filters with 200ms debounce)
 *   - Result count line ("Showing N events")
 *   - AuditRow list (click to expand, multiple simultaneously)
 *   - RosterPagination (50 rows/page)
 *   - Empty states (no events / no match)
 *
 * PHI contract: only booleans are sent to PostHog via clinic_audit_tab_opened
 * and clinic_audit_filter_applied (delegated to AuditFilterBar).
 */
import { useEffect, useRef, useState } from 'react';
import posthog from 'posthog-js';
import { Card } from '@/components/ui/Card';
import { Skeleton } from '@/components/ui/Skeleton';
import { Button } from '@/components/ui/Button';
import { CLINIC_EVENTS } from '@/lib/clinic-events';
import { RosterPagination } from '@/components/clinic/roster/RosterPagination';
import {
  useAuditEvents,
  type TimeRangePreset,
  type CustomRange,
} from './use-audit-events';
import { AuditFilterBar, DEFAULT_FILTER_STATE } from './AuditFilterBar';
import { AuditRow } from './AuditRow';

const RETENTION_DISMISSED_KEY = 'clinic_audit_retention_dismissed';
const PAGE_SIZE = 50;

export interface AuditTabProps {
  orgId: string;
}

export function AuditTab({ orgId }: AuditTabProps) {
  // 13-month retention notice
  const [retentionDismissed, setRetentionDismissed] = useState<boolean>(
    () => sessionStorage.getItem(RETENTION_DISMISSED_KEY) === 'true',
  );

  // Filter state
  const [filters, setFilters] = useState(DEFAULT_FILTER_STATE);

  // Pagination
  const [offset, setOffset] = useState(0);

  // Expanded rows (multiple can be expanded simultaneously)
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  // Fire PostHog on mount
  const firedRef = useRef(false);
  useEffect(() => {
    if (firedRef.current) return;
    firedRef.current = true;
    posthog.capture(CLINIC_EVENTS.AUDIT_TAB_OPENED, { org_id: orgId });
  }, [orgId]);

  const { rows, loading, error, totalCount, refresh } = useAuditEvents({
    orgId,
    memberFilter: filters.memberFilter,
    actionFilter: filters.actionFilter,
    timeRangeFilter: filters.timeRangeFilter as TimeRangePreset,
    customRange: filters.customRange as CustomRange | null,
    offset,
    limit: PAGE_SIZE,
  });

  const handleDismissRetention = (): void => {
    sessionStorage.setItem(RETENTION_DISMISSED_KEY, 'true');
    setRetentionDismissed(true);
  };

  const handleFiltersChange = (next: typeof filters): void => {
    setFilters(next);
    setOffset(0); // reset to first page on filter change
  };

  const handleClearFilters = (): void => {
    setFilters(DEFAULT_FILTER_STATE);
    setOffset(0);
  };

  const handleRowToggle = (id: string): void => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const hasFilters =
    filters.memberFilter !== null ||
    filters.actionFilter !== null ||
    filters.timeRangeFilter !== '7d' ||
    filters.customRange !== null;

  const start = totalCount === 0 ? 0 : offset + 1;
  const end = Math.min(offset + PAGE_SIZE, totalCount);

  return (
    <div className="flex flex-col gap-5">
      {/* Heading */}
      <div>
        <h1 className="text-[26px] font-semibold tracking-tight text-[var(--color-text)]">
          Audit log
        </h1>
        <p className="mt-1 text-[13px] text-[var(--color-text-secondary)]">
          Every operator action in your workspace from the last 13 months.
        </p>
      </div>

      {/* 13-month retention notice */}
      {!retentionDismissed && (
        <div
          role="status"
          className="flex items-center justify-between gap-3 rounded-xl bg-[var(--color-surface-elevated)] border border-[var(--color-border)] px-4 py-3"
        >
          <p className="text-[13px] text-[var(--color-text-secondary)]">
            We keep audit events for 13 months. Older events are automatically removed.
          </p>
          <button
            type="button"
            aria-label="Dismiss retention notice"
            onClick={handleDismissRetention}
            className="shrink-0 text-[var(--color-text-tertiary)] hover:text-[var(--color-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] rounded-lg p-1"
          >
            ✕
          </button>
        </div>
      )}

      {/* Filter bar */}
      <AuditFilterBar
        orgId={orgId}
        value={filters}
        onChange={handleFiltersChange}
        onClear={handleClearFilters}
      />

      {/* Result count — only shown when there are rows */}
      {!loading && !error && totalCount > 0 && (
        <p className="text-[13px] text-[var(--color-text-secondary)]" aria-live="polite">
          {`Showing ${start}–${end} of ${totalCount} events`}
        </p>
      )}

      {/* Error state */}
      {error && !loading && (
        <Card variant="flat" padding="sm">
          <p className="text-[13px] text-[var(--color-danger)] mb-2">{error}</p>
          <Button variant="secondary" size="sm" onClick={refresh}>
            Retry
          </Button>
        </Card>
      )}

      {/* Loading skeletons */}
      {loading && (
        <Card variant="flat" padding="none">
          {Array.from({ length: 8 }).map((_, i) => (
            <div
              key={i}
              className="px-4 py-3 border-b border-[var(--color-border)] last:border-b-0 flex items-center gap-3"
            >
              <Skeleton className="w-16 h-3" shape="pill" />
              <Skeleton className="flex-1 h-3" shape="pill" />
            </div>
          ))}
        </Card>
      )}

      {/* Row list */}
      {!loading && !error && rows.length > 0 && (
        <Card variant="flat" padding="none">
          {rows.map((event) => (
            <AuditRow
              key={event.id}
              event={event}
              isExpanded={expandedIds.has(event.id)}
              onToggle={handleRowToggle}
            />
          ))}
        </Card>
      )}

      {/* Empty states */}
      {!loading && !error && rows.length === 0 && (
        <Card variant="flat" padding="lg">
          <div className="flex flex-col items-center gap-3 py-6 text-center">
            {hasFilters ? (
              <>
                <p className="text-[18px] font-semibold text-[var(--color-text)]">
                  No events match your filters
                </p>
                <p className="text-[13px] text-[var(--color-text-secondary)]">
                  Try a wider time range, a different member, or remove filters to see more.
                </p>
                <Button variant="primary" size="sm" onClick={handleClearFilters}>
                  Clear filters
                </Button>
              </>
            ) : (
              <>
                <p className="text-[18px] font-semibold text-[var(--color-text)]">
                  No events yet
                </p>
                <p className="text-[13px] text-[var(--color-text-secondary)]">
                  Operator activity in this workspace will appear here.
                </p>
              </>
            )}
          </div>
        </Card>
      )}

      {/* Pagination */}
      {!loading && !error && totalCount > PAGE_SIZE && (
        <RosterPagination
          offset={offset}
          limit={PAGE_SIZE}
          total={totalCount}
          onPrevious={() => setOffset((o) => Math.max(0, o - PAGE_SIZE))}
          onNext={() => setOffset((o) => o + PAGE_SIZE)}
        />
      )}
    </div>
  );
}
