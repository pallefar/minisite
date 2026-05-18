/**
 * Phase 26 Plan 01 — AFFTIER-01: Standard→Gold auto-promotion at N=10 paid conversions.
 *
 * Vitest live-DB test (NOT Playwright — see plan body Task 3 + the
 * playwright.config.ts testIgnore + vitest-e2e.config.ts include entries that
 * route this `.spec.ts` to vitest only).
 *
 * Wave-0 stub: this test is RED until Plan 26-07 Task 4 pushes Migrations
 * 01-07 live with `supabase db push --linked`. Once the AFTER INSERT trigger
 * `trg_affiliate_promote_gold` is active in the live DB, this test passes.
 *
 * Pattern lift: e2e/rls-audit-logs.test.ts (env-skip + admin singleton + per-file slug prefix).
 * Per [[feedback_rls_per_file_slug_prefix]]: SLUG_PREFIX is file-scoped (NEVER shared).
 *
 * What we prove:
 *   1. INSERT 10 paid conversions for a standard-tier affiliate.
 *   2. affiliates.tier flips to 'gold'; tier_promoted_at gets set.
 *   3. EXACTLY ONE audit_logs row is written with action_name='affiliate_tier_auto_promoted'
 *      (Pitfall 3 race-safe ratchet → FOUND-gated audit).
 *
 * The single-audit-row assertion is the canonical proof that the
 * `WHERE tier='standard'` ratchet clause works under concurrent inserts.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SHOULD_RUN = Boolean(URL && SERVICE);
const describeIfLive = SHOULD_RUN ? describe : describe.skip;

// Per-file slug prefix per [[feedback_rls_per_file_slug_prefix]] — NEVER shared.
const TEST_SLUG_PREFIX = `26-promote-${Date.now()}-`;

describeIfLive('AFFTIER-01 — Standard → Gold auto-promotion at N=10 paid conversions', () => {
  let admin: SupabaseClient;
  let affiliateId: string;

  beforeAll(async () => {
    admin = createClient(URL!, SERVICE!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data, error } = await admin
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
    if (error || !data) throw error ?? new Error('affiliate insert returned no row');
    affiliateId = data.id;
  });

  afterAll(async () => {
    if (!affiliateId) return;
    await admin.from('audit_logs').delete().eq('row_pk', affiliateId);
    await admin.from('affiliate_conversions').delete().eq('affiliate_id', affiliateId);
    await admin.from('affiliates').delete().eq('id', affiliateId);
  });

  it('insert 10 paid conversions; tier flips to gold; exactly one audit row written', async () => {
    for (let i = 0; i < 10; i++) {
      const { error } = await admin.from('affiliate_conversions').insert({
        affiliate_id: affiliateId,
        invoice_id: `${TEST_SLUG_PREFIX}c-${i}`,
        commission_cents: 260,
        status: 'paid',
      });
      if (error) throw error;
    }

    const { data: aff, error: affErr } = await admin
      .from('affiliates')
      .select('tier, tier_promoted_at')
      .eq('id', affiliateId)
      .single();
    if (affErr) throw affErr;
    expect(aff!.tier).toBe('gold');
    expect(aff!.tier_promoted_at).not.toBeNull();

    const { data: audit, error: auditErr } = await admin
      .from('audit_logs')
      .select('action_name')
      .eq('row_pk', affiliateId)
      .eq('action_name', 'affiliate_tier_auto_promoted');
    if (auditErr) throw auditErr;
    // Race-safe ratchet (Pitfall 3): FOUND-gated audit → exactly one row.
    expect((audit ?? []).length).toBe(1);
  });
});
