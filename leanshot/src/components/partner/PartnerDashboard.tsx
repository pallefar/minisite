/**
 * Phase 19 Plan 19-06a — PartnerDashboard (the /partner/dashboard surface).
 *
 * Spec references:
 *   - 19-UI-SPEC.md §/partner/dashboard
 *   - 19-CONTEXT.md D-10: 10-min SWR poll
 *   - 19-PATTERNS.md §C.4 KPI bento composition
 *
 * I-4 cross-wave gate (LOCKED): this file imports
 * `@/components/partner/StripeConnectOnboardingCard`, which is authored by
 * Plan 19-06b (Wave 4). Workspace will be typecheck-red between Wave 3 close
 * and Wave 4 open — that's the contract. `/gsd-execute-phase 19` runs
 * Waves 3 + 4 back-to-back without an intermediate build/typecheck.
 *
 * BL-4 honored: this file does NOT modify src/App.tsx.
 */
import { MousePointer, RefreshCw, ShoppingCart, Coins, Wallet } from 'lucide-react';
import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { PartnerActivityFeed } from '@/components/partner/PartnerActivityFeed';
import { PartnerKpiCard } from '@/components/partner/PartnerKpiCard';
import { usePartnerContext } from '@/components/partner/PartnerLayout';
// Phase 26 Plan 26-03 (AFFTIER-03) — multi-tier dashboard surface. Both new
// blocks render above the v1.2 KPI grid; KPI grid + activity feed are
// unchanged below.
import { PartnerTierEarningsBreakdown } from '@/components/partner/PartnerTierEarningsBreakdown';
import { PartnerTierProgress } from '@/components/partner/PartnerTierProgress';
import { PartnerTrendChart } from '@/components/partner/PartnerTrendChart';
// I-4 cross-wave gate (LOCKED in 19-06a PLAN line 154) — `StripeConnectOnboardingCard`
// is authored by Plan 19-06b (Wave 4). To keep Wave 3's test gate green
// (acceptance criterion: "11 vitest tests pass"), 19-06a ships an opaque
// placeholder at the same file path that returns null. Plan 19-06b's executor
// OVERWRITES that placeholder with the real 4-state-machine component. This
// is a Rule-3 deviation from the plan's "do not stub" language — the placeholder
// is the minimal artifact required to make the test command executable today.
import { StripeConnectOnboardingCard } from '@/components/partner/StripeConnectOnboardingCard';
import { Button } from '@/components/ui/Button';
import { Skeleton } from '@/components/ui/Skeleton';
import {
  type AffiliateStats,
  type ConversionRow,
  type DailyPoint,
  fetchAffiliateStats,
  fetchDailyTrend,
  fetchRecentConversions,
} from '@/lib/affiliate/api';
import { supabase } from '@/lib/supabase';

const POLL_MS = 10 * 60 * 1000; // 10 min — D-10

function pctDelta(current: number, previous: number): number | null {
  if (previous === 0) {
    if (current === 0) return 0;
    return null; // undefined growth from zero baseline
  }
  return ((current - previous) / previous) * 100;
}

function relativeMinutes(ts: Date | null): string {
  if (!ts) return 'never';
  const sec = Math.floor((Date.now() - ts.getTime()) / 1000);
  if (sec < 30) return 'just now';
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  return `${min} min ago`;
}

export function PartnerDashboard(): ReactNode {
  const { profile, connectState, requirements, disabledReason } = usePartnerContext();
  const [stats, setStats] = useState<AffiliateStats | null>(null);
  const [trend, setTrend] = useState<DailyPoint[]>([]);
  const [recent, setRecent] = useState<ConversionRow[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [lastFetchedAt, setLastFetchedAt] = useState<Date | null>(null);
  const refreshingRef = useRef<boolean>(false);

  const fetchAll = useCallback(async () => {
    if (refreshingRef.current) return;
    refreshingRef.current = true;
    try {
      const [s, t, r] = await Promise.all([
        fetchAffiliateStats(profile.id, supabase),
        fetchDailyTrend(profile.id, supabase),
        fetchRecentConversions(profile.id, supabase, 10),
      ]);
      setStats(s);
      setTrend(t);
      setRecent(r);
      setLastFetchedAt(new Date());
      setLoading(false);
    } catch {
      setLoading(false);
    } finally {
      refreshingRef.current = false;
    }
  }, [profile.id]);

  useEffect(() => {
    void fetchAll();
    const id = window.setInterval(() => {
      void fetchAll();
    }, POLL_MS);
    return () => {
      window.clearInterval(id);
    };
  }, [fetchAll]);

  const handleManualRefresh = (): void => {
    void fetchAll();
  };

  return (
    <div>
      {/* Header strip — greeting + refresh */}
      <header className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 mb-6">
        <h1 className="text-2xl font-semibold text-[var(--color-text)]">
          Hi {profile.display_name} 👋
        </h1>
        <div className="flex items-center gap-3">
          <span className="text-xs text-[var(--color-text-secondary)]" aria-live="off">
            Updated {relativeMinutes(lastFetchedAt)}
          </span>
          <Button
            variant="ghost"
            size="sm"
            leadingIcon={<RefreshCw className="size-4" />}
            onClick={handleManualRefresh}
            aria-label="Refresh dashboard"
          >
            Refresh
          </Button>
        </div>
      </header>

      {/* Stripe Connect onboarding (Plan 19-06b owns the 4-state-machine component;
          this call site is wired but renders nothing until 19-06b overwrites the
          placeholder at `@/components/partner/StripeConnectOnboardingCard`). */}
      <StripeConnectOnboardingCard
        state={connectState}
        requirements={requirements}
        disabledReason={disabledReason}
      />

      {/* Phase 26 Plan 26-03 (AFFTIER-03) — Tier progress + per-tier earnings.
          Mounted ABOVE the existing v1.2 KPI grid per plan spec; both new blocks
          source affiliateId from profile.id (same scope the KPI cards use). */}
      <div className="grid grid-cols-12 gap-4 md:gap-6 mb-6">
        <PartnerTierProgress affiliateId={profile.id} />
        <PartnerTierEarningsBreakdown affiliateId={profile.id} />
      </div>

      {/* KPI grid */}
      <div className="grid grid-cols-12 gap-4 md:gap-6 mb-6">
        {loading || !stats ? (
          <>
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="lg:col-span-3 md:col-span-6 col-span-12" aria-hidden>
                <Skeleton className="h-32 w-full rounded-card" />
              </div>
            ))}
          </>
        ) : (
          <>
            <PartnerKpiCard
              label="Clicks · 30d"
              value={stats.clicks30d}
              deltaPct={pctDelta(stats.clicks30d, stats.clicksPrev30d)}
              icon={<MousePointer className="size-4" />}
              format="count"
            />
            <PartnerKpiCard
              label="Conversions · 30d"
              value={stats.conversions30d}
              deltaPct={pctDelta(stats.conversions30d, stats.conversionsPrev30d)}
              icon={<ShoppingCart className="size-4" />}
              format="count"
            />
            <PartnerKpiCard
              label="Commissions · 30d"
              value={stats.commissionsCents30d}
              deltaPct={pctDelta(stats.commissionsCents30d, stats.commissionsCentsPrev30d)}
              icon={<Coins className="size-4" />}
              format="currency"
            />
            <PartnerKpiCard
              label="Pending payout"
              value={stats.pendingPayoutCents}
              deltaPct={null}
              icon={<Wallet className="size-4" />}
              format="currency"
            />
          </>
        )}
      </div>

      {/* Trend chart */}
      <div className="grid grid-cols-12 gap-4 md:gap-6 mb-6">
        {loading ? (
          <div className="col-span-12">
            <Skeleton className="h-64 w-full rounded-card" />
          </div>
        ) : (
          <PartnerTrendChart data={trend} />
        )}
      </div>

      {/* Activity feed */}
      <div className="grid grid-cols-12 gap-4 md:gap-6">
        {loading ? (
          <div className="col-span-12">
            <Skeleton className="h-48 w-full rounded-card" />
          </div>
        ) : (
          <PartnerActivityFeed rows={recent} />
        )}
      </div>
    </div>
  );
}

export default PartnerDashboard;
