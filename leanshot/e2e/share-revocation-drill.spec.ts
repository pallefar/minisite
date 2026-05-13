// Phase 8 Plan 08-01 Wave 0 scaffold — SHARE-03 SC#3 4-failure-mode revocation drill.
//
// SC#3 wording: doctor's open tab becomes unusable within seconds via
// DB-row-checked revocation (NOT JWT-TTL-only). All 4 failure modes MUST
// be blocked by the architecture. Plan 08-05 implements the actual
// assertions; this scaffold defines the test surface.

import { test } from '@playwright/test';

test.describe('Phase 8 SHARE-03 — 4-failure-mode revocation drill', () => {
  test.skip('failure-mode (a): token cache — doctor poll after revoke returns 401', () => {
    // Plan 08-05 implements:
    //   - Patient creates share, doctor opens, sees snapshot
    //   - Patient revokes via SettingsPage → revoke_share RPC
    //   - Doctor's next poll (chart refresh, symptom poll, etc.) MUST return 401
    //     within seconds (D-02 per-request DB check on revoked_at).
  });

  test.skip('failure-mode (b): HTTP cache — Cache-Control: private, no-store on every share-route response', () => {
    // Plan 08-05 implements:
    //   - Assert every /share/* response carries `Cache-Control: private, no-store`
    //   - Verify in Playwright via response.headers() inspection
    //   - This blocks intermediary caches (CDN, browser) from serving stale snapshots
    //     after revocation.
  });

  test.skip('failure-mode (c): JWT TTL fallback — DB revoke wins over still-valid JWT', () => {
    // Plan 08-05 implements:
    //   - Issue share JWT with e.g. 1h TTL
    //   - Revoke share row at t=10min
    //   - At t=11min, doctor's still-cryptographically-valid JWT → Edge Function
    //     checks DB → revoked_at IS NOT NULL → 401. JWT TTL is fallback, NOT primary.
  });

  test.skip('failure-mode (d): forwarded link — recipient B (no cookie / no code) cannot access', () => {
    // Plan 08-05 implements:
    //   - Doctor A enters code → cookie set → snapshot loads
    //   - Doctor A forwards link to doctor B
    //   - Doctor B opens link → no recipient_session cookie → redirected to code entry
    //   - Doctor B has no code → cannot redeem (single-use, already consumed by A)
    //   - This is D-03 cookie-binding's headline assurance.
  });
});
