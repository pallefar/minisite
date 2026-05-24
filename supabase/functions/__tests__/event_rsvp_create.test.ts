// REQUIRES: 47-02 supabase db push --linked (event_rsvp_create SECDEF RPC) +
//           supabase functions deploy event-rsvp-create.
//
// EVENT-02 event_rsvp_create RPC tests — RED scaffold (Wave 0 / Plan 47-05).
// Wave 1 (Plan 47-02) replaces each Deno.test stub body with assertions against
// the deployed RPC. Per reference_deno_test_top_level_serve_trap: this file
// contains NO top-level Deno-dot-serve() calls; only stub Deno-dot-test() registrations.
//
// Run: $HOME/.deno/bin/deno test --no-check supabase/functions/__tests__/event_rsvp_create.test.ts

Deno.test('TODO Phase 47 — event_rsvp_create: status=going under capacity → row going + waitlist_position null', () => {
  throw new Error('TODO: scaffold; implement in Wave 1 (Plan 47-02)');
});

Deno.test('TODO Phase 47 — event_rsvp_create: status=going AT capacity → row waitlist + waitlist_position assigned', () => {
  throw new Error('TODO');
});

Deno.test('TODO Phase 47 — event_rsvp_create: auth.uid() null → 42501 insufficient_privilege', () => {
  throw new Error('TODO');
});

Deno.test('TODO Phase 47 — event_rsvp_create: invalid status value → 22023 invalid_parameter_value', () => {
  throw new Error('TODO');
});

Deno.test('TODO Phase 47 — event_rsvp_create: idempotent on (event_id, user_id) — second call UPDATES not raises', () => {
  throw new Error('TODO');
});
