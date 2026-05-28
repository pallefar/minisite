/**
 * Phase 10 Plan 10-06 — RosterTable composition root.
 * Phase 10 Plan 10-10 — Extended with bulk selection (useRosterSelection hook,
 *   RosterBulkSelectionBar, header indeterminate checkbox, RosterRow/Card props).
 *
 * Manages:
 *   - Sort state (column + direction; 3rd click reverts to default score DESC)
 *   - Offset/pagination state
 *   - Selection state (Plan 10-10: useRosterSelection hook)
 *   - Realtime row signal-column patching (D-16)
 *   - Threshold-cross toast (D-17): score crosses 70 boundary on refetch
 *   - Passive 30s refetch
 *   - PostHog events: clinic_roster_loaded, clinic_roster_sorted, clinic_bulk_selected
 *
 * Desktop (<768px hidden) renders <table> with RosterRow.
 * Mobile renders RosterMobileCard stack.
 *
 * Score recompute (full RPC re-fire):
 *   - On sort change
 *   - On pagination change
 *   - Manual Refresh button click
 *   - Passive 30s timer (resets on manual refresh/sort/pagination)
 *
 * Realtime patches only signal columns in-place WITHOUT re-firing the RPC.
 */

import { ArrowDown, ArrowUp, ArrowUpDown, RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { Skeleton } from '@/components/ui/Skeleton';
import { useToast } from '@/hooks/useToast';
import { CLINIC_EVENTS, scoreBucket } from '@/lib/clinic-events';
import { cn } from '@/lib/helpers';
import type { RankRosterRow, ReadOnlyPermissionMap } from '@/types/snapshot';
import { BulkExportCSVFlow } from './BulkExportCSVFlow';
import { BulkExportPDFFlow } from './BulkExportPDFFlow';
import { BulkOpenInTabsFlow } from './BulkOpenInTabsFlow';
import { RosterBulkSelectionBar } from './RosterBulkSelectionBar';
import { RosterMobileCard } from './RosterMobileCard';
import { RosterPagination } from './RosterPagination';
import { RosterRow } from './RosterRow';
import { useOrgSettingsRealtime } from './use-org-settings-realtime';
import { useRankRoster } from './use-rank-roster';
import { useRosterRealtime } from './use-roster-realtime';
import type { PatientSignalChangePayload } from './use-roster-realtime';
import { useRosterSelection } from './use-roster-selection';

const PAGE_SIZE = 50;
const REFRESH_INTERVAL_MS = 30_000;

type SortColumn =
  | 'score'
  | 'display_name'
  | 'last_injection_at'
  | 'weight_trend_arrow'
  | 'recent_symptom_severity'
  | 'days_since_injection'
  | 'missed_dose_flag';
type SortDirection = 'asc' | 'desc';

interface SortState {
  column: SortColumn;
  direction: SortDirection;
  clickCount: number; // track for 3rd-click revert
}

const DEFAULT_SORT: SortState = {
  column: 'score',
  direction: 'desc',
  clickCount: 0,
};

const COLUMN_LABELS: Record<SortColumn, string> = {
  score: 'Score',
  display_name: 'Patient',
  last_injection_at: 'Last dose',
  weight_trend_arrow: 'Weight',
  recent_symptom_severity: 'Symptoms',
  days_since_injection: 'Days since',
  missed_dose_flag: 'Missed',
};

export interface RosterTableProps {
  orgId: string;
  slug: string;
  permissionMap: ReadOnlyPermissionMap;
  /** Passed through from Plan 10-10's selection wiring. */
  onSelectionChange?: (selectedIds: string[]) => void;
}

type BulkFlowType = 'pdf' | 'csv' | 'tabs' | null;

export function RosterTable({
  orgId,
  slug,
  permissionMap,
  onSelectionChange: _onSelectionChange,
}: RosterTableProps) {
  const [sort, setSort] = useState<SortState>(DEFAULT_SORT);
  const [offset, setOffset] = useState(0);
  const [flashingRows, setFlashingRows] = useState<Set<string>>(new Set());
  const [realtimePatched, setRealtimePatched] = useState<Map<string, Partial<RankRosterRow>>>(
    new Map(),
  );
  const [activeBulkFlow, setActiveBulkFlow] = useState<BulkFlowType>(null);

  const toast = useToast();
  const fetchStartRef = useRef<number>(performance.now());
  const prevScoreMapRef = useRef<Map<string, number>>(new Map());
  const hasReportedLoadRef = useRef(false);

  const { rows, loading, error, refresh, lastFetchedAt } = useRankRoster({
    orgId,
    sortColumn: sort.column,
    sortDirection: sort.direction,
    offset,
    limit: PAGE_SIZE,
  });

  // ---- Bulk selection hook -------------------------------------------------
  const { selected, toggle, toggleAll, clear, isSelected } = useRosterSelection({ orgId });
  const selectedCount = selected.size;
  const visibleUserIds = useMemo(() => rows.map((r) => r.user_id), [rows]);

  // ---- Threshold-crossing detection ----------------------------------------
  useEffect(() => {
    if (loading || rows.length === 0) return;

    const prevMap = prevScoreMapRef.current;
    rows.forEach((row) => {
      const prevScore = prevMap.get(row.user_id);
      if (prevScore !== undefined) {
        const wasHigh = prevScore >= 70;
        const isHigh = row.score >= 70;
        if (!wasHigh && isHigh) {
          const firstName = row.display_name.split(' ')[0];
          toast(`${firstName} now needs attention.`, 'error');
        } else if (wasHigh && !isHigh) {
          const firstName = row.display_name.split(' ')[0];
          toast(`${firstName}'s score improved.`, 'info');
        }
      }
    });

    // Update prev score map
    const newMap = new Map<string, number>();
    rows.forEach((row) => newMap.set(row.user_id, row.score));
    prevScoreMapRef.current = newMap;
  }, [rows, loading, toast]);

  // ---- PostHog: clinic_roster_loaded (fires once per RPC completion) --------
  useEffect(() => {
    if (loading || hasReportedLoadRef.current) return;
    hasReportedLoadRef.current = true;
    const renderMs = Math.round(performance.now() - fetchStartRef.current);
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).posthog?.capture(CLINIC_EVENTS.ROSTER_LOADED, {
        org_id: orgId,
        patient_count: rows.length,
        render_ms: renderMs,
      });
    } catch {
      // PostHog unavailable
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading]);

  // ---- Passive 30s refetch --------------------------------------------------
  useEffect(() => {
    const timer = setInterval(() => {
      fetchStartRef.current = performance.now();
      hasReportedLoadRef.current = false;
      refresh();
    }, REFRESH_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [refresh]);

  // ---- Realtime signal-column patching -------------------------------------
  const handleSignalChange = useCallback((payload: PatientSignalChangePayload) => {
    setRealtimePatched((prev) => {
      const next = new Map(prev);
      const existing = next.get(payload.user_id) ?? {};
      if (payload.section === 'injections') {
        next.set(payload.user_id, {
          ...existing,
          last_injection_at: payload.changed_at,
        });
      } else if (payload.section === 'weights' || payload.section === 'symptoms') {
        next.set(payload.user_id, { ...existing });
      }
      return next;
    });

    // Trigger row flash
    setFlashingRows((prev) => {
      const next = new Set(prev);
      next.add(payload.user_id);
      return next;
    });
  }, []);

  useRosterRealtime({ orgId, onSignalChange: handleSignalChange });

  // ---- Settings channel realtime (SC#1: weight saves trigger rank refresh) ---
  // Triggers within ~1s of save in another tab/browser session.
  // Falls back to 30s polling if subscription fails (T-30-02-03 accept).
  const handleWeightsChanged = useCallback(() => {
    fetchStartRef.current = performance.now();
    hasReportedLoadRef.current = false;
    refresh();
  }, [refresh]);
  useOrgSettingsRealtime({ orgId, onWeightsChanged: handleWeightsChanged });

  // ---- Merge Realtime patches into displayed rows --------------------------
  const displayedRows = useMemo(() => {
    if (realtimePatched.size === 0) return rows;
    return rows.map((row) => {
      const patch = realtimePatched.get(row.user_id);
      if (!patch) return row;
      return { ...row, ...patch };
    });
  }, [rows, realtimePatched]);

  // ---- Sort column header click --------------------------------------------
  const handleSortClick = (col: SortColumn) => {
    setSort((prev) => {
      if (prev.column !== col) {
        // New column: start DESC
        const newSort: SortState = { column: col, direction: 'desc', clickCount: 1 };
        fireRosterSorted(col, 'desc');
        return newSort;
      }
      // Same column: cycle asc → revert to default on 3rd click
      if (prev.direction === 'desc') {
        fireRosterSorted(col, 'asc');
        return { column: col, direction: 'asc', clickCount: prev.clickCount + 1 };
      }
      // Was asc → revert to default
      fireRosterSorted(DEFAULT_SORT.column, DEFAULT_SORT.direction);
      return { ...DEFAULT_SORT };
    });
    setOffset(0);
    fetchStartRef.current = performance.now();
    hasReportedLoadRef.current = false;
  };

  const fireRosterSorted = (col: SortColumn, dir: SortDirection) => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).posthog?.capture(CLINIC_EVENTS.ROSTER_SORTED, {
        column: col,
        direction: dir,
      });
    } catch {
      // PostHog unavailable
    }
  };

  // ---- Relative "Refreshed X ago" hint -------------------------------------
  const refreshedAgo = (() => {
    if (!lastFetchedAt) return null;
    const diffSec = Math.floor((Date.now() - lastFetchedAt.getTime()) / 1000);
    if (diffSec < 5) return 'just now';
    if (diffSec < 60) return `${diffSec}s ago`;
    const diffMin = Math.floor(diffSec / 60);
    return `${diffMin}m ago`;
  })();

  const showRefreshedHint = lastFetchedAt && Date.now() - lastFetchedAt.getTime() > 30_000;

  const handleManualRefresh = () => {
    fetchStartRef.current = performance.now();
    hasReportedLoadRef.current = false;
    refresh();
  };

  // ---- Header "select all visible" checkbox state --------------------------
  const allVisibleSelected = visibleUserIds.length > 0 && visibleUserIds.every(isSelected);
  const someVisibleSelected = visibleUserIds.some(isSelected);
  const headerIndeterminate = someVisibleSelected && !allVisibleSelected;

  const handleHeaderCheckboxClick = () => {
    toggleAll(visibleUserIds);
  };

  // ---- Column header sort icon --------------------------------------------
  const SortIcon = ({ col }: { col: SortColumn }) => {
    if (sort.column !== col) {
      return (
        <ArrowUpDown size={14} className="text-[var(--color-text-tertiary)] ms-1" aria-hidden />
      );
    }
    return sort.direction === 'desc' ? (
      <ArrowDown size={14} className="text-[var(--color-primary)] ms-1" aria-hidden />
    ) : (
      <ArrowUp size={14} className="text-[var(--color-primary)] ms-1" aria-hidden />
    );
  };

  const getAriaSortAttr = (col: SortColumn): 'ascending' | 'descending' | 'none' => {
    if (sort.column !== col) return 'none';
    return sort.direction === 'asc' ? 'ascending' : 'descending';
  };

  // ---- Loading skeleton ----------------------------------------------------
  if (loading && rows.length === 0) {
    return (
      <div className="space-y-2" data-testid="roster-loading">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="h-14 w-full rounded-md" />
        ))}
      </div>
    );
  }

  // ---- Error state ---------------------------------------------------------
  if (error) {
    return (
      <div className="py-8 text-center space-y-3" data-testid="roster-error">
        <p className="text-[14px] text-[var(--color-text-secondary)]">
          Couldn&apos;t load the roster. Check your connection and try again.
        </p>
        <Button variant="secondary" size="sm" onClick={() => void refresh()}>
          Retry
        </Button>
      </div>
    );
  }

  // ---- Empty state ---------------------------------------------------------
  if (!loading && displayedRows.length === 0 && offset === 0) {
    return (
      <EmptyState
        inline
        title="No patients yet"
        body="Invite your first patient by email. They'll see your workspace name and choose what data to share with you."
      />
    );
  }

  const sortedSuffix =
    sort.column !== 'score' || sort.direction !== 'desc'
      ? ` · sorted by ${COLUMN_LABELS[sort.column]} ${sort.direction}`
      : '';

  return (
    <div data-testid="roster-table-container">
      {/* Bulk selection bar — renders above the table when ≥1 row selected */}
      {selectedCount > 0 && (
        <div className="mb-3" data-testid="bulk-selection-bar-wrapper">
          <RosterBulkSelectionBar
            count={selectedCount}
            onClear={clear}
            onPDF={() => setActiveBulkFlow('pdf')}
            onCSV={() => setActiveBulkFlow('csv')}
            onOpenTabs={() => setActiveBulkFlow('tabs')}
          />
        </div>
      )}

      {/* Header row: subhead + refresh */}
      <div className="flex items-center justify-between gap-3 mb-4">
        <p className="text-[13px] text-[var(--color-text-secondary)]">
          {displayedRows.length} patient{displayedRows.length !== 1 ? 's' : ''}
          {sortedSuffix}
        </p>
        <div className="flex items-center gap-2">
          {showRefreshedHint && refreshedAgo && (
            <span className="text-[12px] text-[var(--color-text-tertiary)]">
              Refreshed {refreshedAgo}
            </span>
          )}
          <button
            type="button"
            aria-label="Refresh roster"
            title="Recompute scores now"
            onClick={handleManualRefresh}
            className={cn(
              'inline-flex items-center justify-center size-9 rounded-xl',
              'text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-elevated)]',
              'hover:text-[var(--color-text)] transition-colors',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]',
              loading && 'opacity-50 pointer-events-none',
            )}
          >
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} aria-hidden />
          </button>
        </div>
      </div>

      {/* Desktop table (hidden on mobile) */}
      <div className="hidden md:block overflow-x-auto" data-testid="roster-table-desktop">
        <table role="grid" className="w-full text-start" aria-label="Patient roster">
          <thead>
            <tr role="row" className="border-b border-[var(--color-border)]">
              {/* Header checkbox: select all visible */}
              <th role="columnheader" className="pb-2 ps-2 pe-1 w-[40px]">
                <div
                  role="checkbox"
                  aria-checked={allVisibleSelected ? true : headerIndeterminate ? 'mixed' : false}
                  aria-label="Select all visible patients"
                  tabIndex={0}
                  className={cn(
                    'inline-flex items-center justify-center w-10 h-10 rounded-lg cursor-pointer',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]',
                  )}
                  onClick={handleHeaderCheckboxClick}
                  onKeyDown={(e) => {
                    if (e.key === ' ' || e.key === 'Enter') {
                      e.preventDefault();
                      handleHeaderCheckboxClick();
                    }
                  }}
                >
                  <span
                    className={cn(
                      'w-5 h-5 rounded-md border-2 flex items-center justify-center',
                      allVisibleSelected
                        ? 'bg-[var(--color-primary)] border-[var(--color-primary)]'
                        : headerIndeterminate
                          ? 'bg-[var(--color-primary)]/50 border-[var(--color-primary)]'
                          : 'border-[var(--color-border)]',
                    )}
                    aria-hidden
                  >
                    {allVisibleSelected && (
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
                    {headerIndeterminate && !allVisibleSelected && (
                      <svg width="10" height="2" viewBox="0 0 10 2" fill="none">
                        <path d="M1 1H9" stroke="white" strokeWidth="2" strokeLinecap="round" />
                      </svg>
                    )}
                  </span>
                </div>
              </th>

              {(
                [
                  'score',
                  'display_name',
                  'last_injection_at',
                  'weight_trend_arrow',
                  'recent_symptom_severity',
                  'days_since_injection',
                  'missed_dose_flag',
                ] as SortColumn[]
              ).map((col) => (
                <th
                  key={col}
                  role="columnheader"
                  aria-sort={getAriaSortAttr(col)}
                  className="pb-2 px-3 first:ps-4 last:pe-4 text-[12px] font-semibold uppercase tracking-[0.05em] text-[var(--color-text-tertiary)]"
                >
                  <button
                    type="button"
                    onClick={() => handleSortClick(col)}
                    className={cn(
                      'inline-flex items-center gap-0 focus-visible:outline-none focus-visible:ring-2',
                      'focus-visible:ring-[var(--color-primary)] rounded',
                      'hover:text-[var(--color-text)] transition-colors',
                      sort.column === col && 'text-[var(--color-text)]',
                    )}
                  >
                    {COLUMN_LABELS[col]}
                    <SortIcon col={col} />
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {displayedRows.map((row) => (
              <RosterRow
                key={row.user_id}
                row={row}
                slug={slug}
                orgId={orgId}
                permissionMap={permissionMap}
                flash={flashingRows.has(row.user_id)}
                onFlashComplete={() => {
                  setFlashingRows((prev) => {
                    const next = new Set(prev);
                    next.delete(row.user_id);
                    return next;
                  });
                }}
                isSelected={isSelected(row.user_id)}
                onToggleSelect={toggle}
              />
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile card stack (visible only on mobile) */}
      <div className="md:hidden space-y-3" data-testid="roster-table-mobile">
        {displayedRows.map((row) => (
          <RosterMobileCard
            key={row.user_id}
            row={row}
            slug={slug}
            orgId={orgId}
            permissionMap={permissionMap}
            isSelected={isSelected(row.user_id)}
            onToggleSelect={toggle}
          />
        ))}
      </div>

      {/* Pagination footer */}
      {displayedRows.length > 0 && (
        <div className="mt-4">
          <RosterPagination
            offset={offset}
            limit={PAGE_SIZE}
            total={offset + displayedRows.length + (displayedRows.length === PAGE_SIZE ? 1 : 0)}
            onPrevious={() => setOffset((prev) => Math.max(0, prev - PAGE_SIZE))}
            onNext={() => setOffset((prev) => prev + PAGE_SIZE)}
          />
        </div>
      )}

      {/* Bulk flow modals */}
      {activeBulkFlow === 'pdf' && (
        <BulkExportPDFFlow
          orgId={orgId}
          slug={slug}
          selectedIds={[...selected]}
          permissionMap={permissionMap}
          onClose={() => {
            setActiveBulkFlow(null);
            clear();
          }}
        />
      )}
      {activeBulkFlow === 'csv' && (
        <BulkExportCSVFlow
          orgId={orgId}
          selectedIds={[...selected]}
          onClose={() => {
            setActiveBulkFlow(null);
            clear();
          }}
        />
      )}
      {activeBulkFlow === 'tabs' && (
        <BulkOpenInTabsFlow
          slug={slug}
          selectedIds={[...selected]}
          onClose={() => {
            setActiveBulkFlow(null);
            clear();
          }}
        />
      )}
    </div>
  );
}

export { scoreBucket };
