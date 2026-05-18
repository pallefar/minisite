/**
 * Phase 26 Plan 26-03 — PartnerTierProgress (AFFTIER-03).
 *
 * Partner-facing tier-progress card. Renders:
 *   - Tier badge (Standard / Gold / Lifetime) using v1.2 Badge tones.
 *   - Progress bar toward the next-tier threshold (10 paid conversions per
 *     D-02). Hidden for Gold + Lifetime (no further auto-promotion).
 *   - Frozen banner (role=alert) + grey-out overlay when affiliates.frozen_at
 *     is populated — past earnings still render normally, but future-tier
 *     progress is greyed (RESEARCH OQ#4 + D-04).
 *
 * Threat-model alignment (Plan 26-03 plan body):
 *   - T-26-13 Tampering: tier comes from `getTierProgress`, which reads
 *     `affiliates.tier` server-side (RLS-gated). No client-side tier override.
 *   - T-26-14 Repudiation: freeze_reason is rendered verbatim in the banner +
 *     a mailto:partners@leanshot.app appeal link is exposed.
 *
 * Single source of truth: TIER_VOLUME_THRESHOLD comes from tier-config.ts
 * (Plan 26-01). No magic numbers in this file.
 */
import { AlertCircle } from 'lucide-react';
import { type ReactNode, useEffect, useState } from 'react';

import { Badge, type BadgeTone } from '@/components/ui/Badge';
import { Card, CardHeader } from '@/components/ui/Card';
import { getTierProgress } from '@/lib/affiliate/api';
import type { AffiliateTier } from '@/lib/affiliate/tier-config';
import type { TierProgress } from '@/lib/affiliate/types';
import { supabase } from '@/lib/supabase';

export interface PartnerTierProgressProps {
  affiliateId: string;
}

const TIER_LABEL: Record<AffiliateTier, string> = {
  standard: 'Standard',
  gold: 'Gold',
  lifetime: 'Lifetime',
};

const TIER_BADGE_TONE: Record<AffiliateTier, BadgeTone> = {
  standard: 'neutral',
  gold: 'amber',
  lifetime: 'success',
};

export function PartnerTierProgress({ affiliateId }: PartnerTierProgressProps): ReactNode {
  const [data, setData] = useState<TierProgress | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    getTierProgress(affiliateId, supabase)
      .then((d) => {
        if (active) setData(d);
      })
      .catch((e: unknown) => {
        if (active) setError(e instanceof Error ? e.message : String(e));
      });
    return (): void => {
      active = false;
    };
  }, [affiliateId]);

  if (error) {
    return (
      <Card span={12}>
        <p className="text-sm text-[var(--color-text-secondary)]">
          Couldn&apos;t load tier progress.
        </p>
      </Card>
    );
  }
  if (!data) {
    return (
      <Card span={12}>
        <p className="text-sm text-[var(--color-text-secondary)]">Loading…</p>
      </Card>
    );
  }

  const isFrozen = data.frozenAt !== null;
  const percent =
    data.nextTierThreshold !== null
      ? Math.min(100, Math.round((data.paidConversionCount / data.nextTierThreshold) * 100))
      : null;
  const remaining =
    data.nextTierThreshold !== null
      ? Math.max(0, data.nextTierThreshold - data.paidConversionCount)
      : 0;

  return (
    <Card span={12} variant="elevated">
      <CardHeader title="Your tier" />
      <div className={isFrozen ? 'opacity-50 pointer-events-none' : ''}>
        <div className="flex items-center gap-3 mt-2">
          <Badge tone={TIER_BADGE_TONE[data.currentTier]}>{TIER_LABEL[data.currentTier]}</Badge>
          {data.nextTierThreshold !== null && (
            <span className="text-sm text-[var(--color-text-secondary)]">
              {data.paidConversionCount} / {data.nextTierThreshold} paid conversions
            </span>
          )}
        </div>
        {percent !== null && data.nextTierThreshold !== null && (
          <div className="mt-3">
            <div
              role="progressbar"
              aria-valuenow={data.paidConversionCount}
              aria-valuemax={data.nextTierThreshold}
              aria-valuemin={0}
              aria-label="Progress toward Gold tier"
              className="h-2 rounded-full bg-[var(--color-surface-soft)] overflow-hidden"
            >
              <div
                className="h-full bg-[var(--color-primary)] transition-all duration-500"
                style={{ width: `${percent}%` }}
              />
            </div>
            <p className="text-sm text-[var(--color-text-secondary)] mt-2">
              {remaining > 0
                ? `${remaining} more to Gold`
                : 'Promotion pending — refresh shortly.'}
            </p>
          </div>
        )}
      </div>
      {isFrozen && (
        <div
          role="alert"
          className="mt-4 p-3 rounded border border-[var(--color-warning)] bg-[var(--color-warning-soft)] text-[var(--color-text)] flex items-start gap-2"
        >
          <AlertCircle aria-hidden className="w-4 h-4 mt-0.5 text-[var(--color-warning)]" />
          <div>
            <strong>Account frozen — pending review.</strong>
            {data.freezeReason !== null && (
              <p className="text-sm mt-1">{data.freezeReason}</p>
            )}
            <p className="text-sm mt-1">
              <a href="mailto:partners@leanshot.app" className="underline">
                Appeal
              </a>
            </p>
          </div>
        </div>
      )}
    </Card>
  );
}

export default PartnerTierProgress;
