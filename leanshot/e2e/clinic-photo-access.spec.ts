// Phase 9 Plan 09-01 Wave-0 scaffold for clinic-photo Edge Function access drill.
//
// Plan 09-07 owns the green implementation + the D-12 three-check gate.
import { test } from '@playwright/test';

test.fixme(
  'clinic-photo Edge Function: revoked membership returns 401; consent_scope.photos respected — Plan 09-07 implements',
  async () => {
    // D-12 three-check gate:
    //   1. Operator with patient_photos.read + patient with consent_scope.photos=true → 200 + signed URL (5min TTL).
    //   2. Operator without patient_photos.read role → 403.
    //   3. Patient consent_scope.photos=false → 403 'consent_excluded'.
    //   4. Patient revokes membership → subsequent fetch → 401.
    //   5. Already-issued URL works for up to 5min then 401 (D-13 tradeoff).
  },
);
