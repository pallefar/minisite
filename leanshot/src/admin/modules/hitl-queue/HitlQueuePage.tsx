/**
 * Phase 38 Plan 38-08 — HitlQueuePage (RECOMMEND-07, D-12/13/14).
 *
 * Super-admin HITL admin queue. Plugs into Phase 24 admin shell via
 * `@/lib/admin/modules` (registered as `key: 'hitl-queue'`, `minRole: 'superadmin'`).
 *
 * Surfaces:
 *   - Filter pills: All | recommender | digest | win_back (D-12).
 *   - Pending count badge.
 *   - Bulk-select checkboxes + "Approve Selected" CTA.
 *   - Per-row Approve / Reject / Edit buttons (HitlQueueRow).
 *   - HitlDecisionModal for edit-then-approve flow.
 *   - KB-sourced rows render as audit-only (D-13: status='auto_approved_kb').
 *
 * Decision flow:
 *   1. supabase.rpc('hitl_decide', { row_ids, decision, note?, edited_payload? }).
 *      Server-side: super-admin gate + status='pending' only.
 *   2. For approved digest rows, immediately call
 *      supabase.functions.invoke('weekly-digest', { body: { hitl_release_row_id } }).
 *      The Edge Fn re-reads the (now status='approved' OR 'edited') row, runs
 *      DigestOutputSchema validation, and sends the held email.
 *
 * Loads:
 *   supabase
 *     .from('ai_suggestion_review')
 *     .select('*')
 *     .in('status', ['pending', 'auto_approved_kb'])  -- D-13 shows audit rows
 *     .order('created_at', { ascending: false })
 *     .limit(200)
 *
 * RLS scopes the read to super-admin (is_staff=true).
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { HitlDecisionModal } from './HitlDecisionModal';
import { HitlQueueRow, type HitlRow } from './HitlQueueRow';

type FilterKey = 'all' | 'recommender' | 'digest' | 'win_back';

const FILTERS: Array<{ key: FilterKey; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'recommender', label: 'recommender' },
  { key: 'digest', label: 'digest' },
  { key: 'win_back', label: 'win_back' },
];

export default function HitlQueuePage() {
  const [rows, setRows] = useState<HitlRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterKey>('all');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editingRow, setEditingRow] = useState<HitlRow | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('ai_suggestion_review')
        .select('*')
        .in('status', ['pending', 'auto_approved_kb'])
        .order('created_at', { ascending: false })
        .limit(200);
      if (error) {
        setError(error.message);
      } else {
        setRows((data ?? []) as HitlRow[]);
        setError(null);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'unknown error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const visibleRows = useMemo(() => {
    if (filter === 'all') return rows;
    return rows.filter((r) => r.type === filter);
  }, [rows, filter]);

  const pendingCount = useMemo(() => rows.filter((r) => r.status === 'pending').length, [rows]);

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  /**
   * Issue a hitl_decide RPC call and (for digest rows being approved/edited)
   * fire the follow-on `weekly-digest` Edge Fn release callback.
   *
   * Per plan: the digest release path is `supabase.functions.invoke('weekly-digest',
   * { body: { hitl_release_row_id: row.id } })`. The Edge Fn re-reads the
   * ai_suggestion_review row, validates the payload, and sends the held email.
   */
  async function decide(
    rowsToDecide: HitlRow[],
    decision: 'approved' | 'rejected' | 'edited',
    extras?: { note?: string; edited_payload?: Record<string, unknown> },
  ) {
    if (rowsToDecide.length === 0) return;
    const ids = rowsToDecide.map((r) => r.id);
    try {
      const { error } = await supabase.rpc('hitl_decide', {
        row_ids: ids,
        decision,
        note: extras?.note ?? null,
        edited_payload: extras?.edited_payload ?? null,
      });
      if (error) {
        setError(error.message);
        return;
      }
      // Follow-on send: release the held digest email for any approved/edited
      // digest row. Reject does NOT trigger the release path (weekly_digest_sends
      // row remains 'pending_review' and is not retried — operator workflow).
      if (decision === 'approved' || decision === 'edited') {
        for (const r of rowsToDecide) {
          if (r.type === 'digest') {
            try {
              await supabase.functions.invoke('weekly-digest', {
                body: { hitl_release_row_id: r.id },
              });
            } catch (e) {
              // Swallow + surface; the row IS still approved in the DB.
              console.warn('[hitl-queue] release fn failed', e);
            }
          }
        }
      }
      // Clear selection + reload.
      setSelected(new Set());
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'decision failed');
    }
  }

  function onApprove(row: HitlRow) {
    void decide([row], 'approved');
  }
  function onReject(row: HitlRow) {
    void decide([row], 'rejected');
  }
  function onEdit(row: HitlRow) {
    setEditingRow(row);
  }

  function onModalSubmit(payload: { decision: 'edited'; edited_payload: Record<string, unknown> }) {
    if (!editingRow) return;
    void decide([editingRow], payload.decision, {
      edited_payload: payload.edited_payload,
    });
    setEditingRow(null);
  }

  async function onBulkApprove() {
    const selectedRows = rows.filter((r) => selected.has(r.id) && r.status === 'pending');
    if (selectedRows.length === 0) return;
    await decide(selectedRows, 'approved');
  }

  return (
    <div className="space-y-4">
      <header className="flex items-center justify-between gap-3 flex-wrap">
        <h1 className="text-xl font-semibold">AI Suggestion Review</h1>
        <span className="text-[12px] text-[var(--color-text-secondary)]">
          {pendingCount} pending
        </span>
      </header>

      <nav aria-label="Filter by type" className="flex flex-wrap gap-2">
        {FILTERS.map((f) => {
          const active = filter === f.key;
          return (
            <button
              key={f.key}
              type="button"
              aria-pressed={active}
              onClick={() => setFilter(f.key)}
              className={
                active
                  ? 'inline-flex items-center h-8 px-3 rounded-pill text-[12px] font-semibold bg-[var(--color-primary)] text-[var(--color-primary-foreground)]'
                  : 'inline-flex items-center h-8 px-3 rounded-pill text-[12px] font-medium bg-[var(--color-surface-elevated)] border border-[var(--color-border)] text-[var(--color-text)] hover:border-[var(--color-primary)]'
              }
            >
              {f.label}
            </button>
          );
        })}
      </nav>

      {selected.size > 0 && (
        <div className="flex items-center justify-between p-3 rounded-lg bg-[var(--color-primary-soft,#dbeafe)] border border-[var(--color-primary)]">
          <span className="text-[13px] font-semibold">{selected.size} selected</span>
          <button
            type="button"
            onClick={() => void onBulkApprove()}
            className="h-8 px-4 rounded-pill text-[12px] font-semibold bg-[var(--color-primary)] text-[var(--color-primary-foreground)]"
          >
            Approve Selected
          </button>
        </div>
      )}

      {error && (
        <p
          role="alert"
          className="text-sm text-[var(--color-error,#dc2626)] p-3 rounded bg-[var(--color-error-soft,#fee2e2)]"
        >
          Failed to load HITL queue: {error}
        </p>
      )}

      {loading && <p className="text-sm text-[var(--color-text-secondary)]">Loading…</p>}

      {!loading && visibleRows.length === 0 && !error && (
        <p className="text-sm text-[var(--color-text-secondary)] p-6 text-center">
          No pending items — queue is empty.
        </p>
      )}

      <ul className="space-y-3">
        {visibleRows.map((row) => (
          <HitlQueueRow
            key={row.id}
            row={row}
            selected={selected.has(row.id)}
            onToggleSelect={toggleSelect}
            onApprove={onApprove}
            onReject={onReject}
            onEdit={onEdit}
          />
        ))}
      </ul>

      {editingRow && (
        <HitlDecisionModal
          row={editingRow}
          open={true}
          onClose={() => setEditingRow(null)}
          onSubmit={onModalSubmit}
        />
      )}
    </div>
  );
}
