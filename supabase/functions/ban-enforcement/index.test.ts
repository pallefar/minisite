// Phase 48 — ban-enforcement handler test (scaffold).
// WAVE 0: RED. Drives Plan 48-09 to GREEN.
//
// ban-enforcement is the Edge Fn invoked by apply_user_moderation (Plan 48-03)
// AFTER a banned/temp_suspended write — it revokes auth.sessions for the
// affected user (primary enforcement; RLS WITH CHECK from this plan is the
// durable backstop per T-48-06).

// import { handler } from './index.ts';     // <-- uncomment when handler exists

Deno.test('TODO ban-enforcement: HMAC reject 401', () => {
  // assertEquals(handler(<missing-hmac request>).status, 401);
});

Deno.test('TODO ban-enforcement: service-role DELETE FROM auth.sessions WHERE user_id', () => {
  // mock supabase service-role client; assert called with delete on auth.sessions
  // filter user_id=<banned_user>. Also asserts auth.refresh_tokens cleared.
});

Deno.test('TODO ban-enforcement: writes moderation_audit_log row action=session_revoked', () => {
  // assert log_moderation_action invoked with p_action_type='session_revoked'
  // and p_target_id=<banned_user>.
});

Deno.test('TODO ban-enforcement: idempotent re-invoke (no error if sessions already revoked)', () => {
  // run twice with same user_id; assert second call returns 200 and writes
  // a no-op audit row OR is a no-op (Plan 48-09 chooses).
});
