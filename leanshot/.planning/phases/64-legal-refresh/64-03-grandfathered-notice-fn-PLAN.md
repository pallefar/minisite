---
phase: 64-legal-refresh
plan: 03
type: execute
wave: 1
depends_on: []
files_modified:
  - supabase/functions/grandfathered-policy-notice/index.ts
  - supabase/functions/grandfathered-policy-notice/handler.ts
  - supabase/functions/grandfathered-policy-notice/deno.json
  - supabase/functions/grandfathered-policy-notice/__tests__/handler.test.ts
  - supabase/functions/grandfathered-policy-notice/templates/policy-notice.html
  - supabase/functions/grandfathered-policy-notice/templates/policy-notice.txt
autonomous: true
requirements:
  - LEGAL-09
user_setup: []

must_haves:
  truths:
    - "POST /grandfathered-policy-notice with service-role bearer enumerates pre-cutoff users + sends one Resend email each"
    - "Re-invocation is idempotent: users with policy_notice_log row are skipped (INSERT ... ON CONFLICT (user_id) DO NOTHING)"
    - "Email honors email_marketing_consent + email_lifecycle_exclusion (skip if either disables)"
    - "GET /healthz returns 200 + { ok:true, fn:'grandfathered-policy-notice' }"
    - "Subject line is 'Updated Privacy Policy & Terms — your data, your control' per D-Grandfathered-Notice-Email"
    - "ACTUAL SEND of the campaign is deferred to Phase 70 UAT operator action — this plan deploys the Fn only"
  artifacts:
    - path: "supabase/functions/grandfathered-policy-notice/index.ts"
      provides: "Deno.serve entry guarded by import.meta.main"
      contains: "if (import.meta.main)"
    - path: "supabase/functions/grandfathered-policy-notice/handler.ts"
      provides: "POST handler with batch enumeration + ON CONFLICT idempotency"
      exports: ["handle", "GrandfatheredNoticeDeps"]
    - path: "supabase/functions/grandfathered-policy-notice/templates/policy-notice.html"
      provides: "Resend HTML body with policy summary + What Changed + What You Can Do + unsubscribe"
    - path: "supabase/functions/grandfathered-policy-notice/__tests__/handler.test.ts"
      provides: "Deno test exercising happy path + idempotent skip + email_marketing_consent=false skip"
  key_links:
    - from: "handler.ts"
      to: "auth.users + policy_notice_log + email_lifecycle_exclusion"
      via: "SELECT then INSERT ... ON CONFLICT DO NOTHING per user"
      pattern: "policy_notice_log.*on conflict"
    - from: "handler.ts"
      to: "Resend api.resend.com/emails via _shared/lifecycle-send.ts"
      via: "sendLifecycleEmail per recipient (NOT bulk BCC — same pattern as rag-newsletter-sender T-60-12-10)"
      pattern: "lifecycle-send|api\\.resend\\.com/emails"
---

<objective>
Ship `grandfathered-policy-notice` Edge Fn: a one-shot lifecycle send to all pre-Phase-64 registered users notifying of the policy update per D-Grandfathered-Notice-Email + LEGAL-09. **The Fn is deployed by Plan 64-08 close-out but the actual send is an operator action at Phase 70 UAT** — the operator manually invokes the Fn with service-role bearer once they're satisfied with the legal copy review.

Purpose: LEGAL-09 requires one-shot notification of policy update to existing users with CAN-SPAM-compliant unsubscribe. The Fn is built + deployed now so Phase 70 UAT can run it without further code work.

Output: Edge Fn + Resend HTML/plain templates + Deno tests + idempotent INSERT pattern using `policy_notice_log` PK constraint from Plan 64-01.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/phases/64-legal-refresh/64-CONTEXT.md

<!-- Reuse targets (named explicitly per [[feedback_planner_prompt_explicit_reuse_targets]]) -->
@supabase/functions/rag-newsletter-sender/handler.ts
@supabase/functions/rag-newsletter-sender/index.ts
@supabase/functions/_shared/lifecycle-send.ts

<interfaces>
<!-- _shared/lifecycle-send.ts -->
sendLifecycleEmail({ to, subject, html, text, listUnsubscribePost?, unsubscribeUrl? }):
  Promise&lt;{ ok:boolean; id?:string; stubbed?:boolean; error?:string }&gt;
  // RESEND_API_KEY=test-stub returns { ok:true, stubbed:true }

<!-- policy_notice_log table (Plan 64-01) -->
public.policy_notice_log (
  user_id uuid PK,
  sent_at timestamptz not null default now(),
  opened_at timestamptz,
  unsubscribed_at timestamptz,
  resend_message_id text
);
-- ON CONFLICT (user_id) DO NOTHING ensures idempotent re-runs.

<!-- email_lifecycle_exclusion (Plan 64-01) — skip enumeration if row exists for user.email OR user.id -->

<!-- profiles.email_marketing_consent — existing column (Phase 22) -->
-- LEFT JOIN profiles p ON p.id = u.id; skip if p.email_marketing_consent = false
</interfaces>

<!-- Auth-users source of truth — auth.users.email is the email column per [[reference_profiles_email_vs_auth_users_email]] -->
<!-- profiles has NO email column; MUST JOIN auth.users for email -->

<!-- Subject line (CONTEXT D-Grandfathered-Notice-Email) — "Updated Privacy Policy & Terms — your data, your control" -->
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Implement grandfathered-policy-notice handler + idempotent enumeration</name>
  <files>
    supabase/functions/grandfathered-policy-notice/handler.ts,
    supabase/functions/grandfathered-policy-notice/__tests__/handler.test.ts,
    supabase/functions/grandfathered-policy-notice/deno.json,
    supabase/functions/grandfathered-policy-notice/templates/policy-notice.html,
    supabase/functions/grandfathered-policy-notice/templates/policy-notice.txt
  </files>
  <behavior>
    - Test 1: POST with service-role bearer + valid request → enumerates auth.users WHERE created_at &lt; phase_64_ship_date AND id NOT IN (SELECT user_id FROM policy_notice_log) AND NOT EXISTS (email_lifecycle_exclusion match) AND profiles.email_marketing_consent != false; sends Resend email per recipient; INSERTs into policy_notice_log with ON CONFLICT DO NOTHING; returns 200 + { sent:N, skipped:M }
    - Test 2: Re-invocation immediately after Test 1 → 200 + { sent:0, skipped:N } — all users already in policy_notice_log; ZERO Resend calls
    - Test 3: User with email_marketing_consent=false → skipped + counted in `skipped`; NO Resend call; NO policy_notice_log row
    - Test 4: User in email_lifecycle_exclusion → skipped; NO Resend call; NO log row
    - Test 5: Missing/invalid service-role bearer → 401 + { error:'unauthorized' }; NO writes
    - Test 6: RESEND_API_KEY=test-stub → Resend returns stubbed:true; policy_notice_log row STILL written with resend_message_id='stubbed'; counter increments `sent`
    - Test 7: GET /healthz → 200 + { ok:true, fn:'grandfathered-policy-notice' }
  </behavior>
  <action>
    Mirror handler/Deps DI pattern from `supabase/functions/rag-newsletter-sender/handler.ts` (Phase 60-12).

    Export `interface GrandfatheredNoticeDeps { fetchImpl: typeof fetch; supabaseServiceClient: ReturnType&lt;typeof createClient&gt;; resendApiKey: string; serviceRoleKey: string; supabaseUrl: string; phase64ShipDate: string; /* ISO timestamp env var PHASE_64_SHIP_DATE */ }`.

    Auth check: read Authorization header; require `Bearer ${serviceRoleKey}` (constant-time compare per CR-04 Phase 60 fix). Per [[reference_supabase_service_role_key_format_divergence]] this is the new sb_secret_* token format. GET /healthz exempt.

    Enumeration query (SQL via supabase-js .rpc OR raw SQL via createClient(...).from('auth_users_pre_cutoff_view'). Simplest: use supabase-js with a CTE-equivalent JS-side filter):
    1. Read `phase64ShipDate` from `Deno.env.get('PHASE_64_SHIP_DATE')` env var (set at deploy time per D-Grandfathered-Notice-Email "Hardcoded `phase_64_ship_date` constant in Edge Fn — set at deploy time").
    2. Query candidate users: `SELECT u.id, u.email, p.email_marketing_consent FROM auth.users u LEFT JOIN public.profiles p ON p.id = u.id WHERE u.created_at &lt; $phase64ShipDate AND COALESCE(p.email_marketing_consent, true) = true LIMIT 5000` (cap to safety per Resend rate limit; subsequent invocations pick up remainder via the LEFT JOIN policy_notice_log exclusion).
    3. For each candidate: LEFT-JOIN exclude email_lifecycle_exclusion (by user_id OR email) AND policy_notice_log (by user_id). Skip rows present in either.
    4. For each remaining: send Resend email via `sendLifecycleEmail({ to:user.email, subject:'Updated Privacy Policy & Terms — your data, your control', html, text, unsubscribeUrl: ${SUPABASE_URL}/functions/v1/rag-newsletter-unsubscribe-1click?token=… })`. Reuse the unsubscribe-token mint from `_shared/newsletter-token.ts` if available; else add a generic `mintPolicyNoticeUnsubscribeToken(user_id)` HMAC pattern matching newsletter token shape (use `NEWSLETTER_UNSUBSCRIBE_SIGNING_KEY` already configured per memory.md Phase 60.5).
    5. INSERT into policy_notice_log VALUES ($user_id, now(), null, null, $resend_message_id) ON CONFLICT (user_id) DO NOTHING per D-Grandfathered-Notice-Email idempotency.

    Per-recipient (NOT BCC) per [[feedback_3_layer_must_never_invariant_pattern]] precedent + Phase 60 T-60-12-10.

    Templates: HTML + plain text. Subject EXACTLY `"Updated Privacy Policy & Terms — your data, your control"`. Body sections per D-Grandfathered-Notice-Email:
    - Header: "LeanShot policy update"
    - "What changed" — bullet list of subprocessors added in v1.4 (PostHog Session Replay, Anthropic, Mux, Stripe Connect, OpenRouter, Cohere, Resend, Sentry, pgvector recommender, traffic-attribution)
    - "Your data, your control" — CTAs: View privacy policy (link to https://leanshot.app/#/legal/privacy), Manage preferences (link to https://leanshot.app/account/data-rights), Do Not Sell (link to https://leanshot.app/privacy/do-not-sell)
    - CAN-SPAM footer: physical address per WR-02 Phase 60 lesson (NO `[placeholder]` strings — use actual address from `PHYSICAL_ADDRESS` env var; if env var is unset or contains `[`/`TODO`/`REPLACE_ME` the Fn returns 503 + emits Slack P1 alert per [[feedback_placeholder_string_runtime_guard_pattern]])
    - RFC 8058 List-Unsubscribe + List-Unsubscribe-Post headers (reuse `mintUnsubscribeToken` from `_shared/newsletter-token.ts`)

    deno.json: import map mirroring `rag-newsletter-sender/deno.json`.

    Tests mock supabase client + fetchImpl. Use Deno.test groups matching the 7 behavior cases.
  </action>
  <verify>
    <automated>
      cd /Users/karstenhaldan/minisite &amp;&amp;
      test -f supabase/functions/grandfathered-policy-notice/handler.ts &amp;&amp;
      test -f supabase/functions/grandfathered-policy-notice/__tests__/handler.test.ts &amp;&amp;
      test -f supabase/functions/grandfathered-policy-notice/templates/policy-notice.html &amp;&amp;
      test -f supabase/functions/grandfathered-policy-notice/templates/policy-notice.txt &amp;&amp;
      test -f supabase/functions/grandfathered-policy-notice/deno.json &amp;&amp;
      grep -q "export async function handle" supabase/functions/grandfathered-policy-notice/handler.ts &amp;&amp;
      grep -q "GrandfatheredNoticeDeps" supabase/functions/grandfathered-policy-notice/handler.ts &amp;&amp;
      grep -qi "on conflict.*do nothing\|onConflict" supabase/functions/grandfathered-policy-notice/handler.ts &amp;&amp;
      grep -q "Updated Privacy Policy" supabase/functions/grandfathered-policy-notice/handler.ts &amp;&amp;
      grep -qi "PHASE_64_SHIP_DATE" supabase/functions/grandfathered-policy-notice/handler.ts &amp;&amp;
      grep -q "PHYSICAL_ADDRESS" supabase/functions/grandfathered-policy-notice/handler.ts &amp;&amp;
      echo OK
    </automated>
  </verify>
  <done>
    Handler enumerates pre-cutoff users, skips opt-outs + already-sent, emits per-recipient Resend POST, writes ON CONFLICT-protected log row. Subject line exact. PHYSICAL_ADDRESS runtime guard present.
  </done>
</task>

<task type="auto">
  <name>Task 2: Wire index.ts Deno.serve entry</name>
  <files>supabase/functions/grandfathered-policy-notice/index.ts</files>
  <action>
    Thin entry mirroring `rag-newsletter-sender/index.ts`. File header docstring: "Phase 64 Plan 64-03. **OPERATOR-INVOKED at Phase 70 UAT** — service-role POST triggers one-shot grandfathered-notice send. Deploy in Plan 64-08. NO cron — send is manual."

    Imports `handle` from `./handler.ts`. Build prod deps from `Deno.env.get('SUPABASE_URL')`, `SUPABASE_SERVICE_ROLE_KEY`, `RESEND_API_KEY`, `PHASE_64_SHIP_DATE`. Construct service-role supabase client. Guard with `if (import.meta.main) Deno.serve(...)` per [[reference_deno_test_top_level_serve_trap]].
  </action>
  <verify>
    <automated>
      cd /Users/karstenhaldan/minisite &amp;&amp;
      test -f supabase/functions/grandfathered-policy-notice/index.ts &amp;&amp;
      grep -q "if (import.meta.main)" supabase/functions/grandfathered-policy-notice/index.ts &amp;&amp;
      grep -q "Deno.serve" supabase/functions/grandfathered-policy-notice/index.ts &amp;&amp;
      grep -q "OPERATOR-INVOKED" supabase/functions/grandfathered-policy-notice/index.ts &amp;&amp;
      echo OK
    </automated>
  </verify>
  <done>
    index.ts wraps Deno.serve under import.meta.main guard, builds deps from env, documents operator-invoked nature.
  </done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| operator → POST /grandfathered-policy-notice with service-role bearer | privileged invocation enumerating auth.users |
| Edge Fn → auth.users + profiles SELECT | reads all pre-cutoff user emails |
| Edge Fn → api.resend.com/emails | per-recipient send; rate-limited by Resend |
| Edge Fn → policy_notice_log INSERT | idempotent via PK ON CONFLICT |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-64-03-01 | Spoofing | unauthorized POST triggers mass email | mitigate | Authorization Bearer constant-time-compared against SUPABASE_SERVICE_ROLE_KEY; reject 401 otherwise |
| T-64-03-02 | Tampering | double-invocation duplicates emails | mitigate | policy_notice_log PK on user_id + ON CONFLICT DO NOTHING guarantees idempotency |
| T-64-03-03 | Repudiation | user denies receiving | mitigate | policy_notice_log records resend_message_id + sent_at; Resend dashboard cross-reference available |
| T-64-03-04 | Information Disclosure | Resend email body leaks PII | accept | Templates use only first_name + non-PII policy copy; no health data referenced |
| T-64-03-05 | Denial of Service | enumeration consumes Resend free tier quota | mitigate | LIMIT 5000 per invocation; operator must re-invoke for remainder (idempotent ON CONFLICT covers continuation) |
| T-64-03-06 | Tampering | placeholder `[address]` ships to production violating CAN-SPAM | mitigate | Runtime guard rejects PHYSICAL_ADDRESS env var matching `/\[|TODO|REPLACE_ME/` with 503 + Slack P1 alert per [[feedback_placeholder_string_runtime_guard_pattern]] |
| T-64-03-07 | Elevation of Privilege | service-role bearer leaked from operator's terminal | accept | Standard service-role secret hygiene; not unique to this Fn |
| T-64-03-SC | Tampering | npm imports | mitigate | Reuses existing supabase-js + newsletter-token already audited Phase 60 |
</threat_model>

<verification>
- Deno tests cover the 7 behavior cases in mocked supabase + fetch
- `grep "ON CONFLICT.*DO NOTHING\|onConflict" handler.ts` succeeds — idempotency guaranteed
- Subject line exact match `Updated Privacy Policy &amp; Terms — your data, your control`
- PHYSICAL_ADDRESS runtime guard present (per WR-02 Phase 60 CAN-SPAM lesson)
- Deploy is Plan 64-08; send is Phase 70 UAT operator action — NEVER auto-triggered
</verification>

<success_criteria>
- 6 new files committed under `supabase/functions/grandfathered-policy-notice/`
- Idempotent enumeration via policy_notice_log PK
- email_marketing_consent + email_lifecycle_exclusion both respected
- Subject + footer copy match D-Grandfathered-Notice-Email exactly
- Fn deployed by Plan 64-08; actual campaign send deferred to Phase 70 UAT
</success_criteria>

<output>
Create `.planning/phases/64-legal-refresh/64-03-SUMMARY.md` per `$HOME/.claude/get-shit-done/templates/summary.md` when done.
</output>
