/**
 * Phase 37 Plan 37-08 Task 3 — MacroEditorPage (HELP-12).
 *
 * CRUD on agent_macros (per-org canned responses).
 *
 * Schema: (org_id, name, shortcut, body) with UNIQUE (org_id, shortcut).
 * RLS: admin role mutation; agents may read.
 * Role gate (UX): UI disables mutation buttons for non-admin. Server still
 * enforces via RLS as a defense in depth.
 *
 * Inline delete confirmation (no window.confirm) per [[RagTopicsPage]] pattern.
 */
import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';

interface AgentMacro {
  id: string;
  org_id: string;
  name: string;
  shortcut: string;
  body: string;
  created_by: string | null;
  updated_at: string | null;
}

const ADMIN_ROLES = new Set(['owner', 'support_admin', 'support_lead']);

export default function MacroEditorPage(): React.JSX.Element {
  const [macros, setMacros] = useState<AgentMacro[]>([]);
  const [editingId, setEditingId] = useState<string | 'new' | null>(null);
  const [draftName, setDraftName] = useState<string>('');
  const [draftShortcut, setDraftShortcut] = useState<string>('');
  const [draftBody, setDraftBody] = useState<string>('');
  const [role, setRole] = useState<string | null>(null);
  const [orgId, setOrgId] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<boolean>(false);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);

  const canMutate = !!role && ADMIN_ROLES.has(role);

  const fetchMacros = useCallback(async () => {
    const { data, error } = (await supabase
      .from('agent_macros')
      .select('id, org_id, name, shortcut, body, created_by, updated_at')
      .order('name', { ascending: true })) as {
      data: AgentMacro[] | null;
      error: { message: string } | null;
    };
    if (error) {
      setErr(error.message);
      return;
    }
    setMacros(data ?? []);
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
    void fetchMacros();
    void fetchRole();
  }, [fetchMacros, fetchRole]);

  const beginNew = useCallback((): void => {
    setEditingId('new');
    setDraftName('');
    setDraftShortcut('');
    setDraftBody('');
    setErr(null);
  }, []);

  const beginEdit = useCallback((m: AgentMacro): void => {
    setEditingId(m.id);
    setDraftName(m.name);
    setDraftShortcut(m.shortcut);
    setDraftBody(m.body);
    setErr(null);
  }, []);

  const handleSave = useCallback(async () => {
    if (!canMutate || !editingId) return;
    if (!draftName.trim() || !draftShortcut.trim() || !draftBody.trim()) {
      setErr('Name, shortcut, and body are required');
      return;
    }
    if (draftShortcut.length > 32) {
      setErr('Shortcut must be at most 32 chars');
      return;
    }
    setBusy(true);
    setErr(null);
    if (editingId === 'new') {
      const { error } = await supabase
        .from('agent_macros')
        .insert({
          org_id: orgId,
          name: draftName,
          shortcut: draftShortcut,
          body: draftBody,
        })
        .select()
        .single();
      setBusy(false);
      if (error) {
        const msg = error.message.toLowerCase();
        if (msg.includes('duplicate') || msg.includes('unique')) {
          setErr('A macro with that shortcut already exists');
        } else {
          setErr(error.message);
        }
        return;
      }
    } else {
      const { error } = (await supabase
        .from('agent_macros')
        .update({
          name: draftName,
          shortcut: draftShortcut,
          body: draftBody,
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
    await fetchMacros();
  }, [canMutate, editingId, draftName, draftShortcut, draftBody, orgId, fetchMacros]);

  const handleConfirmDelete = useCallback(
    async (id: string) => {
      if (!canMutate) return;
      setBusy(true);
      const { error } = (await supabase
        .from('agent_macros')
        .delete()
        .eq('id', id)) as { error: { message: string } | null };
      setBusy(false);
      setPendingDelete(null);
      if (error) {
        setErr(error.message);
        return;
      }
      await fetchMacros();
    },
    [canMutate, fetchMacros],
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">Macros</h2>
        <button
          type="button"
          onClick={beginNew}
          disabled={!canMutate || editingId !== null}
          aria-label="New macro"
          className="px-3 py-1.5 text-sm rounded bg-[var(--color-primary)] text-[var(--color-primary-foreground)] disabled:opacity-50"
        >
          + New macro
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
              maxLength={64}
              className="px-2 py-1 text-sm border border-[var(--color-border)] rounded"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs">
            <span>Shortcut</span>
            <input
              aria-label="Shortcut"
              type="text"
              value={draftShortcut}
              onChange={(e) => setDraftShortcut(e.target.value)}
              maxLength={32}
              placeholder="/greet"
              className="px-2 py-1 text-sm border border-[var(--color-border)] rounded font-mono"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs">
            <span>Body</span>
            <textarea
              aria-label="Body"
              value={draftBody}
              onChange={(e) => setDraftBody(e.target.value)}
              rows={6}
              className="px-2 py-1 text-sm border border-[var(--color-border)] rounded"
            />
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
        {macros.length === 0 && !editingId ? (
          <li className="text-xs text-[var(--color-text-secondary)]">
            No macros yet
          </li>
        ) : (
          macros.map((m) => (
            <li
              key={m.id}
              className="flex items-center justify-between gap-3 border border-[var(--color-border)] rounded px-3 py-2"
            >
              <div className="flex flex-col min-w-0">
                <span className="text-sm font-medium truncate">{m.name}</span>
                <span className="text-[10px] text-[var(--color-text-secondary)] font-mono">
                  {m.shortcut} · {m.body.slice(0, 60)}
                  {m.body.length > 60 ? '…' : ''}
                </span>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => beginEdit(m)}
                  disabled={!canMutate || editingId !== null}
                  aria-label={`Edit ${m.name}`}
                  className="px-2 py-1 text-xs rounded border border-[var(--color-border)] disabled:opacity-50"
                >
                  Edit
                </button>
                {pendingDelete === m.id ? (
                  <>
                    <button
                      type="button"
                      onClick={() => void handleConfirmDelete(m.id)}
                      disabled={!canMutate || busy}
                      aria-label={`Confirm delete ${m.name}`}
                      className="px-2 py-1 text-xs rounded bg-[var(--color-danger)] text-white disabled:opacity-50"
                    >
                      Confirm delete
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
                    onClick={() => setPendingDelete(m.id)}
                    disabled={!canMutate || editingId !== null}
                    aria-label={`Delete ${m.name}`}
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
