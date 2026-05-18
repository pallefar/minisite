/**
 * Phase 27 plan 27-05 — AdminAnomalyTrackedFunnelsConfig.
 *
 * Superadmin CRUD UI for public.anomaly_tracked_funnels. Lets the founder
 * add / enable / disable / re-threshold / delete tracked funnels live
 * (TAXO-05 SC#5 operator self-serve — without this, the 5 v1 seeds shipped
 * by Plan 27-04 require a migration to extend).
 *
 * Surface:
 *   - Table: one row per tracked funnel with inline editing
 *       * is_enabled toggle (checkbox; persists on change)
 *       * lookbackDays (number input; persists on blur)
 *       * sigmaThreshold (number input; persists on blur)
 *       * Delete (opens ConfirmModal — refuses with toast when server
 *         raises 'has_alerts' so audit history is preserved)
 *   - Below the table: "Add tracked funnel" form
 *       * event_name (text) + lookback (number, default 7) + sigma
 *         (number, default 2.0) + Add button
 *       * On success: prepend new row + clear form.
 *
 * Optimistic UI: edits update local state immediately and roll back on RPC
 * error. Toast for every mutation outcome.
 *
 * Mirrors the row-list + per-row action pattern from
 * src/components/admin/AdminAffiliatesReviewQueue.tsx (filter pills omitted —
 * config table has no status column, only enabled/disabled).
 */
import { Plus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { ConfirmModal } from '@/components/ui/Confirm';
import { Input } from '@/components/ui/Input';
import { useToast } from '@/hooks/useToast';
import {
  AnomalyConfigApiError,
  defineFunnel,
  deleteFunnel,
  listTrackedFunnels,
  type TrackedFunnel,
  updateFunnel,
  type UpdateFunnelPatch,
} from '@/lib/admin/anomaly/config-api';

function describeError(e: unknown): string {
  if (e instanceof AnomalyConfigApiError) {
    switch (e.code) {
      case 'not_staff':
        return 'Forbidden — superadmin role required.';
      case 'duplicate_event_name':
        return 'That event name is already tracked.';
      case 'has_alerts':
        return 'Delete denied: funnel has alert history. Disable instead.';
      case 'not_found':
        return 'Funnel not found — refresh the page.';
      case 'not_authenticated':
        return 'Please sign in again.';
      default:
        return 'Could not save — please retry.';
    }
  }
  return 'Could not save — please retry.';
}

export function AdminAnomalyTrackedFunnelsConfig() {
  const toast = useToast();

  const [rows, setRows] = useState<TrackedFunnel[] | null>(null);
  const [errorMessage, setErrorMessage] = useState('');
  const [busyRowId, setBusyRowId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  // Add-form state.
  const [newEventName, setNewEventName] = useState('');
  const [newLookback, setNewLookback] = useState('7');
  const [newSigma, setNewSigma] = useState('2.0');
  const [addBusy, setAddBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await listTrackedFunnels();
        if (!cancelled) {
          setRows(data);
          setErrorMessage('');
        }
      } catch {
        if (!cancelled) {
          setRows([]);
          setErrorMessage("Couldn't load tracked funnels. Try refreshing.");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // ── Inline edits — optimistic with rollback ────────────────────────────────
  const applyPatch = async (
    funnelId: string,
    patch: UpdateFunnelPatch,
    optimistic: Partial<TrackedFunnel>,
  ): Promise<void> => {
    if (busyRowId) return;
    const prev = rows;
    if (!prev) return;
    setBusyRowId(funnelId);
    setRows(prev.map((r) => (r.funnelId === funnelId ? { ...r, ...optimistic } : r)));
    try {
      await updateFunnel(funnelId, patch);
      toast('Saved.', 'success');
    } catch (e) {
      // Rollback to prior snapshot.
      setRows(prev);
      toast(describeError(e), 'error');
    } finally {
      setBusyRowId(null);
    }
  };

  const handleToggleEnabled = (row: TrackedFunnel, next: boolean): void => {
    void applyPatch(row.funnelId, { isEnabled: next }, { isEnabled: next });
  };

  const handleLookbackBlur = (row: TrackedFunnel, raw: string): void => {
    const next = Number(raw);
    if (!Number.isFinite(next) || next < 1 || next > 90 || next === row.lookbackDays) return;
    void applyPatch(row.funnelId, { lookbackDays: next }, { lookbackDays: next });
  };

  const handleSigmaBlur = (row: TrackedFunnel, raw: string): void => {
    const next = Number(raw);
    if (!Number.isFinite(next) || next <= 0 || next > 10 || next === row.sigmaThreshold) return;
    void applyPatch(row.funnelId, { sigmaThreshold: next }, { sigmaThreshold: next });
  };

  // ── Delete (with ConfirmModal) ────────────────────────────────────────────
  const handleDeleteConfirm = async (): Promise<void> => {
    const id = confirmDeleteId;
    if (!id) return;
    setConfirmDeleteId(null);
    if (busyRowId) return;
    const prev = rows;
    if (!prev) return;
    setBusyRowId(id);
    try {
      await deleteFunnel(id);
      setRows(prev.filter((r) => r.funnelId !== id));
      toast('Funnel deleted.', 'success');
    } catch (e) {
      toast(describeError(e), 'error');
    } finally {
      setBusyRowId(null);
    }
  };

  // ── Add form ──────────────────────────────────────────────────────────────
  const handleAdd = async (): Promise<void> => {
    if (addBusy) return;
    const name = newEventName.trim();
    if (!name) {
      toast('Event name is required.', 'error');
      return;
    }
    const lookback = Number(newLookback);
    const sigma = Number(newSigma);
    if (!Number.isFinite(lookback) || lookback < 1 || lookback > 90) {
      toast('Lookback must be between 1 and 90 days.', 'error');
      return;
    }
    if (!Number.isFinite(sigma) || sigma <= 0 || sigma > 10) {
      toast('Sigma threshold must be between 0 and 10.', 'error');
      return;
    }
    setAddBusy(true);
    try {
      const { funnelId } = await defineFunnel(name, lookback, sigma);
      const created: TrackedFunnel = {
        funnelId,
        eventName: name,
        isEnabled: true,
        lookbackDays: lookback,
        sigmaThreshold: sigma,
        createdBy: null,
        createdAt: new Date().toISOString(),
      };
      setRows((cur) => [created, ...(cur ?? [])]);
      setNewEventName('');
      setNewLookback('7');
      setNewSigma('2.0');
      toast('Tracked funnel added.', 'success');
    } catch (e) {
      toast(describeError(e), 'error');
    } finally {
      setAddBusy(false);
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────
  const confirmTarget = rows?.find((r) => r.funnelId === confirmDeleteId);

  return (
    <section aria-labelledby="anomaly-tracked-funnels-heading">
      <header className="mb-4">
        <h2
          id="anomaly-tracked-funnels-heading"
          className="text-lg font-semibold tracking-tight"
        >
          Tracked funnels
        </h2>
        <p className="text-xs text-[var(--color-text-secondary)] mt-1">
          Adjust thresholds, disable noisy funnels, or add new ones. Superadmin only.
        </p>
      </header>

      {errorMessage && (
        <Card variant="flat" padding="md" className="mb-4">
          <p role="alert" className="text-sm text-[var(--color-danger)]">
            {errorMessage}
          </p>
        </Card>
      )}

      {rows === null && !errorMessage && (
        <p className="text-sm text-[var(--color-text-secondary)]">Loading tracked funnels…</p>
      )}

      {rows !== null && (
        <Card variant="default" padding="none" className="overflow-x-auto mb-6">
          <table className="w-full text-sm" data-testid="anomaly-tracked-funnels-table">
            <thead>
              <tr className="border-b border-[var(--color-border)]">
                <th scope="col" className="text-start text-xs font-semibold uppercase tracking-[0.06em] text-[var(--color-text-secondary)] px-4 py-3">
                  Event name
                </th>
                <th scope="col" className="text-center text-xs font-semibold uppercase tracking-[0.06em] text-[var(--color-text-secondary)] px-4 py-3">
                  Enabled
                </th>
                <th scope="col" className="text-end text-xs font-semibold uppercase tracking-[0.06em] text-[var(--color-text-secondary)] px-4 py-3">
                  Lookback (d)
                </th>
                <th scope="col" className="text-end text-xs font-semibold uppercase tracking-[0.06em] text-[var(--color-text-secondary)] px-4 py-3">
                  Sigma
                </th>
                <th scope="col" className="text-start text-xs font-semibold uppercase tracking-[0.06em] text-[var(--color-text-secondary)] px-4 py-3">
                  Created
                </th>
                <th scope="col" className="text-end text-xs font-semibold uppercase tracking-[0.06em] text-[var(--color-text-secondary)] px-4 py-3">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-center text-sm text-[var(--color-text-secondary)]">
                    No tracked funnels yet. Add one below.
                  </td>
                </tr>
              ) : (
                rows.map((row) => {
                  const isBusy = busyRowId === row.funnelId;
                  return (
                    <tr
                      key={row.funnelId}
                      className="border-b border-[var(--color-border)] last:border-b-0"
                      data-testid={`funnel-row-${row.funnelId}`}
                    >
                      <td className="px-4 py-3 align-middle font-mono text-sm">
                        {row.eventName}
                      </td>
                      <td className="px-4 py-3 align-middle text-center">
                        <input
                          type="checkbox"
                          checked={row.isEnabled}
                          disabled={isBusy}
                          onChange={(e) => handleToggleEnabled(row, e.target.checked)}
                          aria-label={`Enabled: ${row.eventName}`}
                          className="size-4 accent-[var(--color-primary)]"
                        />
                      </td>
                      <td className="px-4 py-3 align-middle text-end">
                        <Input
                          type="number"
                          inputMode="numeric"
                          min={1}
                          max={90}
                          defaultValue={row.lookbackDays}
                          disabled={isBusy}
                          onBlur={(e) => handleLookbackBlur(row, e.target.value)}
                          aria-label={`Lookback days: ${row.eventName}`}
                          className="w-20 text-end tabular-nums"
                        />
                      </td>
                      <td className="px-4 py-3 align-middle text-end">
                        <Input
                          type="number"
                          inputMode="decimal"
                          step="0.1"
                          min={0.1}
                          max={10}
                          defaultValue={row.sigmaThreshold}
                          disabled={isBusy}
                          onBlur={(e) => handleSigmaBlur(row, e.target.value)}
                          aria-label={`Sigma threshold: ${row.eventName}`}
                          className="w-20 text-end tabular-nums"
                        />
                      </td>
                      <td className="px-4 py-3 align-middle text-xs text-[var(--color-text-secondary)]">
                        {new Date(row.createdAt).toLocaleDateString(undefined, {
                          year: 'numeric',
                          month: 'short',
                          day: 'numeric',
                        })}
                      </td>
                      <td className="px-4 py-3 align-middle text-end">
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={isBusy}
                          onClick={() => setConfirmDeleteId(row.funnelId)}
                        >
                          Delete
                        </Button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </Card>
      )}

      {/* Add tracked funnel form */}
      <Card variant="elevated" padding="md">
        <h3 className="text-sm font-semibold mb-3">Add tracked funnel</h3>
        <div className="grid grid-cols-1 md:grid-cols-[2fr_1fr_1fr_auto] gap-3 items-end">
          <div>
            <label
              htmlFor="anomaly-new-event"
              className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1"
            >
              Event name
            </label>
            <Input
              id="anomaly-new-event"
              type="text"
              placeholder="e.g. paywall_clicked"
              value={newEventName}
              onChange={(e) => setNewEventName(e.target.value)}
              disabled={addBusy}
            />
          </div>
          <div>
            <label
              htmlFor="anomaly-new-lookback"
              className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1"
            >
              Lookback (days)
            </label>
            <Input
              id="anomaly-new-lookback"
              type="number"
              inputMode="numeric"
              min={1}
              max={90}
              value={newLookback}
              onChange={(e) => setNewLookback(e.target.value)}
              disabled={addBusy}
              className="tabular-nums"
            />
          </div>
          <div>
            <label
              htmlFor="anomaly-new-sigma"
              className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1"
            >
              Sigma threshold
            </label>
            <Input
              id="anomaly-new-sigma"
              type="number"
              inputMode="decimal"
              step="0.1"
              min={0.1}
              max={10}
              value={newSigma}
              onChange={(e) => setNewSigma(e.target.value)}
              disabled={addBusy}
              className="tabular-nums"
            />
          </div>
          <Button
            variant="primary"
            size="md"
            onClick={() => {
              void handleAdd();
            }}
            loading={addBusy}
            disabled={addBusy}
          >
            <Plus className="size-4 me-1" aria-hidden />
            Add
          </Button>
        </div>
      </Card>

      <ConfirmModal
        open={confirmDeleteId !== null}
        title="Delete tracked funnel?"
        message={
          confirmTarget
            ? `Delete tracked funnel '${confirmTarget.eventName}'? Any existing alerts must be purged first; if alerts exist the delete will be refused — use Disable instead.`
            : ''
        }
        confirmLabel="Delete"
        cancelLabel="Cancel"
        destructive
        onCancel={() => setConfirmDeleteId(null)}
        onConfirm={() => {
          void handleDeleteConfirm();
        }}
      />
    </section>
  );
}

export default AdminAnomalyTrackedFunnelsConfig;
