// Phase 8 Plan 08-01 Wave 0 scaffold — SC#5 / SHARE-02 print-mode disclaimer survival.
//
// Plan 08-06 implements: in the doctor's snapshot view, clicking Print
// (reuses DoctorReport.tsx + print stylesheet) renders the Phase 3 PK-04
// chart-overlaid "estimate, not measured" disclaimer in the print preview.
// Reduced-motion + print stylesheet interaction is platform-specific —
// Playwright emulates print via `page.emulateMedia({ media: 'print' })`.

import { test } from '@playwright/test';

test.describe('Phase 8 SC#5 — print mode preserves chart disclaimer', () => {
  test.skip('PK-04 disclaimer overlay survives print stylesheet', () => {
    // Plan 08-06 implements:
    //   - Open /share/<token>, enter code, snapshot renders
    //   - page.emulateMedia({ media: 'print' })
    //   - Assert chart-overlaid text "estimate, not measured" is visible
    //   - Assert MedLevelChart aria-label still contains disclaimer language
    //   - Assert no "AI coach" / "ai_messages" content appears in print view (SC#3)
  });

  test.skip('share_id appears in print footer (D-02(c)) — opaque, NOT patient user_id', () => {
    // Plan 08-06 implements:
    //   - Verify the print footer renders SnapshotResponse.share_id
    //   - Assert it is the opaque share UUID, NOT the patient's auth user_id
    //   - This is the BL-1 binding from 08-01: SnapshotResponse.share_id field.
  });
});
