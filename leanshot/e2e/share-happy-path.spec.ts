// Phase 8 Plan 08-01 Wave 0 scaffold — SHARE-01 / SHARE-02 happy-path e2e.
//
// All tests are `test.skip` so CI passes during Wave 0. Plans 08-03 + 08-04
// remove the `.skip` and wire the actual user flows (create share via
// Settings → enter code → see snapshot → verify all surfaces render).
//
// State seeding pattern: this spec MUST use `page.addInitScript` for any
// localStorage / sessionStorage seed per memory `reference_playwright_state_seeding.md`
// (page.goto + page.evaluate races supabase-js INITIAL_SESSION and silently
// wipes seeds).

import { test } from '@playwright/test';

test.describe('Phase 8 SHARE-01 / SHARE-02 — happy path', () => {
  test.skip('create share via Settings → returns one-time token + 6-digit code', () => {
    // Plan 08-03 implements:
    //   - Open SettingsPage → "Active shares" section → "Create share" modal
    //   - Submit label + expiry → assert RPC create_share returns share_id + raw_token + raw_code
    //   - Verify the token + code are displayed ONCE with copy-to-clipboard affordances
  });

  test.skip('doctor enters code on share route → sees snapshot view', () => {
    // Plan 08-04 implements:
    //   - Navigate to /share/<raw_token> hash route
    //   - Enter 6-digit code → POST /share/redeem succeeds → HttpOnly cookie set
    //   - GET /share/snapshot returns SnapshotResponse → SharePage renders
  });

  test.skip('snapshot includes chart + injections + symptoms + photos + weight + doctor report', () => {
    // Plan 08-04 implements:
    //   - Assert med-level chart renders with PK-04 disclaimer overlay
    //   - Assert recent injections list, symptoms list, weight chart, photos grid
    //   - Assert DoctorReport component renders with snapshot data
    //   - Assert ZERO ai_messages / AI conversation surface (SC#3 visual check)
  });
});
