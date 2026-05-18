/**
 * Phase 25 Plan 25-09 — BaaChainTable.
 * HIPAA-12: Renders the 6-vendor BAA chain table. Allows superadmin to flip
 * status='signed' via vendor_baa_chain_update RPC when BAA docs are received.
 *
 * Status color coding (per CONTEXT specifics line 152):
 *   - expired or 0–13d to expiry: red ("COMPLIANCE GAP")
 *   - 14–29d: orange
 *   - 30–60d: amber
 *   - signed + >60d to expiry: green
 *   - pending: gray
 *
 * Security: vendor_baa_chain_update RPC is SECDEF and re-validates superadmin
 * role server-side (Pattern S1 dual-layer). UI gate is UX-layer only.
 *
 * A11y: aria-label on icon buttons, role='dialog' + aria-modal on modal.
 */
import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';

interface VendorBaaRow {
  vendor_name: string;
  baa_signed_at: string | null;
  baa_expiry_at: string | null;
  monthly_cost_usd: number;
  scope_summary: string | null;
  status: 'pending' | 'signed' | 'expired';
}

interface EditModalState {
  open: boolean;
  vendorName: string;
  signedAt: string;
  expiryAt: string;
  saving: boolean;
  error: string | null;
}

function daysUntil(expiryAt: string): number {
  return Math.floor((new Date(expiryAt).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
}

type StatusColor = 'green' | 'amber' | 'orange' | 'red' | 'gray';

function getStatusColor(row: VendorBaaRow): StatusColor {
  if (row.status === 'expired') return 'red';
  if (row.status === 'pending') return 'gray';
  // signed
  if (!row.baa_expiry_at) return 'green';
  const d = daysUntil(row.baa_expiry_at);
  if (d < 0) return 'red';
  if (d < 14) return 'red';
  if (d < 30) return 'orange';
  if (d <= 60) return 'amber';
  return 'green';
}

const STATUS_BADGE_CLASSES: Record<StatusColor, string> = {
  green: 'bg-green-100 text-green-800',
  amber: 'bg-amber-100 text-amber-800',
  orange: 'bg-orange-100 text-orange-800',
  red: 'bg-red-100 text-red-800',
  gray: 'bg-gray-100 text-gray-700',
};

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function toDateInputValue(iso: string | null): string {
  if (!iso) return '';
  return new Date(iso).toISOString().slice(0, 10);
}

function toIso(dateInput: string): string {
  // Convert YYYY-MM-DD to ISO string (midnight UTC)
  return new Date(dateInput + 'T00:00:00Z').toISOString();
}

const INITIAL_MODAL: EditModalState = {
  open: false,
  vendorName: '',
  signedAt: '',
  expiryAt: '',
  saving: false,
  error: null,
};

export function BaaChainTable() {
  const [rows, setRows] = useState<VendorBaaRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [modal, setModal] = useState<EditModalState>(INITIAL_MODAL);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  async function loadRows() {
    const { data, error } = await supabase
      .from('vendor_baa_chain')
      .select('vendor_name, baa_signed_at, baa_expiry_at, monthly_cost_usd, scope_summary, status')
      .order('vendor_name', { ascending: true });

    setLoading(false);

    if (error) {
      setFetchError(error.message);
      return;
    }

    setRows((data ?? []) as VendorBaaRow[]);
  }

  useEffect(() => {
    void loadRows();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Move focus to close button when modal opens.
  useEffect(() => {
    if (modal.open) {
      requestAnimationFrame(() => closeButtonRef.current?.focus());
    }
  }, [modal.open]);

  function openModal(row: VendorBaaRow) {
    setModal({
      open: true,
      vendorName: row.vendor_name,
      signedAt: toDateInputValue(row.baa_signed_at) || toDateInputValue(new Date().toISOString()),
      expiryAt: toDateInputValue(row.baa_expiry_at),
      saving: false,
      error: null,
    });
  }

  function closeModal() {
    setModal(INITIAL_MODAL);
  }

  async function handleSave() {
    if (!modal.signedAt || !modal.expiryAt) {
      setModal((m) => ({ ...m, error: 'Both signed and expiry dates are required.' }));
      return;
    }

    setModal((m) => ({ ...m, saving: true, error: null }));

    const { error } = await supabase.rpc('vendor_baa_chain_update', {
      p_vendor_name: modal.vendorName,
      p_signed_at: toIso(modal.signedAt),
      p_expiry_at: toIso(modal.expiryAt),
    });

    if (error) {
      setModal((m) => ({ ...m, saving: false, error: error.message }));
      return;
    }

    // Refresh table then close.
    await loadRows();
    closeModal();
  }

  const statusColor = (row: VendorBaaRow) => getStatusColor(row);
  const statusLabel = (row: VendorBaaRow): string => {
    if (row.status === 'expired') return 'COMPLIANCE GAP';
    if (row.status === 'pending') return 'pending';
    if (!row.baa_expiry_at) return 'signed';
    const d = daysUntil(row.baa_expiry_at);
    if (d < 14) return `signed (${d}d left)`;
    if (d <= 60) return `signed (${d}d)`;
    return 'signed';
  };

  return (
    <section aria-labelledby="baa-chain-heading">
      <h2 id="baa-chain-heading" className="text-base font-semibold mb-3">
        Vendor BAA Chain
      </h2>

      {loading && <p className="text-sm text-[var(--color-text-secondary)]">Loading…</p>}

      {fetchError && (
        <p role="alert" className="text-sm text-red-600">
          Failed to load vendor data: {fetchError}
        </p>
      )}

      {!loading && !fetchError && (
        <div className="overflow-x-auto rounded-lg border border-[var(--color-border)]">
          <table className="min-w-full text-sm">
            <thead className="bg-[var(--color-surface)] text-start text-xs font-semibold uppercase tracking-wide text-[var(--color-text-secondary)]">
              <tr>
                <th scope="col" className="px-4 py-3">Vendor</th>
                <th scope="col" className="px-4 py-3">Status</th>
                <th scope="col" className="px-4 py-3">Signed</th>
                <th scope="col" className="px-4 py-3">Expires</th>
                <th scope="col" className="px-4 py-3 text-end">Cost/mo</th>
                <th scope="col" className="px-4 py-3">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--color-border)]">
              {rows.map((row) => {
                const color = statusColor(row);
                return (
                  <tr key={row.vendor_name} className="hover:bg-[var(--color-surface)]">
                    <td className="px-4 py-3 font-medium">{row.vendor_name}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_BADGE_CLASSES[color]}`}
                      >
                        {statusLabel(row)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-[var(--color-text-secondary)]">
                      {formatDate(row.baa_signed_at)}
                    </td>
                    <td className="px-4 py-3 text-[var(--color-text-secondary)]">
                      {formatDate(row.baa_expiry_at)}
                    </td>
                    <td className="px-4 py-3 text-end tabular-nums">
                      ${(row.monthly_cost_usd ?? 0).toFixed(2)}
                    </td>
                    <td className="px-4 py-3 text-end">
                      <button
                        type="button"
                        onClick={() => openModal(row)}
                        aria-label={`Edit BAA status for ${row.vendor_name}`}
                        className="rounded px-2 py-1 text-xs font-medium text-[var(--color-primary)] hover:bg-[var(--color-surface)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]"
                      >
                        Edit
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Edit-status modal */}
      {modal.open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="baa-modal-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onKeyDown={(e) => e.key === 'Escape' && closeModal()}
        >
          <div className="w-full max-w-md rounded-xl bg-[var(--color-bg)] p-6 shadow-xl">
            <div className="flex items-center justify-between mb-4">
              <h3 id="baa-modal-title" className="text-base font-semibold">
                Update BAA — {modal.vendorName}
              </h3>
              <button
                ref={closeButtonRef}
                type="button"
                onClick={closeModal}
                aria-label="Close edit BAA modal"
                className="rounded p-1 text-[var(--color-text-secondary)] hover:text-[var(--color-text)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]"
              >
                ✕
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label htmlFor="baa-signed-at" className="block text-sm font-medium mb-1">
                  BAA Signed Date
                </label>
                <input
                  id="baa-signed-at"
                  type="date"
                  value={modal.signedAt}
                  onChange={(e) => setModal((m) => ({ ...m, signedAt: e.target.value }))}
                  aria-invalid={!modal.signedAt}
                  className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]"
                />
              </div>

              <div>
                <label htmlFor="baa-expiry-at" className="block text-sm font-medium mb-1">
                  BAA Expiry Date
                </label>
                <input
                  id="baa-expiry-at"
                  type="date"
                  value={modal.expiryAt}
                  onChange={(e) => setModal((m) => ({ ...m, expiryAt: e.target.value }))}
                  aria-invalid={!modal.expiryAt}
                  className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]"
                />
              </div>

              {modal.error && (
                <p role="alert" className="text-sm text-red-600">
                  {modal.error}
                </p>
              )}

              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={closeModal}
                  disabled={modal.saving}
                  className="rounded-lg px-4 py-2 text-sm font-medium text-[var(--color-text-secondary)] hover:bg-[var(--color-surface)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={modal.saving}
                  aria-busy={modal.saving}
                  className="rounded-lg bg-[var(--color-primary)] px-4 py-2 text-sm font-medium text-white hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] disabled:opacity-50"
                >
                  {modal.saving ? 'Saving…' : 'Save'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
