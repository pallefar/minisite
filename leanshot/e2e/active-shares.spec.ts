// Phase 8 Plan 08-01 Wave 0 scaffold — SHARE-05 patient-side audit log surface.
//
// Plan 08-03 implements the SettingsPage "Active shares" section: per-share
// row showing label / expiry / view count / last-viewed / IP-family / UA-family
// + one-click revoke. Data source: aggregate query against audit_logs
// filtered by actor_type='share_recipient' + share_id IN (patient's shares).

import { test } from '@playwright/test';

test.describe('Phase 8 SHARE-05 — patient sees audit log of doctor views', () => {
  test.skip('active shares section lists own shares with view count + last_viewed', () => {
    // Plan 08-03 implements:
    //   - Patient logs in, creates share, doctor views N times
    //   - Patient opens Settings → Active shares
    //   - Assert row count = patient's active shares
    //   - Assert view_count column = N (aggregated from audit_logs)
    //   - Assert last_viewed_at column = most recent share_view timestamp
    //   - Assert RLS: patient sees only their OWN audit rows (no cross-tenant leak)
  });

  test.skip('revoke button writes shares.revoked_at and removes from active list', () => {
    // Plan 08-03 implements:
    //   - Patient clicks "Revoke" on a share row
    //   - Confirm modal → revoke_share RPC fires
    //   - Row moves from "Active" to "Revoked" section (or disappears, planner's choice)
    //   - Re-fetch → revoked_at IS NOT NULL in DB
  });
});
