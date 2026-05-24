// Phase 48 — claude-moderation handler test (scaffold).
// WAVE 0: RED. Drives Plan 48-07 to GREEN.
//
// Per memory reference_deno_test_top_level_serve_trap: do NOT trigger
// Deno.serve() in this test file. When the Fn handler is shipped in Plan
// 48-07, prefer to export a named `handler` (not the bare `Deno.serve` call)
// and import it here for direct invocation.

// import { handler } from './index.ts';     // <-- uncomment when handler exists

Deno.test('TODO claude-moderation: HMAC reject 401', () => {
  // assertEquals(handler(<missing-hmac request>).status, 401);
});

Deno.test('TODO claude-moderation: structured-output JSON >=0.7 -> INSERT community_reports system row', () => {
  // mock Anthropic structured-output JSON { confidence: 0.85, category: 'spam' }
  // assert community_reports insert called with reason->>'source'='claude_auto_flag'
});

Deno.test('TODO claude-moderation: NEVER auto-remove -- even at confidence=0.99', () => {
  // mock confidence 0.99 -> assert NO DELETE FROM public.community_posts call path
});

Deno.test('TODO claude-moderation: rate-limit per author_id (cap auto-flag fan-out)', () => {
  // assert second invocation within window does not re-insert duplicate report
});
