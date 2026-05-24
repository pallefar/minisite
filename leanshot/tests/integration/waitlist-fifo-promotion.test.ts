// REQUIRES: 47-02 supabase db push --linked (event_rsvp_cancel RPC + waitlist promote trigger) +
//           tests/rls/fixtures-events.ts.
//
// EVENT-02 waitlist FIFO promotion — RED scaffold (Wave 0 / Plan 47-05).
// Wave 1 (Plan 47-02) flips it.todo → it() and asserts head-of-queue promotion
// in cancel order. See 47-VALIDATION.md §EVENT-02.

import { describe, it } from 'vitest';

describe('Phase 47 — waitlist FIFO promotion (EVENT-02)', () => {
  it.todo('TODO: cancel a going RSVP → head of waitlist (position 1) promoted to going');
  it.todo('TODO: second cancel → next head (was position 2, now 1) promoted to going');
  it.todo('TODO: waitlist_position is re-numbered contiguous after promotion (no gaps)');
  it.todo('TODO: cancel by user who is on waitlist (not going) does NOT trigger promotion');
});
