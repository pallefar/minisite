---
phase: 49-m4-search-email-digests
plan: 08
subsystem: email
tags: [email, edge-function, hmac, unsubscribe, rfc-8058]
requires:
  - "Phase 22 _shared/lifecycle-utils.ts (corsHeaders, jsonError, makeLazyAdmin)"
  - "Phase 42 _shared/nps-token.ts (HMAC pattern forked)"
provides:
  - "mintUnsubscribeToken({user_id, category, exp}, key?) — for 49-06 + 49-07 digest Fns"
  - "verifyUnsubscribeToken(token, key?) — handler-internal"
  - "POST/GET https://<project>.supabase.co/functions/v1/unsubscribe-handler?t=<token>"
  - "Idempotent UPSERT on notification_settings (user_id, category, channel='email', enabled=false)"
affects:
  - "Plan 49-06 daily-digest mintUnsubscribeToken import (Wave 1)"
  - "Plan 49-07 weekly-digest mintUnsubscribeToken import (Wave 1)"
  - "Plan 49-10 close-out: deploy unsubscribe-handler + set UNSUBSCRIBE_SECRET + Gmail RFC 8058 UAT"
tech_stack:
  added:
    - "node:crypto createHmac + timingSafeEqual (Deno std shim)"
  patterns:
    - "HMAC-SHA256 + b64url replace-chain (reference_base64url_postgres_vercel_mint_verify)"
    - "Deno.serve guard via env var (reference_deno_test_top_level_serve_trap)"
    - "Per-Fn deno.json (reference_supabase_functions_deploy_import_map_flag)"
key_files:
  created:
    - "supabase/functions/_shared/unsubscribe-token.ts"
    - "supabase/functions/_shared/unsubscribe-token.test.ts"
    - "supabase/functions/unsubscribe-handler/index.ts"
    - "supabase/functions/unsubscribe-handler/deno.json"
    - "supabase/functions/unsubscribe-handler/index.test.ts"
  modified: []
decisions:
  - id: D-49-08-01
    text: "URL shape `?t=<token>` (single param) — matches Phase 42 NPS + researcher recommendation; avoids RFC 8058 List-Unsubscribe-Post body parsing"
  - id: D-49-08-02
    text: "KEY_ENV = 'UNSUBSCRIBE_SECRET' (separate from QUARTERLY_NPS_SIGNING_KEY — different blast radius, different rotation cadence)"
  - id: D-49-08-03
    text: "Email-enumeration mitigation (T-49-23): UPSERT is 0-rows-tolerant, 200 OK regardless of row existence; no .error branch"
  - id: D-49-08-04
    text: "__internal.{handler, setAdminForTest, resetAdminForTest} test seam — admin stub via setAdminForTest, no Postgres round-trip in tests"
  - id: D-49-08-05
    text: "Category whitelist enforced INSIDE verify (defence-in-depth) — HMAC alone is not authorization; rejected categories return null even with valid signature"
metrics:
  duration: "~10 min"
  completed_at: "2026-05-24T13:38:24Z"
  tasks_completed: 2
  files_created: 5
  files_modified: 0
  commits: 5
---

# Phase 49 Plan 08: 1-click Unsubscribe Primitives Summary

HMAC-signed token mint/verify (`_shared/unsubscribe-token.ts`) + RFC 8058 One-Click endpoint (`unsubscribe-handler` Edge Fn) for Plan 49-06/49-07 digest emails — token-gated GET+POST (no Bearer), UPSERT `notification_settings enabled=false`, idempotent + email-enumeration-safe.

## Tasks Completed

| # | Name | Commits | Files |
|---|------|---------|-------|
| 1 | `_shared/unsubscribe-token.ts` mint/verify + 8-test scaffold (TDD) | `eeffedee` (RED), `3f8e95d9` (GREEN) | `supabase/functions/_shared/unsubscribe-token.ts`, `supabase/functions/_shared/unsubscribe-token.test.ts` |
| 2 | `unsubscribe-handler` Edge Fn + deno.json + 7-test scaffold (TDD) | `4b8fa9f5` (RED), `1b65f758` (GREEN) | `supabase/functions/unsubscribe-handler/index.ts`, `supabase/functions/unsubscribe-handler/deno.json`, `supabase/functions/unsubscribe-handler/index.test.ts` |
| — | Cross-Fn sweep fix: test-order-independent env-unset assertion | `a61edd12` | `supabase/functions/_shared/unsubscribe-token.test.ts` |

## Acceptance Criteria

All `<acceptance_criteria>` greps from PLAN.md pass:

| Gate | Expected | Actual |
|------|----------|--------|
| files exist (5) | OK | OK |
| `createHmac` in token.ts | ≥1 | 3 |
| `timingSafeEqual` in token.ts | ≥1 | 3 |
| `KEY_ENV = 'UNSUBSCRIBE_SECRET'` | ≥1 | 1 |
| `replace(/=+$/` b64url chain | ≥1 | 1 |
| `export function mintUnsubscribeToken` | ≥1 | 1 |
| `export function verifyUnsubscribeToken` | ≥1 | 1 |
| `verifyUnsubscribeToken` in handler/index.ts | ≥1 | 3 |
| `UNSUBSCRIBE_HANDLER_DISABLE_SERVE` | ≥1 | 2 |
| `checkServiceRoleBearer` (NO Bearer) | =0 | 0 |
| `name="robots" content="noindex"` | ≥1 | 2 (HTML body + comment) |
| `Cache-Control` | ≥1 | 2 |
| `onConflict: 'user_id,category,channel'` | ≥1 | 1 |
| `current_setting` in handler | =0 | 0 |
| Deno.test in token.test.ts | ≥5 | 8 |
| Deno.test in handler/index.test.ts | ≥5 | 7 |
| Rejected-alt strings in handler (`admin.signOut`, `app.unsubscribe_secret`) | =0 | 0 |

## Test Results

```
deno test --no-check --allow-env --allow-read --allow-net \
  supabase/functions/_shared/unsubscribe-token.test.ts \
  supabase/functions/unsubscribe-handler/index.test.ts

ok | 15 passed | 0 failed  (46ms)
```

8 token tests: roundtrip daily, roundtrip weekly, tampered MAC, missing dot, expired exp, unknown category (manual mint with valid HMAC), missing payload field, readSigningKey throws on unset.

7 handler tests: GET valid (→200 + HTML noindex + no-store + upsert shape), POST RFC 8058 valid (→200 + upsert), tampered (→401 invalid_token + no upsert), expired (→401 + no upsert), missing `?t` (→400 missing_token + no upsert), PUT (→405 method_not_allowed), OPTIONS preflight (→200 + CORS).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Test-order-independent UNSUBSCRIBE_SECRET-unset assertion**
- **Found during:** Cross-Fn deno sweep at end of Task 2 (`deno test ... unsubscribe-token.test.ts unsubscribe-handler/index.test.ts`)
- **Issue:** When handler test file (which calls `Deno.env.set('UNSUBSCRIBE_SECRET', 'test-fixture-key-49-08')` before its dynamic-import) runs in the same `deno test` invocation as the token test, the env var leaked across files. The `readSigningKey throws when UNSUBSCRIBE_SECRET unset` assertion in token.test.ts then failed — `verifyUnsubscribeToken` succeeded instead of throwing.
- **Fix:** Snapshot prev env value, `Deno.env.delete('UNSUBSCRIBE_SECRET')` before the `assertThrows`, restore in `finally`. Token test now passes under both file-order permutations.
- **Files modified:** `supabase/functions/_shared/unsubscribe-token.test.ts`
- **Commit:** `a61edd12`
- **Why this is correctness-critical:** the assertion intentionally proves the production-path failure mode (missing Function Secret); a flaky-passing assertion masks an actual UAT regression at Wave 3.

### Additions vs PLAN.md skeleton (none vs. specified behavior — additive only)

- Added 8th token test (`roundtrip: weekly_community_digest also accepted`) and 7th handler test (`OPTIONS preflight → 200 ok with CORS headers`) beyond the 5+ baseline. Both exercise behavior that PLAN.md described but didn't enumerate as a discrete test.
- Added 1 extra grep-defence: `Buffer` imported explicitly from `node:buffer` in `unsubscribe-token.ts` for Deno strict-mode compatibility (Phase 42 nps-token assumes ambient Buffer; Deno 1.41+ requires explicit import for type-safety under `--no-check`).

## Threat Model Coverage

| Threat ID | Disposition | Mitigation Shipped | Evidence |
|-----------|-------------|--------------------|----------|
| T-49-21 (Spoofing — forged URL) | mitigate | HMAC-SHA256 over payloadEncoded with UNSUBSCRIBE_SECRET; `timingSafeEqual` constant-time | `tampered MAC → null` test |
| T-49-22 (Replay after re-subscribe) | accept | UPSERT idempotent toggle-off; user can re-enable via `/settings/notifications` | PLAN.md accepted disposition |
| T-49-23 (Info disclosure — enumeration) | mitigate | UPSERT 0-rows-tolerant; no `.error` branch; 200 OK regardless of row existence | handler does not branch on upsert result |
| T-49-24 (DoS) | accept | Edge Fn project-level rate limit; HMAC-verify only cost | PLAN.md accepted disposition |
| T-49-25 (Elevation — cached URL replay) | mitigate | `Cache-Control: no-store` on 200 response | `GET with valid token` test asserts header |

## Vendor Secret Pre-flight (deferred)

`UNSUBSCRIBE_SECRET` Function Secret is NOT set yet. Per PLAN.md `<context>` line 75 (`feedback_vendor_secret_preflight_surface`), orchestrator was surfaced this at Wave 0 dispatch but secret has not been set in the linked project — code-ship is fine; runtime gate is at Wave 3 / Plan 49-10 close-out:

```bash
supabase secrets set UNSUBSCRIBE_SECRET=$(openssl rand -base64 32) --project-ref ytnsipxxmzgaebkqmokp
supabase secrets list --project-ref ytnsipxxmzgaebkqmokp | grep UNSUBSCRIBE_SECRET
```

Tests do NOT depend on this secret being set (test seam `key?` parameter on mint/verify + handler test injects `Deno.env.set('UNSUBSCRIBE_SECRET', 'test-fixture-key-49-08')` before dynamic-import).

## Files Created (5)

| Path | Purpose | Lines |
|------|---------|-------|
| `supabase/functions/_shared/unsubscribe-token.ts` | HMAC-SHA256 mint/verify utility | 167 |
| `supabase/functions/_shared/unsubscribe-token.test.ts` | 8 Deno.test blocks (token roundtrip + tamper + expiry + whitelist) | 131 |
| `supabase/functions/unsubscribe-handler/index.ts` | Edge Fn GET+POST endpoint (no Bearer, token-gated, UPSERT, HTML response) | 102 |
| `supabase/functions/unsubscribe-handler/deno.json` | Per-Fn import map | 10 |
| `supabase/functions/unsubscribe-handler/index.test.ts` | 7 Deno.test blocks (handler behavior + error responses + preflight) | 195 |

## Commits (5)

| Hash | Message |
|------|---------|
| `eeffedee` | test(49-08): add failing tests for unsubscribe-token mint/verify |
| `3f8e95d9` | feat(49-08): implement unsubscribe-token HMAC mint/verify |
| `4b8fa9f5` | test(49-08): add failing tests + deno.json for unsubscribe-handler |
| `1b65f758` | feat(49-08): implement unsubscribe-handler Edge Fn (RFC 8058 One-Click) |
| `a61edd12` | fix(49-08): test-order-independent UNSUBSCRIBE_SECRET-unset assertion |

## TDD Gate Compliance

Both tasks followed RED → GREEN cycle with explicit test-first commits:

- Task 1: `eeffedee` (test, 0 prior impl files) → `3f8e95d9` (impl, all tests pass)
- Task 2: `4b8fa9f5` (test, 0 prior impl files) → `1b65f758` (impl, all tests pass)

No REFACTOR commit needed — implementations matched the planned skeleton + test contract on first GREEN pass. The `a61edd12` fix is post-cycle (cross-Fn sweep regression), classified as Rule 1 bug not refactor.

## Coordination with Wave 1 Siblings

- Plan 49-06 (daily-digest) imports `mintUnsubscribeToken` via `import { mintUnsubscribeToken } from '../_shared/unsubscribe-token.ts'`
- Plan 49-07 (weekly-digest) imports the same
- Orchestrator serializes 49-08 BEFORE {49-06, 49-07} within Wave 1 per PLAN.md `depends_on: [49-04]` (49-04 ships `notification_settings` table) and 49-06/49-07 `depends_on: [49-08]`.

## Deferrals

- **Wave 0 secret:** `UNSUBSCRIBE_SECRET` not set; runtime gate at Plan 49-10 close-out.
- **Wave 3 deploy:** `supabase functions deploy unsubscribe-handler` not run per plan instruction ("Do NOT run `supabase functions deploy`"); deferred to Plan 49-10 close-out (per `feedback_fn_deploy_before_cron_db_push` — Fn must deploy BEFORE any cron job that targets it).
- **Gmail RFC 8058 in-inbox UAT:** Deferred to Plan 49-10 Wave 3 HUMAN-UAT signal-1 (requires real Gmail account + email delivery, which is downstream of Wave 2 49-06/49-07 dispatch).

## Self-Check: PASSED

**Files:**
- FOUND: `supabase/functions/_shared/unsubscribe-token.ts`
- FOUND: `supabase/functions/_shared/unsubscribe-token.test.ts`
- FOUND: `supabase/functions/unsubscribe-handler/index.ts`
- FOUND: `supabase/functions/unsubscribe-handler/deno.json`
- FOUND: `supabase/functions/unsubscribe-handler/index.test.ts`

**Commits:**
- FOUND: `eeffedee` test(49-08): add failing tests for unsubscribe-token mint/verify
- FOUND: `3f8e95d9` feat(49-08): implement unsubscribe-token HMAC mint/verify
- FOUND: `4b8fa9f5` test(49-08): add failing tests + deno.json for unsubscribe-handler
- FOUND: `1b65f758` feat(49-08): implement unsubscribe-handler Edge Fn (RFC 8058 One-Click)
- FOUND: `a61edd12` fix(49-08): test-order-independent UNSUBSCRIBE_SECRET-unset assertion

**Tests:** 15/15 pass under cross-Fn `deno test` sweep, order-independent.
