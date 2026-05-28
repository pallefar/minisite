/**
 * Phase 48 Plan 48-10 — AuditLogViewer sub-view.
 *
 * Read-only view of public.moderation_audit_log. Append-only invariant
 * enforced by RLS (Plan 48-04) — the UI MUST NOT expose any edit/delete
 * affordances. Per memory feedback_admin_module_manifest_vs_router_branch_drift,
 * this is a dedicated moderation viewer (distinct from the broader
 * audit_logs viewer at /admin/audit-log).
 *
 * Filter bar: actor, action_type, target_type, created_after.
 * Cursor pagination (created_at, id) via load-more button.
 * CSV export of the currently loaded rows via Blob.
 */
import { Fragment, useCallback, useEffect, useState } from 'react';
import type { ModerationAuditRow } from '@/lib/moderation/types';
import { useStore } from '@/lib/store';
import { supabase } from '@/lib/supabase';

const PAGE_SIZE = 50;

const ACTION_OPTIONS: readonly string[] = [
  'all',
  'report_filed',
  'report_triaged',
  'report_dismissed',
  'report_resolved',
  'mute_applied',
  'ban_applied',
  'temp_suspended',
  'temp_restore',
  'auto_flag',
  'banned_word_match',
  'banned_word_upsert',
  'banned_word_remove',
  'session_revoked',
];

const TARGET_OPTIONS: readonly string[] = [
  'all',
  'report',
  'post',
  'comment',
  'dm_message',
  'profile',
  'user',
  'banned_word',
];

interface Filters {
  actor: string;
  action: string;
  target: string;
  createdAfter: string;
}

function toCsvRow(values: (string | number | null)[]): string {
  return values
    .map((v) => {
      if (v === null || v === undefined) return '';
      const s = String(v);
      if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
      return s;
    })
    .join(',');
}

export function AuditLogViewer() {
  const showToast = useStore((s) => s.showToast);
  const [rows, setRows] = useState<ModerationAuditRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState<Filters>({
    actor: '',
    action: 'all',
    target: 'all',
    createdAfter: '',
  });
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);

  const load = useCallback(
    async (cursor: { created_at: string; id: string } | null): Promise<void> => {
      setLoading(true);
      let query = supabase
        .from('moderation_audit_log')
        .select(
          'id, actor_user_id, action_type, target_type, target_id, before_state, after_state, reason, created_at',
        )
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .limit(PAGE_SIZE);

      if (cursor) query = query.lt('created_at', cursor.created_at);
      if (filters.action !== 'all') query = query.eq('action_type', filters.action);
      if (filters.target !== 'all') query = query.eq('target_type', filters.target);
      if (filters.actor.trim()) query = query.eq('actor_user_id', filters.actor.trim());
      if (filters.createdAfter)
        query = query.gte('created_at', new Date(filters.createdAfter).toISOString());

      const { data, error } = await query;
      if (error) {
        showToast(error.message, 'error');
        setRows((prev) => (cursor ? prev : []));
        setHasMore(false);
      } else {
        const fetched = (data ?? []) as ModerationAuditRow[];
        setRows((prev) => (cursor ? [...prev, ...fetched] : fetched));
        setHasMore(fetched.length === PAGE_SIZE);
      }
      setLoading(false);
    },
    [filters, showToast],
  );

  useEffect(() => {
    void load(null);
  }, [load]);

  const loadMore = (): void => {
    const last = rows[rows.length - 1];
    if (!last) return;
    void load({ created_at: last.created_at, id: last.id });
  };

  const exportCsv = (): void => {
    const header = toCsvRow([
      'id',
      'created_at',
      'actor_user_id',
      'action_type',
      'target_type',
      'target_id',
      'reason',
    ]);
    const body = rows
      .map((r) =>
        toCsvRow([
          r.id,
          r.created_at,
          r.actor_user_id ?? '',
          r.action_type,
          r.target_type,
          r.target_id ?? '',
          r.reason ?? '',
        ]),
      )
      .join('\n');
    const csv = `${header}\n${body}\n`;
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `moderation-audit-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-base font-semibold">Moderation audit log</h2>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={exportCsv}
            disabled={rows.length === 0}
            className="text-xs font-medium text-[var(--color-primary)] hover:underline focus-visible:outline-none disabled:opacity-50"
          >
            Export CSV
          </button>
          <button
            type="button"
            onClick={() => void load(null)}
            className="text-xs text-[var(--color-text-secondary)] hover:underline focus-visible:outline-none"
          >
            Refresh
          </button>
        </div>
      </header>

      <div className="flex flex-wrap gap-3">
        <label className="text-xs text-[var(--color-text-secondary)]">
          Action
          <select
            value={filters.action}
            onChange={(e) => setFilters((f) => ({ ...f, action: e.target.value }))}
            className="ms-2 rounded border border-[var(--color-border)] bg-transparent px-2 py-1 text-xs"
          >
            {ACTION_OPTIONS.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs text-[var(--color-text-secondary)]">
          Target
          <select
            value={filters.target}
            onChange={(e) => setFilters((f) => ({ ...f, target: e.target.value }))}
            className="ms-2 rounded border border-[var(--color-border)] bg-transparent px-2 py-1 text-xs"
          >
            {TARGET_OPTIONS.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs text-[var(--color-text-secondary)]">
          Actor (uuid)
          <input
            type="text"
            value={filters.actor}
            onChange={(e) => setFilters((f) => ({ ...f, actor: e.target.value }))}
            placeholder="optional"
            className="ms-2 rounded border border-[var(--color-border)] bg-transparent px-2 py-1 font-mono text-xs"
          />
        </label>
        <label className="text-xs text-[var(--color-text-secondary)]">
          Since
          <input
            type="date"
            value={filters.createdAfter}
            onChange={(e) => setFilters((f) => ({ ...f, createdAfter: e.target.value }))}
            className="ms-2 rounded border border-[var(--color-border)] bg-transparent px-2 py-1 text-xs"
          />
        </label>
      </div>

      {loading && rows.length === 0 && (
        <p className="text-sm text-[var(--color-text-secondary)]">Loading audit log…</p>
      )}

      {!loading && rows.length === 0 && (
        <p className="text-sm text-[var(--color-text-secondary)]">No matching audit rows.</p>
      )}

      {rows.length > 0 && (
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="border-b border-[var(--color-border)]">
              <th className="py-2 text-start font-medium text-[var(--color-text-secondary)]">
                When
              </th>
              <th className="py-2 text-start font-medium text-[var(--color-text-secondary)]">
                Actor
              </th>
              <th className="py-2 text-start font-medium text-[var(--color-text-secondary)]">
                Action
              </th>
              <th className="py-2 text-start font-medium text-[var(--color-text-secondary)]">
                Target
              </th>
              <th className="py-2" />
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const expanded = expandedId === row.id;
              return (
                <Fragment key={row.id}>
                  <tr className="border-b border-[var(--color-border)] hover:bg-[var(--color-surface-elevated)]">
                    <td className="py-2 text-xs text-[var(--color-text-secondary)]">
                      {new Date(row.created_at).toLocaleString()}
                    </td>
                    <td className="py-2 font-mono text-xs">
                      {row.actor_user_id ? row.actor_user_id.slice(0, 8) + '…' : 'system'}
                    </td>
                    <td className="py-2 font-medium">{row.action_type}</td>
                    <td className="py-2">
                      <div className="text-xs capitalize">{row.target_type}</div>
                      {row.target_id && (
                        <div className="font-mono text-xs text-[var(--color-text-secondary)]">
                          {row.target_id.slice(0, 8)}…
                        </div>
                      )}
                    </td>
                    <td className="py-2 text-end">
                      <button
                        type="button"
                        onClick={() => setExpandedId(expanded ? null : row.id)}
                        aria-expanded={expanded}
                        className="text-xs font-medium text-[var(--color-primary)] hover:underline focus-visible:outline-none"
                      >
                        {expanded ? 'Hide' : 'Inspect'}
                      </button>
                    </td>
                  </tr>
                  {expanded && (
                    <tr className="bg-[var(--color-surface-elevated)]">
                      <td colSpan={5} className="px-2 py-3">
                        <div className="grid gap-3 md:grid-cols-2">
                          <div>
                            <div className="text-xs font-semibold text-[var(--color-text-secondary)]">
                              Before
                            </div>
                            <pre className="mt-1 max-h-64 overflow-auto rounded bg-[var(--color-surface)] p-2 font-mono text-[11px]">
                              {row.before_state ? JSON.stringify(row.before_state, null, 2) : '—'}
                            </pre>
                          </div>
                          <div>
                            <div className="text-xs font-semibold text-[var(--color-text-secondary)]">
                              After
                            </div>
                            <pre className="mt-1 max-h-64 overflow-auto rounded bg-[var(--color-surface)] p-2 font-mono text-[11px]">
                              {row.after_state ? JSON.stringify(row.after_state, null, 2) : '—'}
                            </pre>
                          </div>
                        </div>
                        {row.reason && (
                          <div className="mt-3 text-xs">
                            <span className="font-semibold text-[var(--color-text-secondary)]">
                              Reason:
                            </span>{' '}
                            {row.reason}
                          </div>
                        )}
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      )}

      {hasMore && (
        <div className="flex justify-center">
          <button
            type="button"
            onClick={loadMore}
            disabled={loading}
            className="inline-flex h-8 items-center rounded-full bg-[var(--color-surface-elevated)] px-4 text-xs font-medium hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] disabled:opacity-50"
          >
            {loading ? 'Loading…' : 'Load more'}
          </button>
        </div>
      )}
    </div>
  );
}

export default AuditLogViewer;
