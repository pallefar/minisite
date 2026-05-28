/**
 * Phase 39 Plan 39-08 — PharmaExperimentTab (Surface G — Pharma sub-tab).
 *
 * Mirrors PaywallExperimentTab structure (sibling pattern from Plan 39-07) but
 * specialised for pharma metrics. Renders one row per PharmaExperimentRow with:
 *   - variant_name + sample_size header
 *   - PharmaVariantMetricsCard composite preview (nps_delta + one_star_rate_ratio
 *     + conversion_uplift_pct)
 *   - clinical-signoff badge (warning when latest version pending, success when
 *     reviewed)
 *   - 1-click "Disable variant" button (PHARMA-04) gated through ConfirmModal
 *   - "Version history" button opening a Sheet drawer with PharmaVersionList
 *
 * Per UI-SPEC Hard Constraint 8 the Pharma disable flow does NOT use
 * ship-winner-flag (that is a promotion); it calls disable_pharma_variant
 * SECDEF RPC via the parent's onDisable callback.
 *
 * Accent policy (UI-SPEC line 132): NO teal accent on pharma surfaces; only
 * warning/success/danger tones are used here.
 *
 * Decision references: D-03 (NPS + 1★ surfaced), D-12 (audit on disable),
 * PHARMA-03/04/07/08.
 */
import { useState } from 'react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { ConfirmModal } from '@/components/ui/Confirm';
import { Sheet } from '@/components/ui/Sheet';
import type { PharmaExperimentRow } from './experiment-types';
import { PharmaVariantMetricsCard } from './PharmaVariantMetricsCard';
import { PharmaVersionList, type PharmaContentVersion } from './PharmaVersionList';

/**
 * Convenience shape used by the parent dashboard — extends the SECDEF row
 * with the per-content version history slice (joined client-side or returned
 * inline by a sibling RPC; this component does not own the fetch).
 */
export interface PharmaExperimentRowWithVersions extends PharmaExperimentRow {
  versions?: PharmaContentVersion[];
  content_id?: string;
}

export interface PharmaExperimentTabProps {
  rows: PharmaExperimentRowWithVersions[];
  onDisable: (variantId: string) => Promise<void> | void;
  busyKey: string | null;
}

interface PendingDisable {
  variantId: string;
  variantName: string;
}

interface ActiveDrawer {
  variantId: string;
  variantName: string;
  versions: PharmaContentVersion[];
  contentId: string;
}

function deriveConversionUplift(row: PharmaExperimentRow): number | null {
  // The SECDEF RPC leaves paid_rate null for pharma surface; compute uplift
  // only when both paid_rate and a control baseline are populated.
  if (row.paid_rate === null || row.refund_rate_baseline_30d === null) return null;
  const baseline = row.refund_rate_baseline_30d;
  if (baseline === 0) return null;
  return ((row.paid_rate - baseline) / baseline) * 100;
}

function latestSignoffStatus(
  versions: PharmaContentVersion[] | undefined,
): 'reviewed' | 'pending' | 'none' {
  if (!versions || versions.length === 0) return 'none';
  const sorted = [...versions].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  const latest = sorted[0];
  if (latest.clinical_signoff_at && latest.clinical_signoff_name) return 'reviewed';
  return 'pending';
}

export function PharmaExperimentTab({
  rows,
  onDisable,
  busyKey,
}: PharmaExperimentTabProps): React.JSX.Element {
  const [pending, setPending] = useState<PendingDisable | null>(null);
  const [drawer, setDrawer] = useState<ActiveDrawer | null>(null);

  async function handleConfirm(): Promise<void> {
    if (!pending) return;
    await onDisable(pending.variantId);
    setPending(null);
  }

  return (
    <div className="flex flex-col gap-3">
      {rows.map((row) => {
        const archived = row.archived_at !== null;
        const rowBusy = busyKey === row.variant_id;
        const signoff = latestSignoffStatus(row.versions);
        return (
          <Card
            key={row.variant_id}
            variant="flat"
            padding="md"
            className={archived ? 'opacity-70' : ''}
          >
            <div className="flex flex-col gap-3">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="flex flex-col gap-1">
                  <h3 className="text-base font-bold">{row.variant_name}</h3>
                  {row.cohort_label && (
                    <p className="text-sm text-[var(--color-text-secondary)]">{row.cohort_label}</p>
                  )}
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  {archived && <Badge tone="danger">Disabled</Badge>}
                  {signoff === 'reviewed' && (
                    <Badge tone="success">Clinical review: approved</Badge>
                  )}
                  {signoff === 'pending' && <Badge tone="warning">Clinical review: pending</Badge>}
                </div>
              </div>

              <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
                <span>
                  <span className="text-[var(--color-text-secondary)]">Sample: </span>
                  <span className="font-bold tabular-nums">{row.sample_size}</span>
                </span>
                {row.nps_delta !== null && (
                  <span>
                    <span className="text-[var(--color-text-secondary)]">NPS Δ: </span>
                    <span className="font-bold tabular-nums">{row.nps_delta.toFixed(1)}</span>
                  </span>
                )}
                {row.one_star_rate_ratio !== null && (
                  <span>
                    <span className="text-[var(--color-text-secondary)]">1★ ratio: </span>
                    <span className="font-bold tabular-nums">
                      {row.one_star_rate_ratio.toFixed(2)}×
                    </span>
                  </span>
                )}
              </div>

              <PharmaVariantMetricsCard
                nps_delta={row.nps_delta}
                one_star_rate_ratio={row.one_star_rate_ratio}
                conversion_uplift_pct={deriveConversionUplift(row)}
              />

              <div className="flex justify-end gap-2 flex-wrap">
                {row.versions !== undefined && (
                  <Button
                    variant="ghost"
                    size="sm"
                    data-action="open-version-history"
                    data-variant={row.variant_id}
                    onClick={() =>
                      setDrawer({
                        variantId: row.variant_id,
                        variantName: row.variant_name,
                        versions: row.versions ?? [],
                        contentId: row.content_id ?? '',
                      })
                    }
                  >
                    Version history
                  </Button>
                )}
                {!archived && (
                  <Button
                    variant="destructive"
                    size="sm"
                    disabled={rowBusy}
                    loading={rowBusy}
                    onClick={() =>
                      setPending({
                        variantId: row.variant_id,
                        variantName: row.variant_name,
                      })
                    }
                    data-action="disable-variant"
                    data-variant={row.variant_id}
                  >
                    Disable variant
                  </Button>
                )}
              </div>
            </div>
          </Card>
        );
      })}

      {pending && (
        <ConfirmModal
          open
          destructive
          title="Disable pharma variant"
          message={`Disable pharma variant \`${pending.variantName}\`? All traffic returns to control immediately.`}
          confirmLabel="Disable variant"
          cancelLabel="Cancel"
          onConfirm={() => void handleConfirm()}
          onCancel={() => setPending(null)}
        />
      )}

      {drawer && (
        <Sheet
          open
          onClose={() => setDrawer(null)}
          title={`${drawer.variantName} — content versions`}
        >
          <PharmaVersionList contentId={drawer.contentId} versions={drawer.versions} />
        </Sheet>
      )}
    </div>
  );
}

export default PharmaExperimentTab;
