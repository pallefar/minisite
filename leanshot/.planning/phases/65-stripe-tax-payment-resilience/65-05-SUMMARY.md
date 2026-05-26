---
phase: 65-stripe-tax-payment-resilience
plan: 05
subsystem: payments-dunning
tags: [edge-function, resend, can-spam, dunning, cron]
requires:
  - subscriptions.dunning_state column (migration 20290104000002)
  - dunning_emails_sent table (migration 20290104000003)
  - _shared/newsletter-token.ts (mintUnsubscribeToken + constantTimeEqual)
  - _shared/slack-guardrail-alert.ts (sendSlackGuardrailAlert)
provides:
  - supabase/functions/stripe-dunning-orchestrator/ Edge Fn (cron-callable)
  - 6 email templates in _shared/email-templates/dunning-{first,second,final}.{html,txt}
  - DunningOrchestratorDeps DI seam exported from handler.ts
affects:
  - 65-10 close-out (Fn deploy + pg_cron registration)
tech-stack:
  patterns:
    - Phase 64-03 grandfathered-policy-notice handler/index split
    - Phase 60 WR-02 CAN-SPAM PHYSICAL_ADDRESS placeholder guard (503 + Slack P1)
    - feedback_placeholder_string_runtime_guard_pattern (literal placeholder = 503)
    - reference_deno_test_top_level_serve_trap (import.meta.main guard)
    - reference_profiles_email_vs_auth_users_email (JOIN auth.users, not profiles)
key-files:
  created:
    - supabase/functions/stripe-dunning-orchestrator/handler.ts
    - supabase/functions/stripe-dunning-orchestrator/index.ts
    - supabase/functions/stripe-dunning-orchestrator/deno.json
    - supabase/functions/stripe-dunning-orchestrator/__tests__/handler.test.ts
    - supabase/functions/_shared/email-templates/dunning-first.html
    - supabase/functions/_shared/email-templates/dunning-first.txt
    - supabase/functions/_shared/email-templates/dunning-second.html
    - supabase/functions/_shared/email-templates/dunning-second.txt
    - supabase/functions/_shared/email-templates/dunning-final.html
    - supabase/functions/_shared/email-templates/dunning-final.txt
  modified: []
decisions:
  - "Bundled templates inline in handler.ts (renderHtmlForStage/renderTextForStage) — _shared/email-templates/*.{html,txt} files document canonical content but Fn renders from in-bundle copy to avoid runtime FS reads. Phase 65-10 close-out should add a static-grep gate matching the two copies."
  - "Candidate query via RPC get_dunning_orchestrator_candidates(intervals jsonb) — DB-side encapsulates the JOIN auth.users + COALESCE(email_marketing_consent,true) + NOT EXISTS email_lifecycle_exclusion + LIMIT 200 + send-interval gate. RPC SQL is registered in Plan 65-10 close-out (mirrors get_grandfathered_notice_candidates pattern from 64-03)."
  - "Stub path (resendApiKey='test-stub') short-circuits BEFORE fetch — increments sent counter without HTTP. Mirrors grandfathered-policy-notice convention."
  - "Defense-in-depth runtime placeholder guard on RENDERED body (not just env var) — if any future template edit leaves a literal [placeholder]/REPLACE_ME/TODO_TEMPLATE, the Fn 503s AND rolls back the inserted dunning_emails_sent row so the next cron tick can retry once the template is fixed."
metrics:
  duration_minutes: 8
  tasks_completed: 2
  files_created: 10
  files_modified: 0
  tests_passing: 13
  completed_date: "2026-05-26"
---

# Phase 65 Plan 05: Stripe Dunning Orchestrator Edge Fn Summary

Cron-driven dunning orchestrator Edge Fn (T+1d / T+3d / T+7d Resend emails for failing subscriptions) — handler.ts + index.ts + 6 email templates + 13 passing tests; deploy + cron registration deferred to close-out 65-10.

## What Shipped

### Edge Function: `supabase/functions/stripe-dunning-orchestrator/`

**handler.ts** (611 lines) — pure handler with DI seam (`DunningOrchestratorDeps`), mirrors Phase 64-03 `grandfathered-policy-notice/handler.ts` shape:

- **GET /healthz** → 200 `{ ok: true, fn: 'stripe-dunning-orchestrator' }` (exempt from bearer)
- **POST /** → service-role bearer required (constant-time compare via `_shared/newsletter-token.ts`)
- **PHYSICAL_ADDRESS guard** — 503 + Slack P1 if env var unset or matches `/\[|TODO|REPLACE_ME|PLACEHOLDER/i` (T-65-05-03 / Phase 60 WR-02)
- **Candidate query** — `supabaseServiceClient.rpc('get_dunning_orchestrator_candidates', { intervals })` (RPC SQL registered in close-out 65-10)
- **Per-row send loop**:
  1. `upsert` into `dunning_emails_sent` with `{ onConflict: 'subscription_id,stage', ignoreDuplicates: true }` — composite PK from migration 20290104000003 guarantees idempotency under cron-burst retries
  2. On insert success (new row): mint unsubscribe HMAC envelope, render stage-specific HTML+txt, POST to `https://api.resend.com/emails` per-recipient (NEVER bulk BCC — T-65-05-04)
  3. On Resend 200: UPDATE `dunning_emails_sent.resend_message_id` + UPDATE `subscriptions.last_dunning_email_at = now()`
  4. On Resend 4xx/5xx: DELETE the just-inserted `dunning_emails_sent` row (rollback for retry) + push `{ subscription_id, error: 'resend_failed' }` to errors[]
- **Defense-in-depth body guard** — after render, regex-scans the HTML+text for literal `[placeholder]` / `REPLACE_ME` / `TODO_TEMPLATE` / `TBD_TEMPLATE`; on match → 503 + Slack P1 + rollback (so retry can re-attempt once template is fixed)
- **Returns** 200 `{ sent: N, skipped: M, errors: [...] }`

**index.ts** — Deno.serve entry behind `if (import.meta.main)` guard (per `reference_deno_test_top_level_serve_trap`); reads env vars (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, RESEND_API_KEY, NEWSLETTER_UNSUBSCRIBE_SIGNING_KEY, PHYSICAL_ADDRESS) and constructs prod deps.

**deno.json** — imports map matching `grandfathered-policy-notice/deno.json` (std@0.224.0, shared/, supabase-js@2.45.0).

### Email templates (`supabase/functions/_shared/email-templates/`)

Six new templates (3 stages × 2 formats):

| File | Stage | Subject | Header Color | CTA |
|------|-------|---------|--------------|-----|
| `dunning-first.html` / `.txt` | `first_failed` | "We couldn't process your last payment" | teal `#0f766e` | "Update payment method" |
| `dunning-second.html` / `.txt` | `second_failed` | "Action needed: second payment attempt failed" | amber `#b45309` | "Update payment method" |
| `dunning-final.html` / `.txt` | `final_warning` | "Your subscription will be cancelled in 24 hours" | red `#b91c1c` | "Keep my subscription" |

All templates use `{{user_first_name}}`, `{{billing_portal_url}}`, `{{unsubscribe_url}}`, `{{physical_address}}` placeholders and link CTA to `https://app.leanshot.app/settings/billing` (in-app, per PAY-05 — NOT Stripe-hosted page). HTML version: inline CSS, 600px max-width, preheader text. Plain-text version: same content, no formatting. CAN-SPAM footer + RFC 8058 List-Unsubscribe link on every template.

### Tests (`__tests__/handler.test.ts`) — 13 passing

| # | Behavior | Status |
|---|----------|--------|
| 1 | GET /healthz returns 200 without bearer | pass |
| 2 | POST / without bearer returns 401 | pass |
| 3 | POST / with wrong bearer returns 401 (constant-time) | pass |
| 4 | POST / with PHYSICAL_ADDRESS=undefined returns 503 | pass |
| 5 | POST / with `[YOUR PHYSICAL ADDRESS]` placeholder returns 503 | pass |
| 6 | POST / sends 2 emails for 2 actionable first_failed rows | pass |
| 7 | POST / returns `skipped:1` when row is already in `dunning_emails_sent` (composite PK conflict) | pass |
| 8 | POST / honors `email_marketing_consent=false` (row skipped) | pass |
| 9 | POST / on Resend 500 rolls back the insert + records `errors[]` entry | pass |
| 10 | POST / sets `subscriptions.last_dunning_email_at = now()` on success | pass |
| 11 | POST / uses correct stage template (first/second/final) per `dunning_state` | pass |
| 12 | POST / `RESEND_API_KEY='test-stub'` short-circuits before fetch | pass |
| 13 | POST / no candidates → `{ sent:0, skipped:0, errors:[] }` | pass |

Run command:
```bash
$HOME/.deno/bin/deno test --no-check --allow-env --allow-net \
  supabase/functions/stripe-dunning-orchestrator/__tests__/handler.test.ts
# → ok | 13 passed | 0 failed
```

## How It Works

**Send-interval semantics** (encoded in RPC, defaults in `handler.ts`):
- `first_failed_hours = 24` — gate is hours since `dunning_state` transitioned to `first_failed` (`last_dunning_email_at IS NULL`)
- `second_failed_hours = 72` — gate is hours since the previous stage email was sent
- `final_warning_hours = 168` (= 7 days)

**Cost ceiling** (T-65-05-05): LIMIT 200 candidates per invocation × 96 cron-ticks/day = 19,200 emails/day ceiling. Safe headroom even for a 10k-user base.

**Auth flow** (T-65-05-01): cron fires POST with vault-fetched service-role bearer → `constantTimeEqual(bearer, serviceRoleKey)` → 401 on mismatch.

**Idempotency** (T-65-05-02): composite PK `(subscription_id, stage)` on `dunning_emails_sent` enforced at the DB layer. `upsert(..., { ignoreDuplicates: true })` returns empty `data` array on conflict, which the handler treats as "already sent — skip".

**CAN-SPAM compliance** (T-65-05-03):
1. PHYSICAL_ADDRESS env-var presence + placeholder regex check at request entry
2. Defense-in-depth: post-render body scan for `[placeholder]` / `REPLACE_ME` / `TODO_TEMPLATE` / `TBD_TEMPLATE`
3. List-Unsubscribe header (RFC 8058) + List-Unsubscribe-Post=One-Click on every email
4. Unsubscribe link in HTML body + plain-text footer
5. Physical address rendered in HTML footer + plain-text footer

## Deviations from Plan

**None — plan executed exactly as written.** All success criteria met:

- handler.ts ≥ 200 lines (actual 611) with DI seam ✓
- 13 tests pass via `$HOME/.deno/bin/deno test --no-check` ✓
- 6 template files exist with `{{placeholder}}` interpolation points ✓
- CAN-SPAM + placeholder guard mirror Phase 64-03 pattern ✓
- index.ts has `import.meta.main` guard ✓
- deno.json pins supabase-js 2.45.0 ✓
- No deploy in this plan (close-out 65-10 owns deploy + cron registration) ✓

## Known Stubs

None. All code paths are wired:
- DI deps consumed in production via `index.ts`
- Templates rendered from in-bundle string constants (synced with `_shared/email-templates/*.{html,txt}`)
- RPC `get_dunning_orchestrator_candidates` is called from `handler.ts` — the SQL registration is correctly deferred to close-out 65-10 (along with deploy + pg_cron registration), which mirrors the `get_grandfathered_notice_candidates` pattern from Phase 64-03. The Edge Fn ships ready; SQL + cron + deploy are a single close-out wave.

## Threat Flags

None. All threats identified in `<threat_model>` are mitigated:

| Threat | Mitigation |
|--------|------------|
| T-65-05-01 (unauth POST) | constant-time bearer compare; 401 on mismatch |
| T-65-05-02 (double-send) | composite PK + INSERT-before-Resend ordering |
| T-65-05-03 (CAN-SPAM violation) | PHYSICAL_ADDRESS runtime guard + post-render body scan + Slack P1 |
| T-65-05-04 (bulk-BCC leak) | per-recipient sends; `to: [single email]` only |
| T-65-05-05 (runaway cost) | LIMIT 200/invocation enforced in RPC; 19,200/day ceiling |
| T-65-05-06 (Resend key leak) | Function Secret only; error responses use short-code only |

## Commits

| Task | Hash | Description |
|------|------|-------------|
| 1 | `52300f8c` | handler.ts (611 lines) + 13 tests + 6 templates |
| 2 | `7767d411` | index.ts (import.meta.main guard) + deno.json |

## Self-Check: PASSED

Verified after writing this SUMMARY:

- File existence:
  - `supabase/functions/stripe-dunning-orchestrator/handler.ts` → FOUND
  - `supabase/functions/stripe-dunning-orchestrator/index.ts` → FOUND
  - `supabase/functions/stripe-dunning-orchestrator/deno.json` → FOUND
  - `supabase/functions/stripe-dunning-orchestrator/__tests__/handler.test.ts` → FOUND
  - 6 templates under `supabase/functions/_shared/email-templates/dunning-*.{html,txt}` → FOUND

- Commit hashes:
  - `52300f8c` → FOUND in `git log`
  - `7767d411` → FOUND in `git log`

- Test result: `13 passed | 0 failed` ✓
- Plan verification: `grep -c "Deno.env.get" supabase/functions/stripe-dunning-orchestrator/handler.ts` → 0 ✓
- Plan verification: `test -f index.ts && test -f deno.json && grep -q "import.meta.main" && grep -q "@supabase/supabase-js@2.45.0"` → all pass ✓
