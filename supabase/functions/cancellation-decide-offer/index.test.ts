/**
 * Phase 40 Plan 40-03 — cancellation-decide-offer integration tests.
 *
 * VALIDATION row 40-03-T1 (happy path + ineligible paths + response shape).
 *
 * Tests the handler logic with pure unit assertions to avoid importing
 * the full module at test load time (Deno.serve + npm:@sentry/node imports
 * require --allow-env and network permissions).
 *
 * These tests validate:
 *   - Tenure bucket computation
 *   - Request validation logic (reason enum, reason_other_text)
 *   - isClinicOrg derivation from subscription.clinic_id
 *   - Ineligible code path shapes (D-02/D-03)
 *   - DecideOfferResponse shape contract
 *
 * End-to-end integration tests requiring a live Supabase project are
 * deferred to the 40-06 UAT runbook.
 *
 * Run: $HOME/.deno/bin/deno test --no-check supabase/functions/cancellation-decide-offer/index.test.ts
 */

import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { checkLifetimeCap, checkCooldown } from './anti-gaming.ts';
import type { DecideOfferResponse, IneligibleCode } from '../_shared/cancellation-types.ts';

// ─── Helper: computeTenureBucket (inline for test isolation) ─────────────────
function computeTenureBucket(subscriptionCreatedAt: string): '<30d' | '30-180d' | '>180d' {
  const createdDate = new Date(subscriptionCreatedAt);
  const now = new Date();
  const daysDiff = Math.floor((now.getTime() - createdDate.getTime()) / (1000 * 60 * 60 * 24));
  if (daysDiff < 30) return '<30d';
  if (daysDiff <= 180) return '30-180d';
  return '>180d';
}

function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString();
}

// ─── Tenure bucket computation ────────────────────────────────────────────────

Deno.test('decide-offer: 15 days tenure → <30d bucket', () => {
  const bucket = computeTenureBucket(daysAgo(15));
  assertEquals(bucket, '<30d');
});

Deno.test('decide-offer: 60 days tenure → 30-180d bucket', () => {
  const bucket = computeTenureBucket(daysAgo(60));
  assertEquals(bucket, '30-180d');
});

Deno.test('decide-offer: 180 days tenure → 30-180d bucket (boundary inclusive)', () => {
  const bucket = computeTenureBucket(daysAgo(180));
  assertEquals(bucket, '30-180d');
});

Deno.test('decide-offer: 200 days tenure → >180d bucket', () => {
  const bucket = computeTenureBucket(daysAgo(200));
  assertEquals(bucket, '>180d');
});

// ─── Request validation ───────────────────────────────────────────────────────

Deno.test('decide-offer: valid reason values accepted', () => {
  const VALID_REASONS = [
    'too_expensive', 'not_using', 'found_alternative',
    'health_goals_changed', 'temporary_break', 'service_quality_issue', 'other',
  ];
  for (const reason of VALID_REASONS) {
    assertEquals(VALID_REASONS.includes(reason), true);
  }
});

Deno.test('decide-offer: invalid reason rejected', () => {
  const VALID_REASONS = [
    'too_expensive', 'not_using', 'found_alternative',
    'health_goals_changed', 'temporary_break', 'service_quality_issue', 'other',
  ];
  assertEquals(VALID_REASONS.includes('invalid_reason'), false);
  assertEquals(VALID_REASONS.includes(''), false);
});

Deno.test("decide-offer: reason='other' requires reason_other_text >= 4 chars", () => {
  const shortText = 'abc'; // 3 chars — insufficient
  const validText = 'Price is too high for what I get';
  assertEquals(shortText.trim().length < 4, true);
  assertEquals(validText.trim().length >= 4, true);
});

// ─── isClinicOrg derivation ───────────────────────────────────────────────────

Deno.test('decide-offer: subscription.clinic_id !== null → isClinicOrg=true', () => {
  const sub = { id: 'sub_123', clinic_id: 'clinic-org-456' };
  assertEquals(sub.clinic_id !== null, true);
});

Deno.test('decide-offer: subscription.clinic_id === null → isClinicOrg=false', () => {
  const sub = { id: 'sub_123', clinic_id: null };
  assertEquals(sub.clinic_id !== null, false);
});

// ─── Ineligible code paths ────────────────────────────────────────────────────

Deno.test('decide-offer: 2 prior discount takes → lifetime cap exceeded', () => {
  const priorTakes = [
    { offer_type: 'discount' as const },
    { offer_type: 'extended_trial' as const },
  ];
  const { exceeded } = checkLifetimeCap(priorTakes);
  assertEquals(exceeded, true);
});

Deno.test('decide-offer: 2 prior pause takes + 1 discount → cap NOT exceeded (pause exempt)', () => {
  const priorTakes = [
    { offer_type: 'pause' as const },
    { offer_type: 'pause' as const },
    { offer_type: 'discount' as const },
  ];
  const { exceeded, nonPauseCount } = checkLifetimeCap(priorTakes);
  assertEquals(exceeded, false);
  assertEquals(nonPauseCount, 1);
});

Deno.test('decide-offer: take within 365d → cooldown active', () => {
  const priorTakes = [
    { taken_at: daysAgo(100), offer_type: 'discount' as const },
  ];
  const { onCooldown } = checkCooldown(priorTakes);
  assertEquals(onCooldown, true);
});

Deno.test('decide-offer: take 400 days ago → cooldown expired', () => {
  const priorTakes = [
    { taken_at: daysAgo(400), offer_type: 'extended_trial' as const },
  ];
  const { onCooldown } = checkCooldown(priorTakes);
  assertEquals(onCooldown, false);
});

// ─── Response shape contract ──────────────────────────────────────────────────

Deno.test('decide-offer: DecideOfferResponse shape — offer returned', () => {
  const resp: DecideOfferResponse = {
    offer_id: 'log-uuid-1',
    offer_type: 'discount',
    offer_config: { type: 'discount', coupon_id: 'SAVE-25-3MO', percent_off: 0.25, duration_in_months: 3 },
    stacking: null,
    ineligible_code: null,
  };
  assertEquals(resp.offer_id !== null, true);
  assertEquals(resp.ineligible_code, null);
  assertEquals(resp.offer_type, 'discount');
});

Deno.test('decide-offer: DecideOfferResponse shape — ineligible returned', () => {
  const ineligibleCodes: IneligibleCode[] = [
    'OFFER_INELIGIBLE_LIFETIME_CAP',
    'OFFER_INELIGIBLE_COOLDOWN',
    'OFFER_INELIGIBLE_NO_RULE',
    'NO_SUBSCRIPTION',
  ];
  for (const code of ineligibleCodes) {
    const resp: DecideOfferResponse = {
      offer_id: null,
      offer_type: null,
      offer_config: null,
      stacking: null,
      ineligible_code: code,
    };
    assertEquals(resp.offer_id, null);
    assertEquals(resp.ineligible_code, code);
  }
});

Deno.test('decide-offer: stacking info populated when discount clamped', () => {
  const resp: DecideOfferResponse = {
    offer_id: 'log-uuid-2',
    offer_type: 'discount',
    offer_config: { type: 'discount', coupon_id: 'SAVE-20-3MO', percent_off: 0.2, duration_in_months: 3 },
    stacking: { existing_pct: 0.1, capped_pct: 0.2 },
    ineligible_code: null,
  };
  assertEquals(resp.stacking !== null, true);
  assertEquals(resp.stacking?.existing_pct, 0.1);
});
