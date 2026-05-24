// REQUIRES: 47-09 mux-webhook event-recording branch deployed (Wave 1) +
//           events.recording_* + events.attach_to_module_id columns from 47-01 +
//           course_lessons table from earlier phase.
//
// EVENT-05 mux-webhook event-recording branch tests — RED scaffold (Wave 0 / Plan 47-05).
// Wave 1 (Plan 47-09) replaces each Deno.test stub body with assertions against
// the extended mux-webhook handler. Per reference_deno_test_top_level_serve_trap:
// this file contains NO top-level Deno-dot-serve() calls; only stub Deno-dot-test()
// registrations. Source supabase/functions/mux-webhook/index.ts already uses
// the denoGlobal?.serve guard pattern (per existing index.test.ts).
//
// Run: $HOME/.deno/bin/deno test --no-check supabase/functions/mux-webhook/event-recording.test.ts

Deno.test('TODO Phase 47 — mux-webhook event-recording: passthrough.event_id present + attach_to_module_id NOT NULL → INSERTs course_lessons row', () => {
  throw new Error('TODO: scaffold; implement in Wave 1 (Plan 47-09)');
});

Deno.test('TODO Phase 47 — mux-webhook event-recording: passthrough.event_id present + attach_to_module_id NULL → writes events.recording_playback_id + duration only (no course_lessons row)', () => {
  throw new Error('TODO');
});

Deno.test('TODO Phase 47 — mux-webhook event-recording: passthrough missing event_id → log warning + 200 OK (no-op passthrough, does not 500)', () => {
  throw new Error('TODO');
});

Deno.test('TODO Phase 47 — mux-webhook event-recording: existing passthrough.upload_id (community / course path) is NOT affected by event branch', () => {
  throw new Error('TODO');
});
