/**
 * Phase 37 Plan 37-08 Task 3 — RoutingRulesPage (HELP-12).
 *
 * CRUD on helpdesk_routing_rules. Priority swap via reorder_routing_rule RPC.
 *
 * Routing rules apply Claude AI tag → agent assignment. UI uses up/down
 * priority buttons rather than drag-reorder (lighter; reuses RPC).
 *
 * Role gate (UX): UI disables mutation for non-admin. RPC + RLS enforce
 * server-side.
 */
import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';

interface RoutingRule {
  id: string;
  org_id: string;
  name: string;
  tag_name: string;
  assign_to_user_id: string;
  priority: number;
  active: boolean;
}

const ADMIN_ROLES = new Set(['owner', 'support_admin', 'support_lead']);
const PRIORITY_STEP = 10;
const MAX_PRIORITY = 9999;

export default function RoutingRulesPage(): React.JSX.Element {
  const [rules, setRules] = useState<RoutingRule[]>([]);
  const [editingId, setEditingId] = useState<string | 'new' | null>(null);
  const [draftName, setDraftName] = useState<string>('');
  const [draftTag, setDraftTag] = useState<string>('');
  const [draftAssign, setDraftAssign] = useState<string>('');
  const [draftPriority, setDraftPriority] = useState<number>(100);
  const [draftActive, setDraftActive] = useState<boolean>(true);
  const [role, setRole] = useState<string | null>(null);
  const [orgId, setOrgId] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<boolean>(false);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);

  const canMutate = !!role && ADMIN_ROLES.has(role);

  const fetchRules = useCallback(async () => {
    const { data, error } = (await supabase
      .from('helpdesk_routing_rules')
      .select('id, org_id, name, tag_name, assign_to_user_id, priority, active')
      .order('priority', { ascending: true })) as {
      data: RoutingRule[] | null;
      error: { message: string } | null;
    };
    if (error) {
      setErr(error.message);
      return;
    }
    setRules(data ?? []);
  }, []);

  const fetchRole = useCallback(async () => {
    const { data: userData } = await supabase.auth.getUser();
    const userId = userData?.user?.id;
    if (!userId) return;
    const { data } = await supabase
      .from('org_members')
      .select('role, org_id, user_id')
      .eq('user_id', userId)
      .limit(1)
      .single();
    const mem = data as { role?: string; org_id?: string } | null;
    setRole(mem?.role ?? null);
    setOrgId(mem?.org_id ?? null);
  }, []);

  useEffect(() => {
    void fetchRules();
    void fetchRole();
  }, [fetchRules, fetchRole]);

  const beginNew = useCallback((): void => {
    setEditingId('new');
    setDraftName('');
    setDraftTag('');
    setDraftAssign('');
    setDraftPriority(100);
    setDraftActive(true);
    setErr(null);
  }, []);

  const handleSave = useCallback(async () => {
    if (!canMutate || !editingId) return;
    if (!draftName.trim() || !draftTag.trim() || !draftAssign.trim()) {
      setErr('Name, tag, and assignee are required');
      return;
    }
    if (draftPriority < 0 || draftPriority > MAX_PRIORITY) {
      setErr(`Priority must be between 0 and ${MAX_PRIORITY}`);
      return;
    }
    setBusy(true);
    setErr(null);
    if (editingId === 'new') {
      const { error } = await supabase
        .from('helpdesk_routing_rules')
        .insert({
          org_id: orgId,
          name: draftName,
          tag_name: draftTag,
          assign_to_user_id: draftAssign,
          priority: draftPriority,
          active: draftActive,
        })
        .select()
        .single();
      setBusy(false);
      if (error) {
        setErr(error.message);
        return;
      }
    } else {
      const { error } = (await supabase
        .from('helpdesk_routing_rules')
        .update({
          name: draftName,
          tag_name: draftTag,
          assign_to_user_id: draftAssign,
          priority: draftPriority,
          active: draftActive,
          updated_at: new Date().toISOString(),
        })
        .eq('id', editingId)) as { error: { message: string } | null };
      setBusy(false);
      if (error) {
        setErr(error.message);
        return;
      }
    }
    setEditingId(null);
    await fetchRules();
  }, [
    canMutate,
    editingId,
    draftName,
    draftTag,
    draftAssign,
    draftPriority,
    draftActive,
    orgId,
    fetchRules,
  ]);

  const handleReorder = useCallback(
    async (rule: RoutingRule, direction: 'up' | 'down') => {
      if (!canMutate) return;
      const newPriority =
        direction === 'up'
          ? Math.max(0, rule.priority - PRIORITY_STEP)
          : Math.min(MAX_PRIORITY, rule.priority + PRIORITY_STEP);
      if (newPriority === rule.priority) return;
      const { error } = await supabase.rpc('reorder_routing_rule', {
        p_rule_id: rule.id,
        p_new_priority: newPriority,
      });
      if (error) {
        setErr(error.message);
        return;
      }
      await fetchRules();
    },
    [canMutate, fetchRules],
  );

  const handleConfirmDelete = useCallback(
    async (id: string) => {
      if (!canMutate) return;
      setBusy(true);
      const { error } = (await supabase
        .from('helpdesk_routing_rules')
        .delete()
        .eq('id', id)) as { error: { message: string } | null };
      setBusy(false);
      setPendingDelete(null);
      if (error) {
        setErr(error.message);
        return;
      }
      await fetchRules();
    },
    [canMutate, fetchRules],
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">Routing rules</h2>
        <button
          type="button"
          onClick={beginNew}
          disabled={!canMutate || editingId !== null}
          aria-label="New rule"
          className="px-3 py-1.5 text-sm rounded bg-[var(--color-primary)] text-[var(--color-primary-foreground)] disabled:opacity-50"
        >
          + New rule
        </button>
      </div>
      {err && (
        <p role="alert" className="text-xs text-[var(--color-danger)]">
          {err}
        </p>
      )}
      {!canMutate && (
        <p className="text-xs text-[var(--color-text-secondary)]">
          Read-only (role: {role ?? 'unknown'})
        </p>
      )}

      {editingId && (
        <div className="border border-[var(--color-border)] rounded p-3 flex flex-col gap-2">
          <label className="flex flex-col gap-1 text-xs">
            <span>Name</span>
            <input
              aria-label="Name"
              type="text"
              value={draftName}
              onChange={(e) => setDraftName(e.target.value)}
              className="px-2 py-1 text-sm border border-[var(--color-border)] rounded"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs">
            <span>Tag name</span>
            <input
              aria-label="Tag"
              type="text"
              value={draftTag}
              onChange={(e) => setDraftTag(e.target.value)}
              placeholder="billing / refund / clinical / …"
              className="px-2 py-1 text-sm border border-[var(--color-border)] rounded font-mono"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs">
            <span>Assign to (user id)</span>
            <input
              aria-label="Assign to"
              type="text"
              value={draftAssign}
              onChange={(e) => setDraftAssign(e.target.value)}
              placeholder="uuid"
              className="px-2 py-1 text-sm border border-[var(--color-border)] rounded font-mono"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs">
            <span>Priority (0–9999, lower = higher priority)</span>
            <input
              aria-label="Priority"
              type="number"
              min={0}
              max={MAX_PRIORITY}
              value={draftPriority}
              onChange={(e) => setDraftPriority(Number(e.target.value))}
              className="px-2 py-1 text-sm border border-[var(--color-border)] rounded"
            />
          </label>
          <label className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={draftActive}
              onChange={(e) => setDraftActive(e.target.checked)}
              aria-label="Active"
            />
            <span>Active</span>
          </label>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void handleSave()}
              disabled={busy || !canMutate}
              className="px-3 py-1.5 text-sm rounded bg-[var(--color-primary)] text-[var(--color-primary-foreground)] disabled:opacity-50"
            >
              Save
            </button>
            <button
              type="button"
              onClick={() => {
                setEditingId(null);
                setErr(null);
              }}
              className="px-3 py-1.5 text-sm rounded border border-[var(--color-border)]"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <ul className="flex flex-col gap-2">
        {rules.length === 0 && !editingId ? (
          <li className="text-xs text-[var(--color-text-secondary)]">
            No routing rules yet
          </li>
        ) : (
          rules.map((r) => (
            <li
              key={r.id}
              className="flex items-center justify-between gap-3 border border-[var(--color-border)] rounded px-3 py-2"
            >
              <div className="flex flex-col min-w-0">
                <span className="text-sm font-medium truncate">{r.name}</span>
                <span className="text-[10px] text-[var(--color-text-secondary)] font-mono">
                  {r.tag_name} → {r.assign_to_user_id.slice(0, 8)}… · prio{' '}
                  {r.priority}
                  {!r.active ? ' · inactive' : ''}
                </span>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button
                  type="button"
                  onClick={() => void handleReorder(r, 'up')}
                  disabled={!canMutate || busy}
                  aria-label={`Move ${r.name} up`}
                  className="px-2 py-1 text-xs rounded border border-[var(--color-border)] disabled:opacity-50"
                >
                  ↑
                </button>
                <button
                  type="button"
                  onClick={() => void handleReorder(r, 'down')}
                  disabled={!canMutate || busy}
                  aria-label={`Move ${r.name} down`}
                  className="px-2 py-1 text-xs rounded border border-[var(--color-border)] disabled:opacity-50"
                >
                  ↓
                </button>
                {pendingDelete === r.id ? (
                  <>
                    <button
                      type="button"
                      onClick={() => void handleConfirmDelete(r.id)}
                      disabled={!canMutate || busy}
                      aria-label={`Confirm delete ${r.name}`}
                      className="px-2 py-1 text-xs rounded bg-[var(--color-danger)] text-white disabled:opacity-50"
                    >
                      Confirm
                    </button>
                    <button
                      type="button"
                      onClick={() => setPendingDelete(null)}
                      className="px-2 py-1 text-xs rounded border border-[var(--color-border)]"
                    >
                      Cancel
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={() => setPendingDelete(r.id)}
                    disabled={!canMutate || editingId !== null}
                    aria-label={`Delete ${r.name}`}
                    className="px-2 py-1 text-xs rounded border border-[var(--color-danger)] text-[var(--color-danger)] disabled:opacity-50"
                  >
                    Delete
                  </button>
                )}
              </div>
            </li>
          ))
        )}
      </ul>
    </div>
  );
}
