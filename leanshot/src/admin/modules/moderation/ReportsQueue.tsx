/**
 * Phase 48 Plan 48-10 — ReportsQueue sub-view.
 *
 * Renders community_reports rows. RLS-gated SELECT (Plan 48-02 policy):
 * is_staff() sees all; clinic admins see only reports for content scoped
 * to their org via public.can_moderate_report_org(). Cross-org isolation
 * is enforced at the DB layer — the client query is identical for both.
 *
 * Modes:
 *   'all'         — every row
 *   'auto-flags'  — only system-sourced reports (reporter_user_id IS NULL)
 *
 * Row actions:
 *   Triage   → triage_report RPC (open → triaged)
 *   Dismiss  → opens dismiss-reason prompt, then dismiss_report RPC
 *   Resolve  → resolve_report RPC
 */
import { useCallback, useEffect, useState } from 'react';
import type {
  ModerationReport,
  ReportStatus,
  ReportTargetType,
} from '@/lib/moderation/types';
import { useStore } from '@/lib/store';
import { supabase } from '@/lib/supabase';
import { dismissReport, resolveReport, triageReport } from './api';

const STATUS_FILTERS: ReadonlyArray<ReportStatus | 'all'> = [
  'all',
  'open',
  'triaged',
  'resolved',
  'dismissed',
];

const TARGET_FILTERS: ReadonlyArray<ReportTargetType | 'all'> = [
  'all',
  'post',
  'comment',
  'dm_message',
  'profile',
];

interface ReportsQueueProps {
  mode: 'all' | 'auto-flags';
}

export function ReportsQueue({ mode }: ReportsQueueProps) {
  const showToast = useStore((s) => s.showToast);
  const [rows, setRows] = useState<ModerationReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<ReportStatus | 'all'>('open');
  const [targetFilter, setTargetFilter] = useState<ReportTargetType | 'all'>('all');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    let query = supabase
      .from('community_reports')
      .select(
        'id, target_type, target_id, reporter_user_id, reason, status, triaged_by, triaged_at, dismissed_reason, created_at',
      )
      .order('created_at', { ascending: false })
      .limit(100);

    if (statusFilter !== 'all') query = query.eq('status', statusFilter);
    if (targetFilter !== 'all') query = query.eq('target_type', targetFilter);
    if (mode === 'auto-flags') query = query.is('reporter_user_id', null);

    const { data, error: qErr } = await query;
    if (qErr) {
      setError(qErr.message);
      setRows([]);
    } else {
      setRows((data ?? []) as ModerationReport[]);
    }
    setLoading(false);
  }, [statusFilter, targetFilter, mode]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleAction = async (
    fn: () => Promise<void>,
    successMsg: string,
  ): Promise<void> => {
    try {
      await fn();
      showToast(successMsg, 'success');
      await load();
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Action failed';
      showToast(msg, 'error');
    }
  };

  const onTriage = (reportId: string) =>
    handleAction(() => triageReport(reportId), 'Report triaged.');

  const onResolve = (reportId: string) =>
    handleAction(() => resolveReport(reportId), 'Report resolved.');

  const onDismiss = (reportId: string) => {
    const reason = window.prompt('Dismissal reason (visible in audit log):', '');
    if (!reason || !reason.trim()) return;
    void handleAction(() => dismissReport(reportId, reason.trim()), 'Report dismissed.');
  };

  return (
    <div className="space-y-4">
      <header className="flex items-center justify-between">
        <h2 className="text-base font-semibold">
          {mode === 'auto-flags' ? 'Auto-flagged content' : 'Community reports'}
        </h2>
        <button
          type="button"
          onClick={() => void load()}
          className="text-xs text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:underline focus-visible:outline-none"
        >
          Refresh
        </button>
      </header>

      <div className="flex flex-wrap gap-3">
        <label className="text-xs text-[var(--color-text-secondary)]">
          Status
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as ReportStatus | 'all')}
            className="ml-2 rounded border border-[var(--color-border)] bg-transparent px-2 py-1 text-xs"
          >
            {STATUS_FILTERS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs text-[var(--color-text-secondary)]">
          Target
          <select
            value={targetFilter}
            onChange={(e) => setTargetFilter(e.target.value as ReportTargetType | 'all')}
            className="ml-2 rounded border border-[var(--color-border)] bg-transparent px-2 py-1 text-xs"
          >
            {TARGET_FILTERS.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
      </div>

      {error && (
        <div className="rounded-md border border-[var(--color-danger)] bg-[var(--color-danger)]/10 p-3 text-sm text-[var(--color-danger)]">
          {error}
        </div>
      )}

      {loading && (
        <p className="text-sm text-[var(--color-text-secondary)]">Loading reports…</p>
      )}

      {!loading && rows.length === 0 && !error && (
        <p className="text-sm text-[var(--color-text-secondary)]">No reports match.</p>
      )}

      {!loading && rows.length > 0 && (
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="border-b border-[var(--color-border)]">
              <th className="py-2 text-left font-medium text-[var(--color-text-secondary)]">
                Created
              </th>
              <th className="py-2 text-left font-medium text-[var(--color-text-secondary)]">
                Target
              </th>
              <th className="py-2 text-left font-medium text-[var(--color-text-secondary)]">
                Source
              </th>
              <th className="py-2 text-left font-medium text-[var(--color-text-secondary)]">
                Status
              </th>
              <th className="py-2" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const source = String(r.reason?.source ?? 'unknown');
              return (
                <tr
                  key={r.id}
                  className="border-b border-[var(--color-border)] align-top hover:bg-[var(--color-surface-elevated)]"
                >
                  <td className="py-2 text-xs text-[var(--color-text-secondary)]">
                    {new Date(r.created_at).toLocaleString()}
                  </td>
                  <td className="py-2">
                    <div className="font-medium capitalize">{r.target_type}</div>
                    <div className="font-mono text-xs text-[var(--color-text-secondary)]">
                      {r.target_id.slice(0, 8)}…
                    </div>
                  </td>
                  <td className="py-2 text-xs">{source}</td>
                  <td className="py-2">
                    <span
                      className={
                        'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ' +
                        (r.status === 'open'
                          ? 'bg-amber-500/15 text-amber-700 dark:text-amber-300'
                          : r.status === 'triaged'
                            ? 'bg-blue-500/15 text-blue-700 dark:text-blue-300'
                            : r.status === 'resolved'
                              ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                              : 'bg-zinc-500/15 text-zinc-700 dark:text-zinc-300')
                      }
                    >
                      {r.status}
                    </span>
                  </td>
                  <td className="py-2 text-right">
                    <div className="inline-flex gap-2">
                      {r.status === 'open' && (
                        <button
                          type="button"
                          onClick={() => void onTriage(r.id)}
                          className="text-xs font-medium text-[var(--color-primary)] hover:underline focus-visible:outline-none"
                        >
                          Triage
                        </button>
                      )}
                      {(r.status === 'open' || r.status === 'triaged') && (
                        <>
                          <button
                            type="button"
                            onClick={() => void onResolve(r.id)}
                            className="text-xs font-medium text-emerald-600 hover:underline focus-visible:outline-none"
                          >
                            Resolve
                          </button>
                          <button
                            type="button"
                            onClick={() => onDismiss(r.id)}
                            className="text-xs font-medium text-[var(--color-text-secondary)] hover:underline focus-visible:outline-none"
                          >
                            Dismiss
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

export default ReportsQueue;
