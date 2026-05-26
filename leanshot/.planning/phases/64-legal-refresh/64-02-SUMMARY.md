---
phase: 64-legal-refresh
plan: "02"
subsystem: edge-functions
tags: [deno, edge-function, privacy, ccpa, do-not-sell, resend, posthog, fan-out]

# Dependency graph
requires:
  - phase: 64-legal-refresh
    plan: "01"
    provides: "privacy_optout_requests + ad_targeting_exclusion + email_lifecycle_exclusion tables"
provides:
  - "privacy-optout-process Edge Fn — synchronous fan-out opt-out processing"
  - "handler.ts + PrivacyOptoutDeps DI interface"
  - "index.ts with import.meta.main Deno.serve guard"
  - "optout-confirmation.html + .txt email templates"
  - "7 Deno tests covering all behavior cases"
affects:
  - "64-08-close-out — deploys via supabase functions deploy privacy-optout-process"

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Handler/index split with import.meta.main guard — [[reference_deno_test_top_level_serve_trap]]"
    - "Dependency injection (PrivacyOptoutDeps) for full test isolation without network"
    - "Synchronous in-Fn fan-out — INSIGHTS-09 lesson (Phase 62): direct DB writes, NOT queue"
    - "Best-effort PostHog $opt_out — failure logs + continues; never fails the request"
    - "test-stub RESEND_API_KEY shortcircuit — per lifecycle-send.ts Pitfall 6"
    - "Per-IP rate limit via SELECT count from privacy_optout_requests"
    - "24h email-keyed idempotency via maybeSingle() before INSERT"
    - "Control char strip /[\\x00-\\x1F\\x7F]/g — CR-02 Phase 60 lesson (T-64-02-03)"

key-files:
  created:
    - supabase/functions/privacy-optout-process/handler.ts
    - supabase/functions/privacy-optout-process/index.ts
    - supabase/functions/privacy-optout-process/deno.json
    - supabase/functions/privacy-optout-process/__tests__/handler.test.ts
    - supabase/functions/privacy-optout-process/templates/optout-confirmation.html
    - supabase/functions/privacy-optout-process/templates/optout-confirmation.txt
  modified: []

key-decisions:
  - "Fan-out is synchronous in a single Fn invocation — no queue per INSIGHTS-09 Phase 62 BLOCKER-2 lesson"
  - "PostHog opt-out is best-effort — failure never blocks the user response (propagated_at set after DB fan-outs)"
  - "email used as PostHog distinct_id for anonymous Do-Not-Sell (no user_id available on public form)"
  - "Deploy deferred to Plan 64-08 per [[feedback_fn_deploy_before_cron_db_push]] discipline"
  - "Template rendering uses Deno.readTextFile with inline fallback for test environment"

# Metrics
duration: 5min
completed: 2026-05-26
---

# Phase 64 Plan 02: privacy-optout-process Edge Fn Summary

**privacy-optout-process Edge Fn with synchronous fan-out to 3 DB tables + PostHog opt-out + Resend confirmation email — all within a single Fn invocation per INSIGHTS-09 lesson**

## Performance

- **Duration:** 5 min
- **Started:** 2026-05-26T21:00:35Z
- **Completed:** 2026-05-26T21:05:14Z
- **Tasks:** 2 (TDD: RED + GREEN + Task 2)
- **Files modified:** 6 created

## Accomplishments

- Implemented `privacy-optout-process` Edge Fn with `handle()` + `PrivacyOptoutDeps` dependency injection interface (mirroring Phase 60-12 `rag-newsletter-sender` handler/index pattern)
- Synchronous fan-out chain (INSIGHTS-09 — no queue): INSERT `privacy_optout_requests` → UPSERT `ad_targeting_exclusion` → UPSERT `email_lifecycle_exclusion` → PostHog `$opt_out` → Resend confirmation
- Input validation (pre-INSERT): email regex, state_residency whitelist (CA/VA/CO/CT/UT/OTHER), opt_out_scope array (advertising/sale/sharing), control-char strip, 4 KB body limit
- 24h email-keyed idempotency check (returns `{ idempotent: true }` without duplicate row)
- Per-IP rate limit: >10 submissions/hour → 429
- PostHog `$opt_out` event capture (best-effort: failure logged + continued; never fails request)
- Resend confirmation email with `test-stub` shortcircuit; `propagated_at` + `confirmation_email_sent_at` set after fan-outs
- `index.ts` with `if (import.meta.main) Deno.serve(...)` guard per [[reference_deno_test_top_level_serve_trap]]
- HTML + plain-text email templates with `{{name}}`, `{{state}}`, `{{submitted_at}}` placeholders + 24h propagation SLA copy
- All 7 Deno tests pass (T1 happy path, T2 missing email, T3 invalid state, T4 idempotent duplicate, T5 Resend stub, T6 PostHog failure, T7 healthz)

## Task Commits

**TDD RED phase:**
1. **test(64-02)** - `af71e1a6` — failing tests for all 7 behavior cases + deno.json

**TDD GREEN phase:**
2. **feat(64-02)** - `d369a005` — handler.ts implementation + email templates (all 7 tests pass)
3. **feat(64-02)** - `7ccfbc8f` — index.ts Deno.serve entry + production deps

## Files Created

- `supabase/functions/privacy-optout-process/handler.ts` — `handle()` + `PrivacyOptoutDeps`; validation; synchronous fan-out to 3 tables; PostHog best-effort; Resend confirmation; propagated_at update
- `supabase/functions/privacy-optout-process/index.ts` — thin entry; `import.meta.main` guard; prod deps factory
- `supabase/functions/privacy-optout-process/deno.json` — import map: std@0.224.0 + shared/ + supabase-js@2
- `supabase/functions/privacy-optout-process/__tests__/handler.test.ts` — 7 Deno.test cases; inline mock supabase client + fetch
- `supabase/functions/privacy-optout-process/templates/optout-confirmation.html` — inline-table layout; 24h SLA copy; privacy@leanshot.app contact
- `supabase/functions/privacy-optout-process/templates/optout-confirmation.txt` — plain-text variant

## Decisions Made

- **Synchronous fan-out** — per INSIGHTS-09 lesson (Phase 62 BLOCKER 2): Edge Fn writes directly to `ad_targeting_exclusion` + `email_lifecycle_exclusion` tables in the same request, not via a queue that no consumer reads. Guarantees sub-second propagation vs cron-delayed.
- **PostHog best-effort** — PostHog `$opt_out` capture failure never blocks the user response; only DB fan-outs (steps 1-3) gate `propagated_at`. This is the right trade-off: DB writes are the legal obligation; PostHog is analytics.
- **email as PostHog distinct_id** — anonymous submitters have no `user_id`; email is used as `distinct_id` for the `$opt_out` event, consistent with PostHog's email-keyed person matching.
- **Deploy deferred to Plan 64-08** — per [[feedback_fn_deploy_before_cron_db_push]] discipline; no cron here but close-out convention maintained.

## Deviations from Plan

None — plan executed exactly as written.

- TDD RED/GREEN/REFACTOR gates followed in sequence
- Mock builder `then()` bug auto-fixed inline (Rule 1): the INSERT+SELECT chained mock resolved incorrectly when `ops.includes('select')` was checked as last op instead of checking `ops.includes('insert')` — fixed in the GREEN iteration before committing.

## Known Stubs

None. All template placeholders (`{{name}}`, `{{state}}`, `{{submitted_at}}`) are runtime-substituted via the `renderTemplate()` function. The word "placeholder" appears only in code comments.

## Threat Surface Scan

New network surface introduced: `POST /privacy-optout-process` (anonymous, public). This surface is fully modeled in the plan's STRIDE threat register (T-64-02-01 through T-64-02-07) and all mitigations are implemented inline:

| Flag | File | Description |
|------|------|-------------|
| threat_flag: anonymous_public_endpoint | handler.ts | Unauthenticated POST accepting PII (name + email + state) — mitigated via input validation, rate limiting, control-char strip, no SQL error echo |

No new SQL endpoints, auth paths, or schema changes introduced (schema owned by Plan 64-01).

## TDD Gate Compliance

- **RED gate:** `af71e1a6` — `test(64-02)` commit with 7 failing tests (handler.ts absent)
- **GREEN gate:** `d369a005` — `feat(64-02)` commit with all 7 tests passing
- **REFACTOR:** Not required — implementation is clean on first pass

---
*Phase: 64-legal-refresh*
*Completed: 2026-05-26*

## Self-Check: PASSED

Files verified:
- FOUND: supabase/functions/privacy-optout-process/handler.ts
- FOUND: supabase/functions/privacy-optout-process/index.ts
- FOUND: supabase/functions/privacy-optout-process/deno.json
- FOUND: supabase/functions/privacy-optout-process/__tests__/handler.test.ts
- FOUND: supabase/functions/privacy-optout-process/templates/optout-confirmation.html
- FOUND: supabase/functions/privacy-optout-process/templates/optout-confirmation.txt
- FOUND: leanshot/.planning/phases/64-legal-refresh/64-02-SUMMARY.md

Commits verified:
- FOUND: af71e1a6 (test(64-02): RED — 7 failing tests)
- FOUND: d369a005 (feat(64-02): GREEN — implementation + templates)
- FOUND: 7ccfbc8f (feat(64-02): index.ts entry + prod deps)
