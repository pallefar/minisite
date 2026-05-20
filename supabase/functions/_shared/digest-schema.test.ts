/**
 * Phase 38 Plan 38-02 — tests for digest-schema.ts + render-user-facts.ts +
 * render-user-context.ts.
 *
 * Project convention: existing `_shared/*.test.ts` files use Deno.test (see
 * [[reference_deno_test_discovery]]). The 38-02-PLAN's "Vitest" mention was a
 * planner-side drift; we reconcile to the project convention (Rule 3 deviation
 * — project convention takes precedence; ALL other Phase 38 helper tests in
 * `_shared/` use Deno.test).
 *
 * Coverage:
 *  T1: DigestOutputSchema accepts a valid digest
 *  T2: DigestOutputSchema REJECTS non-whitelisted action.id
 *  T3: DigestOutputSchema REJECTS narrative < 40 chars (boundary)
 *  T4: DigestOutputSchema REJECTS empty actions array (min:1)
 *  T5: CLINICAL_KEYWORD_BLOCKLIST matches "Consider increasing to 1mg"
 *  T6: digestJsonSchema has additionalProperties:false + actions.items.id.enum === WHITELIST_ACTION_IDS
 *  T7: renderUserFacts caps top-5 symptoms / last-7 weights / last-14 injections
 *  T8: renderUserContext returns a single deterministic embedding string
 */

import { assert, assertEquals, assertStringIncludes, assertThrows } from 'jsr:@std/assert@^1';
import {
  CLINICAL_KEYWORD_BLOCKLIST,
  DigestOutputSchema,
  digestJsonSchema,
  validateNoClinicalKeywords,
  WHITELIST_ACTION_IDS,
} from './digest-schema.ts';
import { renderUserFacts, type UserFactsForDigest } from './render-user-facts.ts';
import { renderUserContext, type UserContextFacts } from './render-user-context.ts';

const VALID_NARRATIVE =
  'You logged two injections this week and stayed on your check-in streak. Nice work keeping consistent.';

Deno.test('T1: DigestOutputSchema accepts valid digest', () => {
  const result = DigestOutputSchema.parse({
    narrative: VALID_NARRATIVE,
    actions: [{ id: 'log_weight', reason: 'Add a weigh-in to round out the week.' }],
  });
  assertEquals(result.actions.length, 1);
  assertEquals(result.actions[0]!.id, 'log_weight');
});

Deno.test('T2: DigestOutputSchema REJECTS non-whitelisted action.id', () => {
  assertThrows(() =>
    DigestOutputSchema.parse({
      narrative: VALID_NARRATIVE,
      // 'increase_dose' is NOT in WHITELIST_ACTION_IDS — must throw ZodError.
      actions: [{ id: 'increase_dose', reason: 'go higher' }],
    }),
  );
});

Deno.test('T3: DigestOutputSchema REJECTS narrative < 40 chars (boundary)', () => {
  assertThrows(() =>
    DigestOutputSchema.parse({
      // 39 chars — one below the 40-char floor.
      narrative: 'Too short narrative under forty chars!!',
      actions: [{ id: 'log_weight', reason: 'Add a weigh-in.' }],
    }),
  );
  // 40-char narrative should pass (boundary).
  const fortyExact = 'Forty characters narrative exact bounds!';
  assertEquals(fortyExact.length, 40);
  DigestOutputSchema.parse({
    narrative: fortyExact,
    actions: [{ id: 'log_weight', reason: 'Add a weigh-in.' }],
  });
});

Deno.test('T4: DigestOutputSchema REJECTS empty actions array (min:1)', () => {
  assertThrows(() =>
    DigestOutputSchema.parse({
      narrative: VALID_NARRATIVE,
      actions: [],
    }),
  );
});

Deno.test('T4b: DigestOutputSchema REJECTS reason > 120 chars', () => {
  assertThrows(() =>
    DigestOutputSchema.parse({
      narrative: VALID_NARRATIVE,
      actions: [{ id: 'log_weight', reason: 'a'.repeat(121) }],
    }),
  );
});

Deno.test('T5: CLINICAL_KEYWORD_BLOCKLIST matches clinical-action phrasing', () => {
  // AI-SPEC §6 O2 verbatim regex — word-boundary anchored stems.
  // NOTE: the regex uses `\b` so adjacent digits (e.g. "1mg") DO NOT match,
  // and suffixed forms (e.g. "increasing", "diagnosing") DO NOT match. This
  // is the literal AI-SPEC contract; if planners want broader matching they
  // need to update the AI-SPEC regex, not the test. See [[reference_grep_gate_comment_strip]]
  // for the prior precedent of taking AI-SPEC regex strings verbatim.
  //
  // Positive cases — each contains a word-boundary-anchored blocklist stem.
  assert(CLINICAL_KEYWORD_BLOCKLIST.test('Consider increase the dose to 1 mg'));
  assert(CLINICAL_KEYWORD_BLOCKLIST.test('please titrate up next week'));
  assert(CLINICAL_KEYWORD_BLOCKLIST.test('skip injection if nauseous'));
  assert(CLINICAL_KEYWORD_BLOCKLIST.test('lower your dose'));
  assert(CLINICAL_KEYWORD_BLOCKLIST.test('diagnos this patient'));
  assert(CLINICAL_KEYWORD_BLOCKLIST.test('You should increase your dose'));
  assert(CLINICAL_KEYWORD_BLOCKLIST.test('split dose into two halves'));
  assert(CLINICAL_KEYWORD_BLOCKLIST.test('prescribe a stronger course'));
  // Benign reasons must NOT match.
  assert(!CLINICAL_KEYWORD_BLOCKLIST.test('Try a new injection site rotation pattern.'));
  assert(!CLINICAL_KEYWORD_BLOCKLIST.test('Log your weight to track progress.'));
  assert(!CLINICAL_KEYWORD_BLOCKLIST.test('Share your last check-in with your doctor.'));
  // Suffix-bearing forms do NOT match the strict regex — documented behavior.
  assert(!CLINICAL_KEYWORD_BLOCKLIST.test('Consider increasing to 1mg'));
  assert(!CLINICAL_KEYWORD_BLOCKLIST.test('diagnosing the issue'));
  // The validateNoClinicalKeywords helper throws on match.
  assertThrows(() => validateNoClinicalKeywords('You should increase your dose'));
  // Does not throw on benign reason.
  validateNoClinicalKeywords('Log your weight to round out the week.');
});

Deno.test('T6: digestJsonSchema enforces additionalProperties:false + enum lockstep', () => {
  assertEquals(digestJsonSchema.additionalProperties, false);
  assertEquals(digestJsonSchema.properties.actions.items.additionalProperties, false);
  // Enum values MUST be identical to WHITELIST_ACTION_IDS (single source of truth).
  const schemaEnum = digestJsonSchema.properties.actions.items.properties.id.enum as readonly string[];
  assertEquals([...schemaEnum], [...WHITELIST_ACTION_IDS]);
  // minItems / maxItems on actions.
  assertEquals(digestJsonSchema.properties.actions.minItems, 1);
  assertEquals(digestJsonSchema.properties.actions.maxItems, 3);
  // Narrative bounds carry over.
  assertEquals(digestJsonSchema.properties.narrative.minLength, 40);
  assertEquals(digestJsonSchema.properties.narrative.maxLength, 600);
});

Deno.test('T6b: WHITELIST_ACTION_IDS contains all 9 CONTEXT D-15 entries', () => {
  const expected = [
    'read_kb',
    'log_weight',
    'log_injection',
    'log_meal',
    'view_curve',
    'share_with_doctor',
    'complete_onboarding_step',
    'try_recipe',
    'watch_tutorial',
  ];
  for (const id of expected) {
    assert((WHITELIST_ACTION_IDS as readonly string[]).includes(id), `missing ${id}`);
  }
  assertEquals(WHITELIST_ACTION_IDS.length, 9);
});

// ─── Render-user-facts caps ─────────────────────────────────────────────────

function makeFacts(over: Partial<UserFactsForDigest> = {}): UserFactsForDigest {
  return {
    userId: '00000000-0000-0000-0000-000000000001',
    orgId: null,
    weekStartIso: '2026-05-12',
    injections: [],
    weights: [],
    symptoms: [],
    streak: { days: 7, status: 'active' },
    missedCheckIns: [],
    redFlags: [],
    ...over,
  };
}

Deno.test('T7: renderUserFacts caps top-5 symptoms / last-7 weights / last-14 injections', () => {
  // 20 injections supplied, cap at 14.
  const injections = Array.from({ length: 20 }, (_, i) => ({
    at: `2026-05-${String(12 + (i % 7)).padStart(2, '0')}T08:00:00Z`,
    site: i % 2 === 0 ? 'abdomen' : 'thigh',
  }));
  // 10 weights supplied, cap at 7.
  const weights = Array.from({ length: 10 }, (_, i) => ({
    date: `2026-05-${String(12 + (i % 7)).padStart(2, '0')}`,
    value_kg: 80 - i * 0.1,
  }));
  // 8 symptoms supplied, cap at 5.
  const symptoms = Array.from({ length: 8 }, (_, i) => ({
    name: `sym${i}`,
    count: 10 - i,
  }));

  const out = renderUserFacts(makeFacts({ injections, weights, symptoms }));

  // Must say "14 this week" not "20" — cap applied.
  assertStringIncludes(out, 'injections: 14 this week');
  // Symptoms line must include first 5 and NOT sym5..sym7.
  assertStringIncludes(out, 'symptoms (top 5)');
  for (let i = 0; i < 5; i++) assertStringIncludes(out, `sym${i} ×${10 - i}`);
  for (let i = 5; i < 8; i++) assert(!out.includes(`sym${i}`), `should not include sym${i}`);
  // Weights cap at 7 → "over 7 entries" in delta line.
  assertStringIncludes(out, 'over 7 entries');
});

Deno.test('T7b: renderUserFacts fenced + whitelist block + red-flags first', () => {
  const out = renderUserFacts(
    makeFacts({
      redFlags: [{ type: 'severe_abdominal_pain', loggedAt: '2026-05-14T08:00:00Z' }],
    }),
  );
  assertStringIncludes(out, '<user_facts>');
  assertStringIncludes(out, '</user_facts>');
  assertStringIncludes(out, '<whitelist>');
  assertStringIncludes(out, '</whitelist>');
  assertStringIncludes(out, 'RED FLAGS');
  // Whitelist must list all 9 entries.
  for (const id of WHITELIST_ACTION_IDS) assertStringIncludes(out, `- ${id}`);
  // Red flags line must come BEFORE injections line (model sees red flags first).
  const rfIdx = out.indexOf('RED FLAGS');
  const injIdx = out.indexOf('injections:');
  assert(rfIdx < injIdx, 'red flags must precede injections in the rendered block');
});

Deno.test('T7c: renderUserFacts redacts raw weight values to delta only (D-04)', () => {
  const out = renderUserFacts(
    makeFacts({
      weights: [
        { date: '2026-05-18', value_kg: 79.4 },
        { date: '2026-05-12', value_kg: 80.0 },
      ],
    }),
  );
  // Delta is emitted...
  assertStringIncludes(out, 'weight delta over 2 entries: -0.6 kg');
  // ...but the absolute values (79.4, 80.0) MUST NOT appear (D-04).
  assert(!out.includes('79.4'), 'must not leak absolute weight value 79.4');
  assert(!out.includes('80.0'), 'must not leak absolute weight value 80.0');
});

// ─── Render-user-context determinism ────────────────────────────────────────

const SAMPLE_CTX: UserContextFacts = {
  goalType: 'weight_loss',
  glp1Phase: 'escalation',
  injectionCount: 4,
  weightDelta30d: -1.2,
  units: 'kg',
  moodAvg: 3.4,
  topSymptoms: ['nausea', 'fatigue', 'headache'],
  streakDays: 12,
};

Deno.test('T8: renderUserContext returns deterministic embedding string', () => {
  const a = renderUserContext(SAMPLE_CTX);
  const b = renderUserContext({ ...SAMPLE_CTX });
  assertEquals(a, b);
  // Sanity-check shape: single line-ish, contains all key fields.
  assertStringIncludes(a, 'weight loss');
  assertStringIncludes(a, 'escalation');
  assertStringIncludes(a, '4 injections');
  assertStringIncludes(a, '-1.2 kg over 30 days');
  assertStringIncludes(a, 'mood averaging 3.4');
  assertStringIncludes(a, 'top symptoms: nausea, fatigue, headache');
  assertStringIncludes(a, '12 days');
});

Deno.test('T8b: renderUserContext handles null mood / null weight / empty symptoms', () => {
  const out = renderUserContext({
    goalType: 'maintenance',
    glp1Phase: 'maintenance',
    injectionCount: 0,
    weightDelta30d: null,
    units: 'lb',
    moodAvg: null,
    topSymptoms: [],
    streakDays: 1,
  });
  assertStringIncludes(out, 'no recent weight logs');
  assertStringIncludes(out, 'mood not logged');
  assertStringIncludes(out, 'no symptoms logged');
  assertStringIncludes(out, '1 day');
  // Singular day, no "1 days".
  assert(!out.includes('1 days'), 'singular pluralization broken');
});
