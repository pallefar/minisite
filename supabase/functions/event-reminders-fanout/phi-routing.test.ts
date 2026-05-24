// REQUIRES: 47-08 supabase functions deploy event-reminders-fanout (Wave 1) +
//           _shared/email-router.ts deployed + RESEND_* + SES_* secrets set.
//
// EVENT-03 PHI routing (Resend vs SES) — RED scaffold (Wave 0 / Plan 47-05).
// Wave 1 (Plan 47-08) replaces each Deno.test stub body with assertions that the
// fan-out routes via SES for phi=true and Resend for phi=false (mirrors
// _shared/email-router.test.ts pattern). Per reference_deno_test_top_level_serve_trap:
// this file contains NO top-level Deno-dot-serve() calls; only stub Deno-dot-test() registrations.
//
// Run: $HOME/.deno/bin/deno test --no-check supabase/functions/event-reminders-fanout/phi-routing.test.ts

Deno.test('TODO Phase 47 — phi-routing: phi=true (org-scoped event) → email-router picks SES path', () => {
  throw new Error('TODO: scaffold; implement in Wave 1 (Plan 47-08)');
});

Deno.test('TODO Phase 47 — phi-routing: phi=false (global event) → email-router picks Resend path', () => {
  throw new Error('TODO');
});

Deno.test('TODO Phase 47 — phi-routing: notification_settings.event_reminders_opt_in = false → send skipped (no router call)', () => {
  throw new Error('TODO');
});

Deno.test('TODO Phase 47 — phi-routing: user has no email row → send skipped + logged (no exception)', () => {
  throw new Error('TODO');
});
