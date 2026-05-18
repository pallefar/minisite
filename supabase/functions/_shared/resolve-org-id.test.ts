/**
 * Tests for resolve-org-id.ts — Phase 25 Plan 25-04 (HIPAA-07).
 *
 * v1.3 contract: resolveOrgId always returns null (Phase 28 forward-compat stub).
 * After Phase 28 ships clinic_patients, this test should be replaced with a
 * fixture-based test that verifies org_id lookup from the DB.
 */

import { resolveOrgId } from './resolve-org-id.ts';
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';

// Minimal mock admin client — resolveOrgId doesn't use it at v1.3.
const mockAdmin = {} as SupabaseClient;

Deno.test('resolveOrgId - returns null for any userId at v1.3 (stub)', async (t) => {
  await t.step('returns null for a real-looking UUID', async () => {
    const result = await resolveOrgId(mockAdmin, '00000000-0000-0000-0000-000000000001');
    if (result !== null) {
      throw new Error(`Expected null, got ${JSON.stringify(result)}`);
    }
  });

  await t.step('returns null for empty string userId', async () => {
    const result = await resolveOrgId(mockAdmin, '');
    if (result !== null) {
      throw new Error(`Expected null, got ${JSON.stringify(result)}`);
    }
  });

  await t.step('returns null for arbitrary string userId', async () => {
    const result = await resolveOrgId(mockAdmin, 'some-arbitrary-user-id');
    if (result !== null) {
      throw new Error(`Expected null, got ${JSON.stringify(result)}`);
    }
  });
});

// Phase 28 placeholder — when clinic_patients ships, replace this with a
// fixture-based test that creates a patient record and verifies org_id is returned.
// see deferred-tests.md#resolve-org-id-phase28
Deno.test.ignore(
  '[DEFERRED Phase 28] resolveOrgId returns org_id when clinic_patients row exists',
  async () => {
    // TODO Phase 28: seed a clinic_patients row, assert resolveOrgId returns the org_id.
    // Example:
    //   const { data: patient } = await admin.from('clinic_patients').insert({
    //     patient_user_id: testUserId,
    //     org_id: testOrgId,
    //   }).select().single();
    //   const result = await resolveOrgId(admin, testUserId);
    //   assertEquals(result, testOrgId);
    throw new Error('Phase 28 fixture test not yet implemented');
  },
);
