// REQUIRES: 47-02 supabase db push --linked (event_rsvp_cancel RPC + SELECT FOR UPDATE SKIP LOCKED) +
//           tests/rls/fixtures-events.ts.
//
// EVENT-02 concurrent cancel + SKIP LOCKED proof — RED scaffold (Wave 0 / Plan 47-05).
// Wave 1 (Plan 47-02) flips it.todo → it() and asserts no double-promotion under
// concurrent cancels. See 47-VALIDATION.md §EVENT-02.

import { describe, it } from 'vitest';

describe('Phase 47 — waitlist concurrent cancel (EVENT-02)', () => {
  it.todo('TODO: 2 concurrent cancels at capacity=5 (10 RSVPs) → exactly 2 promoted, not 3');
  it.todo('TODO: SELECT FOR UPDATE SKIP LOCKED prevents the second tx from grabbing the same waitlist head row');
  it.todo('TODO: post-promotion waitlist_position sequence remains contiguous 1..N');
  it.todo('TODO: no orphaned waitlist row after concurrent cancel (RPC tx atomicity)');
});
