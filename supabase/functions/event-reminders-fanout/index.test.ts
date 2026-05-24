// REQUIRES: 47-08 supabase functions deploy event-reminders-fanout (Wave 1) +
//           47-01 event_reminder_sent UNIQUE constraint + 47-05 pg_cron schedule
//           registered (this plan) + service_role_key vault entry set.
//
// EVENT-03 event-reminders-fanout Edge Fn tests — RED scaffold (Wave 0 / Plan 47-05).
// Wave 1 (Plan 47-08) replaces each Deno.test stub body with assertions against
// the deployed handler. Per reference_deno_test_top_level_serve_trap: this file
// contains NO top-level Deno-dot-serve() calls; only stub Deno-dot-test() registrations.
// Wave 1 handler MUST use the import.meta.main guard before the top-level serve call.
//
// Run: $HOME/.deno/bin/deno test --no-check supabase/functions/event-reminders-fanout/index.test.ts

Deno.test('TODO Phase 47 — fanout: 1d window selects RSVPs whose event_at_utc ∈ [now+23h, now+25h)', () => {
  throw new Error('TODO: scaffold; implement in Wave 1 (Plan 47-08)');
});

Deno.test('TODO Phase 47 — fanout: 1h window selects RSVPs whose event_at_utc ∈ [now, now+2h)', () => {
  throw new Error('TODO');
});

Deno.test('TODO Phase 47 — fanout: multi-TZ correctness — same UTC moment, LA vs NY user windows differ', () => {
  throw new Error('TODO');
});

Deno.test('TODO Phase 47 — fanout: dedup UNIQUE (event_id, user_id, kind) skips already-sent rows', () => {
  throw new Error('TODO');
});

Deno.test('TODO Phase 47 — fanout: drains waitlist-promotion queue (Wave 1 47-02 trigger emit)', () => {
  throw new Error('TODO');
});
