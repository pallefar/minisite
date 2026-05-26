/**
 * push-payload.test.ts — Deno unit tests for push-payload.ts
 *
 * Phase 60 Plan 60-11 Task 2 (TDD RED → GREEN).
 *
 * Verifies: title/body truncation, prescriptive-verb rejection,
 * equivalence-claim rejection, dose-number rejection, char limits.
 *
 * Run: $HOME/.deno/bin/deno test --no-check --allow-env push-payload.test.ts
 */

import {
  assertEquals,
  assertThrows,
} from 'https://deno.land/std@0.224.0/assert/mod.ts';

import {
  buildPushPayload,
  PUSH_TITLE_MAX,
  PUSH_BODY_MAX,
  TipPayloadRejected,
} from '../push-payload.ts';

// ──────────────────────────────────────────────────────────────────────────────
// Test 7: exported constants match UI-SPEC §7 hard caps
// ──────────────────────────────────────────────────────────────────────────────

Deno.test('PUSH_TITLE_MAX is 65', () => {
  assertEquals(PUSH_TITLE_MAX, 65);
});

Deno.test('PUSH_BODY_MAX is 240', () => {
  assertEquals(PUSH_BODY_MAX, 240);
});

// ──────────────────────────────────────────────────────────────────────────────
// Test 1: happy path — short title + body
// ──────────────────────────────────────────────────────────────────────────────

Deno.test('buildPushPayload returns correct title, body, deep_link for short inputs', () => {
  const result = buildPushPayload({
    headline: 'Short title',
    body_first_sentence: 'A short informational sentence.',
    topic: 'glp1',
    slug: 'titration',
  });
  assertEquals(result.title, "Today's tip: Short title");
  assertEquals(result.body, 'A short informational sentence. — LeanShot Research');
  assertEquals(result.deep_link, '/knowledge/glp1/titration');
});

// ──────────────────────────────────────────────────────────────────────────────
// Test 2: title truncation to 65 chars total
// ──────────────────────────────────────────────────────────────────────────────

Deno.test('title is truncated to PUSH_TITLE_MAX (65) chars including prefix', () => {
  // "Today's tip: " is 13 chars; max headline = 52 chars (65 - 13)
  // Provide a headline that is 60 chars — should be truncated to 51 chars + ellipsis
  const longHeadline = 'A'.repeat(60);
  const result = buildPushPayload({
    headline: longHeadline,
    body_first_sentence: 'Safe informational text here.',
    topic: 'glp1',
    slug: 'test',
  });
  assertEquals(result.title.length <= PUSH_TITLE_MAX, true);
});

// ──────────────────────────────────────────────────────────────────────────────
// Test 3: body truncation to 240 chars total
// ──────────────────────────────────────────────────────────────────────────────

Deno.test('body is truncated to PUSH_BODY_MAX (240) chars including suffix', () => {
  // ' — LeanShot Research' is 20 chars; max body_first_sentence = 220 chars
  const longSentence = 'B'.repeat(230);
  const result = buildPushPayload({
    headline: 'Short headline',
    body_first_sentence: longSentence,
    topic: 'glp1',
    slug: 'test',
  });
  assertEquals(result.body.length <= PUSH_BODY_MAX, true);
});

// ──────────────────────────────────────────────────────────────────────────────
// Test 4: prescriptive verb at sentence start throws
// ──────────────────────────────────────────────────────────────────────────────

Deno.test('buildPushPayload throws prescriptive_verb_rejected for "Take ..."', () => {
  assertThrows(
    () =>
      buildPushPayload({
        headline: 'Some headline',
        body_first_sentence: 'Take your medication as directed.',
        topic: 'glp1',
        slug: 'test',
      }),
    TipPayloadRejected,
    'prescriptive_verb_rejected',
  );
});

Deno.test('buildPushPayload throws prescriptive_verb_rejected for "increase dose"', () => {
  assertThrows(
    () =>
      buildPushPayload({
        headline: 'Some headline',
        body_first_sentence: 'Increase the dose after 4 weeks.',
        topic: 'glp1',
        slug: 'test',
      }),
    TipPayloadRejected,
    'prescriptive_verb_rejected',
  );
});

// ──────────────────────────────────────────────────────────────────────────────
// Test 5: equivalence claim throws
// ──────────────────────────────────────────────────────────────────────────────

Deno.test('buildPushPayload throws equivalence_claim_rejected for "equivalent to Ozempic"', () => {
  assertThrows(
    () =>
      buildPushPayload({
        headline: 'Compound claim',
        body_first_sentence: 'Compounded semaglutide equivalent to Ozempic shows similar profile.',
        topic: 'compounding',
        slug: 'test',
      }),
    TipPayloadRejected,
    'equivalence_claim_rejected',
  );
});

Deno.test('buildPushPayload throws equivalence_claim_rejected for "same as FDA-approved"', () => {
  assertThrows(
    () =>
      buildPushPayload({
        headline: 'Brand claim',
        body_first_sentence: 'This formulation is the same as FDA-approved brand.',
        topic: 'compounding',
        slug: 'test',
      }),
    TipPayloadRejected,
    'equivalence_claim_rejected',
  );
});

// ──────────────────────────────────────────────────────────────────────────────
// Test 6: dose number in push body throws
// ──────────────────────────────────────────────────────────────────────────────

Deno.test('buildPushPayload throws dose_number_in_push for "0.5mg" reference', () => {
  assertThrows(
    () =>
      buildPushPayload({
        headline: 'Dosing info',
        body_first_sentence: 'Clinical studies used 0.5mg weekly for 12 weeks.',
        topic: 'titration',
        slug: 'test',
      }),
    TipPayloadRejected,
    'dose_number_in_push',
  );
});

Deno.test('buildPushPayload throws dose_number_in_push for "2.4 mcg" reference', () => {
  assertThrows(
    () =>
      buildPushPayload({
        headline: 'Dose units',
        body_first_sentence: 'Patients received 2.4 mcg per injection site.',
        topic: 'titration',
        slug: 'test',
      }),
    TipPayloadRejected,
    'dose_number_in_push',
  );
});
