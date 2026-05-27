/**
 * Phase 26 Plan 26-03 — PartnerTierEarningsBreakdown (AFFTIER-03).
 *
 * Three-row earnings breakdown: cents earned as Standard / Gold / Lifetime,
 * summed across all paid + confirmed conversions via
 * `affiliate_conversions.tier_at_conversion_time` (stamped at INSERT by Plan
 * 26-01's trigger migration 20270701000003 — historical-immutability
 * guarantee per AFFTIER-02).
 *
 * Notes:
 *   - Past earnings render normally even when frozen (RESEARCH OQ#4 — already
 *     paid commissions belong to the partner). Frozen UX lives in
 *     PartnerTierProgress only.
 *   - No magic colors / no new dependencies; reuses v1.2 Card primitive.
 */
import { type ReactNode, useEffect, useState } from 'react';
import { Card, CardHeader } from '@/components/ui/Card';
import { getTierEarningsBreakdown } from '@/lib/affiliate/api';
import type { TierEarningsBreakdown } from '@/lib/affiliate/types';
import { supabase } from '@/lib/supabase';

export interface PartnerTierEarningsBreakdownProps {
  affiliateId: string;
}

function formatCents(cents: number): string {
  const dollars = Math.round(cents) / 100;
  return `$${dollars.toFixed(2)}`;
}

export function PartnerTierEarningsBreakdown({
  affiliateId,
}: PartnerTierEarningsBreakdownProps): ReactNode {
  const [data, setData] = useState<TierEarningsBreakdown | null>(null);

  useEffect(() => {
    let active = true;
    getTierEarningsBreakdown(affiliateId, supabase)
      .then((d) => {
        if (active) setData(d);
      })
      .catch(() => {
        // Silent — Card body renders the "Loading…" fallback. Partner sees the
        // tier-progress card error if both calls failed; this card stays inert.
      });
    return (): void => {
      active = false;
    };
  }, [affiliateId]);

  return (
    <Card span={12}>
      <CardHeader title="Earnings by tier" />
      {data === null ? (
        <p className="text-sm text-[var(--color-text-secondary)]">Loading…</p>
      ) : (
        <dl className="grid grid-cols-3 gap-4 mt-3">
          <div>
            <dt className="text-xs text-[var(--color-text-secondary)]">As Standard</dt>
            <dd className="text-lg font-medium">{formatCents(data.asStandardCents)}</dd>
          </div>
          <div>
            <dt className="text-xs text-[var(--color-text-secondary)]">As Gold</dt>
            <dd className="text-lg font-medium">{formatCents(data.asGoldCents)}</dd>
          </div>
          <div>
            <dt className="text-xs text-[var(--color-text-secondary)]">As Lifetime</dt>
            <dd className="text-lg font-medium">{formatCents(data.asLifetimeCents)}</dd>
          </div>
        </dl>
      )}
    </Card>
  );
}

export default PartnerTierEarningsBreakdown;
