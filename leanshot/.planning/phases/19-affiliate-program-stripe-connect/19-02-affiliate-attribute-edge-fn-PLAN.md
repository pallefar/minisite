---
phase: 19
plan: 2
type: execute
wave: 1
depends_on: []
files_modified:
  - /Users/karstenhaldan/minisite/supabase/functions/affiliate-attribute/index.ts
  - /Users/karstenhaldan/minisite/supabase/functions/affiliate-attribute/index.test.ts
  - /Users/karstenhaldan/minisite/supabase/functions/affiliate-attribute/cookie.ts
  - /Users/karstenhaldan/minisite/supabase/functions/affiliate-attribute/cors.ts
  - /Users/karstenhaldan/minisite/supabase/functions/affiliate-attribute/referer.ts
  - /Users/karstenhaldan/minisite/supabase/functions/affiliate-attribute/deno.json
  - /Users/karstenhaldan/minisite/supabase/config.toml
  - /Users/karstenhaldan/minisite/leanshot/vercel.json
  - /Users/karstenhaldan/minisite/leanshot/scripts/wave-0-vercel-rewrite-smoke.sh
autonomous: true
requirements: [AFF-02]
tags: [edge-fn, cookies, vercel-rewrite, wave-0]

must_haves:
  truths:
    - "Wave-0 smoke confirms Vercel rewrite at /r/:code preserves Set-Cookie header from Supabase Edge Function (D-37 #1)"
    - "Visitor to leanshot.app/r/{valid-code} receives 302 redirect + ONE Set-Cookie: _aff (HttpOnly) cookie with Domain=.leanshot.app, SameSite=Lax, Secure, 30-day Max-Age (W-6 — dropped _aff_v JS-readable mirror; HttpOnly cookies are server-readable so the stripe-checkout fallback path works on _aff alone)"
    - "Visitor to /r/{invalid-code} or /r/{rejected-affiliate-code} receives 404 with NO Set-Cookie"
    - "affiliate_clicks row is INSERTed on every /r/{code} hit (flagged=true when fraud signals fire; click row still inserted per D-27)"
  artifacts:
    - path: "/Users/karstenhaldan/minisite/supabase/functions/affiliate-attribute/index.ts"
      provides: "Public Edge Function (verify_jwt=false) — GET /r/{code} → 302 + single HttpOnly cookie set"
      contains: "Deno.serve"
    - path: "/Users/karstenhaldan/minisite/supabase/functions/affiliate-attribute/cookie.ts"
      provides: "setAffiliateCookie helper using jsr:@std/http/cookie (D-21)"
      contains: "setCookie"
    - path: "/Users/karstenhaldan/minisite/leanshot/vercel.json"
      provides: "Rewrite /r/:code → Supabase Edge Function (preserves Set-Cookie + Domain=.leanshot.app)"
      contains: "affiliate-attribute"
    - path: "/Users/karstenhaldan/minisite/leanshot/scripts/wave-0-vercel-rewrite-smoke.sh"
      provides: "Wave-0 smoke (D-37 #1) — curl + assert Set-Cookie present with correct Domain"
      contains: "Set-Cookie"
  key_links:
    - from: "leanshot.app/r/{code} (browser)"
      to: "supabase/functions/affiliate-attribute"
      via: "Vercel rewrite (vercel.json)"
      pattern: "/r/:code.*affiliate-attribute"
    - from: "affiliate-attribute"
      to: "public.affiliate_clicks (Plan 19-01 schema)"
      via: "service-role INSERT"
      pattern: "from\\(['\"]affiliate_clicks['\"]\\)"
---

<objective>
Ship the public `affiliate-attribute` Edge Function (verify_jwt=false) that handles `leanshot.app/r/{code}` redirects with server-side single-cookie attribution. Includes the Wave-0 smoke verification (D-37 #1) — confirms Vercel rewrite preserves the `Set-Cookie: Domain=.leanshot.app` header from a Supabase Edge Function origin BEFORE building real logic.

Purpose: AFF-02 (cookie attribution that defeats Safari ITP). Critical-path Edge Function — every other Wave 2 component (stripe-checkout aff= param, partner dashboard click totals, fraud trigger) depends on this working.

**Iter-1 revision (W-6, 2026-05-15):** Dropped the `_aff_v` JS-readable mirror cookie. HttpOnly cookies ARE server-readable in stripe-checkout (and any other Edge Function with `Cookie:` request header parsing) so the dual-cookie pattern was unnecessary. Single `_aff` HttpOnly cookie removes self-XSS surface. If a client-side reader emerges later, add a documented non-HttpOnly cookie at that time.

**Iter-1 revision (BL-4, 2026-05-15):** This plan is the FIRST Wave-1 writer of `supabase/config.toml` (adds `[functions.affiliate-attribute]` block). Plan 19-03 explicitly `depends_on: [2]` to serialize its config.toml append. Plan 19-05 depends_on [1, 3] for the same reason. Plan 19-06 depends_on [1, 3, 5]. Plan 19-09 (Wave end) deploys all blocks at once.

Output: Edge Function (5 files) + Vercel rewrite + config.toml entry + Wave-0 smoke script.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@/Users/karstenhaldan/minisite/leanshot/.planning/phases/19-affiliate-program-stripe-connect/19-CONTEXT.md
@/Users/karstenhaldan/minisite/leanshot/.planning/phases/19-affiliate-program-stripe-connect/19-CONTEXT-ADDENDUM-research.md
@/Users/karstenhaldan/minisite/leanshot/.planning/phases/19-affiliate-program-stripe-connect/19-PATTERNS.md
@/Users/karstenhaldan/minisite/supabase/functions/share/index.ts
@/Users/karstenhaldan/minisite/supabase/functions/share/cookie.ts
@/Users/karstenhaldan/minisite/supabase/functions/share/cors.ts
@/Users/karstenhaldan/minisite/leanshot/vercel.json

<interfaces>
From `supabase/functions/share/cookie.ts` (analog — clone with adaptations):
- `import { setCookie, getCookies } from 'jsr:@std/http/cookie';`
- `export function setShareCookie(headers: Headers, token: string): void`

From `supabase/functions/share/cors.ts`:
- `export const BASE_RESPONSE_HEADERS: HeadersInit`
- `export function buildCorsHeaders(origin: string | null): Headers`

CONTEXT D-21: cookie attrs `HttpOnly`, `SameSite=Lax`, `Secure`, `Domain=.leanshot.app`, 30-day Max-Age.

**W-6 revision:** RESEARCH §"Critical attribution-on-conversion flow" described a dual-cookie pattern (`_aff` HttpOnly + `_aff_v` JS-readable). The dual was for client_reference_id passthrough in client-side Stripe.js. However, Plan 19-04 (stripe-checkout) reads `_aff` server-side via `getCookies(req.headers.get('Cookie'))` — that works on HttpOnly cookies. The dual was over-engineered. Single `_aff` HttpOnly is correct.
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Wave-0 smoke — Vercel rewrite Set-Cookie passthrough verification (D-37 #1)</name>
  <files>/Users/karstenhaldan/minisite/leanshot/scripts/wave-0-vercel-rewrite-smoke.sh, /Users/karstenhaldan/minisite/supabase/functions/affiliate-attribute/index.ts, /Users/karstenhaldan/minisite/supabase/functions/affiliate-attribute/deno.json, /Users/karstenhaldan/minisite/supabase/config.toml, /Users/karstenhaldan/minisite/leanshot/vercel.json</files>
  <read_first>
    /Users/karstenhaldan/minisite/leanshot/.planning/phases/19-affiliate-program-stripe-connect/19-CONTEXT-ADDENDUM-research.md (D-37 #1 full smoke contract)
    /Users/karstenhaldan/minisite/leanshot/vercel.json (existing rewrites — line 4-8; understand the negative-lookahead pattern to extend)
    /Users/karstenhaldan/minisite/supabase/functions/share/index.ts (Deno.serve scaffold)
    /Users/karstenhaldan/minisite/leanshot/.planning/phases/19-affiliate-program-stripe-connect/19-PATTERNS.md (section E.1 — vercel.json modify pattern; section B.1 — config.toml block)
  </read_first>
  <acceptance_criteria>
    - Stub Edge Function exists at `/Users/karstenhaldan/minisite/supabase/functions/affiliate-attribute/index.ts` and uses `Deno.serve` + `jsr:@std/http/cookie` (no hand-rolled Set-Cookie strings).
    - `supabase/config.toml` has the `[functions.affiliate-attribute]` block with `verify_jwt = false` (verify via `grep -A1 '\[functions.affiliate-attribute\]' supabase/config.toml`).
    - `leanshot/vercel.json` has a rewrite `/r/:code → https://ytnsipxxmzgaebkqmokp.supabase.co/functions/v1/affiliate-attribute?code=:code` as the FIRST rewrite; `/affiliate`, `/partner/(.*)`, `/admin/affiliates` rewrites added pointing to `/index.html`; the catch-all page-render rewrite's negative-lookahead extended with `partner|affiliate|r`.
    - `bash /Users/karstenhaldan/minisite/leanshot/scripts/wave-0-vercel-rewrite-smoke.sh` exits 0 OR the smoke script clearly identifies the failure mode and prints fall-back instructions for `r.leanshot.app` subdomain.
    - `curl -sSv https://leanshot.app/r/test` returns 302 with `Set-Cookie: _aff=test; Domain=.leanshot.app; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=60` (ONE Set-Cookie line; W-6 — no `_aff_v` mirror).
  </acceptance_criteria>
  <action>
Smoke verification + scaffold deploy. The smoke MUST pass before Task 2 builds the real logic — if Set-Cookie does not pass through Vercel rewrite, fall back to subdomain `r.leanshot.app` pointed directly at the Supabase function URL (documented in failure branch below).

**Step A — Stub Edge Function (`/Users/karstenhaldan/minisite/supabase/functions/affiliate-attribute/index.ts`):**
- File scaffold using `Deno.serve` per [[reference-supabase-edge-function-deploy]].
- Imports via esm.sh / jsr URLs (NOT bare imports): `import { setCookie } from 'jsr:@std/http/cookie';`.
- Single handler that ignores `code` param, sets ONE stub cookie via `setCookie(headers, { name: '_aff', value: 'test', domain: '.leanshot.app', httpOnly: true, secure: true, sameSite: 'Lax', path: '/', maxAge: 60 })`, returns `Response` with status 302 + `Location: /` header.
- Add `Cache-Control: private, no-store` header (Security Domain §V9 in RESEARCH.md).
- DO NOT set a second `_aff_v` cookie (W-6 — single cookie only).

**Step B — `supabase/config.toml`:** Append a `[functions.affiliate-attribute]` block at the end of the file with `verify_jwt = false` (mirrors existing `[functions.lead-capture]` block found at line 431 per the existing config.toml). Without this, the Supabase gateway will require JWT auth and the smoke 404s.

**Step C — `deno.json`** for the function: mirror `supabase/functions/share/deno.json` (minimal `{ "imports": {} }`).

**Step D — Modify `/Users/karstenhaldan/minisite/leanshot/vercel.json`:**
- Read the existing JSON. ADD this rewrite as the FIRST rule (highest priority): `{ "source": "/r/:code", "destination": "https://ytnsipxxmzgaebkqmokp.supabase.co/functions/v1/affiliate-attribute?code=:code" }`.
- ADD three additional client-side route rewrites (these need to land in the SPA, not in page-render): `{ "source": "/affiliate", "destination": "/index.html" }`, `{ "source": "/partner/(.*)", "destination": "/index.html" }`, `{ "source": "/admin/affiliates", "destination": "/index.html" }`.
- MODIFY the existing catch-all rewrite (currently at line 8 of vercel.json) — extend the negative lookahead from `^/((?!clinic|clinic-invite|admin|share|api|auth|assets|index\.html|assets/|sitemap\.xml|robots\.txt).+)$` to include `partner|affiliate|r` so these never fall through to `page-render`: new source `^/((?!clinic|clinic-invite|admin|share|api|auth|assets|index\.html|assets/|sitemap\.xml|robots\.txt|partner|affiliate|r).+)$`.

**Step E — Smoke script `/Users/karstenhaldan/minisite/leanshot/scripts/wave-0-vercel-rewrite-smoke.sh`:**
Bash script that:
1. Deploys the stub function: `cd /Users/karstenhaldan/minisite && supabase functions deploy affiliate-attribute --linked`.
2. Deploys vercel.json change: `cd /Users/karstenhaldan/minisite/leanshot && vercel deploy --prod` (assumes auth set via `VERCEL_TOKEN` env or already-logged-in CLI). If `vercel` CLI is unavailable, surface as a HUMAN-OBSERVABLE deploy checkpoint (exit with a clear message).
3. Curls `curl -sSv https://leanshot.app/r/test 2>&1 | tee /tmp/wave-0-smoke.txt`.
4. Asserts response includes header line matching `Set-Cookie:.*_aff=test.*Domain=\.leanshot\.app.*HttpOnly`. Use `grep -i 'set-cookie' /tmp/wave-0-smoke.txt | grep -F 'Domain=.leanshot.app' | grep -F 'HttpOnly' || (echo "SMOKE FAILED — Vercel rewrite did NOT preserve Set-Cookie with Domain=.leanshot.app. Fall back to subdomain r.leanshot.app per D-37 #1." && exit 1)`.
5. ALSO assert ONLY ONE Set-Cookie line was returned (W-6 — no `_aff_v`): `[ "$(grep -ic 'set-cookie' /tmp/wave-0-smoke.txt)" = "1" ] || (echo "SMOKE FAILED — expected exactly 1 Set-Cookie header; W-6 dropped _aff_v"; exit 1)`.
6. On success: `echo "WAVE-0 SMOKE PASS" >> /tmp/wave-0-smoke.txt`.

**Fall-back branch (record in 19-02-SUMMARY.md if smoke fails):**
- Instead of Vercel rewrite, register `r.leanshot.app` CNAME → Supabase function host directly.
- Update Task 2 to omit the Vercel rewrite step; cookie Domain stays `.leanshot.app` because the subdomain is a child of the apex.

**Constraints:**
- Stub function uses `verify_jwt = false` per [[reference-supabase-edge-function-deploy]] (default is true; explicit override required for public endpoints).
- DO NOT push migrations or run `supabase db push` in this task — Plan 19-01 owns DB; 19-09 owns the schema push.
- Commit with pathspec: `git commit -- supabase/functions/affiliate-attribute/index.ts supabase/functions/affiliate-attribute/deno.json supabase/config.toml leanshot/vercel.json leanshot/scripts/wave-0-vercel-rewrite-smoke.sh` per [[feedback-parallel-executor-git-isolation]].
  </action>
  <verify>
    <automated>bash /Users/karstenhaldan/minisite/leanshot/scripts/wave-0-vercel-rewrite-smoke.sh 2>&1 | tee /tmp/19-02-task1.log && grep -F 'WAVE-0 SMOKE PASS' /tmp/19-02-task1.log</automated>
  </verify>
  <done>Smoke script exits 0; `curl https://leanshot.app/r/test` returns exactly ONE `Set-Cookie: _aff=test; Domain=.leanshot.app; HttpOnly; Secure; SameSite=Lax` header (W-6 — no `_aff_v`); if smoke fails, SUMMARY.md documents the fallback (`r.leanshot.app` subdomain) and Task 2 proceeds with that path.</done>
</task>

<task type="auto">
  <name>Task 2: Replace stub with real affiliate-attribute handler + cookie.ts + cors.ts + referer.ts + Deno tests</name>
  <files>/Users/karstenhaldan/minisite/supabase/functions/affiliate-attribute/index.ts, /Users/karstenhaldan/minisite/supabase/functions/affiliate-attribute/cookie.ts, /Users/karstenhaldan/minisite/supabase/functions/affiliate-attribute/cors.ts, /Users/karstenhaldan/minisite/supabase/functions/affiliate-attribute/referer.ts, /Users/karstenhaldan/minisite/supabase/functions/affiliate-attribute/index.test.ts</files>
  <read_first>
    /Users/karstenhaldan/minisite/supabase/functions/share/index.ts (full file — module-level admin client + handler shape)
    /Users/karstenhaldan/minisite/supabase/functions/share/cookie.ts (full file — jsr:@std/http/cookie pattern)
    /Users/karstenhaldan/minisite/supabase/functions/share/cors.ts (echo-Origin allowlist)
    /Users/karstenhaldan/minisite/supabase/functions/share/index.test.ts (Deno test scaffold)
    /Users/karstenhaldan/minisite/leanshot/.planning/phases/19-affiliate-program-stripe-connect/19-RESEARCH.md (Code Examples §"affiliate-attribute Edge Function — full handler skeleton" lines 678-755)
    /Users/karstenhaldan/minisite/leanshot/.planning/phases/19-affiliate-program-stripe-connect/19-PATTERNS.md (section B.1 — cookie adaptation)
  </read_first>
  <acceptance_criteria>
    - 5 files exist under `supabase/functions/affiliate-attribute/` matching the path list above.
    - `index.ts` references EXACTLY ONE cookie name `_aff` (W-6); zero references to `_aff_v` (verify via `grep -c '_aff_v' supabase/functions/affiliate-attribute/index.ts` returns 0).
    - `cookie.ts` exports `setAffiliateCookie(headers: Headers, referralCode: string): void` (singular) — NOT `setAffiliateCookies` (plural).
    - `referer.ts` exports `isRefererAllowed(refererHeader: string | null, allowedHosts: string[]): boolean` and returns false for null referer with non-mobile UA (validated by the test).
    - All 6 Deno tests in `index.test.ts` pass via `deno test --allow-env --allow-net`.
    - Code regex validates referral codes against `/^[a-z0-9-]{4,80}$/` BEFORE any DB query.
  </acceptance_criteria>
  <action>
Replace the Task-1 stub with real logic. Cookie + CORS + Referer helpers live in dedicated files (mirror `share/` directory shape).

**File 1 — `cookie.ts`** (per D-21 + W-6 single-cookie):
- Exports `setAffiliateCookie(headers: Headers, referralCode: string): void` (singular — W-6) that writes ONE cookie via `setCookie` from `jsr:@std/http/cookie`:
  - `_aff` cookie attrs: `httpOnly: true, secure: true, sameSite: 'Lax', domain: '.leanshot.app', path: '/', maxAge: 30 * 24 * 3600` (D-21).
- Exports cookie-name constant `AFF_COOKIE_NAME = '_aff'`.
- NO `_aff_v` constant or setter (W-6).
- NO hand-rolled `Set-Cookie:` strings ([[reference-supabase-edge-function-deploy]] footgun).

**File 2 — `cors.ts`** (clone `share/cors.ts` shape; allowlist `leanshot.app` + `www.leanshot.app` + Vercel preview pattern):
- Exports `BASE_RESPONSE_HEADERS` with `Cache-Control: private, no-store` + `X-Content-Type-Options: nosniff` (V7/V9 from RESEARCH Security Domain).
- Exports `buildCorsHeaders(origin: string | null): Headers` that echoes a single allowlisted origin (NEVER `*`).

**File 3 — `referer.ts`** (D-28 — referer-based click fraud):
- Exports `isRefererAllowed(refererHeader: string | null, allowedHosts: string[]): boolean`.
- Logic: if `refererHeader` is null/empty → return `false` (D-28 reject missing-referer on non-mobile-app UA; mobile-app exemption handled in index.ts by user-agent check).
- Parse host via `new URL(refererHeader).host`; case-insensitive compare against each entry of `allowedHosts`.
- If `allowedHosts` is empty → return `true` (no restriction set for this affiliate).
- Wrap URL parse in try/catch — invalid URL returns `false`.

**File 4 — `index.ts`** (per RESEARCH Code Examples lines 678-755):
- Module-level: import `createClient` from `npm:@supabase/supabase-js@2`; init `admin` service-role client (Pattern S1 from PATTERNS.md).
- Constants: `COOKIE_TTL_SEC = 30 * 24 * 3600`, `COLD_START_CAP_CLICKS_PER_DAY = 500` (D-27), `COLD_START_DAYS = 7` (D-27).
- `Deno.serve` handler:
  1. Parse `code` from `?code=` query param. Validate against regex `/^[a-z0-9-]{4,80}$/` (V5 input validation per RESEARCH Security Domain). On invalid → `return new Response('Not found', { status: 404 })` — NO cookie set.
  2. SELECT from `public.affiliates`: `id, status, allowed_referer_hosts, created_at`. WHERE `referral_code = code`. If `!affiliate || affiliate.status !== 'approved'` → 404 NO cookie (V11 — D-25 "non-approved codes silently no-op").
  3. Detect mobile-app UA: `const ua = req.headers.get('User-Agent') ?? ''; const isMobileApp = ua.includes('LeanShot/');` (D-28 exempt).
  4. Apply referer fraud filter: `const refererOk = isMobileApp || isRefererAllowed(req.headers.get('Referer'), aff.allowed_referer_hosts);` (D-28).
  5. Cold-start cap (D-27): `const isColdStart = new Date(aff.created_at) > new Date(Date.now() - COLD_START_DAYS * 24 * 3600 * 1000);` — if true, SELECT count from `affiliate_clicks` where `affiliate_id = aff.id` and `created_at > now() - 24h`; if count >= 500 → `overCap = true`.
  6. `const flagged = !refererOk || overCap;`
  7. INSERT INTO `public.affiliate_clicks` with fields `affiliate_id`, `referral_code: code`, `ip: req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null`, `user_agent: ua`, `referer: req.headers.get('Referer')`, `flagged`, `flag_reason: !refererOk ? 'referer_mismatch' : overCap ? 'cold_start_cap' : null` — service-role bypasses RLS (per Plan 19-01 service_insert policy).
  8. Build response headers: clone BASE_RESPONSE_HEADERS. If `!flagged`: call `setAffiliateCookie(headers, code)` to set the SINGLE `_aff` cookie (W-6). If `flagged`: DO NOT set cookie (D-27 click is logged but attribution suppressed).
  9. `headers.set('Location', \`/r/${code}/landing\`);` — Phase 15 page-render serves the landing page for this slug (per Plan 19-08 seed).
  10. Return `new Response(null, { status: 302, headers });`
- Error handling: top-level try/catch around DB queries; on error return `new Response('error', { status: 500 })` — DO NOT echo error details (V7 per RESEARCH Security Domain).
- Logging: `console.error('[affiliate-attribute]', err instanceof Error ? err.message : 'unknown')` (Pattern S3 — PII-safe logs).

**File 5 — `index.test.ts`** (Deno test per [[reference-deno-test-discovery]] — `.test.ts` NOT `-test.ts`):
- Test 1: invalid code regex → 404, no Set-Cookie.
- Test 2: valid code but affiliate.status='pending' → 404, no Set-Cookie.
- Test 3: valid code + approved affiliate + valid referer → 302 + EXACTLY ONE Set-Cookie header (`_aff` HttpOnly); zero `_aff_v` headers (W-6); `affiliate_clicks` insert called with `flagged=false`.
- Test 4: valid code + missing Referer + non-mobile-app UA → 302 NO Set-Cookie + click row INSERTed with `flagged=true, flag_reason='referer_mismatch'`.
- Test 5: valid code + mobile-app UA (LeanShot/...) + no Referer → 302 + cookie set (D-28 exemption).
- Test 6: cold-start affiliate (< 7d old) with 500 clicks in last 24h → next click `flagged=true, flag_reason='cold_start_cap'`.
- Mock the supabase-js admin client via dependency injection or test-time override (mirror `share/index.test.ts` pattern).

**Constraints:**
- Edge Function imports use esm.sh / jsr URLs only ([[reference-supabase-edge-function-deploy]]).
- Test file MUST be `index.test.ts` not `index-test.ts` ([[reference-deno-test-discovery]]).
- DO NOT modify `supabase/config.toml` again — Task 1 already added the `verify_jwt=false` block.
- W-6: zero references to `_aff_v` anywhere in this plan's files.
- Commit with pathspec on this plan's files only.
  </action>
  <verify>
    <automated>cd /Users/karstenhaldan/minisite && deno test supabase/functions/affiliate-attribute/index.test.ts --allow-env --allow-net</automated>
  </verify>
  <done>6 Deno tests pass; handler validates code regex, blocks non-approved affiliates, sets the single `_aff` HttpOnly cookie on success (W-6 — no `_aff_v`), suppresses cookie + flags click on fraud signals, exempts mobile-app UA from Referer requirement.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| External browser → /r/:code | Untrusted input crosses here; code is a public referral string |
| Vercel rewrite → Supabase Edge Function | Trusted infrastructure; rewrite preserves headers per D-37 #1 smoke |
| Edge Function → DB (service_role) | Trusted; bypasses RLS via service-role policy from Plan 19-01 |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-19-02-S | Spoofing | Cookie session fixation | mitigate | Cookie value IS the public referral code (no secret session token to fixate); D-25 silently no-ops non-approved codes |
| T-19-02-T | Tampering | SQL injection via code param | mitigate | Regex `/^[a-z0-9-]{4,80}$/` validation BEFORE DB query; parameterized supabase-js client (V5) |
| T-19-02-T | Tampering | Referral-code stuffing / click fraud | mitigate | Referer-host allowlist (D-28) + cold-start 500/day cap (D-27) + Z-score baseline (Plan 19-07) |
| T-19-02-R | Repudiation | Fake-Referer click injection | mitigate | Per-affiliate `allowed_referer_hosts[]`; missing-Referer on non-mobile UA flagged |
| T-19-02-I | Information Disclosure | Cookie leak via XSS | mitigate | `_aff` is HttpOnly (server-only); W-6 removed the `_aff_v` JS-readable mirror entirely — no self-XSS surface from the JS-readable cookie path |
| T-19-02-I | Information Disclosure | Cookie cached by CDN | mitigate | `Cache-Control: private, no-store` on all responses (V9) |
| T-19-02-D | DoS | Bot flood on /r/:code | accept | Vercel edge has DDoS protection; cold-start cap limits per-affiliate damage; admin queue surfaces volume anomalies |
| T-19-02-E | Elevation of Privilege | Trojan code attributes to attacker | mitigate | `status='approved'` check; non-approved silently no-ops (V11) |
</threat_model>

<verification>
- Wave-0 smoke (Task 1) confirms Vercel rewrite preserves `Set-Cookie: Domain=.leanshot.app` (D-37 #1) AND that only ONE Set-Cookie header is returned (W-6)
- Edge Function passes 6 Deno tests covering valid/invalid code, fraud-flag paths, mobile-app exemption
- `config.toml` has `[functions.affiliate-attribute] verify_jwt = false` block
- `vercel.json` rewrites /r/:code → Supabase function URL AND adds /partner/(.*) + /affiliate + /admin/affiliates client-side rewrites
- Catch-all page-render rewrite excludes `r|partner|affiliate` from negative lookahead (these paths NEVER fall through to page-render unless explicitly seeded as landing pages by Plan 19-08)
</verification>

<success_criteria>
- D-37 #1 Wave-0 smoke passes (or fallback to subdomain documented in SUMMARY)
- `curl https://leanshot.app/r/{approved-code}` returns 302 + exactly ONE Set-Cookie header (`_aff` HttpOnly; W-6) + Location header
- `curl https://leanshot.app/r/{rejected-code}` returns 404 with NO Set-Cookie
- `affiliate_clicks` row INSERTed on every /r/{code} hit with correct `flagged` + `flag_reason` (per D-27 — flagged clicks still recorded)
- 6 Deno tests green; cookie helper reuses `jsr:@std/http/cookie` (no hand-rolled strings); zero references to `_aff_v` (W-6)
</success_criteria>

<output>
After completion, create `19-02-SUMMARY.md`: Wave-0 smoke result (pass/fallback path used), Edge Function endpoint URL, single-cookie contract documented (W-6 rationale), Referer + cold-start fraud signal coverage, vercel.json delta documented, config.toml first-writer note for the BL-4 ordering chain (19-02 → 19-03 → 19-05 → 19-06 → 19-09).
</output>
