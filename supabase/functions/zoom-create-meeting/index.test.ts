// REQUIRES: 47-06 supabase functions deploy zoom-create-meeting (Wave 1) +
//           Zoom S2S secrets set (ZOOM_S2S_ACCOUNT_ID + ZOOM_S2S_CLIENT_ID +
//           ZOOM_S2S_CLIENT_SECRET) + events schema applied.
//
// EVENT-04 zoom-create-meeting Edge Fn tests — RED scaffold (Wave 0 / Plan 47-05).
// Wave 1 (Plan 47-06) replaces each Deno.test stub body with assertions against
// the deployed handler. Per reference_deno_test_top_level_serve_trap: this file
// contains NO top-level Deno-dot-serve() calls; only stub Deno-dot-test() registrations.
// Wave 1 handler MUST use the import.meta.main guard before the top-level serve call.
//
// Run: $HOME/.deno/bin/deno test --no-check supabase/functions/zoom-create-meeting/index.test.ts

Deno.test('TODO Phase 47 — zoom-create-meeting: happy path → 200 + join_url + zoom_meeting_id written back to events row', () => {
  throw new Error('TODO: scaffold; implement in Wave 1 (Plan 47-06)');
});

Deno.test('TODO Phase 47 — zoom-create-meeting: 401 from Zoom → refresh S2S token + retry once → success', () => {
  throw new Error('TODO');
});

Deno.test('TODO Phase 47 — zoom-create-meeting: caller is NOT is_staff() admin → 403 forbidden', () => {
  throw new Error('TODO');
});

Deno.test('TODO Phase 47 — zoom-create-meeting: event_id does not exist → 404 event_not_found', () => {
  throw new Error('TODO');
});
