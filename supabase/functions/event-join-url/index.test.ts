// REQUIRES: 47-03 supabase functions deploy event-join-url (Wave 1) +
//           47-02 event_rsvps schema applied + Zoom S2S secrets set.
//
// EVENT-04 event-join-url Edge Fn tests — RED scaffold (Wave 0 / Plan 47-05).
// Wave 1 (Plan 47-03) replaces each Deno.test stub body with assertions against
// the deployed handler. Per reference_deno_test_top_level_serve_trap: this file
// contains NO top-level Deno-dot-serve() calls; only stub Deno-dot-test() registrations.
// Wave 1 handler MUST use the import.meta.main guard before the top-level serve call.
//
// Run: $HOME/.deno/bin/deno test --no-check supabase/functions/event-join-url/index.test.ts

Deno.test('TODO Phase 47 — event-join-url: status=going + within join window → returns 200 + join_url', () => {
  throw new Error('TODO: scaffold; implement in Wave 1 (Plan 47-03)');
});

Deno.test('TODO Phase 47 — event-join-url: caller outside join window (too early) → 403 too_early', () => {
  throw new Error('TODO');
});

Deno.test('TODO Phase 47 — event-join-url: RSVP status maybe / not_going / missing → 403 rsvp_required', () => {
  throw new Error('TODO');
});

Deno.test('TODO Phase 47 — event-join-url: event ended (event_at_utc + duration < now) → 403 event_ended', () => {
  throw new Error('TODO');
});

Deno.test('TODO Phase 47 — event-join-url: is_staff() admin → preview join_url returned regardless of window', () => {
  throw new Error('TODO');
});
