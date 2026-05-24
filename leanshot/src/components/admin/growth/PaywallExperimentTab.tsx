/**
 * Phase 39 Plan 39-07 — PaywallExperimentTab (Surface E paywall sub-tab).
 *
 * Renders one row per ExperimentRow with variant_name + cohort_label +
 * composite_score + BayesianBadge + refund_rate_7d. Each row carries a
 * Ship-Winner button (data-action="ship-winner" per UI-SPEC Hard Constraint 8,
 * verbatim contract from OnboardingABPanel.tsx — see <read_first> in PLAN).
 *
 * Ship-Winner cascade (D-12):
 *   - posterior >= 0.95 → onShip(variantId) directly (parent invokes
 *     ship-winner-flag Edge Fn)
 *   - posterior <  0.95 → opens ShipWinnerConfirmModal; on confirm the modal
 *     calls admin_ship_below_95 RPC (audit) AND THEN onShip(variantId)
 *
 * archived_at row presentation:
 *   - Refund-rate kill-switch banner (UI-SPEC danger tone)
 *   - Ship-Winner replaced by "Re-enable variant" (variant=destructive)
 *
 * Decision references: D-02 (refund kill banner), D-12 (Ship-Winner cascade),
 *   PAGEAB-07 (Bayesian badge), PAYWALL-03/04.
 */
import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { useToast } from '@/hooks/useToast';
import { supabase } from '@/lib/supabase';
import { BayesianBadge } from './BayesianBadge';
import type { ExperimentRow, InvokeError } from './experiment-types';
import { ShipWinnerConfirmModal } from './ShipWinnerConfirmModal';

export interface PaywallExperimentTabProps {
  rows: ExperimentRow[];
  onShip: (variantId: string) => void;
  busyKey: string | null;
}

interface PendingConfirm {
  variantId: string;
  variantName: string;
  posterior: number;
}

function formatPct(rate: number | null): string {
  if (rate === null || Number.isNaN(rate)) return '—';
  return `${(rate * 100).toFixed(1)}%`;
}

function formatComposite(score: number | null): string {
  if (score === null || Number.isNaN(score)) return '—';
  return score.toFixed(4);
}

export function PaywallExperimentTab({
  rows,
  onShip,
  busyKey,
}: PaywallExperimentTabProps): React.JSX.Element {
  const toast = useToast();
  const [pending, setPending] = useState<PendingConfirm | null>(null);

  function handleShipClick(row: ExperimentRow): void {
    if (row.posterior >= 0.95) {
      // Direct invoke — no modal cascade for high-significance ships.
      onShip(row.variant_id);
      return;
    }
    // Below 95% → open typed-confirmation modal (D-12).
    setPending({
      variantId: row.variant_id,
      variantName: row.variant_name,
      posterior: row.posterior,
    });
  }

  async function handleConfirmBelow95(reason: string): Promise<void> {
    if (!pending) return;
    // D-12 split: write audit row via SECDEF RPC FIRST, then onShip (which
    // invokes ship-winner-flag in the parent). If the audit write fails, do
    // NOT proceed — operator must retry.
    const { error } = await supabase.rpc('admin_ship_below_95', {
      p_variant_id: pending.variantId,
      p_reason: reason,
      p_posterior: pending.posterior,
    });
    if (error) {
      const code =
        (error as InvokeError & { code?: string }).code ??
        (error as { message?: string }).message ??
        'unknown';
      if (code === '42501' || String(code).includes('forbidden_not_superadmin')) {
        toast('Superadmin role required', 'error');
      } else {
        toast(`Audit write failed: ${code}`, 'error');
      }
      setPending(null);
      return;
    }
    // Audit row written — now flip the flag via the parent's invoke path.
    onShip(pending.variantId);
    setPending(null);
  }

  return (
    <div className="flex flex-col gap-3">
      {/* D-01 composite explainer header (UI-SPEC composite-score callout) */}
      <p className="text-sm text-[var(--color-text-secondary)]">
        Composite: paid_rate × 30d_retention = score (control baseline shown
        per row when available).
      </p>

      {rows.map((row) => {
        const archived = row.archived_at !== null;
        const rowBusy = busyKey === row.variant_id;
        return (
          <Card
            key={row.variant_id}
            variant={archived ? 'flat' : 'flat'}
            padding="md"
            className={archived ? 'opacity-80' : ''}
          >
            <div className="flex flex-col gap-3">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="flex flex-col gap-1">
                  <h3 className="text-base font-bold">{row.variant_name}</h3>
                  {row.cohort_label && (
                    <p className="text-sm text-[var(--color-text-secondary)]">
                      {row.cohort_label}
                    </p>
                  )}
                </div>
                <BayesianBadge posterior={row.posterior} />
              </div>

              <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
                <span>
                  <span className="text-[var(--color-text-secondary)]">Composite: </span>
                  <span className="font-bold tabular-nums">
                    {formatComposite(row.composite_score)}
                  </span>
                </span>
                <span>
                  <span className="text-[var(--color-text-secondary)]">Sample: </span>
                  <span className="font-bold tabular-nums">{row.sample_size}</span>
                </span>
                {row.refund_rate_7d !== null && (
                  <span>
                    <span className="text-[var(--color-text-secondary)]">Refund 7d: </span>
                    <span className="font-bold tabular-nums">
                      {formatPct(row.refund_rate_7d)}
                    </span>
                  </span>
                )}
              </div>

              {archived && (
                <div
                  role="status"
                  className="rounded-xl border border-[var(--color-danger)] bg-[var(--color-danger-soft)] p-3 text-sm text-[var(--color-text)]"
                >
                  Refund rate exceeded 2× control baseline. Variant disabled —
                  traffic on control.
                </div>
              )}

              <div className="flex justify-end gap-2">
                {archived ? (
                  <Button variant="destructive" size="sm">
                    Re-enable variant
                  </Button>
                ) : (
                  <Button
                    variant="primary"
                    size="sm"
                    disabled={rowBusy}
                    loading={rowBusy}
                    onClick={() => handleShipClick(row)}
                    data-action="ship-winner"
                    data-variant={row.variant_id}
                  >
                    Ship Winner
                  </Button>
                )}
              </div>
            </div>
          </Card>
        );
      })}

      {pending && (
        <ShipWinnerConfirmModal
          open={true}
          variantId={pending.variantId}
          variantName={pending.variantName}
          posterior={pending.posterior}
          onConfirm={handleConfirmBelow95}
          onClose={() => setPending(null)}
        />
      )}
    </div>
  );
}

export default PaywallExperimentTab;
