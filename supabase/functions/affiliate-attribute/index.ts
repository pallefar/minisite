/**
 * `affiliate-attribute` Edge Function — Phase 19 / Plan 19-02 (Wave-0 stub).
 *
 * Public Edge Function at `GET /functions/v1/affiliate-attribute?code=...`.
 * Fronted by Vercel rewrite `/r/:code` → this function (so the response
 * `Set-Cookie: Domain=.leanshot.app` is honored by the visitor's browser).
 *
 * STUB (Wave-0 smoke contract — D-37 #1):
 *   Sets ONE cookie `_aff=test` with Domain=.leanshot.app + HttpOnly + Secure
 *   + SameSite=Lax + Max-Age=60s, returns 302 → /. No DB queries, no validation.
 *   The smoke `bash leanshot/scripts/wave-0-vercel-rewrite-smoke.sh` curls
 *   `https://leanshot.app/r/test` and asserts the Set-Cookie passes through.
 *
 * Task 2 of 19-02 replaces this stub with the real attribution handler
 * (regex validation + DB lookup + referer fraud check + cold-start cap +
 * affiliate_clicks INSERT). W-6: single `_aff` cookie only (no JS-readable mirror).
 *
 * Project rules (LeanShot memory):
 *   - reference_supabase_edge_function_deploy.md — esm.sh / jsr URLs only
 *     (NOT bare specifiers); verify_jwt=false in supabase/config.toml.
 *   - reference_deno_test_discovery.md — sibling test file is index.test.ts.
 */

import { setCookie } from 'jsr:@std/http/cookie';

const COOKIE_NAME = '_aff';
const STUB_MAX_AGE_SEC = 60;

Deno.serve((_req: Request): Response => {
  const headers = new Headers({
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff',
    'Location': '/',
  });

  setCookie(headers, {
    name: COOKIE_NAME,
    value: 'test',
    httpOnly: true,
    secure: true,
    sameSite: 'Lax',
    domain: '.leanshot.app',
    path: '/',
    maxAge: STUB_MAX_AGE_SEC,
  });

  return new Response(null, { status: 302, headers });
});
