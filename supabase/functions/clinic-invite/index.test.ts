/**
 * Phase 9 Plan 09-01 Wave-0 Deno test scaffold for clinic-invite.
 *
 * Plan 09-06 ships the real Edge Function body + the corresponding
 * green tests. This scaffold exists so the Wave-0 test infrastructure
 * gate is green (Validation §"Wave 0 Requirements" → Edge Function
 * scaffolds). The deferred-test pattern from memory
 * `feedback_defer_then_batch_fix_pattern.md` keeps this file failing-
 * but-explicit rather than silently absent.
 *
 * File suffix is `.test.ts` per memory `reference_deno_test_discovery.md`
 * — Deno's directory-walk matches `{*_,*.,}test.*` only, NOT `*-test.ts`.
 *
 * Run: `cd supabase/functions/clinic-invite && deno task test`
 */
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { corsHeaders } from './cors.ts';

Deno.test('clinic-invite cors headers — wildcard origin (no credentials)', () => {
  assertEquals(corsHeaders['Access-Control-Allow-Origin'], '*');
  assertEquals(corsHeaders['Access-Control-Allow-Methods'], 'POST, OPTIONS');
});

Deno.test({
  name: 'clinic-invite lookup endpoint — Plan 09-06 owns implementation',
  ignore: true,
  fn: () => {
    // Plan 09-06 ships:
    //   - POST /clinic-invite/lookup { token_hash } → state machine
    //     branch (consent | signin_required | signup_required)
    //   - POST /clinic-invite/accept { token_hash, consent_scope }
    //   - POST /clinic-invite/reject { token_hash }
    // This scaffold is intentionally `ignore: true` until Plan 09-06.
  },
});
