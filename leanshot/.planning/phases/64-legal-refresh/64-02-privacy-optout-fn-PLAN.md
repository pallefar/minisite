---
phase: 64-legal-refresh
plan: 02
type: execute
wave: 2
depends_on:
  - 64-01
files_modified:
  - supabase/functions/privacy-optout-process/index.ts
  - supabase/functions/privacy-optout-process/handler.ts
  - supabase/functions/privacy-optout-process/deno.json
  - supabase/functions/privacy-optout-process/__tests__/handler.test.ts
  - supabase/functions/privacy-optout-process/templates/optout-confirmation.html
  - supabase/functions/privacy-optout-process/templates/optout-confirmation.txt
autonomous: true
requirements:
  - LEGAL-02
user_setup: []

must_haves:
  truths:
    - "POST /privacy-optout-process accepts a Do-Not-Sell submission and writes one privacy_optout_requests row"
    - "The same submission fan-outs to ad_targeting_exclusion + email_lifecycle_exclusion (per-source-tag='do_not_sell') in the SAME Fn invocation — NOT a queue (per INSIGHTS-09 lesson from Phase 62)"
    - "The same submission calls PostHog server-side opt-out via the existing posthog-server.ts helper"
    - "The same submission sends a Resend confirmation email to the submitter's email"
    - "propagated_at on privacy_optout_requests is set to now() ONLY after all fan-outs succeed (or are skipped with documented reason)"
    - "GET /healthz returns {ok:true, fn:'privacy-optout-process'}"
  artifacts:
    - path: "supabase/functions/privacy-optout-process/index.ts"
      provides: "Deno.serve entry guarded by import.meta.main"
      contains: "if (import.meta.main)"
    - path: "supabase/functions/privacy-optout-process/handler.ts"
      provides: "POST handler + dependency-injected deps interface for test"
      exports: ["handle", "PrivacyOptoutDeps"]
    - path: "supabase/functions/privacy-optout-process/__tests__/handler.test.ts"
      provides: "Deno test exercising happy path + duplicate email idempotency + missing fields 400"
    - path: "supabase/functions/privacy-optout-process/templates/optout-confirmation.html"
      provides: "Resend HTML email body referencing user name + state + 24h propagation copy"
  key_links:
    - from: "handler.ts"
      to: "privacy_optout_requests INSERT"
      via: ".from('privacy_optout_requests').insert(…)"
      pattern: "privacy_optout_requests.*insert"
    - from: "handler.ts"
      to: "ad_targeting_exclusion + email_lifecycle_exclusion fan-out"
      via: "two separate .from(…).upsert calls"
      pattern: "(ad_targeting_exclusion|email_lifecycle_exclusion).*(insert|upsert)"
    - from: "handler.ts"
      to: "PostHog server-side opt-out"
      via: "import + invocation of opt-out helper"
      pattern: "posthog.*(opt_out|opt-out|optOut|capture)"
    - from: "handler.ts"
      to: "Resend confirmation email"
      via: "fetch POST https://api.resend.com/emails using _shared/lifecycle-send.ts pattern"
      pattern: "api\\.resend\\.com/emails|lifecycle-send"
---

<objective>
Ship the `privacy-optout-process` Edge Function that handles `/privacy/do-not-sell` form POSTs. The function persists the opt-out request and fan-outs to PostHog opt-out + ad_targeting_exclusion + email_lifecycle_exclusion + sends a Resend confirmation email — all inline in a single Fn invocation per the **INSIGHTS-09 lesson from Phase 62** captured in the planning directive: *"opt-out propagation Edge Fn MUST directly write to PostHog opt-out list + ad_targeting_exclusion + email_lifecycle_exclusion tables — NOT to a queue that no consumer reads"*.

Purpose: LEGAL-02 requires CCPA Do-Not-Sell opt-out propagation within 24h. Fan-out-in-Fn pattern guarantees synchronous propagation (sub-second) instead of waiting on a cron.

Output: New Edge Fn `privacy-optout-process` with handler/index split per [[reference_deno_test_top_level_serve_trap]], deno tests, Resend confirmation templates. Deploy is deferred to Plan 64-08 close-out per [[feedback_fn_deploy_before_cron_db_push]] (no cron here, but maintains close-out discipline).
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/phases/64-legal-refresh/64-CONTEXT.md
@.planning/phases/64-legal-refresh/64-01-SUMMARY.md

<!-- Reuse targets (named explicitly per [[feedback_planner_prompt_explicit_reuse_targets]]) -->
@supabase/functions/rag-newsletter-sender/handler.ts
@supabase/functions/rag-newsletter-sender/index.ts
@supabase/functions/_shared/lifecycle-send.ts
@supabase/functions/_shared/posthog-server.ts

<interfaces>
<!-- _shared/lifecycle-send.ts (Phase 22) — Resend direct-HTTPS POST helper -->
async function sendLifecycleEmail(args: {
  to: string;
  subject: string;
  html: string;
  text: string;
  // RESEND_API_KEY=test-stub → returns { ok:true, stubbed:true } per Pitfall 6
}): Promise<{ ok: boolean; id?: string; stubbed?: boolean; error?: string }>

<!-- _shared/posthog-server.ts (Phase 24) — captureServer pattern; for opt-out the Fn must invoke PostHog `/decide` or the dedicated /opt-out path -->
<!-- IMPORTANT: posthog-node SDK exposes server-side identify with $process_person_profile=false; for full opt-out call
  POST https://us.i.posthog.com/capture with event=$opt_out + distinct_id=user_id (or email-hash if no user_id)
  Reuse posthog-server.ts's getClient() lazy singleton; add an exported `optOutServer(distinctId)` helper there
  OR invoke directly using POSTHOG_PROJECT_KEY env var. -->

<!-- Newsletter sender Fn (Phase 60-12) is the strongest analog for handler/index split + Resend integration -->
<!-- supabase/functions/rag-newsletter-sender/index.ts shows the import.meta.main guard pattern -->
<!-- supabase/functions/rag-newsletter-sender/handler.ts shows DI pattern via Deps interface -->
</interfaces>

<!-- Migration head from Plan 64-01 -->
<!-- privacy_optout_requests, ad_targeting_exclusion, email_lifecycle_exclusion tables — see 64-01 SUMMARY -->
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Implement privacy-optout-process handler + Deno tests</name>
  <files>
    supabase/functions/privacy-optout-process/handler.ts,
    supabase/functions/privacy-optout-process/__tests__/handler.test.ts,
    supabase/functions/privacy-optout-process/deno.json,
    supabase/functions/privacy-optout-process/templates/optout-confirmation.html,
    supabase/functions/privacy-optout-process/templates/optout-confirmation.txt
  </files>
  <behavior>
    - Test 1: POST with valid {name, email, state_residency:'CA', opt_out_scope:['advertising','sale']} → 200 + JSON { ok:true, request_id, propagated_at }; verifies one row in privacy_optout_requests + one row in ad_targeting_exclusion + one row in email_lifecycle_exclusion (mocked supabase client records call args)
    - Test 2: Missing required field (no email) → 400 + { error:'email is required' }; NO database writes
    - Test 3: Invalid state_residency 'XX' → 400 + { error:'state_residency must be one of CA/VA/CO/CT/UT/OTHER' }; NO database writes
    - Test 4: Duplicate submission (same email within last 24h) → 200 + { ok:true, idempotent:true } — does NOT create duplicate row, returns existing request_id
    - Test 5: Resend API stubbed (RESEND_API_KEY=test-stub) → confirmation email returns { stubbed:true } and Fn still returns 200 + sets confirmation_email_sent_at
    - Test 6: PostHog opt-out failure (network mock returns 500) → Fn STILL returns 200 (PostHog is best-effort fan-out — logged but does not fail the request); propagated_at set only if at least the DB-table fan-outs succeed
    - Test 7: GET /healthz → 200 + { ok:true, fn:'privacy-optout-process' }
  </behavior>
  <action>
    Mirror the handler/index/Deps DI pattern from `supabase/functions/rag-newsletter-sender/handler.ts` (Phase 60-12).

    Export from `handler.ts`:
    `interface PrivacyOptoutDeps { fetchImpl: typeof fetch; supabaseServiceClient: ReturnType&lt;typeof createClient&gt;; resendApiKey: string; posthogProjectKey: string | null; supabaseUrl: string; }`
    `export async function handle(req: Request, deps: PrivacyOptoutDeps): Promise&lt;Response&gt;`

    Request validation (zod-free; manual checks per Phase 60 stripControlChars precedent):
    - Reject if Content-Type ≠ application/json
    - Parse body; reject missing/empty `name`, `email` (regex `/^[^\s@]+@[^\s@]+\.[^\s@]+$/`), `state_residency` (∈ CA/VA/CO/CT/UT/OTHER), `opt_out_scope` (1-3 items from advertising/sale/sharing)
    - Strip control chars from name + email using `/[\x00-\x1F\x7F]/g` per CR-02 Phase 60 fix
    - Reject bodies &gt; 4 KB

    Idempotency: SELECT existing row WHERE email = $1 AND submitted_at &gt; now() - interval '24 hours'; if found, return `{ ok:true, idempotent:true, request_id }` without further work.

    Fan-out (in order; collect outcomes):
    1. INSERT into privacy_optout_requests; capture id + request_ip (from X-Forwarded-For) + request_user_agent
    2. UPSERT into ad_targeting_exclusion with conflict-on-email (unauth path) or conflict-on-user_id (if auth user)
    3. UPSERT into email_lifecycle_exclusion same pattern
    4. PostHog opt-out: best-effort POST to `https://us.i.posthog.com/capture` with event=$opt_out + distinct_id=user_id-or-email; on failure log warning + continue
    5. Send Resend confirmation email using `_shared/lifecycle-send.ts` `sendLifecycleEmail({ to:email, subject:"We received your Do-Not-Sell request", html:&lt;loaded from optout-confirmation.html&gt;, text:&lt;loaded from optout-confirmation.txt&gt; })` — substitute `{{name}}` + `{{state}}` + `{{submitted_at}}` placeholders
    6. UPDATE privacy_optout_requests SET propagated_at = now(), confirmation_email_sent_at = now() WHERE id = $request_id

    Templates: HTML + plain-text variants per UI-SPEC §7 + D-Do-Not-Sell-Opt-Out copy. HTML uses inline-style table layout (Resend best practice — Phase 60-12 precedent). Subject line: `"We received your Do-Not-Sell request — confirmation"`. Body mentions 24h propagation SLA + privacy@leanshot.app contact + the user's state-residency selection.

    Rate-limiting: by request_ip in the last 60 minutes. If &gt; 10 submissions from same IP → return 429 + { error:'Too many requests; try again later' }.

    Write `deno.json` mirroring `supabase/functions/rag-newsletter-sender/deno.json` (imports map; no `--import-map` flag per [[reference_supabase_functions_deploy_import_map_flag]]).

    Tests live in `__tests__/handler.test.ts` and mock `fetchImpl` + `supabaseServiceClient` via a tiny inline mock. Use Deno.test with --no-check flag invocation path documented in close-out (cannot run locally per [[reference_deno_test_top_level_serve_trap]] — orchestrator close-out runs them post-deploy if at all).
  </action>
  <verify>
    <automated>
      cd /Users/karstenhaldan/minisite &amp;&amp;
      test -f supabase/functions/privacy-optout-process/handler.ts &amp;&amp;
      test -f supabase/functions/privacy-optout-process/__tests__/handler.test.ts &amp;&amp;
      test -f supabase/functions/privacy-optout-process/templates/optout-confirmation.html &amp;&amp;
      test -f supabase/functions/privacy-optout-process/templates/optout-confirmation.txt &amp;&amp;
      test -f supabase/functions/privacy-optout-process/deno.json &amp;&amp;
      grep -q "export async function handle" supabase/functions/privacy-optout-process/handler.ts &amp;&amp;
      grep -q "PrivacyOptoutDeps" supabase/functions/privacy-optout-process/handler.ts &amp;&amp;
      grep -qE "privacy_optout_requests|ad_targeting_exclusion|email_lifecycle_exclusion" supabase/functions/privacy-optout-process/handler.ts &amp;&amp;
      grep -q "Deno.test\|test(" supabase/functions/privacy-optout-process/__tests__/handler.test.ts &amp;&amp;
      echo OK
    </automated>
  </verify>
  <done>
    Handler exports `handle` + `PrivacyOptoutDeps`.
    Tests cover 7 behavior cases listed in behavior block.
    Confirmation email templates load via fs read (use Deno.readTextFile or string-inlined as ES module export).
    `deno.json` declares the import map.
  </done>
</task>

<task type="auto">
  <name>Task 2: Wire index.ts Deno.serve entry + production deps</name>
  <files>supabase/functions/privacy-optout-process/index.ts</files>
  <action>
    Create thin entry mirroring `supabase/functions/rag-newsletter-sender/index.ts`:

    File header docstring: "Phase 64 Plan 64-02. Triggered by POST from `/privacy/do-not-sell` form (no auth). GET /healthz returns 200 ok. NO cron. Deploy in Plan 64-08."

    Imports: `import { handle } from './handler.ts';` and `import { createClient } from 'npm:@supabase/supabase-js@2';`

    Production deps factory: read `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `RESEND_API_KEY`, `POSTHOG_PROJECT_KEY` (nullable — captureServer is no-op when missing per posthog-server.ts pattern). Construct service-role supabase client. Pass into `handle(req, deps)`.

    Guard with `if (import.meta.main) Deno.serve(async (req) =&gt; handle(req, makeProdDeps()));` per [[reference_deno_test_top_level_serve_trap]].

    DO NOT deploy from this plan. Plan 64-08 close-out runs `npx supabase functions deploy privacy-optout-process --project-ref ytnsipxxmzgaebkqmokp`.
  </action>
  <verify>
    <automated>
      cd /Users/karstenhaldan/minisite &amp;&amp;
      test -f supabase/functions/privacy-optout-process/index.ts &amp;&amp;
      grep -q "if (import.meta.main)" supabase/functions/privacy-optout-process/index.ts &amp;&amp;
      grep -q "Deno.serve" supabase/functions/privacy-optout-process/index.ts &amp;&amp;
      grep -q "from './handler.ts'" supabase/functions/privacy-optout-process/index.ts &amp;&amp;
      echo OK
    </automated>
  </verify>
  <done>
    index.ts imports handler, builds prod deps from env, wraps Deno.serve in import.meta.main guard.
    No deploy command executed.
  </done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| anonymous public Internet → POST /privacy-optout-process | unauthenticated PII (name + email + state + scope); no Authorization header |
| Edge Fn → PostHog cloud API | best-effort fan-out; PostHog can fail without failing the user request |
| Edge Fn → Resend api.resend.com/emails | confirmation email; failure logged but does NOT block propagation |
| Edge Fn → Postgres (privacy_optout_requests + ad_targeting_exclusion + email_lifecycle_exclusion) | service role bypass of RLS — MUST validate inputs before INSERT |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-64-02-01 | Spoofing | attacker submits opt-out on victim's email | mitigate | Confirmation email Round-trips ownership; attacker cannot withdraw victim's opt-in without controlling victim email. Ad exclusion has minimal abuse vector (no positive privilege gained); accept residual risk. |
| T-64-02-02 | Tampering | bypassing CHECK constraints via direct HTTP | mitigate | Manual zod-free validation in handler.ts BEFORE INSERT (state_residency whitelist, opt_out_scope ∈ {advertising,sale,sharing}, email regex, name length cap 200 chars) |
| T-64-02-03 | Tampering | unicode control char injection (CR-02 Phase 60 lesson) | mitigate | Strip /[\x00-\x1F\x7F]/g from name + email before insert |
| T-64-02-04 | Repudiation | user denies opt-out submission | mitigate | privacy_optout_requests stores request_ip + request_user_agent + submitted_at; Resend message_id recorded for delivery audit |
| T-64-02-05 | Information Disclosure | error message leaks DB schema | mitigate | All error responses use generic strings `{ error: 'invalid request' }` — never echo SQL/Postgres errors. Stack traces logged via console.error only. |
| T-64-02-06 | Denial of Service | flood of fake submissions consuming Resend quota + DB rows | mitigate | Per-IP rate limit 10/h via SELECT count from privacy_optout_requests grouped by request_ip; 429 above threshold. CAPTCHA deferred to Phase 70 if abuse observed in prod. |
| T-64-02-07 | Elevation of Privilege | service-role bearer leakage | mitigate | RESEND_API_KEY + service role key read from Deno.env only; never echoed. Confirmation email body MUST NOT contain service-role-derived data (per privacy_optout_requests row only). |
| T-64-02-SC | Tampering | npm imports (npm:@supabase/supabase-js@2) | mitigate | Supabase-js already audited in Phase 60; legitimacy table covers. No new packages introduced. |
</threat_model>

<verification>
- Deno tests pass for all 7 behavior cases (mocked supabase + fetch)
- `grep -q 'privacy_optout_requests\|ad_targeting_exclusion\|email_lifecycle_exclusion' handler.ts` succeeds — confirms direct table writes, NOT queue (INSIGHTS-09 lesson)
- index.ts honors import.meta.main guard
- `npx tsc --noEmit -p leanshot/tsconfig.app.json` unaffected (Edge Fn is Deno-only, not in app tsconfig)
- Plan 64-08 deploys via `supabase functions deploy privacy-optout-process --project-ref ytnsipxxmzgaebkqmokp` and curl-tests POST + GET /healthz
</verification>

<success_criteria>
- 6 new files committed under `supabase/functions/privacy-optout-process/`
- Fan-out is synchronous in-Fn (NO queue intermediary)
- Confirmation email template references {{name}} + {{state}} + 24h SLA copy
- Deploy deferred to Plan 64-08
</success_criteria>

<output>
Create `.planning/phases/64-legal-refresh/64-02-SUMMARY.md` per `$HOME/.claude/get-shit-done/templates/summary.md` when done.
</output>
