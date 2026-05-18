/**
 * Phase 26 Plan 01 — AFFTIER-02 success criterion #1: historical immutability.
 *
 * Vitest live-DB test (NOT Playwright — see plan body Task 3 + the
 * playwright.config.ts testIgnore + vitest-e2e.config.ts include entries that
 * route this `.spec.ts` to vitest only).
 *
 * Wave-0 stub: this test is RED until Plan 26-07 Task 4 pushes Migrations
 * 01-07 live with `supabase db push --linked`. Once the BEFORE INSERT trigger
 * `trg_affiliate_conversion_stamp` is active in the live DB, every conversion
 * INSERT will physically stamp `tier_at_conversion_time` from
 * `affiliates.tier` atomically — and this test passes.
 *
 * Pattern lift: e2e/rls-audit-logs.test.ts (env-skip + admin singleton + per-file slug prefix).
 * Per [[feedback_rls_per_file_slug_prefix]]: SLUG_PREFIX is file-scoped (NEVER shared).
 *
 * What we prove:
 *   1. INSERT 5 paid conversions while affiliates.tier = 'standard' → all 5
 *      get tier_at_conversion_time = 'standard' (BEFORE INSERT trigger fires).
 *   2. UPDATE affiliates SET tier = 'gold' → no historical rows mutate.
 *   3. INSERT 5 more paid conversions → all 5 get tier_at_conversion_time = 'gold'.
 *   4. SELECT all 10 rows → first 5 still 'standard', second 5 'gold'.
 *
 * This is the canonical refutation of any "app-layer stamping" implementation;
 * the trigger is the SINGLE writer of tier_at_conversion_time.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { TIER_COMMISSION_PCT } from '@/lib/affiliate/tier-config';

const URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SHOULD_RUN = Boolean(URL && SERVICE);
const describeIfLive = SHOULD_RUN ? describe : describe.skip;

// Per-file slug prefix per [[feedback_rls_per_file_slug_prefix]] — NEVER shared.
const TEST_SLUG_PREFIX = `26-tier-stamp-${Date.now()}-`;

describeIfLive('AFFTIER-02 — historical immutability (success criterion #1)', () => {
  let admin: SupabaseClient;
  let affiliateId: string;

  beforeAll(async () => {
    admin = createClient(URL!, SERVICE!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data: aff, error } = await admin
      .from('affiliates')
      .insert({
        email: `${TEST_SLUG_PREFIX}aff@test.invalid`,
        display_name: `${TEST_SLUG_PREFIX}aff`,
        audience_type: 'Other',
        audience_size: 0,
        status: 'approved',
        referral_code: `${TEST_SLUG_PREFIX}aff`,
      })
      .select('id')
      .single();
    if (error || !aff) throw error ?? new Error('affiliate insert returned no row');
    affiliateId = aff.id;
  });

  afterAll(async () => {
    if (!affiliateId) return;
    await admin.from('affiliate_conversions').delete().eq('affiliate_id', affiliateId);
    await admin.from('affiliates').delete().eq('id', affiliateId);
  });

  it('5 standard conversions remain standard after tier upgrade to gold', async () => {
    // 1. Insert 5 paid conversions while tier='standard'.
    for (let i = 0; i < 5; i++) {
      const { error } = await admin.from('affiliate_conversions').insert({
        affiliate_id: affiliateId,
        invoice_id: `${TEST_SLUG_PREFIX}std-${i}`,
        commission_cents: 260,
        status: 'paid',
      });
      if (error) throw error;
    }

    // 2. Flip tier to gold AFTER the first 5 rows exist.
    const { error: updErr } = await admin
      .from('affiliates')
      .update({ tier: 'gold' })
      .eq('id', affiliateId);
    if (updErr) throw updErr;

    // 3. Insert 5 more paid conversions while tier='gold'.
    for (let i = 0; i < 5; i++) {
      const { error } = await admin.from('affiliate_conversions').insert({
        affiliate_id: affiliateId,
        invoice_id: `${TEST_SLUG_PREFIX}gold-${i}`,
        commission_cents: 390,
        status: 'paid',
      });
      if (error) throw error;
    }

    // 4. Assert.
    const { data: rows, error: selErr } = await admin
      .from('affiliate_conversions')
      .select('invoice_id, tier_at_conversion_time')
      .eq('affiliate_id', affiliateId)
      .order('created_at', { ascending: true });
    if (selErr) throw selErr;
    expect(rows).toBeTruthy();

    const std = (rows ?? []).filter((r) => String(r.invoice_id).includes('std-'));
    const gld = (rows ?? []).filter((r) => String(r.invoice_id).includes('gold-'));
    expect(std).toHaveLength(5);
    expect(gld).toHaveLength(5);
    expect(std.every((r) => r.tier_at_conversion_time === 'standard')).toBe(true);
    expect(gld.every((r) => r.tier_at_conversion_time === 'gold')).toBe(true);
  });

  it('TIER_COMMISSION_PCT values match SQL trigger CASE arms (D-01 single source of truth)', () => {
    expect(TIER_COMMISSION_PCT).toEqual({ standard: 0.2, gold: 0.3, lifetime: 0.25 });
  });
});
