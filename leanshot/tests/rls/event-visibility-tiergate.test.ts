// REQUIRES: 47-01 supabase db push --linked (events / event_rsvps / RLS) +
//           tests/rls/fixtures-events.ts seed helpers (47-05 ships scaffold).
//
// EVENT-01 tier-gate visibility — RED scaffold (Wave 0 / Plan 47-05).
// Mirrors tests/rls/community-tier-gating-rls.test.ts. Wave 1 (Plan 47-01) flips
// it.todo → it() and asserts free-tier users cannot SELECT pro-only events.

import { describe, it } from 'vitest';

describe('Phase 47 — event-visibility tier-gate (EVENT-01)', () => {
  it.todo('TODO: free-tier user cannot SELECT an event with required_tier = pro');
  it.todo('TODO: pro-tier user CAN SELECT an event with required_tier = pro');
  it.todo('TODO: required_tier = free is visible to both free and pro users');
  it.todo('TODO: downgrade from pro → free immediately hides previously-visible pro events');
});
