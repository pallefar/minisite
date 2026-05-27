/**
 * Phase 19 Plan 19-06a — Shared affiliate data layer.
 *
 * Consumed by both 19-06a (`PartnerDashboard`) and 19-06b (`PartnerLinksPage`,
 * `PartnerPayoutsPage`). All fetchers filter by `affiliate_id` on the client AND
 * are RLS-gated server-side by `pol_*_self_select` policies from Plan 19-01
 * (defense-in-depth per T-19-06a-I).
 *
 * Spec references:
 *   - 19-CONTEXT.md D-09..D-12: KPI windows + 10-min poll
 *   - 19-UI-SPEC.md §/partner/dashboard: KPI labels + activity-feed row anatomy
 *   - supabase/migrations/20270101000001_affiliates_schema.sql: affiliates shape
 *   - supabase/migrations/20270101000002_affiliate_clicks_conversions_payouts.sql:
 *     clicks/conversions/payouts shape
 *
 * Pending payout (per plan body line 130): SUM(commission_cents) WHERE
 * status IN ('pending','confirmed'). 'paid' is excluded — already disbursed.
 * 'flagged' is excluded — under review; not yet earned.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { TIER_VOLUME_THRESHOLD, type AffiliateTier } from './tier-config';
import type { TierEarningsBreakdown, TierProgress } from './types';

export interface AffiliateStats {
  clicks30d: number;
  clicksPrev30d: number;
  conversions30d: number;
  conversionsPrev30d: number;
  commissionsCents30d: number;
  commissionsCentsPrev30d: number;
  pendingPayoutCents: number;
}

export interface ConversionRow {
  id: string;
  created_at: string;
  status: 'pending' | 'confirmed' | 'flagged' | 'rejected' | 'paid';
  commission_cents: number;
  subscription_id: string | null;
}

export interface DailyPoint {
  date: string; // YYYY-MM-DD (UTC)
  clicks: number;
  conversions: number;
}

export interface AffiliateProfile {
  id: string;
  display_name: string;
  referral_code: string | null;
  status: string;
  stripe_payouts_enabled: boolean;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function nowMs(): number {
  return Date.now();
}

function toIso(ms: number): string {
  return new Date(ms).toISOString();
}

function toDateKey(ms: number): string {
  // UTC YYYY-MM-DD — aligns with how Plan 19-07's baseline matview buckets
  // (`date_trunc('day', created_at AT TIME ZONE 'UTC')`).
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * KPI window aggregation. Three windowed queries:
 *   (1) clicks last 30d + previous 30d
 *   (2) conversions last 30d + previous 30d (commission_cents summed too)
 *   (3) pending payout (status IN ('pending','confirmed'))
 *
 * Uses `select('id', { count: 'exact', head: true })` for fast count without
 * payload transfer.
 */
export async function fetchAffiliateStats(
  affiliateId: string,
  supabase: SupabaseClient,
): Promise<AffiliateStats> {
  const now = nowMs();
  const t30 = toIso(now - 30 * MS_PER_DAY);
  const t60 = toIso(now - 60 * MS_PER_DAY);
  const nowIso = toIso(now);

  // --- Clicks (count only, head=true → no row payload) ---------------------
  const clicksCur = await supabase
    .from('affiliate_clicks')
    .select('id', { count: 'exact', head: true })
    .eq('affiliate_id', affiliateId)
    .gte('created_at', t30)
    .lt('created_at', nowIso);
  const clicksPrev = await supabase
    .from('affiliate_clicks')
    .select('id', { count: 'exact', head: true })
    .eq('affiliate_id', affiliateId)
    .gte('created_at', t60)
    .lt('created_at', t30);

  // --- Conversions current/prev (need rows for commission sum) -------------
  const convCur = await supabase
    .from('affiliate_conversions')
    .select('commission_cents,status')
    .eq('affiliate_id', affiliateId)
    .gte('created_at', t30)
    .lt('created_at', nowIso);
  const convPrev = await supabase
    .from('affiliate_conversions')
    .select('commission_cents,status')
    .eq('affiliate_id', affiliateId)
    .gte('created_at', t60)
    .lt('created_at', t30);

  // --- Pending payout (all-time pending/confirmed; not yet paid) -----------
  const pendingRes = await supabase
    .from('affiliate_conversions')
    .select('commission_cents')
    .eq('affiliate_id', affiliateId)
    .in('status', ['pending', 'confirmed']);

  const sumCents = (rows: { commission_cents: number }[] | null): number =>
    (rows ?? []).reduce((acc, r) => acc + (r.commission_cents ?? 0), 0);

  return {
    clicks30d: clicksCur.count ?? 0,
    clicksPrev30d: clicksPrev.count ?? 0,
    conversions30d: convCur.data?.length ?? 0,
    conversionsPrev30d: convPrev.data?.length ?? 0,
    commissionsCents30d: sumCents(convCur.data as { commission_cents: number }[] | null),
    commissionsCentsPrev30d: sumCents(convPrev.data as { commission_cents: number }[] | null),
    pendingPayoutCents: sumCents(pendingRes.data as { commission_cents: number }[] | null),
  };
}

/**
 * Most recent N conversions for the activity feed.
 * Default `limit=10` matches UI-SPEC §/partner/dashboard activity-feed length.
 */
export async function fetchRecentConversions(
  affiliateId: string,
  supabase: SupabaseClient,
  limit = 10,
): Promise<ConversionRow[]> {
  const res = await supabase
    .from('affiliate_conversions')
    .select('id,created_at,status,commission_cents,subscription_id')
    .eq('affiliate_id', affiliateId)
    .order('created_at', { ascending: false })
    .limit(limit);
  return (res.data ?? []) as ConversionRow[];
}

/**
 * 30-day clicks + conversions daily trend.
 * Gap-fills empty days with `{ clicks: 0, conversions: 0 }` so the chart's
 * x-axis is always 30 points (UI-SPEC line 186).
 */
export async function fetchDailyTrend(
  affiliateId: string,
  supabase: SupabaseClient,
): Promise<DailyPoint[]> {
  const now = nowMs();
  const t30 = toIso(now - 30 * MS_PER_DAY);
  const nowIso = toIso(now);

  const clicksRes = await supabase
    .from('affiliate_clicks')
    .select('created_at')
    .eq('affiliate_id', affiliateId)
    .gte('created_at', t30)
    .lt('created_at', nowIso);
  const convRes = await supabase
    .from('affiliate_conversions')
    .select('created_at')
    .eq('affiliate_id', affiliateId)
    .gte('created_at', t30)
    .lt('created_at', nowIso);

  // Build 30 ascending day buckets ending today (UTC).
  const buckets = new Map<string, { clicks: number; conversions: number }>();
  for (let i = 29; i >= 0; i--) {
    const key = toDateKey(now - i * MS_PER_DAY);
    buckets.set(key, { clicks: 0, conversions: 0 });
  }
  for (const row of (clicksRes.data ?? []) as { created_at: string }[]) {
    const key = row.created_at.slice(0, 10);
    const b = buckets.get(key);
    if (b) b.clicks += 1;
  }
  for (const row of (convRes.data ?? []) as { created_at: string }[]) {
    const key = row.created_at.slice(0, 10);
    const b = buckets.get(key);
    if (b) b.conversions += 1;
  }
  return Array.from(buckets.entries()).map(([date, v]) => ({ date, ...v }));
}

/**
 * Fetch the affiliate profile row for the signed-in user. Returns null when
 * the user has no `affiliates` row (PartnerLayout uses this to fall through
 * to the forbidden state — even when app_metadata.role='affiliate' is set,
 * we still require a real row).
 */
export async function fetchAffiliateProfile(
  userId: string,
  supabase: SupabaseClient,
): Promise<AffiliateProfile | null> {
  const res = await supabase
    .from('affiliates')
    .select('id,display_name,referral_code,status,stripe_payouts_enabled')
    .eq('user_id', userId)
    .maybeSingle();
  if (!res.data) return null;
  return res.data as AffiliateProfile;
}

// ============================================================================
// Phase 26 Plan 26-03 — AFFTIER-03 partner-facing tier progress.
//
// Two read functions powering PartnerTierProgress + PartnerTierEarningsBreakdown:
//   1. getTierProgress: current tier + paid-conversion count + next threshold
//      + frozen state (frozen_at / freeze_reason populated by the fraud-signal
//      pipeline, D-04).
//   2. getTierEarningsBreakdown: per-tier sum of commission_cents grouped by
//      tier_at_conversion_time (the trigger-stamped column from Plan 26-01's
//      migration 20270701000003).
//
// Both filter by affiliate_id and rely on Plan 19-01's
// `pol_*_self_select` RLS policies (defense-in-depth — server enforces too).
// ============================================================================

/**
 * AFFTIER-03 — Partner dashboard tier progress.
 *
 * Reads `affiliates.tier` + frozen state with a single-row lookup, then
 * issues a head-count query against `affiliate_conversions` for paid +
 * confirmed conversions (the rows that count toward the volume threshold
 * per D-02).
 *
 * `nextTierThreshold` is `TIER_VOLUME_THRESHOLD` (10) on Standard; `null` on
 * Gold / Lifetime (no further auto-promotion path — Lifetime is manual-only
 * per D-03 ratchet semantics, Gold has no next step).
 */
export async function getTierProgress(
  affiliateId: string,
  client: SupabaseClient,
): Promise<TierProgress> {
  const { data: aff, error: affErr } = await client
    .from('affiliates')
    .select('tier, frozen_at, freeze_reason')
    .eq('id', affiliateId)
    .single();
  if (affErr || !aff) {
    throw new Error(`affiliate ${affiliateId} not found`);
  }

  const { count, error: convErr } = await client
    .from('affiliate_conversions')
    .select('id', { count: 'exact', head: true })
    .eq('affiliate_id', affiliateId)
    .in('status', ['paid', 'confirmed']);
  if (convErr) {
    throw new Error(`tier-progress count failed: ${convErr.message}`);
  }

  const tier = (aff as { tier: AffiliateTier }).tier;
  const frozenAt = (aff as { frozen_at: string | null }).frozen_at ?? null;
  const freezeReason = (aff as { freeze_reason: string | null }).freeze_reason ?? null;

  return {
    currentTier: tier,
    paidConversionCount: count ?? 0,
    nextTierThreshold: tier === 'standard' ? TIER_VOLUME_THRESHOLD : null,
    frozenAt,
    freezeReason,
  };
}

/**
 * AFFTIER-03 — Per-tier earnings breakdown.
 *
 * Fetches the (tier_at_conversion_time, commission_cents) projection for all
 * paid + confirmed conversions, then defers to the pure `rollupTierEarnings`
 * helper for the sum-by-bucket arithmetic. The two-function split keeps the
 * arithmetic unit-testable without a Supabase mock.
 */
export async function getTierEarningsBreakdown(
  affiliateId: string,
  client: SupabaseClient,
): Promise<TierEarningsBreakdown> {
  const { data, error } = await client
    .from('affiliate_conversions')
    .select('tier_at_conversion_time, commission_cents')
    .eq('affiliate_id', affiliateId)
    .in('status', ['paid', 'confirmed']);
  if (error) {
    throw new Error(`tier-earnings failed: ${error.message}`);
  }

  return rollupTierEarnings(
    (data ?? []) as Array<{ tier_at_conversion_time: string; commission_cents: number }>,
  );
}

/**
 * Pure helper — sums commission_cents grouped by tier_at_conversion_time.
 * Exported for direct unit-testing (no Supabase mock required).
 *
 * Defensive: unknown tier values (anything other than standard | gold |
 * lifetime) are silently skipped so a future tier introduction does not
 * break partner dashboards.
 */
export function rollupTierEarnings(
  rows: Array<{ tier_at_conversion_time: string; commission_cents: number }>,
): TierEarningsBreakdown {
  let asStandardCents = 0;
  let asGoldCents = 0;
  let asLifetimeCents = 0;
  for (const r of rows) {
    const cents = r.commission_cents ?? 0;
    if (r.tier_at_conversion_time === 'standard') asStandardCents += cents;
    else if (r.tier_at_conversion_time === 'gold') asGoldCents += cents;
    else if (r.tier_at_conversion_time === 'lifetime') asLifetimeCents += cents;
    // else: defensive skip — unknown tier values do not contribute to total.
  }
  return {
    asStandardCents,
    asGoldCents,
    asLifetimeCents,
    totalCents: asStandardCents + asGoldCents + asLifetimeCents,
  };
}
