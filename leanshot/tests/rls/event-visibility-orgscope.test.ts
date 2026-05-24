// REQUIRES: 47-01 supabase db push --linked (events / event_rsvps / RLS) +
//           tests/rls/fixtures-events.ts seed helpers (47-05 ships scaffold).
//
// EVENT-01 cross-tenant impersonation proof for org-scoped events — RED scaffold
// (Wave 0 / Plan 47-05). Mirrors the cross-tenant RLS pattern from
// tests/rls/community-spaces-rls.test.ts + tests/rls/subscriptions-impersonation.test.ts.
// Wave 1 (Plan 47-01) flips it.todo → it() and asserts impersonation negative-controls.

import { describe, it } from 'vitest';

describe('Phase 47 — event-visibility org-scope impersonation (EVENT-01)', () => {
  it.todo('TODO: user in org-A cannot SELECT an event with org_id = org-B');
  it.todo('TODO: user in org-A cannot UPDATE an event with org_id = org-B (RLS denial)');
  it.todo('TODO: user in org-A cannot DELETE an event with org_id = org-B (RLS denial)');
  it.todo('TODO: forging org_id in INSERT to another tenant is rejected by RLS WITH CHECK');
});
