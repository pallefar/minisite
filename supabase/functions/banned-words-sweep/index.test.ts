// Phase 48 — banned-words-sweep handler test (scaffold).
// WAVE 0: RED. Drives Plan 48-08 to GREEN.

// import { handler } from './index.ts';     // <-- uncomment when handler exists

Deno.test('TODO banned-words-sweep: HMAC reject 401', () => {
  // assertEquals(handler(<missing-hmac request>).status, 401);
});

Deno.test('TODO banned-words-sweep: cursored batch returns next_cursor', () => {
  // assert response body includes next_cursor for resume
});

Deno.test('TODO banned-words-sweep: idempotent -- re-invoke same cursor does NOT dup-insert', () => {
  // run sweep over (cursor, banned_word); re-run with same cursor;
  // assert community_reports row count unchanged (relies on banned_word_dedup_uniq).
});

Deno.test('TODO banned-words-sweep: per-batch cap honoured (no unbounded scan)', () => {
  // seed > batch_cap posts containing banned word; assert single invocation
  // processes <= batch_cap rows; resume continues from cursor.
});
