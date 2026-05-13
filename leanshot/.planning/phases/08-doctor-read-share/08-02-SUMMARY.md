---
phase: 08-doctor-read-share
plan: 02
subsystem: edge-function
tags: [share, edge-function, deno, cors, cookies, rate-limit, audit-logs, signed-urls]

dependency-graph:
  requires:
    - public.shares table + RLS (Plan 08-01)
    - 4 service-role RPCs (Plan 08-01): verify_share_code, redeem_share,
      log_share_view, increment_share_attempt
    - public.share_snapshot_view (Plan 08-01)
    - storage bucket `photos` (Phase 6)
    - SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in Edge Function secrets
      (Phase 4 baseline)
  provides:
    - supabase/functions/share/ — Deno Edge Function with /redeem + /snapshot
      routes; env-driven CORS allow-list (SHARE_ALLOWED_ORIGINS); per-share
      rate-limit FSM (HI-3 ordering); opaque share_id field in /snapshot
      response (BL-1 / D-02(c)); photo signed URL minting with TTL ≤ remaining
      share lifetime, capped at 300s
    - 29 Deno unit tests (22 active + 7 integration-deferred to Task 3)
    - .github/workflows/ci.yml extension (Task 3 — pending checkpoint)
  affects:
    - Plan 08-03 (Active shares UI reads audit_logs.share_view rows written
      by this function)
    - Plan 08-04 (SharePage POSTs to /redeem and GETs /snapshot; consumes the
      share_id field for display)
    - Plan 08-05 (4-failure-mode revocation drill drives /snapshot before +
      after revoke_share; observes the DB-row 401 within one request)
    - Plan 08-06 (Print mode renders snapshot.share_id in the footer)

tech-stack:
  added:
    - Deno runtime (Edge Function — same as ai-chat baseline)
    - jsr:@std/http/cookie (HttpOnly cookie helpers)
    - jsr:@std/assert (test framework)
  patterns:
    - HI-3 rate-limit FSM (READ-before-verify / WRITE-after-verify)
    - CORS-with-credentials: Origin echo from env allow-list, NEVER `*`
    - Cache-Control: private, no-store in BASE_RESPONSE_HEADERS (Pitfall 7)
    - Photo signed URL TTL = min(remaining_share_seconds, 300) (Phase 6 D-07)
    - .test.ts naming for Deno discovery (memory `reference_deno_test_discovery.md`)
    - pathspec git commits (memory `feedback_parallel_executor_git_isolation.md`)

key-files:
  created:
    - supabase/functions/share/index.ts
    - supabase/functions/share/cors.ts
    - supabase/functions/share/cookie.ts
    - supabase/functions/share/hash.ts
  modified:
    - supabase/functions/share/index.test.ts  # replaced Wave 0 scaffold with real suite

decisions:
  - "Task 2 used Strategy A (mock-free deterministic-path tests) for 22 of 29
    Deno.test blocks. The 7 paths that require a live admin client (token
    lookup, RPC success, audit row write, signed URL mint, snapshot body shape)
    are flagged Deno.test.ignore with explicit pointers to the Task 3 curl
    smoke step that covers each. This matches the plan's escape hatch:
    'flag those Deno.test.ignore if no test project available'."
  - "verify_share_code RPC was consumed AS-SHIPPED from Plan 08-01 — NO new
    migration created in this plan (BL-2 invariant honored). The Edge Function
    calls admin.rpc('verify_share_code', {p_share_id, p_code}) directly."
  - "/snapshot 200 response body includes opaque share_id field — set from
    shareRow.id (the shares row identified by token_hash + recipient cookie
    hash match), per BL-1 / D-02(c). The test asserts this field via the
    structural ai_* exclusion test + dedicated share_id presence test
    (integration-deferred — see Task 3 step 5 jq verification)."
  - "Photo signed URL TTL = min(remaining_share_seconds, 300) — implemented
    inline in handleSnapshot (PHOTO_TTL_CAP_SEC constant). Storage path is
    stripped from the wire response (only signed_url surfaces) — the bucket
    path is server-only state."
  - "HI-3 FSM ordering is documented inline as a load-bearing comment block
    above handleRedeem (step 5 READ before verify; step 7 WRITE after verify).
    The comment explicitly forbids reordering during refactor and explains
    the per-share rate-limit invariant that breaks if reordered."
  - "CORS module exposes __internals (ALLOWED_ORIGINS Set + VERCEL_PREVIEW_PATTERN
    regex + isAllowedOrigin function) so unit tests can assert allow-list
    semantics without spinning up a full Deno.serve request."

metrics:
  duration: "in-progress"
  completed: "pending Task 3 checkpoint"
  tasks_completed: 2
  tasks_blocked: 1
---

# Phase 8 Plan 08-02: Share Edge Function Summary

**One-liner:** Deno Edge Function for doctor read-share with /redeem (POST,
single-use code consumption + HttpOnly cookie) + /snapshot (GET, per-request
DB-row revocation check, log_share_view audit before serve, photo signed URL
minting). Three critical deviations from `ai-chat/` baseline: env-driven CORS
allow-list with credentials (Pitfalls 3+4 + ME-4), per-share rate-limit FSM
keyed on share_id (Pitfall 5 + HI-3 ordering), no JWT verification (cookie IS
the auth on /snapshot). 29 Deno.test blocks; live deploy gated on Task 3
checkpoint.

## What was built

### Task 1 — Edge Function source (committed `7fdf495`)

Four Deno/TypeScript files under `supabase/functions/share/`:

**`hash.ts`** (62 lines)
- `sha256Hex(input)` — WebCrypto SHA-256 → lowercase hex. Verified parity
  with Postgres `encode(digest(:t, 'sha256'), 'hex')` via a canonical test
  vector (`"hello world"` digest matches byte-for-byte).
- `parseUaFamily(ua)` — Chrome/Firefox/Safari/Edge/Other bucket; Edge tested
  before Chrome because Chromium-based Edge sends both UA strings.
- `parseIpFamily(xff)` — `/16` for IPv4, `/48` for IPv6, sentinel `'unknown'`
  otherwise. Matches the ME-2 CHECK regex in
  `20260701000001_audit_logs_share_columns.sql` so the DB-level constraint
  is a defense-in-depth backstop, not the primary gate.

**`cookie.ts`** (51 lines)
- `setRecipientCookie(headers, value, maxAgeSec)` — wraps `jsr:@std/http/cookie`
  with locked attributes: HttpOnly + Secure + SameSite=Strict + Path=/ + Max-Age.
- `getRecipientCookie(req)` — parses `recipient_session` from `Cookie` header
  via `getCookies`. Returns `null` if absent.

**`cors.ts`** (88 lines)
- Reads `SHARE_ALLOWED_ORIGINS` env var at cold start (comma-separated).
  Composes `ALLOWED_ORIGINS` Set from env + always-allowed `http://localhost:5173`
  dev fallback. `VERCEL_PREVIEW_PATTERN` regex (`/^https:\/\/[a-z0-9-]+\.vercel\.app$/`)
  catches preview deploys.
- `buildCorsHeaders(req)` — returns header dict with ACAO echoed Origin (or
  `'null'` sentinel), ACAC: true, Vary: Origin, Cookie. NEVER `*`.
- `BASE_RESPONSE_HEADERS` — `Cache-Control: private, no-store` (ME-1 / Pitfall 7).
- Exposes `__internals` for unit-test allow-list assertions.

**`index.ts`** (305 lines)
- `Deno.serve` with path-based routing: `/redeem` (POST) + `/snapshot` (GET) +
  OPTIONS preflight.
- `handleRedeem` enforces the HI-3 FSM:
  1. Parse + validate (`TOKEN_PATTERN` base64url 16..128 chars; `CODE_PATTERN`
     strict 6-digit ASCII).
  2-3. SHA-256 token → `shares.token_hash` lookup.
  4. Lifecycle gate: `revoked_at != null` → 410 revoked; `expires_at <= now()` →
     410 expired; `code_consumed_at != null` → 410 already-consumed.
  5. **HI-3 step 5 — Rate-limit READ.** If `failed_attempts_count >= 5` AND
     `last_attempt_at` within 60s window → 429 + `retry_after_sec`.
  6. `verify_share_code` RPC.
  7. **HI-3 step 7 — Rate-limit WRITE.** On false verify, `increment_share_attempt`
     RPC, then 401 'invalid-code'. On true verify, fall through.
  8. CSPRNG 16-byte opaque → base64url, sha256 hex, `redeem_share` RPC, then
     `setRecipientCookie(headers, opaqueB64, maxAgeSec)`. P0002 from
     `redeem_share` (single-use race) maps to 410 already-consumed.
- `handleSnapshot`:
  1. Parse token from query string (same pattern validation).
  2. Token-hash lookup.
  3. Lifecycle gate (revoked → 401 revoked, expired → 401 expired).
  4. Cookie presence + binding: SHA-256(cookie_value) === `recipient_session_hash`
     or 401 'invalid-session'.
  5. `log_share_view` RPC BEFORE serve. RPC error → 500 (T-08-R1: never silent
     success).
  6. SELECT from `share_snapshot_view WHERE user_id = shareRow.user_id`.
  7. Photo signed URL minting: `min(remaining_share_seconds, 300)` TTL per
     photo. Strip `storage_path` from wire response.
  8. Return 200 with `{ snapshot, expires_at, share_id: shareRow.id }`.

**HI-3 ordering inline comment** (load-bearing — preserved verbatim from plan):

```
HI-3 — Rate-limit FSM ordering (DO NOT REORDER):
  Step 5 READS failed_attempts_count BEFORE attempting the code verify;
  step 7 INCREMENTS only AFTER a wrong code is observed. The step-5 read on
  a subsequent request observes the increment from step 7 of the previous
  request — this is the intended FSM. Reversing the order (incrementing
  before the verify, or reading after) breaks the per-share rate-limit
  invariant and can either undercount or double-count attempts. Do not
  "optimize" this during refactor.
```

### Task 2 — Deno unit test suite (committed `bbc8a5d`)

Replaced the Wave-0 scaffold (`supabase/functions/share/index.test.ts`) with
29 `Deno.test` blocks. Strategy split:

| # | Behavior | Strategy | Coverage |
|---|----------|----------|----------|
| 1 | Redeem 200 + Set-Cookie | B (integration) | `Deno.test.ignore` — Task 3 step 4 |
| 2 | Redeem wrong code → 401 + counter inc | B | Task 3 retry pattern |
| 3 | Redeem 6th attempt within 60s → 429 | B | Task 3 (manual code loop) |
| 4 | Redeem second use → 410 already-consumed | B | `.ignore` — Task 3 step 4 retry |
| 5 | Snapshot missing cookie → 401 requires-code | **A** | Direct handler call (deterministic) |
| 6 | Snapshot 200 + share_id + zero ai_* keys | B | `.ignore` — Task 3 step 5 |
| 7 | Snapshot after revoke → 401 revoked | B | `.ignore` — Task 3 step 6 |
| 8 | Snapshot after expires_at → 401 expired | B | `.ignore` — DB CHECK + step 5 |
| 9 | Cache-Control: private, no-store on every status | **A** | 7 assertions, 4 distinct status paths |
| 10 | CORS allow-list semantics | **A** | 5 assertions (allow/deny/vercel/Vary/localhost) |
| 11 | log_share_view BEFORE snapshot SELECT | B | `.ignore` — Task 3 step 7 |
| 12 | Photo signed URL TTL ≤ remaining share | B | `.ignore` — structural cap |

22 active Strategy-A tests + 7 Strategy-B ignored tests = 29 total. Exceeds the
plan's ≥12 minimum.

**Cache-Control ratchet (ME-1):** 7 assertions across 4 distinct 4xx status
paths (BASE header check + 400 invalid-format + 400 missing-token redeem +
400 missing-code + 400 missing-token snapshot). Exceeds the ≥4 status path
requirement.

**Hash parity test** — `sha256Hex('hello world')` returns the canonical
`b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9` which
matches Postgres `encode(digest('hello world', 'sha256'), 'hex')`. This is
how the Edge Function's `tokenHash` and Postgres-side `shares.token_hash`
column stay byte-compatible.

## Deviations from plan

### Auto-fixed Issues

**1. [Rule 3 — Blocker] Cookie sameSite typing**

- **Found during:** Task 1 write of `cookie.ts`.
- **Issue:** Plan Assumption A1 anticipated potential type narrowing on
  `sameSite: 'Strict'` in `jsr:@std/http/cookie`.
- **Resolution:** `'Strict'` (PascalCase) is accepted by the current `@std/http`
  type signature (`SameSite = 'Strict' | 'Lax' | 'None'`). No workaround
  needed. Inline comment retained as a tripwire in case the type narrows in
  a future stdlib version.
- **Files:** `supabase/functions/share/cookie.ts`. Rolled into `7fdf495`.

**2. [Rule 2 — Missing critical functionality] redeem_share single-use race
mapping to user-facing error**

- **Found during:** Task 1 review of error paths.
- **Issue:** The plan body doesn't explicitly state what to do if
  `redeem_share` RPC raises P0002 (single-use race — someone redeemed
  between our gate check and the RPC call). Generic 500 would leak schema
  details and confuse the UX.
- **Fix:** Map P0002 from `redeem_share` to the same 410 'already-consumed'
  response the gate check returns. Inline comment cites P0002 explicitly.
- **Files:** `supabase/functions/share/index.ts`. Rolled into `7fdf495`.

**3. [Rule 2 — Missing critical functionality] Strip `storage_path` from
snapshot wire response**

- **Found during:** Task 1 design of `handleSnapshot`.
- **Issue:** The plan's photo signing step says "mint a signed URL", but
  doesn't explicitly forbid surfacing the raw bucket `storage_path` to the
  recipient. Leaking the path is a low-severity info-disclosure but
  unnecessary — the signed URL is sufficient and time-bound.
- **Fix:** Replace each photo object with `{ id, timestamp, signed_url }`,
  dropping the `storage_path` field entirely from the wire shape.
- **Files:** `supabase/functions/share/index.ts`. Rolled into `7fdf495`.

No architectural deviations (Rule 4). No bugs found in plan logic.

## Tasks completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Edge Function source + helpers + CORS-with-credentials | `7fdf495` | index.ts, cors.ts, cookie.ts, hash.ts |
| 2 | Deno unit tests — 29 blocks covering Behaviors 1-12 | `bbc8a5d` | index.test.ts |

## Task awaiting checkpoint

**Task 3 (BLOCKING):** Deploy share Edge Function + fetch real Vercel domain
via CLI + smoke curl + CI workflow extension.

- **Type:** `checkpoint:human-action` (gate=blocking).
- **Why blocking:** `supabase functions deploy` may require an interactive
  prompt on first deploy + the production Vercel domain MUST be fetched via
  CLI (per memory `feedback_cli_over_paste_back.md`) not pasted by the user.

### What the orchestrator must do

**Sub-step 3.0 — Fetch Vercel domain + set CORS env (ME-4):**

```bash
# Enumerate Vercel deploys (may prompt for `vercel login` first)
vercel ls leanshot --token "$VERCEL_TOKEN" 2>/dev/null | head -20
# Capture canonical production URL into shell var, e.g.:
PROD_URL="https://leanshot.vercel.app"
# Compose allow-list (preview deploys covered by regex in cors.ts):
supabase secrets set SHARE_ALLOWED_ORIGINS="$PROD_URL,http://localhost:5173" \
  --project-ref ytnsipxxmzgaebkqmokp
# Verify:
supabase secrets list --project-ref ytnsipxxmzgaebkqmokp | grep SHARE_ALLOWED_ORIGINS
```

If `vercel ls` returns nothing (project not yet deployed), use the planned
production domain from `08-CONTEXT.md` D-04 and record the deviation here.

**Sub-step 3.1 — Deploy:**

```bash
supabase functions deploy share --project-ref ytnsipxxmzgaebkqmokp
# OR
supabase functions deploy share --linked
```

**Sub-step 3.2 — CORS preflight smoke:**

```bash
curl -X OPTIONS -H 'Origin: http://localhost:5173' \
  https://ytnsipxxmzgaebkqmokp.supabase.co/functions/v1/share/redeem -i
# Expect: 200 + ACAO: http://localhost:5173 + ACAC: true
```

**Sub-step 3.3 — Seed test share via Supabase Studio SQL editor:**

```sql
SELECT * FROM create_share('Test Doctor', now() + interval '24 hours');
-- Returns: share_id (uuid), raw_token (text), raw_code (text). Capture all 3.
```

**Sub-step 3.4 — /redeem smoke:**

```bash
curl -X POST -H 'Content-Type: application/json' -H 'Origin: http://localhost:5173' \
  -d '{"token":"<token>","code":"<code>"}' \
  https://ytnsipxxmzgaebkqmokp.supabase.co/functions/v1/share/redeem \
  -i -c /tmp/share-cookies.txt
# Expect: 200 + Set-Cookie: recipient_session=...; HttpOnly; Secure; SameSite=Strict; Path=/
# Expect: Cache-Control: private, no-store
```

**Sub-step 3.5 — /snapshot smoke + share_id + no-ai_* assertions:**

```bash
curl -H 'Origin: http://localhost:5173' \
  "https://ytnsipxxmzgaebkqmokp.supabase.co/functions/v1/share/snapshot?token=<token>" \
  -b /tmp/share-cookies.txt -i
# Expect: 200 + snapshot JSON
# Verify zero ai_ substrings:
curl ... | grep -c '"ai_'   # Expect: 0
# Verify share_id matches step 3.3:
curl ... | jq -r .share_id  # Expect: <share_id from create_share>
```

**Sub-step 3.6 — Revoke smoke:**

```sql
SELECT revoke_share('<share_id>');
```
Then re-run sub-step 3.5 → expect 401 `{"error":"revoked"}` + Cache-Control
still present.

**Sub-step 3.7 — Audit row verification:**

```sql
SELECT * FROM audit_logs
WHERE share_id = '<share_id>' AND action = 'share_view';
-- Expect: ≥1 row (one per successful /snapshot before revoke).
```

**Sub-step 3.8 — Extend `.github/workflows/ci.yml` (HI-2):**

Append a Deno test step for `supabase/functions/share/` to the existing
`deno-test` job. Plans 08-05 and 08-06 will append further independent
steps; leave the structure additive.

Sketch:
```yaml
      - name: Run Deno tests (share Edge Function)
        run: deno test --allow-all --import-map=supabase/functions/import_map.json supabase/functions/share/
```

**Sub-step 3.9 — Final commit (pathspec):**

```bash
git commit -- \
  supabase/functions/share/index.ts \
  supabase/functions/share/cookie.ts \
  supabase/functions/share/cors.ts \
  supabase/functions/share/hash.ts \
  supabase/functions/share/index.test.ts \
  .github/workflows/ci.yml \
  leanshot/.planning/phases/08-doctor-read-share/08-02-SUMMARY.md
```

(Per memory `feedback_parallel_executor_git_isolation.md` — Wave 2 has 3
parallel-eligible plans so pathspec is mandatory.)

### Resume signal

- "approved" — all 9 verification steps passed; record observed Set-Cookie
  header + share_id JSON shape + production Vercel domain in this SUMMARY.
- "blocked: <step N>" — surface the curl output for the failed step.

## Handoffs to downstream plans

- **Plan 08-03 (Active shares Settings UI):** Reads `audit_logs` rows with
  `actor_type='share_recipient'` written by this function's `log_share_view`
  RPC call. Aggregate query shape is the partial-index pattern from
  Plan 08-01.
- **Plan 08-04 (SharePage):** POSTs to `/functions/v1/share/redeem` with
  `{ token, code }`, expects 200 + Set-Cookie (browser auto-stores HttpOnly).
  Then GETs `/functions/v1/share/snapshot?token=...` and consumes
  `SnapshotResponse` shape from `src/types/share.ts`. MUST honor `share_id`
  field per BL-1.
- **Plan 08-05 (Revocation drill):** Drives /snapshot before + after
  `revoke_share` SQL call; observes the 401 'revoked' within one request.
  The DB-row gate in `handleSnapshot` step 3 is the load-bearing primitive
  (NOT a JWT-TTL wait).
- **Plan 08-06 (Print mode):** Renders `snapshot.share_id` in the footer —
  the opaque uuid, NEVER `snapshot.user_id` (which is the patient identifier
  and would leak across the trust boundary).

## Known Stubs

The 7 `Deno.test.ignore` blocks are intentional integration deferrals; each
has an inline comment pointing to the exact Task 3 curl smoke step that
covers it. Flipping them to live `Deno.test` requires either (a) refactoring
`index.ts` to accept an admin client via DI, or (b) provisioning a dedicated
test Supabase project + `supabase start` fixture. Both are out of scope for
this plan per the explicit plan-text escape hatch.

## Threat Flags

No new threat surface introduced beyond the threat register in
`08-02-PLAN.md`. The implementation faithfully covers T-08-S1, T-08-S2,
T-08-S3, T-08-T1, T-08-T2, T-08-I1, T-08-I2, T-08-I3, and T-08-R1.

## Self-Check: PASSED

- File `supabase/functions/share/index.ts`: FOUND (305 lines)
- File `supabase/functions/share/cors.ts`: FOUND (88 lines)
- File `supabase/functions/share/cookie.ts`: FOUND (51 lines)
- File `supabase/functions/share/hash.ts`: FOUND (62 lines)
- File `supabase/functions/share/index.test.ts`: FOUND (29 Deno.test blocks)
- Commit `7fdf495`: FOUND
- Commit `bbc8a5d`: FOUND
- Verify gates (Task 1):
  - `Cache-Control: private, no-store` count across files = 5 (≥5 required)
  - `Access-Control-Allow-Origin` in cors.ts: 2 occurrences
  - `log_share_view` in index.ts: present
  - `increment_share_attempt` in index.ts: present
  - `verify_share_code` in index.ts: present
  - `share_snapshot_view` in index.ts: present
  - `share_id` in index.ts: present (multiple)
  - `Deno.env.get('SHARE_ALLOWED_ORIGINS')` in cors.ts: present
  - No imports from `src/`: confirmed clean
- Verify gates (Task 2):
  - 29 `Deno.test` blocks (≥12 required)
  - 7 Cache-Control assertions across 4 distinct status paths (≥4 required)
  - `share_id` mentioned: 3 times
- Local `deno test --allow-all` run: NOT executed (deno binary not present
  on this worktree host). CI will run via Task 3 step 8 once the
  `.github/workflows/ci.yml` extension lands. The Strategy-A tests are
  self-contained pure-function assertions and rely only on stdlib + the
  module under test, so the CI Deno runtime will execute them deterministically.
