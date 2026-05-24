// REQUIRES: 47-02 supabase db push --linked (event_rsvp_create RPC with SELECT FOR UPDATE) +
//           supabase functions deploy event-rsvp-create + tests/rls/fixtures-events.ts.
//
// EVENT-02 RSVP capacity-race — RED scaffold (Wave 0 / Plan 47-05).
// Wave 1 (Plan 47-02) flips it.todo → it() and runs 10 concurrent RSVP calls at
// capacity=5; asserts exactly 5 going + 5 waitlist (SELECT FOR UPDATE + capacity
// branch is race-safe). See 47-VALIDATION.md §EVENT-02.

import { describe, it } from 'vitest';

describe('Phase 47 — event-rsvp capacity race (EVENT-02)', () => {
  it.todo('TODO: 10 concurrent RSVPs at capacity=5 → exactly 5 going + 5 waitlist (no over/under-count)');
  it.todo('TODO: 5 concurrent RSVPs at capacity=10 → all 5 going, 0 waitlist');
  it.todo('TODO: waitlist_position is contiguous 1..N after race (no gaps, no duplicates)');
  it.todo('TODO: same user calling RPC twice → idempotent (one row, no waitlist double-insert)');
});
