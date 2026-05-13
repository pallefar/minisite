/**
 * Phase 9 Plan 09-01 Wave-0 Deno test scaffold for clinic-photo.
 *
 * Plan 09-07 ships the real Edge Function body + the corresponding
 * green tests. This scaffold exists so the Wave-0 test infrastructure
 * gate is green.
 *
 * File suffix is `.test.ts` per memory `reference_deno_test_discovery.md`.
 *
 * Run: `cd supabase/functions/clinic-photo && deno task test`
 */
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { corsHeaders } from './cors.ts';

Deno.test('clinic-photo cors headers — wildcard origin (no credentials)', () => {
  assertEquals(corsHeaders['Access-Control-Allow-Origin'], '*');
  assertEquals(corsHeaders['Access-Control-Allow-Methods'], 'GET, OPTIONS');
});

Deno.test({
  name: 'clinic-photo D-12 three-check gate — Plan 09-07 owns implementation',
  ignore: true,
  fn: () => {
    // Plan 09-07 ships:
    //   - GET /clinic-photo/{orgId}/{userId}/{photoId}
    //   - Three-check gate: operator active member + roles.has(patient_photos.read)
    //     + patient consent_scope.photos === true
    //   - 5-minute signed URL via supabase.storage.createSignedUrl (D-13)
    //   - log_clinic_event RPC writes 'clinic_photo_view' audit row
    // Scaffold ignored until Plan 09-07.
  },
});
