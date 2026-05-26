/**
 * posthog-rag-events.test.ts — Deno tests for _shared/posthog-rag-events.ts
 *
 * Phase 60 Plan 60-02.
 *
 * Tests use the no-op path (POSTHOG_PROJECT_KEY absent) to verify routing
 * and PHI scrub logic without network access or real PostHog clients.
 *
 * Behaviors tested:
 *  1. emitAiGeneration no-ops when POSTHOG_PROJECT_KEY absent (valid userId).
 *  2. emitAiGeneration throws when userId is empty string (D-13 invariant).
 *  3. _testScrubProperties strips PHI fields (user_id, patient_id, email, phone).
 *  4. emitCostEnvelopeBreach succeeds without userId (system-attributed event).
 */

import { assertEquals, assertThrows } from 'https://deno.land/std@0.224.0/assert/mod.ts';

Deno.test('1. emitAiGeneration no-ops when POSTHOG_PROJECT_KEY absent (valid userId)', async () => {
  const origKey = Deno.env.get('POSTHOG_PROJECT_KEY');
  Deno.env.delete('POSTHOG_PROJECT_KEY');

  // Ensure SUPABASE_URL / SERVICE_ROLE_KEY absent so mirror no-ops cleanly
  const origUrl = Deno.env.get('SUPABASE_URL');
  const origSrk = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  Deno.env.delete('SUPABASE_URL');
  Deno.env.delete('SUPABASE_SERVICE_ROLE_KEY');

  try {
    const { emitAiGeneration, shutdownPostHog } = await import('./posthog-rag-events.ts');

    // Should NOT throw — userId is valid, just no-op since key missing
    emitAiGeneration({
      userId: 'u1',
      properties: {
        model: 'claude-sonnet-4-6',
        trace_id: 't1',
        usage_total_cost: 0.012,
        prompt_tokens: 500,
        completion_tokens: 200,
      },
    });

    await shutdownPostHog();
    assertEquals(true, true, 'emitAiGeneration should not throw when POSTHOG_PROJECT_KEY absent');
  } finally {
    if (origKey) Deno.env.set('POSTHOG_PROJECT_KEY', origKey);
    if (origUrl) Deno.env.set('SUPABASE_URL', origUrl);
    if (origSrk) Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', origSrk);
  }
});

Deno.test('2. emitAiGeneration throws when userId is empty string (D-13 invariant)', async () => {
  const { emitAiGeneration } = await import('./posthog-rag-events.ts');

  assertThrows(
    () => {
      emitAiGeneration({
        userId: '' as string,
        properties: {
          model: 'claude-sonnet-4-6',
          trace_id: 't2',
        },
      });
    },
    Error,
    'userId required',
  );
});

Deno.test('3. _testScrubProperties strips PHI fields (user_id, patient_id, email, phone)', async () => {
  const { _testScrubProperties } = await import('./posthog-rag-events.ts');

  const input = {
    user_id: 'leaked-pii',
    patient_id: 'p-123',
    email: 'user@example.com',
    phone: '+1-555-0100',
    refusal_reason: 'out_of_corpus',
    surface: 'coach',
    trace_id: 't1',
    model: 'claude-sonnet-4-6',
  };

  const scrubbed = _testScrubProperties(input);

  assertEquals('user_id' in scrubbed, false, 'user_id must be scrubbed');
  assertEquals('patient_id' in scrubbed, false, 'patient_id must be scrubbed');
  assertEquals('email' in scrubbed, false, 'email must be scrubbed');
  assertEquals('phone' in scrubbed, false, 'phone must be scrubbed');
  // Non-PHI fields must remain
  assertEquals(scrubbed.refusal_reason, 'out_of_corpus');
  assertEquals(scrubbed.surface, 'coach');
  assertEquals(scrubbed.trace_id, 't1');
  assertEquals(scrubbed.model, 'claude-sonnet-4-6');
});

Deno.test('4. emitCostEnvelopeBreach succeeds without userId (system-attributed event)', async () => {
  const origKey = Deno.env.get('POSTHOG_PROJECT_KEY');
  Deno.env.delete('POSTHOG_PROJECT_KEY');

  const origUrl = Deno.env.get('SUPABASE_URL');
  const origSrk = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  Deno.env.delete('SUPABASE_URL');
  Deno.env.delete('SUPABASE_SERVICE_ROLE_KEY');

  try {
    const { emitCostEnvelopeBreach, shutdownPostHog } = await import('./posthog-rag-events.ts');

    // Must NOT throw — no userId required for system-attributed events
    emitCostEnvelopeBreach({
      properties: {
        scope: 'per_cron',
        cron_kind: 'tip_of_day',
        cost_usd: 0.62,
        envelope_usd: 0.50,
        trace_id: 't2',
      },
      // userId explicitly omitted
    });

    await shutdownPostHog();
    assertEquals(true, true, 'emitCostEnvelopeBreach must not throw without userId');
  } finally {
    if (origKey) Deno.env.set('POSTHOG_PROJECT_KEY', origKey);
    if (origUrl) Deno.env.set('SUPABASE_URL', origUrl);
    if (origSrk) Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', origSrk);
  }
});
