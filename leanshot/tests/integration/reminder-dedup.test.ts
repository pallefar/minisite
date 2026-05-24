// REQUIRES: 47-01 supabase db push --linked (event_reminder_sent UNIQUE (event_id, user_id, kind)) +
//           47-08 supabase functions deploy event-reminders-fanout (Wave 1) +
//           tests/rls/fixtures-events.ts.
//
// EVENT-03 reminder dedup — RED scaffold (Wave 0 / Plan 47-05).
// Wave 1 (Plan 47-08) flips it.todo → it() and asserts UNIQUE constraint blocks
// duplicate send within the same (event_id, user_id, kind) tuple.
// See 47-VALIDATION.md §EVENT-03.

import { describe, it } from 'vitest';

describe('Phase 47 — reminder dedup (EVENT-03)', () => {
  it.todo('TODO: second insert into event_reminder_sent (event_id, user_id, kind=1d) raises unique_violation');
  it.todo('TODO: same event_id + user_id but different kind (1h vs 1d) → both inserts succeed');
  it.todo('TODO: fan-out Fn invoked twice within the hour writes exactly one event_reminder_sent row per (user, kind)');
  it.todo('TODO: dedup is per-event — RSVP to a SECOND event still reminds the same user');
});
