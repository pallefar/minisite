---
phase: 28
plan: "04"
subsystem: realtime-channel-auth
tags: [hmac, realtime, rls, vault, secdef, migrations, vitest, playwright]
dependency_graph:
  requires: ["28-00", "28-01", "28-P28-Task1-vault-mint"]
  provides: ["HMAC-realtime-channel-auth", "org-realtime-ts", "realtime_topic_authorized"]
  affects: ["realtime.messages", "org-realtime.ts", "plans 28-05/06/07"]
tech_stack:
  added:
    - "HMAC-SHA-256 via crypto.subtle (browser WebCrypto API)"
    - "extensions.hmac (PostgreSQL pgcrypto Supabase extension)"
    - "vault.decrypted_secrets (Supabase Vault)"
  patterns:
    - "SECDEF RPC pattern with explicit revoke from public/anon"
    - "Module-level secret cache with test-only clear function"
    - "vi.hoisted() for vitest mock factory hoisting"
    - "supabase-js channel.subscribe() direct in Playwright spec"
key_files:
  created:
    - supabase/migrations/20270601100014_org_realtime_channel_secret_vault.sql
    - supabase/migrations/20270601100015_get_realtime_secret_secdef_fn.sql
    - supabase/migrations/20270601100016_realtime_topic_authorized_fn.sql
    - supabase/migrations/20270601100019_realtime_messages_org_hmac_policy.sql
    - tests/sql/p28-realtime-topic-authorized.test.sql
    - leanshot/src/lib/org-realtime.ts
    - leanshot/src/lib/__tests__/org-realtime.test.ts
    - leanshot/e2e/rls-org-realtime-channel.spec.ts
  modified: []
decisions:
  - "Used vi.hoisted() to avoid vitest mock factory hoisting ReferenceError (cannot access mockRpc before init)"
  - "SQL unit test uses dynamic HMAC computation via CTE (not hardcoded values) — secret-rotation safe"
  - "Migration 100014 raises EXCEPTION (not NOTICE) if vault secret missing — fail-loud deployment posture"
  - "get_realtime_secret() also granted to service_role for runbook/test automation (addition to plan spec)"
  - "Playwright spec asserts cross-tenant CHANNEL_ERROR OR zero events (both satisfy security invariant per clinic-realtime-negative-space.spec.ts precedent)"
  - "org-realtime.ts does NOT modify clinic-realtime.ts (hard rule enforced)"
metrics:
  duration_minutes: 25
  completed_date: "2026-05-17"
  tasks_completed: 3
  files_created: 8
  deviations: 2
---

# Phase 28 Plan 04: HMAC Realtime Channels + SECDEF Helper Summary

**One-liner:** HMAC-SHA-256 realtime channel auth via Vault secret + SECDEF helpers; cross-tenant channel subscription denied by `realtime_topic_authorized` RLS policy with defense-in-depth claim check.

## Tasks Completed

| Task | Name | Commit | Status |
|------|------|--------|--------|
| 1 | Vault secret mint (HUMAN-CHECKPOINT) | pre-flight (orchestrator) | Done (resumed) |
| 2 | 4 migrations + SQL unit test | 320ff45 | Done |
| 3 | org-realtime.ts + vitest + Playwright e2e | 979d95c | Done |

## Task 1: Vault Secret (Pre-flight)

- Secret `org_realtime_channel_secret` minted by orchestrator pre-flight.
- Verified: `hex_len=64, byte_len=32` — 32-byte random secret.
- Secret ID: `579750f5-1c36-45b5-a354-eae98c482218`.

## Task 2: Migrations

### Migration 20270601100014

Vault assertion guard. Raises `EXCEPTION` (not NOTICE) if `org_realtime_channel_secret` is missing from `vault.decrypted_secrets` — fail-loud deployment posture. Idempotent.

### Migration 20270601100015

`public.get_realtime_secret()` SECDEF SQL function:
- Reads `vault.decrypted_secrets WHERE name='org_realtime_channel_secret'`
- `REVOKE execute FROM public, authenticated, anon`
- `GRANT execute TO supabase_realtime_admin, service_role`

Verified: `authenticated` and `anon` cannot execute.

### Migration 20270601100016

Two SECDEF functions:

1. `public.realtime_topic_authorized(topic text, claims jsonb) → boolean`
   - Validates topic shape regex `^org-[0-9a-f]{8}-[a-z_]+$`
   - Iterates `claims->app_metadata->org_ids`, recomputes HMAC-SHA-256 for each
   - Defense-in-depth: HMAC match AND org_id must be in caller's JWT claims
   - Uses `current_setting('request.jwt.claims', true)::jsonb` (per addendum A4 — `claim()` does NOT exist)

2. `public.get_realtime_channel_keying() → text`
   - Browser-facing RPC; returns raw secret hex
   - `REVOKE FROM public, anon`; `GRANT TO authenticated, service_role`

### Migration 20270601100019

One-liner RLS policy on `realtime.messages`:

```sql
create policy "org_hmac_channel_select" on realtime.messages
  for select to authenticated
  using (
    public.realtime_topic_authorized(
      realtime.topic(),
      current_setting('request.jwt.claims', true)::jsonb
    )
  );
```

### SQL Unit Test Results (6/6 OK)

| Case | Description | Result |
|------|-------------|--------|
| 1 | Happy path: valid HMAC + org_id in claims | OK |
| 2 | Defense-in-depth: HMAC valid, org_id NOT in claims | OK |
| 3 | HMAC mismatch: wrong prefix, org_id in claims | OK |
| 4 | Malformed topic (not-an-org-topic) | OK |
| 5 | Uppercase table name (regex rejects) | OK |
| 6 | Empty claims ({}) | OK |

## Task 3: Source Files + Tests

### src/lib/org-realtime.ts

- `channelNameFor(orgId: string, table: string): Promise<string>` — HMAC-SHA-256 via `crypto.subtle.importKey + sign`; format `org-{8hex}-{table}`
- `_clearSecretCache(): void` — test-only module state reset
- Module-level `_cachedSecretBuffer` — one RPC call per session
- Does NOT modify `clinic-realtime.ts` (hard rule enforced)

### src/lib/__tests__/org-realtime.test.ts (8/8 PASS)

| Test | Description | Result |
|------|-------------|--------|
| T1 | Deterministic: same inputs → same output + format regex | PASS |
| T1 ext | Output matches pre-computed expected HMAC | PASS |
| T2 | Distinct orgs → distinct channel names | PASS |
| T3 | Same org, distinct tables → distinct channel names | PASS |
| T4 | Secret cached: RPC called exactly once | PASS |
| T4 clear | _clearSecretCache() triggers new RPC call | PASS |
| Error | RPC error → throws with descriptive message | PASS |
| Error | null data → throws "missing Vault secret" | PASS |

**vi.hoisted() deviation:** Needed to use `vi.hoisted()` for `mockRpc` initialization because `vi.mock()` factory is hoisted to top of file by Babel transform — standard `const mockRpc = vi.fn()` causes "Cannot access before initialization" ReferenceError.

### e2e/rls-org-realtime-channel.spec.ts

- Gated via `PLAYWRIGHT_RUN_P28=1` (per [[reference_playwright_conditional_project_argv]])
- Setup: creates 2 users + 2 orgs via admin API; mints sessions via generateLink+verifyOtp (ES256-compat)
- Test 5: User A subscribes to `channelNameFor(orgY, 'org_members')` → CHANNEL_ERROR (cross-tenant deny)
- Test 6: User A subscribes to `channelNameFor(orgX, 'org_members')` → SUBSCRIBED (same-tenant allow)
- Drives supabase-js directly (no UI traversal) per [[feedback_realtime_layer_e2e_pattern]]

## Verification Checklist

- [x] 4 migrations pushed without `^Skipping` lines
- [x] SQL helper unit test 6/6 OK
- [x] `authenticated` cannot execute `get_realtime_secret()`
- [x] `anon` cannot execute `get_realtime_secret()`
- [x] `authenticated` CAN execute `get_realtime_channel_keying()`
- [x] `anon` cannot execute `get_realtime_channel_keying()`
- [x] RLS policy `org_hmac_channel_select` confirmed on `realtime.messages`
- [x] vitest 8/8 green
- [x] TypeScript `--noEmit` exit 0
- [x] Bundle size delta: ~2 kB uncompressed (no external deps, only crypto.subtle + supabase)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] vi.hoisted() required for vitest mock factory**

- **Found during:** Task 3
- **Issue:** `const mockRpc = vi.fn()` declared before `vi.mock()` factory causes "Cannot access before initialization" because `vi.mock()` is hoisted to the top of the file by Vitest's Babel transform.
- **Fix:** Used `vi.hoisted(() => ({ mockRpc: vi.fn() }))` to create the mock function in the hoisted context, then destructured into the `mockRpc` constant.
- **Files modified:** `leanshot/src/lib/__tests__/org-realtime.test.ts`
- **Commit:** 979d95c

**2. [Rule 2 - Missing critical functionality] service_role grant on get_realtime_secret()**

- **Found during:** Task 2
- **Issue:** Plan only specified `supabase_realtime_admin` grant for `get_realtime_secret()`. Runbook automation and integration tests (run with `service_role`) need to call this function without impersonating the internal realtime role.
- **Fix:** Added `GRANT execute ON FUNCTION public.get_realtime_secret() TO service_role`.
- **Files modified:** `supabase/migrations/20270601100015_get_realtime_secret_secdef_fn.sql`
- **Commit:** 320ff45

## Note for Plan 07 (Extension Contract)

Per plan output item 7: downstream phases using `realtime_topic_authorized` MUST document `allowed_table_regex` extension procedure. Currently the topic regex is `^org-[0-9a-f]{8}-[a-z_]+$` which allows ANY lowercase table name. Plan 07 should document:
1. New table names are automatically supported (no migration needed).
2. If table name includes uppercase or special chars, the topic will be rejected.
3. Rotation runbook: rotate Vault secret → `UPDATE vault.secrets SET secret = '<new_hex>' WHERE name = 'org_realtime_channel_secret'` → no migration needed.

## Known Stubs

None. All channel name computation, secret fetching, and RLS enforcement are fully wired.

## Threat Flags

No new security-relevant surfaces beyond those in the plan's `<threat_model>`. All mitigations applied:
- T-28-04-01: Defense-in-depth claim check implemented in `realtime_topic_authorized` loop
- T-28-04-02: Explicit revoke from public/anon on both SECDEF functions
- T-28-04-04: `current_setting('request.jwt.claims', true)::jsonb` used (not nonexistent `claim()`)
- T-28-04-05: Loop construct guarantees both HMAC match AND org_id in claims

## Self-Check: PASSED

Files confirmed present:
- supabase/migrations/20270601100014_org_realtime_channel_secret_vault.sql: FOUND
- supabase/migrations/20270601100015_get_realtime_secret_secdef_fn.sql: FOUND
- supabase/migrations/20270601100016_realtime_topic_authorized_fn.sql: FOUND
- supabase/migrations/20270601100019_realtime_messages_org_hmac_policy.sql: FOUND
- tests/sql/p28-realtime-topic-authorized.test.sql: FOUND
- leanshot/src/lib/org-realtime.ts: FOUND
- leanshot/src/lib/__tests__/org-realtime.test.ts: FOUND
- leanshot/e2e/rls-org-realtime-channel.spec.ts: FOUND

Commits confirmed:
- 320ff45: feat(28-04): push 4 HMAC realtime auth migrations + SQL unit test
- 979d95c: feat(28-04): org-realtime.ts + vitest + Playwright cross-tenant channel e2e
