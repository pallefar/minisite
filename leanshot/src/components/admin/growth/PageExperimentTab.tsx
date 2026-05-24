/**
 * Phase 39 Plan 39-07 — PageExperimentTab (Surface E page-builder sub-tab).
 *
 * Renders the page-variant table for Surface E's "Page-Builder" sub-tab.
 *
 * Per-row banners (D-11 42-day lifecycle):
 *   - 35-day warn (warned_at != null AND archived_at == null): warning tone,
 *     copy "This variant auto-archives in {N} days. Ship a winner or roll
 *     back to control." UI-SPEC table.
 *   - 42-day archived (archived_at != null): neutral tone, copy "This variant
 *     was auto-archived on {date}. Traffic is back on control." (overrides
 *     the warn banner if both set).
 *
 * Ship-Winner cascade: identical to PaywallExperimentTab (D-12). Reuses
 * ShipWinnerConfirmModal + the same admin_ship_below_95 RPC audit step.
 *
 * Verbatim Ship-Winner contract (UI-SPEC Hard Constraint 8): data-action=
 * "ship-winner" on the button; parent invokes ship-winner-flag Edge Fn.
 *
 * Decision references: D-11 (42-day banners), D-12 (Ship-Winner cascade),
 *   PAGEAB-03/05/07.
 */
import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { useToast } from '@/hooks/useToast';
import { supabase } from '@/lib/supabase';
import { BayesianBadge } from './BayesianBadge';
import type { ExperimentRow, InvokeError } from './experiment-types';
import { ShipWinnerConfirmModal } from './ShipWinnerConfirmModal';

export interface PageExperimentTabProps {
  rows: ExperimentRow[];
  onShip: (variantId: string) => void;
  busyKey: string | null;
}

interface PendingConfirm {
  variantId: string;
  variantName: string;
  posterior: number;
}

const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const HARD_CUT_DAYS = 42;

function daysUntilHardCut(warnedAt: string): number {
  const warned = new Date(warnedAt).getTime();
  const elapsedDays = Math.floor((Date.now() - warned) / ONE_DAY_MS);
  // warned at day 35 → hard cut at day 42 → N = 7 - elapsedDays (since warn)
  const remaining = HARD_CUT_DAYS - 35 - elapsedDays;
  return Math.max(remaining, 0);
}

function formatArchiveDate(archivedAt: string): string {
  return new Date(archivedAt).toISOString().slice(0, 10);
}

export function PageExperimentTab({
  rows,
  onShip,
  busyKey,
}: PageExperimentTabProps): React.JSX.Element {
  const toast = useToast();
  const [pending, setPending] = useState<PendingConfirm | null>(null);

  function handleShipClick(row: ExperimentRow): void {
    if (row.posterior >= 0.95) {
      onShip(row.variant_id);
      return;
    }
    setPending({
      variantId: row.variant_id,
      variantName: row.variant_name,
      posterior: row.posterior,
    });
  }

  async function handleConfirmBelow95(reason: string): Promise<void> {
    if (!pending) return;
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
    onShip(pending.variantId);
    setPending(null);
  }

  return (
    <div className="flex flex-col gap-3">
      {rows.map((row) => {
        const archived = row.archived_at !== null;
        const warning = row.warned_at !== null && !archived;
        const rowBusy = busyKey === row.variant_id;
        const daysRemaining = warning && row.warned_at ? daysUntilHardCut(row.warned_at) : 0;

        return (
          <Card key={row.variant_id} variant="flat" padding="md">
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

              {/* D-11: 35-day warn banner */}
              {warning && (
                <div
                  role="status"
                  className="rounded-xl border border-[var(--color-warning)] bg-[var(--color-warning-soft)] p-3 text-sm text-[var(--color-text)]"
                >
                  This variant auto-archives in {daysRemaining} day
                  {daysRemaining === 1 ? '' : 's'}. Ship a winner or roll back
                  to control.
                </div>
              )}

              {/* D-11: 42-day archived banner (precedence over warn) */}
              {archived && (
                <div
                  role="status"
                  className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-elevated)] p-3 text-sm text-[var(--color-text-tertiary)]"
                >
                  This variant was auto-archived on{' '}
                  {formatArchiveDate(row.archived_at!)}. Traffic is back on
                  control.
                </div>
              )}

              <div className="flex justify-end gap-2">
                {!archived && (
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

export default PageExperimentTab;
