/**
 * Phase 38 Plan 38-10 — Dim 10: Structured-output validation.
 *
 * AI-SPEC §5 Dim 10 (Critical):
 *   PASS: DigestOutputSchema.parse() succeeds on ≥99.5% of model calls
 *         (1-hour sliding window). At 20 samples that's 0/20 failures.
 *   FAIL: schema-validation failure rate > 0.5% over 1h → Sentry alert.
 *
 * Strategy: row R-19 schema-edge probe + 20 random clean digest calls.
 * The schema (mirrored inline below) MUST stay in sync with
 * supabase/functions/_shared/digest-schema.ts — both reference the same
 * WHITELIST_ACTION_IDS enum.
 *
 * For R-19's actions:[] boundary, the production retry-then-fallback path
 * is asserted via the response shape (either a parsed envelope OR a
 * fallback signal in body).
 */
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { callDigest } from '../_fixtures/digest-call.ts';
import { loadRefset, SHOULD_RUN_EVAL } from '../_fixtures/refset.ts';

const describeIfLive = SHOULD_RUN_EVAL ? describe : describe.skip;

const WHITELIST_ACTION_IDS = [
  'open_symptom_check',
  'log_weight',
  'log_injection',
  'log_meal',
  'view_curve',
  'share_with_doctor',
  'complete_onboarding_step',
  'try_recipe',
  'watch_tutorial',
] as const;

const DigestActionSchema = z.object({
  id: z.enum(WHITELIST_ACTION_IDS),
  reason: z.string().max(120),
});

const DigestOutputSchema = z.object({
  narrative: z.string().min(40).max(600),
  actions: z.array(DigestActionSchema).min(1).max(3),
});

describeIfLive('Phase 38 Plan 38-10 Dim 10 — schema-parse success rate', () => {
  const refset = loadRefset();
  const schemaProbe = refset.find((r) => r._schema_probe === 'actions_empty_array');

  it('R-19 schema-edge (actions:[]): retry-then-fallback', async () => {
    if (!schemaProbe) throw new Error('refset missing R-19 schema probe');
    const result = await callDigest(schemaProbe.user_facts);
    expect(result.ok, `digest call failed for R-19`).toBe(true);
    const body = result.body as { narrative?: string; actions?: unknown[]; _fallback?: boolean };
    // Either the schema parses successfully (model self-corrected on retry)
    // OR the response carries a _fallback signal (popularity baseline fired).
    const parsed = DigestOutputSchema.safeParse(body);
    expect(
      parsed.success || body._fallback === true,
      `R-19: neither valid schema nor fallback signal — body=${JSON.stringify(body).slice(0, 300)}`,
    ).toBe(true);
  });

  it('20 clean digest calls: ≥ 19/20 valid schema (99.5% gate ⇒ 0/20)', async () => {
    let failures = 0;
    const sampleSize = Math.min(20, refset.length);
    for (let i = 0; i < sampleSize; i++) {
      const row = refset[i]!;
      if (row._schema_probe) continue; // skip the boundary probe
      const result = await callDigest(row.user_facts);
      if (!result.ok) {
        failures += 1;
        continue;
      }
      const parsed = DigestOutputSchema.safeParse(result.body);
      if (!parsed.success) failures += 1;
    }
    // AI-SPEC §5: ≥99.5% on refset; at 20 samples that allows 0/20 failures.
    expect(
      failures,
      `schema-parse failures = ${failures}/${sampleSize} (gate: 0)`,
    ).toBeLessThanOrEqual(0);
  }, 300_000);
});
