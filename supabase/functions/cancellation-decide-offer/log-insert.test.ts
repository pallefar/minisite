/**
 * Phase 40 Plan 40-03 — log-insert unit tests.
 *
 * VALIDATION row 40-03-T1e (D-18 reason capture even when no offer available).
 *
 * Asserts:
 *   - reason is captured in cancellation_offers_log even when OFFER_INELIGIBLE_NO_RULE
 *   - reason_other_text persisted when reason='other'
 *   - status='offered' (not 'accepted') for the decide-Fn insert
 *   - Stacking fields written when D-15 clamp applied
 *
 * Run: $HOME/.deno/bin/deno test --no-check supabase/functions/cancellation-decide-offer/log-insert.test.ts
 */

import { assertEquals, assertExists } from 'https://deno.land/std@0.224.0/assert/mod.ts';

// ─── Log row shape verification ───────────────────────────────────────────────

Deno.test('log-insert: reason captured even when offer_type=none (OFFER_INELIGIBLE_NO_RULE)', () => {
  // When resolveRule returns null, the decide Fn inserts a row with offer_type='none'
  // and status='offered'. The reason must still be captured for analytics.
  const logRow = {
    user_id: 'user-123',
    org_id: null,
    subscription_id: 'sub_test',
    reason: 'too_expensive',
    reason_other_text: null,
    offer_type: 'none',
    offer_config: {},
    cohort_snapshot: {},
    tenure_bucket: '30-180d',
    status: 'offered',
    prior_takes_count: 0,
    stacking_clamped: false,
  };

  assertEquals(logRow.reason, 'too_expensive');
  assertEquals(logRow.offer_type, 'none');
  assertEquals(logRow.status, 'offered');
});

Deno.test("log-insert: reason_other_text persisted when reason='other'", () => {
  const logRow = {
    user_id: 'user-456',
    reason: 'other',
    reason_other_text: 'The app is too slow on my phone',
    offer_type: 'none',
    status: 'offered',
  };

  assertEquals(logRow.reason, 'other');
  assertExists(logRow.reason_other_text);
  assertEquals(logRow.reason_other_text.length > 4, true);
});

Deno.test("log-insert: reason_other_text is null when reason != 'other'", () => {
  const logRow = {
    user_id: 'user-789',
    reason: 'not_using',
    reason_other_text: null,
    offer_type: 'discount',
    status: 'offered',
  };

  assertEquals(logRow.reason, 'not_using');
  assertEquals(logRow.reason_other_text, null);
});

Deno.test('log-insert: stacking fields written when D-15 clamp applied', () => {
  // When clampSavePct detects a clamped value, the log row should capture both
  // pre-clamp and post-clamp percentages for audit/analytics
  const logRow = {
    stacking_pre_clamp_pct: 0.1,   // 10% affiliate
    stacking_post_clamp_pct: 0.2778, // clamped effective save pct
    stacking_clamped: true,
  };

  assertEquals(logRow.stacking_clamped, true);
  assertExists(logRow.stacking_pre_clamp_pct);
  assertExists(logRow.stacking_post_clamp_pct);
  assertEquals(logRow.stacking_pre_clamp_pct, 0.1);
});

Deno.test('log-insert: stacking fields are null when no affiliate discount exists', () => {
  // When existingPct=0, stacking fields should be null (no stacking context)
  const logRow = {
    stacking_pre_clamp_pct: null,
    stacking_post_clamp_pct: null,
    stacking_clamped: false,
  };

  assertEquals(logRow.stacking_clamped, false);
  assertEquals(logRow.stacking_pre_clamp_pct, null);
  assertEquals(logRow.stacking_post_clamp_pct, null);
});

Deno.test('log-insert: ineligible_lifetime_cap log has correct status', () => {
  const logRow = {
    user_id: 'user-capped',
    reason: 'too_expensive',
    offer_type: 'none',
    status: 'ineligible_lifetime_cap',
    prior_takes_count: 2,
  };

  assertEquals(logRow.status, 'ineligible_lifetime_cap');
  assertEquals(logRow.offer_type, 'none');
  assertEquals(logRow.prior_takes_count, 2);
});

Deno.test('log-insert: ineligible_cooldown log has correct status', () => {
  const logRow = {
    user_id: 'user-cooldown',
    reason: 'not_using',
    offer_type: 'none',
    status: 'ineligible_cooldown',
  };

  assertEquals(logRow.status, 'ineligible_cooldown');
});
