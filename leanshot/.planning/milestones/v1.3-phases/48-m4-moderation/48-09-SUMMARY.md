---
phase: 48-m4-moderation
plan: 09
subsystem: moderation
tags: [edge-fn, ban-enforcement, sessions, auth, secdef-rpc, moderation, tdd]
dependency_graph:
  requires:
    - 48-03 (user_moderation_state + apply_user_moderation RPC)
    - 48-04 (moderation_audit_log + log_moderation_action RPC)
    - 48-06 (RED test stub + RLS write-deny backstop)
  provides:
    - public.revoke_user_sessions(uuid) SECDEF RPC (auth.sessions + auth.refresh_tokens DML funnel)
    - ban-enforcement Edge Fn (POST /functions/v1/ban-enforcement)
  affects:
    - auth.sessions (DELETE on ban)
    - auth.refresh_tokens (DELETE on ban)
    - moderation_audit_log (session_revoked rows)
tech_stack:
  added:
    - public.revoke_user_sessions(uuid) — service_role-only SECDEF RPC
    - ban-enforcement Edge Fn (Deno + supabase-js)
  patterns:
    - SECDEF RPC funnel for cross-schema DML (PostgREST exposes only public)
    - HMAC service-role bearer (constantTimeEqual via _shared/lifecycle-utils)
    - Lazy admin singleton + test-injection seam (Proxy pattern)
    - Deno.serve guard (import.meta.main) per reference_deno_test_top_level_serve_trap
key_files:
  created:
    - supabase/functions/ban-enforcement/index.ts
    - supabase/functions/ban-enforcement/index.test.ts (overwrites Plan 48-06 stub with 9 GREEN tests)
    - supabase/functions/ban-enforcement/deno.json
    - supabase/migrations/20270901000018_p48_revoke_user_sessions_rpc.sql
  modified: []
decisions:
  - "D-15 CORRECTED: revoke via SECDEF RPC calling DELETE on auth.sessions + auth.refresh_tokens (not the rejected JWT-based admin API). Per memory feedback_negation_grep_defeated_by_comment_string the rejected API name is documented in PLAN.md / SUMMARY.md only — never in committed source. Verified grep == 0."
  - "iter-1 W1 fix retained: funnel auth.* DML through public.revoke_user_sessions SECDEF RPC because PostgREST exposes only public + graphql_public; direct supabase-js .schema('auth') is not guaranteed reachable."
  - "Audit log call is non-fatal — sessions revoke success is the contract, audit failure logs to console but still returns 200."
metrics:
  duration: "~12 minutes"
  completed: "2026-05-24T02:31:26Z"
  files_created: 4
  files_modified: 0
  commits: 4
  tests_added: 9
  tests_passing: 9
---

# Phase 48 Plan 09: ban-enforcement Edge Fn Summary

**One-liner:** Service-role Edge Fn invoked by apply_user_moderation trigger on `status='banned'` — revokes all sessions via `public.revoke_user_sessions(uuid)` SECDEF RPC (DELETE on auth.sessions + auth.refresh_tokens) and logs `session_revoked` audit row.

## What Shipped

### 1. `supabase/migrations/20270901000018_p48_revoke_user_sessions_rpc.sql` — SECDEF revoke funnel

- `public.revoke_user_sessions(p_user_id uuid)` returns void, SECURITY DEFINER, `search_path = public, extensions`.
- Body: two unconditional DELETEs on `auth.sessions` and `auth.refresh_tokens` for `user_id = p_user_id`.
- Grants: `revoke all from public, authenticated, anon` + `grant execute to service_role` only.
- Idempotent: DELETE on absent rows returns 0 rows, no error.
- Funnels auth.* DML through the trusted `public` schema (PostgREST-reachable via `supabase-js .rpc()`).
- Standalone migration (no cron-body nesting) → single `$fn$` dollar-quote tag is safe per `reference_postgres_dollar_quote_nesting_in_cron_body`.

### 2. `supabase/functions/ban-enforcement/index.ts` — Edge Fn handler

- `POST /functions/v1/ban-enforcement` with `Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>`.
- Body: `{ user_id: uuid }` (RFC 4122 hex-with-hyphens regex).
- Pipeline: HMAC bearer check → body validate → `admin.rpc('revoke_user_sessions', { p_user_id })` → `admin.rpc('log_moderation_action', { p_action_type: 'session_revoked', p_target_type: 'user', p_target_id })`.
- Response codes: `200 { revoked: true, user_id }`, `400 invalid_body`, `401 unauthorized`, `405 method_not_allowed`, `500 session_revoke_failed`.
- Reuses `checkServiceRoleBearer`, `corsHeaders`, `jsonResponse`, `jsonError` from `_shared/lifecycle-utils.ts`.
- Lazy admin singleton via `Proxy` (test-injectable via `setAdminForTest` / `resetAdminForTest`).
- Deno.serve guarded by `import.meta.main && Deno.serve` so `deno test` imports without binding.

### 3. `supabase/functions/ban-enforcement/deno.json` — per-Fn config

- Mirrors `notify-community/deno.json` verbatim: npm:@supabase/supabase-js@2 import, deno test task (`--no-check --allow-env --allow-net`), recommended lint rules, 100-col fmt.

### 4. `supabase/functions/ban-enforcement/index.test.ts` — 9 GREEN Deno tests (overwrote Plan 48-06 RED stub)

- T1 — Missing bearer → 401 unauthorized.
- T1b — Wrong bearer → 401 unauthorized.
- T2 — Service-role + valid body → `revoke_user_sessions` RPC called with `p_user_id`, returns 200.
- T3 — `log_moderation_action` invoked with `p_action_type='session_revoked'`, `p_target_type='user'`, `p_target_id=<user>`.
- T4 — Missing `user_id` → 400 invalid_body.
- T4b — Non-uuid `user_id` → 400 invalid_body.
- T5 — `revoke_user_sessions` RPC error → 500 session_revoke_failed.
- T6 — GET method → 405 method_not_allowed.
- T7 — Idempotent: 2 consecutive invocations both return 200.
- All 9 pass via `deno test --no-check --allow-env --allow-net --allow-read`.

## Acceptance Criteria

| Criterion | Result |
|-----------|--------|
| 3 files exist at canonical paths | PASS (4: index.ts + deno.json + migration + test) |
| `grep -c 'auth.admin.signOut' index.ts == 0` | PASS (0) |
| `grep -c "rpc('revoke_user_sessions'" index.ts >= 1` | PASS (1) |
| `grep -cE "schema\(['\"]auth['\"]\)\.from" index.ts == 0` | PASS (0) |
| `grep -c 'checkServiceRoleBearer' index.ts >= 1` | PASS (2) |
| `grep -c "p_action_type: 'session_revoked'" index.ts >= 1` | PASS (1) |
| `grep -c 'security definer' migration >= 1` | PASS (1) |
| `grep -c 'import.meta.main' index.ts == 1` | PASS (1) |
| `deno test ban-enforcement/.` exits 0 | PASS (9/9) |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Test T6 GET request cannot have body**
- **Found during:** Task 1 GREEN test run.
- **Issue:** Initial `makeReq` helper unconditionally set `body: JSON.stringify(body)` — `new Request(url, { method: 'GET', body })` throws `TypeError: Request with GET/HEAD method cannot have body`.
- **Fix:** `makeReq` now omits `body` when method is GET or HEAD.
- **Files modified:** `supabase/functions/ban-enforcement/index.test.ts`.
- **Commit:** `6d360f59` (folded into GREEN commit).

**2. [Rule 1 - Bug] `import.meta.main` appeared twice (acceptance == 1)**
- **Found during:** acceptance grep pass.
- **Issue:** A docblock comment referenced `import.meta.main` by name, defeating the `== 1` acceptance count.
- **Fix:** Paraphrased the comment to describe the guard semantically without naming the symbol. Conceptually identical to the `feedback_negation_grep_defeated_by_comment_string` pattern (auth.admin.signOut).
- **Files modified:** `supabase/functions/ban-enforcement/index.ts` (comment-only edit).
- **Commit:** `6d360f59`.

### Plan-Embedded Deviations (none)

The plan skeleton was followed verbatim — no architectural surprises. Notable predicted-and-shipped items:

- Plan 48-06 RED stub at `index.test.ts` replaced with 9 GREEN tests as instructed.
- SECDEF RPC migration (Task 3) shipped as the iter-1 W1-fix path (planned).
- Rejected-API-name negation grep gate validated (0 occurrences). Documented here in SUMMARY (not source) per memory `feedback_negation_grep_defeated_by_comment_string`.

## Known Stubs

None. All wiring is functional except:

- **Audit log call is non-fatal by design** — if `log_moderation_action` errors, we log to console and still return 200 (sessions are already revoked). This is intentional: revoke success is the contract; audit is best-effort. See decisions[2].

## Auth Gates

None — this Fn doesn't call external APIs (no Anthropic, no Resend). Service-role bearer is checked against `SUPABASE_SERVICE_ROLE_KEY` env var which the orchestrator confirmed pre-dispatch.

## Threat Flags

None — all surface is within plan threat model (T-48-06, T-48-23, T-48-24). No net-new endpoints, auth paths, or trust-boundary writes beyond what `<threat_model>` enumerates.

## TDD Gate Compliance

- RED commit: `8327f000 test(48-09): RED — ban-enforcement Fn driver (7 tests)` — verified failing before implementation.
- GREEN commit: `6d360f59 feat(48-09): ban-enforcement Edge Fn — GREEN` — all 9 tests passing.
- (Test count grew from 7 to 9 in GREEN: split T1/T1b for missing-vs-wrong bearer, added T4b for non-uuid validation. All in original test-plan spirit.)
- No REFACTOR commit needed.

## Carry-Over for Phase 48 Close-out

- `supabase functions deploy ban-enforcement` — required at Plan 12 close-out (this plan does NOT deploy per instruction).
- `supabase db push --linked` — required at Plan 12 close-out to ship `20270901000018_p48_revoke_user_sessions_rpc.sql`.
- HUMAN-UAT signal-2 (Plan 12) — end-to-end: ban a test account → session revoked → AccountSuspended renders + writes fail. Sentinel: audit row `action_type='session_revoked', target_id=<test_user>` appears.

## Commits

| Hash      | Type     | Description |
|-----------|----------|-------------|
| 8327f000  | test     | RED — ban-enforcement Fn driver (7 tests, expanded to 9 in GREEN) |
| 6d360f59  | feat     | ban-enforcement Edge Fn — GREEN (9/9 tests) |
| 462425cf  | chore    | per-Fn deno.json |
| 47945d67  | feat     | revoke_user_sessions SECDEF RPC migration |

## Self-Check: PASSED

- supabase/functions/ban-enforcement/index.ts — FOUND
- supabase/functions/ban-enforcement/index.test.ts — FOUND
- supabase/functions/ban-enforcement/deno.json — FOUND
- supabase/migrations/20270901000018_p48_revoke_user_sessions_rpc.sql — FOUND
- Commit 8327f000 — FOUND
- Commit 6d360f59 — FOUND
- Commit 462425cf — FOUND
- Commit 47945d67 — FOUND
- 9/9 Deno tests pass
- All 9 acceptance criteria pass
