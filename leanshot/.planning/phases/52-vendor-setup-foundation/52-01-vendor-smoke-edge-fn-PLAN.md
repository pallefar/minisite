---
phase: 52-vendor-setup-foundation
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - supabase/functions/vendor-smoke/deno.json
  - supabase/functions/vendor-smoke/index.ts
  - supabase/functions/vendor-smoke/index.test.ts
autonomous: true
requirements: [VENDOR-01, VENDOR-02, VENDOR-03, VENDOR-04, VENDOR-05, VENDOR-06, VENDOR-07, VENDOR-08, VENDOR-09, VENDOR-11]
user_setup: []

must_haves:
  truths:
    - "vendor-smoke Fn iterates a hardcoded vendor registry and returns one SmokeResult per vendor"
    - "A vendor whose required secret is absent records status 'not_configured' (never 'fail')"
    - "A vendor with a present secret records 'ok' (with latency) or 'fail' (with error code) based on the probe"
    - "The Fn rejects any request lacking a valid service-role bearer OR staff JWT (401)"
    - "Each smoke run upserts one row per vendor into vendor_smoke_log keyed on vendor_name"
    - "deno test of the Fn passes locally without starting an HTTP server"
  artifacts:
    - path: "supabase/functions/vendor-smoke/deno.json"
      provides: "Per-function deno config (imports + test task)"
      contains: "npm:@supabase/supabase-js@2"
    - path: "supabase/functions/vendor-smoke/index.ts"
      provides: "Dual-auth gate, vendor registry, per-vendor handlers, upsert loop"
      min_lines: 200
      contains: "VENDOR_REGISTRY"
    - path: "supabase/functions/vendor-smoke/index.test.ts"
      provides: "Unit tests for auth gate + not_configured/ok/fail handler logic + upsert"
      min_lines: 60
  key_links:
    - from: "supabase/functions/vendor-smoke/index.ts"
      to: "supabase/functions/_shared/lifecycle-utils.ts"
      via: "relative import of checkServiceRoleBearer/makeLazyAdmin/jsonResponse/jsonError/bearerFromReq/corsHeaders"
      pattern: "from '\\.\\./_shared/lifecycle-utils\\.ts'"
    - from: "supabase/functions/vendor-smoke/index.ts"
      to: "vendor_smoke_log table"
      via: "admin.from('vendor_smoke_log').upsert(... onConflict: 'vendor_name')"
      pattern: "vendor_smoke_log"
---

<objective>
Build the single `vendor-smoke` Supabase Edge Function: a dual-auth (cron service-role bearer + staff JWT) endpoint that iterates a hardcoded vendor registry, runs a fail-soft connectivity probe per vendor, and upserts one row per vendor into `vendor_smoke_log`.

Purpose: Gives every downstream v1.4 phase (53–68) a live missing-secret tracker from day one. Fail-soft on absent secrets (`not_configured`, never `fail`) means the Fn runs safely BEFORE Phase 70 provisioning completes.
Output: `supabase/functions/vendor-smoke/{deno.json, index.ts, index.test.ts}`.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/ROADMAP.md
@.planning/STATE.md
@.planning/phases/52-vendor-setup-foundation/52-CONTEXT.md
@.planning/phases/52-vendor-setup-foundation/52-RESEARCH.md

# VERBATIM STRUCTURAL TEMPLATE — copy this Fn's auth + admin-client + helpers + error handling
@supabase/functions/baa-expiry-check/index.ts
# Per-function deno.json shape to mirror (imports block + --no-check test task)
@supabase/functions/mux-create-upload/deno.json
# Existing vendor smoke handler precedent (Resend GET /domains) — reuse its log-only-e.name discipline
@supabase/functions/_shared/resend-domain-health-check.ts

<interfaces>
<!-- Shared utilities (VERIFIED from 52-RESEARCH.md §Existing Reuse Inventory). Import via RELATIVE path '../_shared/lifecycle-utils.ts' — NOT an alias (CLI v2.101.0 ignores --import-map; bare shared/* aliases break). -->

From supabase/functions/_shared/lifecycle-utils.ts:
- checkServiceRoleBearer(req: Request): boolean        // constant-time compare of Bearer vs SUPABASE_SERVICE_ROLE_KEY; handles sb_secret_* format divergence — do NOT hand-roll
- bearerFromReq(req: Request): string | null           // extract Bearer token string
- makeLazyAdmin(): { admin, setAdminForTest, resetAdminForTest }  // lazy Supabase admin client + test injection hook
- jsonResponse(status: number, body: unknown): Response // JSON + CORS headers
- jsonError(status: number, code: string): Response     // JSON error + CORS
- constantTimeEqual(a: string, b: string): boolean
- corsHeaders                                           // CORS header object

Target table contract (created by plan 52-02; reference by string only — no code import):
  vendor_smoke_log(vendor_name text PK, status vendor_smoke_status['ok'|'fail'|'not_configured'], latency_ms integer NULL, message text NULL, checked_at timestamptz)
  Upsert onConflict: 'vendor_name'
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: deno.json + Fn skeleton (dual-auth gate, types, registry scaffold)</name>
  <files>supabase/functions/vendor-smoke/deno.json, supabase/functions/vendor-smoke/index.ts</files>
  <action>
Create `supabase/functions/vendor-smoke/deno.json` mirroring `mux-create-upload/deno.json`, with one deliberate divergence: set `tasks.test` to `deno test --no-check index.test.ts` (target the FILE `index.test.ts`, NOT the directory `.`). RATIONALE: the project's `Deno.serve()` is not guarded by `import.meta.main`, so `deno test <dir>` would import every file in the dir, launch a real HTTP server on import, and hang the CI sweep (RESEARCH Pitfall 2 / [deno test top-level serve trap]). Targeting the single test file avoids importing nothing it doesn't already import explicitly. Also declare an `imports` block with `npm:@supabase/supabase-js@2` and `npm:@mux/mux-node@14` (both self-mapped), the `lint` recommended rules block, and `fmt` (useTabs false, lineWidth 100). Do NOT rely on `../import_map.json` — CLI v2.101.0 ignores it.

Create `supabase/functions/vendor-smoke/index.ts` as the structural copy of `baa-expiry-check/index.ts`. Import `checkServiceRoleBearer, bearerFromReq, corsHeaders, jsonError, jsonResponse, makeLazyAdmin` from `'../_shared/lifecycle-utils.ts'` (relative path, NOT alias). Instantiate `const { admin, setAdminForTest, resetAdminForTest } = makeLazyAdmin();`.

Declare the contract types: `SmokeStatus = 'ok' | 'fail' | 'not_configured'`; `SmokeResult { status: SmokeStatus; latency_ms: number | null; message: string | null }`; `VendorHandler { vendor_name: string; smoke: () => Promise<SmokeResult> }`. Add a `notConfigured()` helper returning `{ status:'not_configured', latency_ms:null, message:null }`.

Implement the dual-auth gate `isAuthorized(req)` per RESEARCH Pattern 2: return true if `checkServiceRoleBearer(req)` (cron path); else take `bearerFromReq(req)`, call `admin.auth.getUser(bearer)`, and verify the user's `profiles.is_staff === true` (staff-UI path). Return false on any miss. This honors the CONTEXT decision: internal-only, HMAC/service-role auth (cron) + staff-triggered, never public.

Stub an empty `const VENDOR_REGISTRY: VendorHandler[] = []` (handlers land in Task 2). Implement `handleRun()` that loops the registry, collects results into a `Record<vendor_name, SmokeResult>`, counts `failed`/`not_configured`, and for each vendor upserts `{ vendor_name, status, latency_ms, message, checked_at: new Date().toISOString() }` into `vendor_smoke_log` with `{ onConflict: 'vendor_name' }`. Return `jsonResponse(200, { ok: failed===0, checked, failed, not_configured, results })`.

Wire `Deno.serve`: OPTIONS → CORS 200; non-POST → `jsonError(405,'method_not_allowed')`; `!isAuthorized` → `jsonError(401,'unauthorized')`; wrap `handleRun` in try/catch logging only `e.name` (NEVER `e.message` — may leak Authorization header fragments per RESEARCH Pitfall 6) and returning `jsonError(500,'internal')`. Export `export const __internal = { handleRun, setAdminForTest, resetAdminForTest, VENDOR_REGISTRY }` for tests.
  </action>
  <verify>
    <automated>cd /Users/karstenhaldan/minisite && $HOME/.deno/bin/deno check --no-lock supabase/functions/vendor-smoke/index.ts 2>&1 | tail -5; grep -q "from '../_shared/lifecycle-utils.ts'" supabase/functions/vendor-smoke/index.ts && grep -q "onConflict: 'vendor_name'" supabase/functions/vendor-smoke/index.ts && grep -q 'deno test --no-check index.test.ts' supabase/functions/vendor-smoke/deno.json && ! grep -q 'deno test --no-check \.' supabase/functions/vendor-smoke/deno.json && echo GATES_OK</automated>
  </verify>
  <done>deno.json (test task targets index.test.ts, NOT the dir) + index.ts exist; isAuthorized dual-path present; handleRun upserts to vendor_smoke_log; error handler logs e.name only; __internal exported; deno check passes.</done>
</task>

<task type="auto">
  <name>Task 2: Per-vendor smoke handlers (fail-soft registry)</name>
  <files>supabase/functions/vendor-smoke/index.ts</files>
  <action>
Populate `VENDOR_REGISTRY` with one `VendorHandler` per vendor below. EVERY handler MUST be fail-soft: read its secret(s) via `Deno.env.get(...) ?? ''`; if ANY required secret is empty, `return notConfigured()` immediately (this satisfies the vendor-defer-to-70 contract — absent secrets are EXPECTED, not failures). When present, time the probe with `Date.now()` deltas, return `{status:'ok', latency_ms, message:null}` on success, `{status:'fail', latency_ms, message:'<short_code>'}` on probe failure. In every catch block log/record only a fixed code (e.g. `'network_error'`) — NEVER the caught error message.

Use these CANONICAL env var names (code is authoritative over REQUIREMENTS.md aliases — note the reconciliation in a code comment):
- Mux (VENDOR-04): `MUX_TOKEN_ID` + `MUX_TOKEN_SECRET`. GET `https://api.mux.com/video/v1/assets?limit=1` Basic auth `btoa(id+':'+secret)`. 200 or 404 → ok; 401 → fail `invalid_credentials`; other non-2xx → fail `http_<status>`.
- Calendly (VENDOR-05): `CALENDLY_API_KEY`. GET `https://api.calendly.com/users/me` Bearer. 200 → ok; 401 → fail `invalid_api_key`. (Do NOT smoke the OAuth client creds `CALENDLY_OAUTH_CLIENT_ID`/`CALENDLY_OAUTH_CLIENT_SECRET` — they need a full OAuth dance; they are registered in the runbook only. Per A11: REQUIREMENTS.md says `CALENDLY_CLIENT_ID` but code/this phase use `CALENDLY_OAUTH_CLIENT_ID`.)
- Better Stack (VENDOR-06): `BETTER_STACK_API_KEY`. GET `https://uptime.betterstack.com/api/v2/monitors` Bearer. 200 → ok; 401 → fail.
- Sentry (VENDOR-07): `SENTRY_DSN`. Parse `https://<key>@<host>/<project_id>`; HEAD `https://<host>/api/<project_id>/envelope/`. 200 or any 4xx (405 expected for HEAD) → ok (reachable); parse failure → fail `invalid_dsn_format`; network error → fail `unreachable`.
- Anthropic clinical (VENDOR-08): `ANTHROPIC_CLINICAL_API_KEY` (per A13 — code at ai-chat/index.ts:45 uses this name, NOT REQUIREMENTS.md's `ANTHROPIC_API_KEY_CLINICAL`). POST `https://api.anthropic.com/v1/messages` headers `x-api-key` + `anthropic-version: 2023-06-01`, body `{model:'claude-haiku-3-5', max_tokens:1, messages:[{role:'user',content:'hi'}]}`. 200 → ok; 400 → ok (key authenticated, body malformed is not a key fault); 401 → fail.
- Anthropic consumer (VENDOR-08): `ANTHROPIC_API_KEY` — same probe as clinical.
- Stripe (VENDOR-09): `STRIPE_SECRET_KEY`. GET `https://api.stripe.com/v1/balance` Bearer. 200 → ok; 401 → fail `invalid_key`.
- Resend (VENDOR-09): `RESEND_API_KEY`. Reuse `_shared/resend-domain-health-check.ts` (GET /domains) if importable; otherwise inline GET `https://api.resend.com/domains` Bearer. 200 → ok; 401 → fail.
- PostHog (VENDOR-09): `POSTHOG_PERSONAL_API_KEY` + `POSTHOG_PROJECT_ID`. GET `https://app.posthog.com/api/projects/<id>/` Bearer. 200 → ok; 401/403 → fail.
- Slack (VENDOR-09): `SLACK_WEBHOOK_EXPERIMENTS_URL`. POST minimal `{text:'[vendor-smoke] connectivity test — ignore'}`. 200 → ok; else fail. (Note in runbook: smoke posts a test message.)
- FCM/Google Play (VENDOR-02): `PLAY_SERVICE_ACCOUNT_JSON`. If present, parse JSON, mint OAuth2 token at `https://oauth2.googleapis.com/token` (scope `https://www.googleapis.com/auth/firebase.messaging`). 200 with access_token → ok; parse/mint failure → fail.
- Apple/APNs (VENDOR-01): require `APNS_KEY_ID` + `APNS_TEAM_ID` + `APNS_P8_KEY` + `APPLE_TEAM_ID` + `APPLE_BUNDLE_ID`. If all present, attempt an ES256 JWT mint (no APNs HTTP/2 call — needs a device token); mint success → ok. Any missing → notConfigured. (Per A1: if ES256 mint proves unworkable in Deno, fall back to presence-check-only → ok when all set; record this fallback in the SUMMARY.)

These vendors record `not_configured` ALWAYS with an explanatory message (no server smoke exists — EXPECTED, not a failure):
- HealthKit (VENDOR-03): message `'entitlement_ios_only_no_server_smoke'`.
- AdMob/AdSense (client SDK IDs only): one registry entry `'AdMob/AdSense'`, message `'client_sdk_only_no_server_smoke'`.
- SHARE_TOKEN_SECRET / QUARTERLY_NPS_SIGNING_KEY (VENDOR-09 internal HMAC keys, no external endpoint): presence-check only — `ok` if the env is set, else `not_configured`; message null.

Do NOT introduce any new npm package — `fetch` (Deno built-in) covers every HTTP probe; `npm:@mux/mux-node@14` is already declared in deno.json if you prefer the SDK for Mux (fetch is sufficient).
  </action>
  <verify>
    <automated>cd /Users/karstenhaldan/minisite && $HOME/.deno/bin/deno check --no-lock supabase/functions/vendor-smoke/index.ts 2>&1 | tail -5; node -e "const s=require('fs').readFileSync('supabase/functions/vendor-smoke/index.ts','utf8').replace(/^\s*\/\/.*$/gm,''); const need=['Mux','Calendly','Better Stack','Sentry','Stripe','Resend','PostHog','Slack','HealthKit','AdMob']; const miss=need.filter(n=>!s.includes(n)); if(miss.length){console.error('MISSING vendors:',miss);process.exit(1)} if(!/ANTHROPIC_CLINICAL_API_KEY/.test(s)){console.error('clinical key name wrong');process.exit(1)} if(/e\.message/.test(s)){console.error('e.message leak risk');process.exit(1)} console.log('REGISTRY_OK')"</automated>
  </verify>
  <done>All listed vendors present in VENDOR_REGISTRY; canonical env names used (CALENDLY_OAUTH_CLIENT_ID not smoked, ANTHROPIC_CLINICAL_API_KEY used); HealthKit + AdMob always not_configured; no `e.message` logged; deno check passes.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 3: Fn unit tests (auth gate + handler statuses + upsert)</name>
  <files>supabase/functions/vendor-smoke/index.test.ts</files>
  <behavior>
    - isAuthorized: request with valid service-role bearer → authorized (cron path)
    - isAuthorized: request with no bearer → 401 unauthorized
    - handleRun: with all vendor secrets unset, every result is 'not_configured' and zero 'fail'
    - handleRun: a stubbed probe returning HTTP 200 yields status 'ok' with numeric latency_ms
    - handleRun: a stubbed probe returning HTTP 401 yields status 'fail' with a short message code
    - handleRun: upserts exactly one row per registry entry into vendor_smoke_log via the injected admin stub (assert onConflict vendor_name and row shape)
  </behavior>
  <action>
Create `supabase/functions/vendor-smoke/index.test.ts` using `Deno.test`. Import the testable surface from `./index.ts` via `__internal` and use `setAdminForTest`/`resetAdminForTest` to inject a fake admin client that records `.from('vendor_smoke_log').upsert(...)` calls and stubs `.auth.getUser()` + `.from('profiles').select().eq().single()`.

Cover the six behaviors above. For probe-status tests, stub `globalThis.fetch` (save/restore in try/finally) to return crafted `Response` objects, then assert the resulting SmokeResult status + latency type. For the all-unset case, ensure `Deno.env` has no vendor secrets (do not set them) and assert no result is `'fail'`.

CRITICAL: run tests against the FILE, never the directory — `deno test --no-check index.test.ts`. The project's `Deno.serve()` is not `import.meta.main`-guarded, so `deno test <dir>` would start a real server and hang (RESEARCH Pitfall 2). The deno.json `test` task is set in Task 1 to `deno test --no-check index.test.ts` (file-targeted, NOT `.`); the verify command below targets that same single file explicitly.
  </action>
  <verify>
    <automated>cd /Users/karstenhaldan/minisite && $HOME/.deno/bin/deno test --no-check supabase/functions/vendor-smoke/index.test.ts 2>&1 | tail -15</automated>
  </verify>
  <done>All Deno tests pass; auth-gate, not_configured/ok/fail status, and upsert-shape assertions covered; test run completes without launching an HTTP server.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| cron → Fn | pg_cron posts with vault service-role bearer (untrusted until bearer verified) |
| staff browser → Fn | `supabase.functions.invoke` forwards user JWT (untrusted until is_staff verified) |
| Fn → vendor APIs | outbound probes carry secrets in Authorization headers |
| vendor API error → smoke log | error text could echo back into persisted `message` |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-52-01 | Spoofing | Fn auth gate | mitigate | `isAuthorized` requires service-role bearer (constant-time via `checkServiceRoleBearer`) OR validated staff JWT (`profiles.is_staff`); never public |
| T-52-02 | Information Disclosure | catch blocks / smoke log message | mitigate | Log/record only fixed codes + `e.name`; NEVER `e.message` or response body (may carry Authorization fragments) — verify gate greps for `e.message` |
| T-52-03 | Elevation of Privilege | staff-trigger path | mitigate | JWT path verifies `profiles.is_staff === true` before running; anon/non-staff JWT → 401 |
| T-52-04 | Tampering (SSRF) | vendor probe URLs | accept | All probe URLs are hardcoded in the registry; no URL is built from request body — no SSRF vector |
| T-52-05 | Information Disclosure | timing oracle on bearer | mitigate | `constantTimeEqual` inside `checkServiceRoleBearer` (shared util); no hand-rolled `===` compare |
| T-52-SC | Tampering | npm/deno installs | accept | No new packages introduced; only pre-existing `npm:@supabase/supabase-js@2` + `npm:@mux/mux-node@14` (RESEARCH Package Legitimacy Audit: no slopcheck required) |
</threat_model>

<verification>
- `$HOME/.deno/bin/deno check --no-lock supabase/functions/vendor-smoke/index.ts` passes.
- `$HOME/.deno/bin/deno test --no-check supabase/functions/vendor-smoke/index.test.ts` passes (file-targeted; no HTTP server hang).
- `deno.json` `tasks.test` = `deno test --no-check index.test.ts` (file, not `.`) — confirmed by Task 1 grep gate.
- Registry covers all VENDOR-01..09 + VENDOR-11; canonical env names used; fail-soft on absent secrets.
- DEPLOY ORDERING (close-out, not this plan): the `vendor-smoke` Fn MUST be deployed BEFORE plan 52-02's cron migration is `db push`ed (cron fires within 15 min of push to a non-existent endpoint otherwise). Surface this in the SUMMARY for the close-out sequence.
</verification>

<success_criteria>
vendor-smoke Fn exists with dual-auth, a fail-soft per-vendor registry, and vendor_smoke_log upsert; unit tests green; deno.json test task targets the file (no CI hang); no new packages; no secret-leaking logs.
</success_criteria>

<output>
Create `.planning/phases/52-vendor-setup-foundation/52-01-SUMMARY.md` when done. Record: any A1 (APNs) fallback taken; whether Resend handler reused the shared health-check util; the deno.json file-targeted test task (vs dir) fix; the Fn-deploy-before-db-push ordering note for close-out.
</output>
