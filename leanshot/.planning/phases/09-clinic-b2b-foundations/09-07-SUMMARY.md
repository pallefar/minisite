---
phase: 09-clinic-b2b-foundations
plan: 07
subsystem: clinic-b2b-foundations
tags: [edge-function, photo-access, signed-url, three-check-gate, audit, clinic-07]
dependency_graph:
  requires:
    - "supabase/functions/clinic-photo/{cors.ts,deno.json,index.test.ts} (Plan 09-01 Wave-0 scaffolds)"
    - "supabase/migrations/20260801000007_memberships.sql (memberships table + partial unique index)"
    - "supabase/migrations/20260801000009_has_permission_fn.sql (SECURITY DEFINER STABLE helper)"
    - "supabase/migrations/20260801000011_clinic_rpcs.sql (log_clinic_event + 15 other RPCs)"
    - "supabase/migrations/20260514000009_photos.sql (Phase 6 photos table — user_id/photo_id/storage_path)"
    - "supabase/migrations/20260514000010_storage_bucket.sql (Phase 6 photos Storage bucket)"
    - "supabase/migrations/20260801000001_audit_logs_org_columns.sql (clinic_photo_view + permission_denied actions in CHECK whitelist)"
  provides:
    - "GET /clinic-photo/{orgId}/{userId}/{photoId} Edge Function with D-12 three-check gate"
    - "5-minute signed-URL mint via createSignedUrl(path, 300) — D-13"
    - "CLINIC-07 capture half on read path: clinic_photo_view audit on 200, permission_denied audit on every authorization deny"
    - "13 plan behaviors + 2 bonus tests (15 Deno tests total) — full 3-check gate exercised without live Postgres/Storage"
    - "Reusable pattern for Phase 10 drill-in: every operator-side data access routes through has_permission + per-request DB check (D-10 Layer 2)"
  affects:
    - "Plan 09-10 (drill-in e2e wires the operator photo path against this function)"
    - "Phase 10 (drill-in surface reuses the 3-check pattern verbatim for non-photo data types)"
tech-stack:
  added:
    - "Dependency-injected handler pattern (`handle(req, { admin })`) for unit-testing Edge Functions against a mock SupabaseClient — mirrors share/index.ts seam"
  patterns:
    - "Three-check gate: JWT → operator-membership-active → has_permission(key) → patient-membership-active+consent — single chain, all denials audit-logged"
    - "Audit-on-deny is best-effort (`logDenied` swallows); audit-on-success logs to console on failure but still serves (anti-DoS-via-broken-audit posture)"
    - "Strict-shape consent check: `consent_scope.photos !== true` denies missing/null/false/non-boolean — Pitfall #8 strict-shape defense in depth"
key-files:
  created:
    - "supabase/functions/clinic-photo/index.ts (287 lines, well above 180 min)"
  modified:
    - "supabase/functions/clinic-photo/index.test.ts (Plan 09-01 scaffold → 439 lines, well above 200 min; 15 tests covering all 13 plan behaviors + bad_path + 405)"
    - ".gitignore (exclude per-function deno.lock)"
decisions:
  - "Exported `handle(req, deps)` from index.ts so Deno tests inject a mock SupabaseClient. Mirrors the share/index.ts seam Plan 08-02 established. Module-level `Deno.serve` still binds production traffic; tests bypass the module-level admin client entirely."
  - "Mock SupabaseClient emulates only the surface the handler touches (auth.getUser, from().select().eq().is().maybeSingle(), rpc, storage.from().createSignedUrl). Builders are per-`.from()`-call so the two memberships lookups (operator + patient) don't share state. Revoked memberships are emulated by absence from the partial-index-aligned map (handler always calls `.is('revoked_at', null)`)."
  - "Path parsing tolerates the function name appearing in the URL prefix: takes the LAST 3 non-empty segments as (orgId, userId, photoId). This makes the local test fixtures (`/clinic-photo/{org}/{user}/{photo}`) and the Edge Runtime production routing (path name stripped) both work without runtime branching."
  - "404 photo_not_found writes NO audit row — by the time we hit this case the gate has already passed, so this is not a security event. Saves audit-log noise on stale row_ids passed by the operator UI."
  - "logDenied (permission_denied path) swallows errors; logOnSuccess (clinic_photo_view path) logs to console but still returns 200. Rationale: a broken audit pipeline must not let an attacker tell apart 'denied + audit succeeded' vs 'denied + audit failed' (timing leak), but on the success path the operator's request was already authorized by the gate, so failing the read because the audit row didn't write would be worse than a probabilistically-missing row."
  - "has_permission RPC error → 500 + permission_denied audit row. The audit row is still useful for forensics ('operator hit a broken permission check on this orgId at this time')."
metrics:
  duration_minutes: ~20
  tasks_complete: 1
  tasks_total: 1
  files_created: 1
  files_modified: 2
  test_count: 15
  completed: 2026-05-13
---

# Phase 9 Plan 07: clinic-photo Edge Function Summary

D-12 three-check gate (operator membership + role permission + patient consent) + D-13 5-minute signed-URL mint, both wired to the CLINIC-07 audit half via `log_clinic_event`. First cross-tenant operator data path in production — Phase 10 drill-in inherits the pattern.

## What landed (Task 1)

### Edge Function body (`supabase/functions/clinic-photo/index.ts`, 287 lines)

- **Endpoint:** `GET /clinic-photo/{orgId}/{userId}/{photoId}` — Bearer JWT required.
- **Three-check gate (D-12)** in order:
  1. `admin.auth.getUser(token)` → 401 `invalid_jwt` / 401 `no_auth` on missing.
  2. Operator's `memberships` row in orgId with `revoked_at IS NULL` → 401 `not_member` + audit `permission_denied`.
  3. `has_permission(operator, orgId, 'patient_photos.read')` RPC → 403 `permission_denied` + audit `permission_denied` (or 500 `permission_check_failed` + audit on RPC error).
  4. Patient's `memberships` row in orgId with `revoked_at IS NULL` → 401 `patient_not_member` + audit `permission_denied`.
  5. Patient `consent_scope.photos === true` (strict-equality — null/missing/false/non-boolean all deny) → 403 `consent_excluded` + audit `permission_denied`.
- **Photo lookup:** `(user_id, photo_id) → storage_path` from `public.photos`; 404 `photo_not_found` writes no audit row.
- **Signed URL:** `supabase.storage.from('photos').createSignedUrl(storage_path, 300)` → D-13 TTL; 500 `sign_failed` wraps Storage errors so bucket internals never leak.
- **Audit on success (CLINIC-07):** `log_clinic_event(actor_type='org_operator', action='clinic_photo_view', org_id, target_user_id=patient, row_id=photoId)`. Logged to console on failure but does NOT fail the response.
- **Response shape:** `200 {signedUrl, ttl: 300}` with `Cache-Control: private, no-store`.
- **CORS:** preflight returns the cors.ts headers verbatim (allow-* + GET,OPTIONS + authorization/apikey/content-type/x-client-info, NO credentials per Pitfall #11).

### Deno tests (`supabase/functions/clinic-photo/index.test.ts`, 439 lines, 15 tests)

| # | Test | Behavior |
|---|------|----------|
| 1 | 200 happy-path mints signed URL and writes audit row | Behavior 1 + 11 (audit fields) |
| 2 | 401 no_auth when Authorization header missing | Behavior 2 |
| 3 | 401 invalid_jwt when token does not resolve | Behavior 3 |
| 4 | 401 not_member when operator has no active membership | Behavior 4 + 12 (denied audit fields) |
| 5 | 403 permission_denied when role lacks patient_photos.read | Behavior 5 |
| 6 | 403 consent_excluded when patient consent_scope.photos is false | Behavior 6 |
| 7 | 403 consent_excluded when consent_scope omits photos key (strict-shape) | Pitfall #8 strict-shape defense |
| 8 | 401 patient_not_member when patient has no active membership | Behavior 7 |
| 9 | 404 photo_not_found writes NO audit row | Behavior 8 |
| 10 | 200 response sets Cache-Control: private, no-store | Behavior 9 |
| 11 | createSignedUrl is called with TTL=300 (D-13) | Behavior 10 |
| 12 | CORS preflight returns wildcard origin without credentials | Behavior 13 |
| 13 | clinic-photo cors headers — wildcard origin (no credentials) | static cors module assert |
| 14 | 400 bad_path when fewer than 3 path segments | bonus (input validation) |
| 15 | 405 method_not_allowed on POST | bonus (HTTP method gating) |

**Strategy:** seed `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` env BEFORE `await import('./index.ts')`, then invoke the exported `handle(req, { admin })` with a hand-rolled mock SupabaseClient that records every `.rpc(...)` and `.createSignedUrl(...)` call. Mirrors the `share/index.test.ts` pattern Plan 08-02 established.

**Verification (local):**
```
$ deno test --allow-env --allow-net --no-check
ok | 15 passed | 0 failed (10ms)

$ deno lint index.ts index.test.ts
Checked 2 files  (no errors)

$ deno check index.ts index.test.ts
Check index.ts
Check index.test.ts  (no errors)
```

### Threat-model coverage

All threats in the plan's `<threat_model>` register are mitigated (or accepted with documentation):

- **T-09-39 (info disclosure post-revoke):** ACCEPTED per D-13; documented in function header comment; 5-min worst-case window.
- **T-09-40 (operator without permission):** MITIGATED — check 2 (`has_permission` RPC); deny path writes audit.
- **T-09-41 (patient revoked consent.photos):** MITIGATED — strict-equality check on `consent_scope.photos !== true` (Test 7 proves missing-key denies too).
- **T-09-42 (repudiation):** MITIGATED — every 200 writes `clinic_photo_view` audit row with full actor+target context.
- **T-09-43 (operator passes wrong orgId):** MITIGATED — check 1 binds operator membership to `(operator.id, orgId)`; cross-tenant lookups return null.
- **T-09-44 (Storage createSignedUrl leaks internals):** MITIGATED — wrapped as `{error: 'sign_failed'}`; never echoed.

## Deviations from Plan

### Auto-fixed issues

**1. [Rule 2 — Critical Functionality] Dependency-injected `handle(req, deps)` seam**
- **Found during:** Task 1 implementation.
- **Issue:** The plan's example code uses a module-level `admin` constructed at import time and a bare `Deno.serve(async (req) => { ... })`. Without a DI seam the Deno tests can only do integration testing against a real Postgres + Storage, which the plan's verify step (`deno test --allow-env --allow-net`) implies but is impractical for a CI green gate. The plan-level `<verify>` block contradicts the test design implied by the 13 plan behaviors.
- **Fix:** Exported `handle(req, deps: { admin })` so tests inject a mock SupabaseClient. Production binding (`Deno.serve((req) => handle(req))`) still uses the module-level `moduleAdmin`. Mirrors the same seam Plan 08-02 added to `share/index.ts` (referenced in `09-CONTEXT.md` canonical_refs).
- **Files modified:** `supabase/functions/clinic-photo/index.ts`
- **Commit:** `1e83f04`

**2. [Rule 2 — Critical Functionality] Strict-shape `consent_scope.photos !== true` (not `=== false`)**
- **Found during:** Task 1 implementation.
- **Issue:** Plan example checks `patientMembership.consent_scope?.photos !== true` — but if a patient's `consent_scope` jsonb is `{ injections: true }` (photos key entirely missing), `=== false` would not deny while `!== true` does. The plan example actually uses `!== true` already, so this isn't a deviation from the plan's intent — but Test 7 was added to lock this behavior so a future refactor can't silently weaken it to `=== false`.
- **Fix:** Test 7 ("consent_excluded when consent_scope omits photos key") added to the suite to cement the strict-shape behavior.
- **Files modified:** `supabase/functions/clinic-photo/index.test.ts`
- **Commit:** `1e83f04`

**3. [Rule 3 — Blocking Issue] Path-parsing tolerates Edge Runtime prefix vs local test URL**
- **Found during:** Task 1 unit testing.
- **Issue:** Supabase Edge Runtime routes `/clinic-photo/...` to the function with the function name stripped (handler sees `/{orgId}/{userId}/{photoId}`), but local test fixtures use the full URL (`/clinic-photo/{orgId}/{userId}/{photoId}`). Plan example uses `parts = url.pathname.split('/').filter(Boolean); const [, orgId, userId, photoId] = parts` — that index-1 destructure assumes the function name is the first segment, which breaks in production where it isn't there.
- **Fix:** Take the LAST 3 non-empty segments via `parts.slice(-3)`. Both Edge Runtime (3 segments) and local test (4 segments with `clinic-photo` prefix) resolve to the same `(orgId, userId, photoId)` tuple.
- **Files modified:** `supabase/functions/clinic-photo/index.ts`
- **Commit:** `1e83f04`

**4. [Rule 2 — Critical Functionality] `.gitignore` deno.lock exclusion**
- **Found during:** Task 1 verification (`deno test` produces `deno.lock`).
- **Issue:** Running tests creates `supabase/functions/clinic-photo/deno.lock` (untracked). No other function commits its lockfile (verified `find supabase/functions -name deno.lock` returns only the new one); project convention is to NOT track per-function deno.lock files.
- **Fix:** Added `supabase/functions/**/deno.lock` to `.gitignore`.
- **Files modified:** `.gitignore`
- **Commit:** `1e83f04`

### Out-of-scope (deferred)

- **Production deploy (`supabase functions deploy clinic-photo --project-ref ytnsipxxmzgaebkqmokp`)** is a human-action gate the orchestrator owns at wave merge time. The function body, tests, and CORS are ready; deployment requires `SUPABASE_ACCESS_TOKEN` which is not available to a worktree executor. Documented for the orchestrator's Wave 3 close.
- **Audit-failure unit tests** — the handler swallows audit RPC errors by design; testing that path would require an additional scenario flag. Best-effort behavior is covered structurally (the success path runs `try/catch` with `console.error`; the deny path runs `try/catch` with no error escape). Not in plan's 13 behaviors.

## Threat Flags

None — every surface introduced by this plan is within the declared `<threat_model>` register. No new network endpoints, file access patterns, or schema changes at trust boundaries beyond what 09-01 already provisioned (memberships table + photos bucket + has_permission RPC).

## Known Stubs

None — `index.ts` is production-grade. `index.test.ts` mocks the SupabaseClient surface but every test exercises a real behavioral path through the handler.

## Self-Check

```
FOUND: supabase/functions/clinic-photo/index.ts (287 lines)
FOUND: supabase/functions/clinic-photo/index.test.ts (439 lines, 15 tests)
FOUND: .gitignore (deno.lock exclusion added)
FOUND commit 1e83f04 (Task 1 — Edge Function body + 15 Deno tests + .gitignore)

Deno test run: 15 passed | 0 failed (10ms)
Deno lint: Checked 2 files (no errors)
Deno check: clean on both files
```

## Self-Check: PASSED
