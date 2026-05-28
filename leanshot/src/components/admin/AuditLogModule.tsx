/**
 * Phase 24 Plan 24-06 — AuditLogModule.
 *
 * Replaces the Plan 24-03 stub. Full admin audit log viewer:
 *   - Fetches audit_logs rows (last 90 days) via Supabase RLS-gated SELECT
 *   - Filter bar: actor email, target email, table_name, action_name, date range
 *   - Cursor-based pagination (created_at desc, id desc)
 *   - Row expansion → AuditRowExpand (before/after JSONB diff)
 *
 * minRole: superadmin (per Plan 24-03 modules.ts).
 * RLS: audit_logs_select_admin policy (is_admin_at_least('admin')).
 *
 * Threat: T-24-03d — JsonDiffViewer truncates values > 200 chars.
 * Pattern: D-15 full before/after JSONB; diff computed client-side.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Card, CardHeader } from '@/components/ui/Card';
import { Skeleton } from '@/components/ui/Skeleton';
import { supabase } from '@/lib/supabase';
import {
  AdminAuditFilterBar,
  DEFAULT_ADMIN_AUDIT_FILTERS,
  type AdminAuditFilters,
} from './audit/AuditFilterBar';
import { AuditRowExpand, type AuditLogRow } from './audit/AuditRowExpand';

// ── Constants ──────────────────────────────────────────────────────────────────

const PAGE_SIZE = 50;

// ── Helpers ────────────────────────────────────────────────────────────────────

function relativeTime(isoString: string): string {
  const now = Date.now();
  const then = new Date(isoString).getTime();
  const diffMs = now - then;
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) return 'Just now';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 30) return `${diffDay}d ago`;
  return new Date(isoString).toLocaleDateString();
}

// ── Query builder ──────────────────────────────────────────────────────────────

async function fetchAuditRows(
  filters: AdminAuditFilters,
  cursor: { created_at: string; id: string } | null,
): Promise<{ rows: AuditLogRow[]; error: string | null }> {
  let query = supabase
    .from('audit_logs')
    .select('*, actor:auth.users!actor_user_id(email), target:auth.users!target_user_id(email)')
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(PAGE_SIZE);

  // Cursor pagination
  if (cursor) {
    query = query.lt('created_at', cursor.created_at);
  }

  // 90-day hot window
  const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
  query = query.gte('created_at', ninetyDaysAgo);

  // Filters
  if (filters.actorEmail) {
    query = query.ilike('actor.email', `%${filters.actorEmail}%`);
  }
  if (filters.targetEmail) {
    query = query.ilike('target.email', `%${filters.targetEmail}%`);
  }
  if (filters.tableName) {
    query = query.eq('table_name', filters.tableName);
  }
  if (filters.actionName) {
    query = query.ilike('action_name', `%${filters.actionName}%`);
  }
  if (filters.fromDate) {
    query = query.gte('created_at', new Date(filters.fromDate).toISOString());
  }
  if (filters.toDate) {
    const toEnd = new Date(filters.toDate);
    toEnd.setDate(toEnd.getDate() + 1);
    query = query.lt('created_at', toEnd.toISOString());
  }

  const { data, error } = await query;

  if (error) {
    return { rows: [], error: (error as { message: string }).message };
  }

  return { rows: (data as unknown as AuditLogRow[]) ?? [], error: null };
}

// ── AuditLogModule ─────────────────────────────────────────────────────────────

export default function AuditLogModule() {
  const [rows, setRows] = useState<AuditLogRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<AdminAuditFilters>(DEFAULT_ADMIN_AUDIT_FILTERS);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [cursor, setCursor] = useState<{ created_at: string; id: string } | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const loadRows = useCallback(
    async (nextFilters: AdminAuditFilters, nextCursor: typeof cursor, append: boolean) => {
      // Cancel any in-flight request
      if (abortRef.current) abortRef.current.abort();
      abortRef.current = new AbortController();

      if (!append) setLoading(true);
      else setLoadingMore(true);
      setError(null);

      const { rows: fetched, error: fetchError } = await fetchAuditRows(nextFilters, nextCursor);

      setLoading(false);
      setLoadingMore(false);

      if (fetchError) {
        setError(fetchError);
        return;
      }

      setHasMore(fetched.length === PAGE_SIZE);

      if (append) {
        setRows((prev) => [...prev, ...fetched]);
      } else {
        setRows(fetched);
      }

      if (fetched.length > 0) {
        const last = fetched[fetched.length - 1];
        setCursor({ created_at: last.created_at, id: last.id });
      }
    },
    [],
  );

  // Initial load + filter changes
  useEffect(() => {
    setCursor(null);
    void loadRows(filters, null, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters]);

  const handleFiltersChange = (next: AdminAuditFilters): void => {
    setFilters(next);
  };

  const handleClearFilters = (): void => {
    setFilters(DEFAULT_ADMIN_AUDIT_FILTERS);
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

  const handleLoadMore = (): void => {
    if (!cursor || loadingMore) return;
    void loadRows(filters, cursor, true);
  };

  return (
    <div className="flex flex-col gap-5">
      {/* Heading */}
      <div>
        <h1 className="text-[26px] font-semibold tracking-tight text-[var(--color-text)]">
          Audit Log
        </h1>
        <p className="mt-1 text-[13px] text-[var(--color-text-secondary)]">
          Admin actions and PHI table changes from the last 90 days. Older records are archived to
          cold storage nightly.
        </p>
      </div>

      {/* Filter bar */}
      <AdminAuditFilterBar
        value={filters}
        onChange={handleFiltersChange}
        onClear={handleClearFilters}
      />

      {/* Error */}
      {error && !loading && (
        <Card variant="flat" padding="sm">
          <p className="text-[13px] text-[var(--color-danger)] mb-2">{error}</p>
          <Button variant="secondary" size="sm" onClick={() => void loadRows(filters, null, false)}>
            Retry
          </Button>
        </Card>
      )}

      {/* Loading */}
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
          {/* Table header */}
          <div className="hidden sm:grid grid-cols-[140px_1fr_1fr_120px_80px] gap-3 px-4 py-2 bg-[var(--color-surface-elevated)] border-b border-[var(--color-border)] text-[11px] font-semibold uppercase tracking-wide text-[var(--color-text-tertiary)]">
            <span>Timestamp</span>
            <span>Actor</span>
            <span>Action</span>
            <span>Table</span>
            <span className="text-end">Source</span>
          </div>

          {rows.map((row) => (
            <div key={row.id} className="border-b border-[var(--color-border)] last:border-b-0">
              <button
                type="button"
                onClick={() => handleRowToggle(row.id)}
                aria-expanded={expandedIds.has(row.id)}
                aria-controls={`audit-row-${row.id}-expand`}
                className="w-full text-start px-4 py-3 hover:bg-[var(--color-surface-elevated)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--color-primary)] sm:grid grid-cols-[140px_1fr_1fr_120px_80px] gap-3 items-center"
              >
                {/* Timestamp */}
                <span className="text-[12px] font-mono text-[var(--color-text-secondary)] block sm:block">
                  {relativeTime(row.created_at)}
                </span>

                {/* Actor */}
                <span className="text-[13px] text-[var(--color-text)] truncate block">
                  {row.actor?.email ?? row.actor_user_id ?? '—'}
                </span>

                {/* Action */}
                <span className="text-[13px] text-[var(--color-text-secondary)] font-mono truncate block">
                  {row.action_name ?? '—'}
                </span>

                {/* Table */}
                <span className="text-[12px] text-[var(--color-text-tertiary)] font-mono truncate block">
                  {row.table_name ?? '—'}
                </span>

                {/* Source + expand indicator */}
                <span className="flex items-center justify-end gap-2 text-[11px] text-[var(--color-text-tertiary)]">
                  <span className="inline-flex items-center px-1.5 py-0.5 rounded-md bg-[var(--color-surface-elevated)] border border-[var(--color-border)]">
                    {row.source ?? '—'}
                  </span>
                  <span
                    aria-hidden
                    className="text-[11px] transition-transform"
                    style={{ transform: expandedIds.has(row.id) ? 'rotate(90deg)' : 'none' }}
                  >
                    ›
                  </span>
                </span>
              </button>

              {expandedIds.has(row.id) && (
                <div id={`audit-row-${row.id}-expand`} role="region">
                  <AuditRowExpand row={row} />
                </div>
              )}
            </div>
          ))}

          {/* Load more */}
          {hasMore && (
            <div className="px-4 py-3 flex justify-center border-t border-[var(--color-border)]">
              <Button
                variant="secondary"
                size="sm"
                onClick={handleLoadMore}
                aria-busy={loadingMore}
              >
                {loadingMore ? 'Loading…' : 'Load more'}
              </Button>
            </div>
          )}
        </Card>
      )}

      {/* Empty state */}
      {!loading && !error && rows.length === 0 && (
        <Card variant="flat" padding="lg">
          <CardHeader title="Audit Log" />
          <div className="flex flex-col items-center gap-3 py-6 text-center">
            <p className="text-[18px] font-semibold text-[var(--color-text)]">
              No audit events found
            </p>
            <p className="text-[13px] text-[var(--color-text-secondary)]">
              Admin actions and PHI-table changes will appear here.
            </p>
            {Object.values(filters).some((v) => v !== '') && (
              <Button variant="primary" size="sm" onClick={handleClearFilters}>
                Clear filters
              </Button>
            )}
          </div>
        </Card>
      )}
    </div>
  );
}
