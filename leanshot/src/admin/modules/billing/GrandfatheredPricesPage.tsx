/**
 * Phase 43 Plan 05 — MEMBER-02 D-03 admin CRUD for grandfathered_prices.
 *
 * Surfaces:
 *   - List view: rows joined with cohort_definitions.name, sorted by effective_from desc.
 *   - Create form: cohort picker (from cohort_definitions) + stripe_price_id +
 *     effective_from + optional effective_until → grandfathered_price_create RPC.
 *   - Inline edit: per-row edit toggle → grandfathered_price_update RPC.
 *   - Delete: per-row delete with window.confirm guard → grandfathered_price_delete RPC.
 *   - Error banner: any RPC failure surfaces above the table; rows stay loaded
 *     so the operator can retry.
 *
 * RLS: SELECT requires is_admin_at_least('admin') on grandfathered_prices
 * (Phase 43 Plan 02). Writes are denied at the table level (Pattern S2) and
 * only reachable via the SECDEF RPCs which re-check the admin gate inside.
 *
 * Pattern: cloned from src/admin/modules/hitl-queue/HitlQueuePage.tsx — single
 * named export, supabase.from + .rpc, useState/useCallback/useEffect with
 * try/catch/finally. NO @tanstack/react-query (project convention).
 */
import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';

interface CohortRef {
  id: string;
  name: string;
}

interface GrandfatheredPriceRow {
  id: string;
  cohort_id: string;
  stripe_price_id: string;
  effective_from: string;
  effective_until: string | null;
  cohort: CohortRef | null;
}

interface CreateFormState {
  cohort_id: string;
  stripe_price_id: string;
  effective_from: string;
  effective_until: string;
}

const INITIAL_CREATE: CreateFormState = {
  cohort_id: '',
  stripe_price_id: '',
  effective_from: '',
  effective_until: '',
};

export function GrandfatheredPricesPage() {
  const [rows, setRows] = useState<GrandfatheredPriceRow[]>([]);
  const [cohorts, setCohorts] = useState<CohortRef[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [createForm, setCreateForm] = useState<CreateFormState>(INITIAL_CREATE);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<{
    stripe_price_id: string;
    effective_from: string;
    effective_until: string;
  }>({ stripe_price_id: '', effective_from: '', effective_until: '' });

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const [pricesRes, cohortsRes] = await Promise.all([
        supabase
          .from('grandfathered_prices')
          .select('*, cohort:cohort_definitions(id, name)')
          .order('effective_from', { ascending: false }),
        supabase.from('cohort_definitions').select('id, name').order('name'),
      ]);
      if (pricesRes.error) {
        setError(pricesRes.error.message);
      } else {
        setRows((pricesRes.data ?? []) as GrandfatheredPriceRow[]);
      }
      if (cohortsRes.error) {
        setError(cohortsRes.error.message);
      } else {
        setCohorts((cohortsRes.data ?? []) as CohortRef[]);
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

  async function onCreateSubmit(e: React.FormEvent) {
    e.preventDefault();
    try {
      const { error: rpcError } = await supabase.rpc('grandfathered_price_create', {
        p_cohort_id: createForm.cohort_id,
        p_stripe_price_id: createForm.stripe_price_id,
        p_effective_from: createForm.effective_from
          ? new Date(createForm.effective_from).toISOString()
          : new Date().toISOString(),
        p_effective_until: createForm.effective_until
          ? new Date(createForm.effective_until).toISOString()
          : null,
      });
      if (rpcError) {
        setError(rpcError.message);
        return;
      }
      setCreateForm(INITIAL_CREATE);
      setError(null);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'create failed');
    }
  }

  function onEditStart(row: GrandfatheredPriceRow) {
    setEditingId(row.id);
    setEditDraft({
      stripe_price_id: row.stripe_price_id,
      effective_from: row.effective_from,
      effective_until: row.effective_until ?? '',
    });
  }

  async function onEditSave(rowId: string) {
    try {
      const { error: rpcError } = await supabase.rpc('grandfathered_price_update', {
        p_id: rowId,
        p_stripe_price_id: editDraft.stripe_price_id,
        p_effective_from: editDraft.effective_from
          ? new Date(editDraft.effective_from).toISOString()
          : new Date().toISOString(),
        p_effective_until: editDraft.effective_until
          ? new Date(editDraft.effective_until).toISOString()
          : null,
      });
      if (rpcError) {
        setError(rpcError.message);
        return;
      }
      setEditingId(null);
      setError(null);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'update failed');
    }
  }

  async function onDelete(row: GrandfatheredPriceRow) {
    if (
      !window.confirm(
        `Delete grandfathered price ${row.stripe_price_id} for cohort ${row.cohort?.name ?? row.cohort_id}?`,
      )
    ) {
      return;
    }
    try {
      const { error: rpcError } = await supabase.rpc('grandfathered_price_delete', {
        p_id: row.id,
      });
      if (rpcError) {
        setError(rpcError.message);
        return;
      }
      setError(null);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'delete failed');
    }
  }

  return (
    <div className="space-y-4">
      <header className="flex items-center justify-between">
        <h1 className="text-xl font-bold">Grandfathered Pricing</h1>
        <span className="text-[12px] text-[var(--color-text-secondary)]">
          {rows.length} rule{rows.length === 1 ? '' : 's'}
        </span>
      </header>

      {error && (
        <p
          role="alert"
          className="text-sm text-[var(--color-error,#dc2626)] p-3 rounded bg-[var(--color-error-soft,#fee2e2)]"
        >
          {error}
        </p>
      )}

      {/* Create form */}
      <form
        onSubmit={(e) => void onCreateSubmit(e)}
        className="grid gap-3 p-3 border border-[var(--color-border)] rounded"
      >
        <div className="grid gap-1">
          <label htmlFor="gf-cohort" className="text-[12px] font-bold">
            Cohort
          </label>
          <select
            id="gf-cohort"
            value={createForm.cohort_id}
            onChange={(e) => setCreateForm((s) => ({ ...s, cohort_id: e.target.value }))}
            className="h-10 px-2 rounded border border-[var(--color-border)] bg-[var(--color-surface-elevated)]"
            required
          >
            <option value="">— pick a cohort —</option>
            {cohorts.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <div className="grid gap-1">
          <label htmlFor="gf-price-id" className="text-[12px] font-bold">
            Stripe Price ID
          </label>
          <input
            id="gf-price-id"
            type="text"
            pattern="^price_[A-Za-z0-9]+$"
            value={createForm.stripe_price_id}
            onChange={(e) => setCreateForm((s) => ({ ...s, stripe_price_id: e.target.value }))}
            placeholder="price_…"
            className="h-10 px-2 rounded border border-[var(--color-border)] bg-[var(--color-surface-elevated)]"
            required
          />
        </div>
        <div className="grid gap-1">
          <label htmlFor="gf-from" className="text-[12px] font-bold">
            Effective From
          </label>
          <input
            id="gf-from"
            type="datetime-local"
            value={createForm.effective_from}
            onChange={(e) => setCreateForm((s) => ({ ...s, effective_from: e.target.value }))}
            className="h-10 px-2 rounded border border-[var(--color-border)] bg-[var(--color-surface-elevated)]"
            required
          />
        </div>
        <div className="grid gap-1">
          <label htmlFor="gf-until" className="text-[12px] font-bold">
            Effective Until (optional)
          </label>
          <input
            id="gf-until"
            type="datetime-local"
            value={createForm.effective_until}
            onChange={(e) => setCreateForm((s) => ({ ...s, effective_until: e.target.value }))}
            className="h-10 px-2 rounded border border-[var(--color-border)] bg-[var(--color-surface-elevated)]"
          />
        </div>
        <button
          type="submit"
          className="h-10 px-4 rounded-pill text-[13px] font-bold bg-[var(--color-primary)] text-[var(--color-primary-foreground)]"
        >
          Create
        </button>
      </form>

      {loading && <p className="text-sm text-[var(--color-text-secondary)]">Loading…</p>}

      {/* Rows table */}
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-[12px] font-bold border-b border-[var(--color-border)]">
            <th className="py-2 px-2">Cohort</th>
            <th className="py-2 px-2">Stripe Price ID</th>
            <th className="py-2 px-2">From</th>
            <th className="py-2 px-2">Until</th>
            <th className="py-2 px-2">Actions</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const isEditing = editingId === row.id;
            return (
              <tr key={row.id} className="border-b border-[var(--color-border)]">
                <td className="py-2 px-2">{row.cohort?.name ?? row.cohort_id}</td>
                <td className="py-2 px-2">
                  {isEditing ? (
                    <input
                      type="text"
                      aria-label="Edit Stripe Price ID"
                      value={editDraft.stripe_price_id}
                      onChange={(e) =>
                        setEditDraft((s) => ({
                          ...s,
                          stripe_price_id: e.target.value,
                        }))
                      }
                      className="h-8 px-2 rounded border border-[var(--color-border)] bg-[var(--color-surface-elevated)]"
                    />
                  ) : (
                    row.stripe_price_id
                  )}
                </td>
                <td className="py-2 px-2">{row.effective_from}</td>
                <td className="py-2 px-2">{row.effective_until ?? '—'}</td>
                <td className="py-2 px-2 flex gap-2">
                  {isEditing ? (
                    <>
                      <button
                        type="button"
                        onClick={() => void onEditSave(row.id)}
                        className="h-8 px-3 rounded-pill text-[12px] font-bold bg-[var(--color-primary)] text-[var(--color-primary-foreground)]"
                      >
                        Save
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditingId(null)}
                        className="h-8 px-3 rounded-pill text-[12px] font-bold bg-[var(--color-surface-elevated)] border border-[var(--color-border)]"
                      >
                        Cancel
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={() => onEditStart(row)}
                        className="h-8 px-3 rounded-pill text-[12px] font-bold bg-[var(--color-surface-elevated)] border border-[var(--color-border)]"
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => void onDelete(row)}
                        className="h-8 px-3 rounded-pill text-[12px] font-bold bg-[var(--color-error-soft,#fee2e2)] text-[var(--color-error,#dc2626)]"
                      >
                        Delete
                      </button>
                    </>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {!loading && rows.length === 0 && (
        <p className="text-sm text-[var(--color-text-secondary)] p-6 text-center">
          No grandfathered prices configured yet.
        </p>
      )}
    </div>
  );
}
