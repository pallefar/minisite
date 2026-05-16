/**
 * Phase 22 plan 22-01 Wave 0 scaffold — admin-impersonate Edge Function (ADMIN-03).
 * Owner of impl: plan 22-04.
 *
 * Behaviors deferred (DEFERRED — see plan 22-04):
 *   T1 non-staff caller → 403 forbidden
 *   T2 happy path mints JWT via admin.updateUserById + generateLink
 *   T3 writes impersonate_start audit row (impersonator_id, target_user_id, action)
 *   T4 end action clears app_metadata.impersonator_id + writes impersonate_end audit row
 *   T5 A1 propagation assumption — verifies updateUserById metadata appears in next JWT
 */
import { assertEquals } from 'jsr:@std/assert@^1';

Deno.test('admin-impersonate Wave 0 scaffold', () => {
  // DEFERRED — Wave 0 placeholder. Real tests land in plan 22-04.
  assertEquals(true, true);
});

// Wave 0 scaffold per .planning/phases/22-…/22-RESEARCH.md §Validation Architecture — DEFERRED implementation owner: 22-04
