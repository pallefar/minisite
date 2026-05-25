---
phase: 45
plan: 05
subsystem: community-moderation
tags: [edge-function, cron, admin-digest, community-reports, service-role]
requires:
  - 45-01 (community_reports table + profiles.admin_digest_opt_in column)
  - 45-02 (community_admin_report_digest email template + 'community-admin-report' category)
provides:
  - community-admin-report-digest Edge Fn (daily cron-triggered)
  - pg_cron job 'community-admin-report-digest' @ 0 9 * * * UTC
affects:
  - supabase/functions/_shared/email-router.ts (consumes existing 'community_admin_report_digest' template)
tech-stack:
  added: []
  patterns:
    - service-role-only-auth (checkServiceRoleBearer)
    - lazy-admin-singleton-Proxy (test-injectable)
    - sendEmail-test-seam (per-recipient try/catch)
    - vault-decrypted-secrets for cron bearer
    - named dollar-tag nesting ($cron$ / $unschedule$)
key-files:
  created:
    - supabase/functions/community-admin-report-digest/index.ts
    - supabase/functions/community-admin-report-digest/index.test.ts
    - supabase/functions/community-admin-report-digest/deno.json
    - supabase/migrations/20270727000006_p45_admin_report_digest_cron.sql
  modified: []
decisions:
  - Service-role-only auth (no user JWT path) — Fn is cron-only per RESEARCH Pattern 3 + Pitfall 7
  - READ-only access to community_reports (no SECDEF write RPC needed from service-role)
  - Email resolved via auth.admin.getUserById (profiles has no email column)
  - Per-recipient try/catch (one failed send must not block others)
  - Hardcoded phi=false (digest contains only aggregate counts + admin URL)
  - Early-return when open_count=0 (don't waste Resend sends on empty digests)
  - Named dollar tags $cron$ + $unschedule$ (NOT bare $$) per nesting trap
metrics:
  duration_minutes: 28
  tasks_completed: 2
  files_changed: 4
  commits: 3
  completed: 2026-05-24
---

# Phase 45 Plan 45-05: community-admin-report-digest Edge Function Summary

Daily admin digest Edge Function — cron at 09:00 UTC fires the Fn which counts open `community_reports` by `target_type` and emails one digest per opted-in admin (`is_staff=true` AND `admin_digest_opt_in=true`), bridging the Phase 45 report queue to admin visibility before Phase 48 ships the moderation UI.

## What Shipped

### Edge Function: `community-admin-report-digest`

`POST /functions/v1/community-admin-report-digest` (service-role bearer required; body `{}`).

**Pipeline:**
1. `checkServiceRoleBearer(req)` → 401 on miss (no user JWT path).
2. `admin.from('community_reports').select('target_type').eq('status','open').limit(1000)` — READ-only.
3. JS-side reduce → `open_count` (number) + `by_type` (Array<{target_type, count}>, sorted desc by count).
4. `admin.from('profiles').select('id').eq('is_staff', true).eq('admin_digest_opt_in', true)`.
5. Early-return `{sent_count:0, open_count:0, by_type:[]}` when `open_count===0` (skip empty digests).
6. For each admin row → `admin.auth.admin.getUserById(id)` to resolve email (profiles has NO email column per memory `reference_profiles_email_vs_auth_users_email`).
7. `sendEmail({template:'community_admin_report_digest', to: email, vars:{open_count, by_type, digest_date, admin_url}, phi:false})` in per-recipient try/catch.
8. Return 200 `{sent_count, open_count, by_type}`.

**Response shape:**
- 200 `{sent_count: number, open_count: number, by_type: Array<{target_type: string, count: number}>}`
- 401 `{error: 'unauthorized'}` (missing/bad bearer)
- 405 `{error: 'method_not_allowed'}`
- 500 `{error: 'internal'}` on DB error

### Daily Cron Migration

`supabase/migrations/20270727000006_p45_admin_report_digest_cron.sql`:
- `cron.schedule('community-admin-report-digest', '0 9 * * *', $cron$ ... $cron$)`
- Vault-sourced bearer via `(select decrypted_secret from vault.decrypted_secrets where name='service_role_key' limit 1)` — pattern from memory `reference_supabase_pg_cron_vault_service_role_pattern`.
- Pre-flight `do $unschedule$ ... cron.unschedule(...) ... $unschedule$` with EXCEPTION handler for idempotent re-run on fresh DBs.
- Named dollar tags throughout — bare `$$` would silently early-close at nested `$$` per memory `reference_postgres_dollar_quote_nesting_in_cron_body`.

### Deno Tests (3 passing)

| # | Scenario | Asserts |
|---|----------|---------|
| T1 | Missing bearer | 401 `{error:'unauthorized'}` |
| T2 | Zero open reports + 2 opted-in admins | 200 `{sent_count:0, open_count:0, by_type:[]}`; sendEmail never invoked |
| T3 | 4 reports (3 post + 1 comment) + 3 opted-in admins | 200 `{sent_count:3, open_count:4, by_type:[{post:3},{comment:1}]}`; 3 sendEmail calls with `template='community_admin_report_digest'`, `phi=false`, full vars, admin_url=`https://app.leanshot.app/admin/community/reports` |

## Test Scenarios — Mock Strategy

`makeFakeAdmin(cfg)` supports:
- `from('community_reports')` chain → `cfg.reportRows`
- `from('profiles')` chain → `cfg.adminProfileRows`
- `auth.admin.getUserById(id)` → `{user: {id, email: cfg.userEmails[id]}}` or 404

`__internal.setSendEmailForTest(fn)` injects a capturing mock without touching Resend. `__internal.resetAdminForTest()` + `__internal.resetSendEmailForTest()` restore real impls between tests.

## Cron Schedule + Vault Key Dependency

- **Job name:** `community-admin-report-digest`
- **Cadence:** `0 9 * * *` (daily 09:00 UTC)
- **URL:** `https://ytnsipxxmzgaebkqmokp.supabase.co/functions/v1/community-admin-report-digest`
- **Bearer source:** `vault.decrypted_secrets` row with `name='service_role_key'` (loaded by `20270101000014_service_role_key_vault_load.sql` from Phase 19). If the secret is absent at runtime, the Authorization header sends `Bearer ` (empty) and the Fn rejects with 401; cron retries the next day.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Negation-grep self-trap] Removed `auth.uid()` literal from doc comment in `index.ts`**
- **Found during:** Task 1 acceptance verification.
- **Issue:** Doc comment read "this Fn ... NEVER calls an `auth.uid()`-bearing RPC", which made `grep -c "auth.uid()"` return 1 even though the code body has zero `auth.uid()` calls. Plan acceptance required `==0`. Same shape as memory `feedback_negation_grep_defeated_by_comment_string`.
- **Fix:** Reworded comment to "an RPC that depends on the request user context" — preserves the intent (the rejected-alternative pattern) without leaving the literal token in committed text.
- **Files modified:** `supabase/functions/community-admin-report-digest/index.ts` (single comment line).
- **Commit:** Folded into `2ab71793` (GREEN).

**2. [Rule 1 - Negation-grep self-trap] Removed `current_setting` literal from doc comment in cron migration**
- **Found during:** Task 2 acceptance verification.
- **Issue:** Doc comment read "`current_setting('app.service_role_key')` GUC does NOT exist on this project", which made `grep -c "current_setting"` return 1. Plan acceptance required `==0`.
- **Fix:** Reworded to "the app-namespaced GUC alternative does NOT exist on this project" — preserves the prevent-future-mistake intent without the literal token.
- **Files modified:** `supabase/migrations/20270727000006_p45_admin_report_digest_cron.sql` (single comment block).
- **Commit:** Folded into `500a9b7d`.

### Out-of-Scope / Deferrals

- **Fn deploy + cron `db push` ordering** (per memory `feedback_fn_deploy_before_cron_db_push`): cron registrations targeting Edge Fns must NOT be pushed before the Fn is deployed (≤15-min fire window can hit a missing endpoint). Documented in the migration header comment; the Phase 45 close-out plan (45-09) owns the correct sequence — `supabase functions deploy community-admin-report-digest` BEFORE `supabase db push --linked`. Plan 45-05 deliberately does NOT run either.

## TDD Gate Compliance

- RED commit `d30f6486` (test only — `feat` not yet present)
- GREEN commit `2ab71793` (implementation makes 3/3 tests pass)
- No REFACTOR commit needed (implementation landed clean; no duplicated logic to extract)

Task 2 (cron SQL migration) is `tdd="true"` in the plan but cannot have a runnable test harness — Supabase migrations are validated only by `supabase db lint` + push-time apply. The plan's `<verify><automated>` block of grep-based acceptance checks IS the validation surface; all checks pass (≥2 name uses, ≥1 schedule string, ≥1 vault reference, 0 `current_setting`, ≥2 named dollar tags).

## Threat Model Alignment

| Threat ID | Disposition | Mitigation in this plan |
|-----------|-------------|--------------------------|
| T-45-07 (DoS — replay) | accept | Cron is service-role-bearer-gated; daily cap = 1 (idempotent within the same day — re-firing on the same data would just re-send identical aggregates). |
| T-45-05 (XSS — by_type vars) | mitigate | Mitigation lives in the `community-admin-report-digest.ts` template (shipped by 45-02) which calls `escapeHtml()` on all vars. This plan does NOT add escaping — by design; the var-pass-through is correct given the template's contract. |

No new threat surface introduced beyond the plan's `<threat_model>`.

## Files

### Created
- `supabase/functions/community-admin-report-digest/index.ts` (269 lines)
- `supabase/functions/community-admin-report-digest/index.test.ts` (203 lines, 3 Deno.test blocks)
- `supabase/functions/community-admin-report-digest/deno.json` (verbatim copy from notify-community)
- `supabase/migrations/20270727000006_p45_admin_report_digest_cron.sql` (73 lines)

### Modified
None.

## Commits

| Hash | Type | Description |
|------|------|-------------|
| `d30f6486` | test | RED — 3 failing Deno tests + stub Fn |
| `2ab71793` | feat | GREEN — Fn implementation makes all 3 tests pass |
| `500a9b7d` | feat | Daily 9am UTC cron migration (vault + named dollar tags) |

## Self-Check: PASSED

- `supabase/functions/community-admin-report-digest/index.ts` — FOUND (270 lines)
- `supabase/functions/community-admin-report-digest/index.test.ts` — FOUND (3 Deno.test blocks, all pass)
- `supabase/functions/community-admin-report-digest/deno.json` — FOUND (valid JSON)
- `supabase/migrations/20270727000006_p45_admin_report_digest_cron.sql` — FOUND
- Commit `d30f6486` — FOUND in git log
- Commit `2ab71793` — FOUND in git log
- Commit `500a9b7d` — FOUND in git log
- `$HOME/.deno/bin/deno test --no-check --allow-env supabase/functions/community-admin-report-digest/index.test.ts` → `3 passed | 0 failed`
- `grep -c "auth.uid()" supabase/functions/community-admin-report-digest/index.ts` → 0
- `grep -c "current_setting" supabase/migrations/20270727000006_p45_admin_report_digest_cron.sql` → 0
