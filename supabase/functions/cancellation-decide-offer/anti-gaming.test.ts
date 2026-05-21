/**
 * Phase 40 Plan 40-03 — anti-gaming unit tests.
 *
 * Tests:
 *   VALIDATION rows 40-03-T1b (D-02 lifetime cap)
 *   VALIDATION rows 40-03-T1c (D-03 cooldown)
 *   VALIDATION rows 40-03-T1f (D-15 clampSavePct — 5 scenarios)
 *
 * Per PATTERNS §"Pitfall 5": explicit Deno.test blocks, no shared state.
 * Run: $HOME/.deno/bin/deno test --no-check supabase/functions/cancellation-decide-offer/anti-gaming.test.ts
 */

import {
  assertEquals,
  assertAlmostEquals,
} from 'https://deno.land/std@0.224.0/assert/mod.ts';
import {
  clampSavePct,
  checkLifetimeCap,
  checkCooldown,
  applyTenureGate,
  STACKING_CAP_EFFECTIVE,
} from './anti-gaming.ts';

// ─── clampSavePct tests (D-15) ───────────────────────────────────────────────

Deno.test('clampSavePct: no existing discount, 25% save — under cap, not clamped', () => {
  // Scenario: no affiliate coupon (existingPct=0), save=0.25
  // preEffective = 1 - (1-0)(1-0.25) = 0.25 ≤ 0.35 → not clamped
  const result = clampSavePct(0, 0.25);
  assertEquals(result.clamped, false);
  assertAlmostEquals(result.finalSavePct, 0.25, 0.001);
  assertAlmostEquals(result.preClampEffective, 0.25, 0.001);
  assertAlmostEquals(result.postClampEffective, 0.25, 0.001);
});

Deno.test('clampSavePct: 10% affiliate + 25% save — under cap (32.5%), not clamped', () => {
  // Scenario: existing=0.1, save=0.25
  // preEffective = 1 - (1-0.1)(1-0.25) = 1 - 0.9*0.75 = 1 - 0.675 = 0.325 ≤ 0.35 → not clamped
  const result = clampSavePct(0.1, 0.25);
  assertEquals(result.clamped, false);
  assertAlmostEquals(result.finalSavePct, 0.25, 0.001);
  assertAlmostEquals(result.preClampEffective, 0.325, 0.001);
  assertAlmostEquals(result.postClampEffective, 0.325, 0.001);
});

Deno.test('clampSavePct: 10% affiliate + 30% save — over cap (37%), clamped to 35%', () => {
  // Scenario: existing=0.1, save=0.30
  // preEffective = 1 - (1-0.1)(1-0.3) = 1 - 0.9*0.7 = 1 - 0.63 = 0.37 > 0.35 → clamped
  // finalSavePct = 1 - (1-0.35)/(1-0.1) = 1 - 0.65/0.9 = 1 - 0.7222 = 0.2778
  const result = clampSavePct(0.1, 0.30);
  assertEquals(result.clamped, true);
  assertAlmostEquals(result.finalSavePct, 0.2778, 0.001);
  assertAlmostEquals(result.preClampEffective, 0.37, 0.001);
  assertAlmostEquals(result.postClampEffective, STACKING_CAP_EFFECTIVE, 0.001);
});

Deno.test('clampSavePct: existing 40% (above cap) — finalSavePct = 0 (offer cannot beat cap)', () => {
  // Scenario: existingPct >= STACKING_CAP_EFFECTIVE → any save would raise combined further
  // finalSavePct = max(0, 1 - (1-0.35)/(1-0.40)) = max(0, 1 - 0.65/0.60) = max(0, 1 - 1.0833) = max(0, -0.0833) = 0
  const result = clampSavePct(0.40, 0.25);
  assertEquals(result.clamped, true);
  assertAlmostEquals(result.finalSavePct, 0, 0.001);
  // postClampEffective = STACKING_CAP_EFFECTIVE
  assertAlmostEquals(result.postClampEffective, STACKING_CAP_EFFECTIVE, 0.001);
});

Deno.test('clampSavePct: edge case existing=0, save=0.35 — exactly at cap boundary, not clamped', () => {
  // preEffective = 0.35 == STACKING_CAP_EFFECTIVE → not clamped (≤ boundary)
  const result = clampSavePct(0, 0.35);
  assertEquals(result.clamped, false);
  assertAlmostEquals(result.finalSavePct, 0.35, 0.001);
  assertAlmostEquals(result.preClampEffective, 0.35, 0.001);
});

// ─── checkLifetimeCap tests (D-02) ──────────────────────────────────────────

Deno.test('checkLifetimeCap: 2 non-pause takes — exceeded=true', () => {
  const result = checkLifetimeCap([
    { offer_type: 'discount' },
    { offer_type: 'extended_trial' },
  ]);
  assertEquals(result.exceeded, true);
  assertEquals(result.nonPauseCount, 2);
});

Deno.test('checkLifetimeCap: 1 non-pause + 5 pauses — exceeded=false (pauses exempt)', () => {
  // D-02: pause does NOT count toward lifetime cap
  const result = checkLifetimeCap([
    { offer_type: 'discount' },
    { offer_type: 'pause' },
    { offer_type: 'pause' },
    { offer_type: 'pause' },
    { offer_type: 'pause' },
    { offer_type: 'pause' },
  ]);
  assertEquals(result.exceeded, false);
  assertEquals(result.nonPauseCount, 1);
});

Deno.test('checkLifetimeCap: 0 takes — exceeded=false', () => {
  const result = checkLifetimeCap([]);
  assertEquals(result.exceeded, false);
  assertEquals(result.nonPauseCount, 0);
});

Deno.test('checkLifetimeCap: 3 non-pause takes — exceeded=true', () => {
  const result = checkLifetimeCap([
    { offer_type: 'discount' },
    { offer_type: 'extended_trial' },
    { offer_type: 'downgrade' },
  ]);
  assertEquals(result.exceeded, true);
  assertEquals(result.nonPauseCount, 3);
});

// ─── checkCooldown tests (D-03) ──────────────────────────────────────────────

Deno.test('checkCooldown: most-recent non-pause take 30 days ago — onCooldown=true', () => {
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const result = checkCooldown([
    { taken_at: thirtyDaysAgo.toISOString(), offer_type: 'discount' },
  ]);
  assertEquals(result.onCooldown, true);
  assertEquals(result.lastTakenAt, thirtyDaysAgo.toISOString());
});

Deno.test('checkCooldown: most-recent non-pause take 400 days ago — onCooldown=false', () => {
  const fourHundredDaysAgo = new Date();
  fourHundredDaysAgo.setDate(fourHundredDaysAgo.getDate() - 400);
  const result = checkCooldown([
    { taken_at: fourHundredDaysAgo.toISOString(), offer_type: 'extended_trial' },
  ]);
  assertEquals(result.onCooldown, false);
});

Deno.test('checkCooldown: only pause takes — onCooldown=false (pause exempt from cooldown)', () => {
  const recentDate = new Date();
  recentDate.setDate(recentDate.getDate() - 5);
  const result = checkCooldown([
    { taken_at: recentDate.toISOString(), offer_type: 'pause' },
  ]);
  assertEquals(result.onCooldown, false);
  assertEquals(result.lastTakenAt, null);
});

Deno.test('checkCooldown: empty takes — onCooldown=false', () => {
  const result = checkCooldown([]);
  assertEquals(result.onCooldown, false);
  assertEquals(result.lastTakenAt, null);
});

// ─── applyTenureGate tests (D-01) ────────────────────────────────────────────

Deno.test("applyTenureGate: '<30d' + extended_trial → false", () => {
  assertEquals(applyTenureGate('<30d', 'extended_trial'), false);
});

Deno.test("applyTenureGate: '<30d' + downgrade → false", () => {
  assertEquals(applyTenureGate('<30d', 'downgrade'), false);
});

Deno.test("applyTenureGate: '<30d' + pause → true", () => {
  assertEquals(applyTenureGate('<30d', 'pause'), true);
});

Deno.test("applyTenureGate: '<30d' + discount → true", () => {
  assertEquals(applyTenureGate('<30d', 'discount'), true);
});

Deno.test("applyTenureGate: '30-180d' + extended_trial → true", () => {
  assertEquals(applyTenureGate('30-180d', 'extended_trial'), true);
});

Deno.test("applyTenureGate: '30-180d' + downgrade → true", () => {
  assertEquals(applyTenureGate('30-180d', 'downgrade'), true);
});

Deno.test("applyTenureGate: '>180d' + extended_trial → false", () => {
  assertEquals(applyTenureGate('>180d', 'extended_trial'), false);
});

Deno.test("applyTenureGate: '>180d' + pause → true", () => {
  assertEquals(applyTenureGate('>180d', 'pause'), true);
});

Deno.test("applyTenureGate: '>180d' + downgrade → true", () => {
  assertEquals(applyTenureGate('>180d', 'downgrade'), true);
});

Deno.test('applyTenureGate: contact_csm always eligible regardless of tenure', () => {
  assertEquals(applyTenureGate('<30d', 'contact_csm'), true);
  assertEquals(applyTenureGate('30-180d', 'contact_csm'), true);
  assertEquals(applyTenureGate('>180d', 'contact_csm'), true);
});
