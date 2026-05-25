---
phase: 34-m2-onboarding-overhaul-activation-event
plan: 05
subsystem: onboarding-merge
tags:
  - anonymous-merge
  - secdef-rpc
  - posthog-alias
  - edge-fn
  - phase-34
requirements:
  - ONBOARD-01
  - ONBOARD-11
dependency_graph:
  requires:
    - 34-01  # anonymous_sessions schema (cookie_id, preferences, draft_entries, aff_code, merged_user_id)
    - 34-02  # weekly TTL cron that only sweeps merged_user_id IS NULL rows
  provides:
    - merge_anon_session(uuid, text[]) → jsonb         # SECDEF RPC, service_role only
    - POST /functions/v1/merge-anon-session             # browser-callable bridge
    - aliasServerSide(supabaseUid, anonDistinctId)      # added to _shared/posthog-server.ts
    - callMergeAnonSession({...})                       # typed browser helper in leanshot/src/lib/anonymous/merge.ts
  affects:
    - 34-06  # useConsumerOnboardingFlow will call callMergeAnonSession post-signup
tech_stack:
  added: []                                              # purely additive; no new deps
  patterns:
    - "SECDEF + pg_advisory_xact_lock for race-safe multi-device merge (D-07)"
    - "Vendor-gated PostHog alias helper (no-op when POSTHOG_PROJECT_KEY unset)"
    - "Edge-Fn try/finally + shutdownPostHog (PITFALL 1)"
    - "Test-seam pattern: setAdmin/setAlias/setShutdownSpyForTest hooks for handler-level Deno tests"
key_files:
  created:
    - supabase/migrations/20270706000007_p34_merge_anon_session_rpc.sql
    - supabase/functions/merge-anon-session/index.ts
    - supabase/functions/merge-anon-session/index.test.ts
    - supabase/functions/merge-anon-session/deno.json
    - leanshot/src/lib/anonymous/merge.ts
    - leanshot/src/lib/anonymous/__tests__/anon-merge.test.ts
  modified:
    - supabase/functions/_shared/posthog-server.ts       # +aliasServerSide()
decisions:
  - "D-07 richest-data tiebreak via population_score = (non-null preferences keys + jsonb_array_length(draft_entries)), ordered DESC then last_activity_at DESC."
  - "Sibling rows (non-winners with the same user_id) are tagged merged_user_id but NOT deleted, so the TTL cron leaves them as audit trail. The cron only sweeps orphan rows (merged_user_id IS NULL)."
  - "PostHog alias uses Pattern A: server receives browser's posthog distinct_id via body.anon_distinct_id; falls silent (no alias) when omitted. Avoids aliasing to the cookie_id surrogate, which would corrupt PostHog timelines."
  - "D-08 propagation is best-effort: profiles + affiliate_clicks failures log + carry on. The merge winner row is already tagged merged_user_id inside the same SQL txn as the RPC pick; rolling back on a downstream UPDATE failure would silently strand the user's preferences because the next retry would see winner_id:null."
  - "affiliate_clicks join column is referral_code (Phase 19 schema), not aff_code. Plan body referenced aff_code; actual column name is referral_code. Edge Fn maps anonymous_sessions.aff_code → affiliate_clicks.referral_code."
metrics:
  duration: ~12 minutes
  completed: 2026-05-20T15:51:32Z
  tasks_completed: 2
  files_changed: 6 (5 created + 1 modified)
---

# Phase 34 Plan 34-05: merge-anon-session Summary

## One-Liner

Ships the keystone anonymous → authenticated merge: a `merge_anon_session(uuid, text[])` SECDEF RPC that picks the richest-data winner row under `pg_advisory_xact_lock`, plus a `merge-anon-session` Edge Fn that calls it post-signup and propagates D-08's four buckets (preferences → profiles, draft_entries → response body, PostHog alias → server-side, aff_code → affiliate_clicks).

## What Shipped

### 1. `merge_anon_session` SECDEF RPC (`20270706000007_p34_merge_anon_session_rpc.sql`)

```sql
public.merge_anon_session(p_user_id uuid, p_cookie_ids text[]) → jsonb
  security definer
  set search_path = pg_catalog, public, extensions
```

Body:

1. `pg_advisory_xact_lock(hashtext('merge_anon_session:' || p_user_id::text))` — serializes concurrent calls per user.
2. CTE `eligible` selects rows where `cookie_id = ANY(p_cookie_ids) AND merged_user_id IS NULL` and computes `pop_score = (count of non-null preferences keys) + jsonb_array_length(draft_entries)`.
3. Pick winner: `ORDER BY pop_score DESC, last_activity_at DESC LIMIT 1`.
4. Mark winner + all eligible siblings with `merged_user_id = p_user_id` (single UPDATE).
5. Return `{ winner_id, cookie_id, preferences, draft_entries, aff_code }` or `{ winner_id: null }` on no-hit (idempotent re-run).

GRANT EXECUTE → `service_role` only; revoked from `public, anon, authenticated` (D-10).

### 2. `merge-anon-session` Edge Function

`POST /functions/v1/merge-anon-session`

Request:

```json
{
  "cookie_ids": ["<uuid>", ...],          // 1..8 entries, 8..64 chars each
  "anon_distinct_id": "<posthog-id>"      // optional, 8..128 chars
}
```

Response shapes:

| Status | Body | Path |
|--------|------|------|
| 200 | `{ "merged": true, "draft_entries": [...] }` | Winner found; preferences propagated; alias fired (if anon_distinct_id) |
| 200 | `{ "merged": false }` | No eligible row; idempotent re-run |
| 400 | `{ "error": "invalid_body" }` | Missing/malformed cookie_ids; too many entries; bad anon_distinct_id |
| 401 | `{ "error": "unauthenticated" }` | No Bearer / invalid JWT |
| 500 | `{ "error": "rpc_error" }` | Postgres unrecoverable |

### 3. `aliasServerSide(supabaseUid, anonDistinctId)` (`_shared/posthog-server.ts`)

```typescript
export function aliasServerSide(supabaseUid: string, anonDistinctId: string): void
```

- Vendor-gated: no-op when `POSTHOG_PROJECT_KEY` unset (same health-check pattern as `captureServer`).
- Wraps `client.alias({ distinctId: supabaseUid, alias: anonDistinctId })` — posthog-node's arg shape (DIFFERENT from posthog-js which is positional).
- Never throws back to caller; analytics-stitch is not load-bearing.

### 4. Browser caller (`leanshot/src/lib/anonymous/merge.ts`)

```typescript
callMergeAnonSession({
  functionsBaseUrl,
  accessToken,
  body: { cookie_ids, anon_distinct_id? },
  fetchImpl?,                                          // test seam
}): Promise<MergeAnonSessionResponse>
```

Plan 34-06's `useConsumerOnboardingFlow` will be the only consumer.

## Test Coverage

| File | Cases | Status |
|------|-------|--------|
| `supabase/functions/merge-anon-session/index.test.ts` | 8 Deno tests (happy path, no-winner, 401, 400, cookie cap, alias branching ×2, RPC-error shutdown) | All pass |
| `leanshot/src/lib/anonymous/__tests__/anon-merge.test.ts` | 6 vitest contract tests (URL, headers, body shape, response round-trip, omit anon_distinct_id, non-200 throws, trailing-slash strip) | All pass |

Migration apply / runtime SECDEF execution will be exercised in Phase 34's integration verification phase against the linked Supabase project (orchestrator deploys all Wave 2 Edge Fns + applies migrations atomically).

## cookie_id vs anon_distinct_id design choice

PostHog identity-stitching ties a NEW canonical id (Supabase uid) to the prior anonymous id. There are TWO candidate prior ids in our system:

- **`cookie_id`** — the `_ls_anon` UUID we generate in Plan 34-02. Lives in `anonymous_sessions`.
- **`anon_distinct_id`** — whatever posthog-js generated when the visitor first hit the page. Lives in browser localStorage `ph_*_posthog`.

These are DIFFERENT identifiers. Aliasing to `cookie_id` would tell PostHog "merge this user with a UUID it has never seen as a distinct_id", producing a no-op or a corrupted timeline.

**Pattern A (chosen):** Browser sends `anon_distinct_id` in the request body. Edge Fn calls `aliasServerSide(uid, anon_distinct_id)`. Adblocker-resistant (server-side request bypasses browser blocking).

**Pattern B (not chosen):** Browser does the alias client-side via existing `aliasAnonymousToUid` (Plan 33 / `src/lib/analytics/identify.ts`). Skips server-side. Loses the adblocker-resistant path.

Both can coexist (alias is idempotent server-side). For now Plan 34-05 ships Pattern A; the existing client-side `aliasAnonymousToUid` stays in place untouched.

When `anon_distinct_id` is omitted from the body (e.g. PostHog blocked + no distinct_id available), `aliasServerSide` is NOT invoked — verified by Deno test T7.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 — Schema bug] `affiliate_clicks.aff_code` → `affiliate_clicks.referral_code`**

- **Found during:** Task 2 implementation, when grepping for the affiliate-attribute pattern.
- **Issue:** The plan body referenced `affiliate_clicks.aff_code` but the actual Phase 19 schema column (`20270101000002_affiliate_clicks_conversions_payouts.sql`) is `referral_code`. The `anonymous_sessions.aff_code` column IS named `aff_code` (Plan 34-01), so the propagation is a name mapping, not a single column.
- **Fix:** Edge Fn does `affiliate_clicks.update({ user_id }).eq('referral_code', winner.aff_code).is('user_id', null)`. Test T1 asserts exactly that.
- **Files modified:** `supabase/functions/merge-anon-session/index.ts`, `supabase/functions/merge-anon-session/index.test.ts`
- **Commit:** 7b35962

**2. [Rule 3 — Worktree pwd drift] Files written to main repo instead of worktree**

- **Found during:** Task 1, after running `Write` with absolute `/Users/karstenhaldan/minisite/...` path.
- **Issue:** Absolute paths starting with `/Users/karstenhaldan/minisite/` resolve to the **main repo** rather than the worktree at `/Users/karstenhaldan/minisite/.claude/worktrees/agent-a6c1a86ea2ebc6ce9/`. Reproduces the `feedback_worktree_executor_pwd_drift_leaks_to_main` memory pattern.
- **Fix:** Moved the orphan migration file from main repo into worktree; reverted main repo's `_shared/posthog-server.ts` to baseline; re-applied edit to worktree path. Subsequent Write calls use the full worktree-prefixed path.
- **Files affected:** `supabase/migrations/20270706000007_p34_merge_anon_session_rpc.sql`, `supabase/functions/_shared/posthog-server.ts`
- **Commit:** files landed correctly in e29a82f

**3. [Rule 3 — Tool availability] `deno` not on $PATH; `vitest` absent from worktree**

- **Issue:** `deno` lives at `$HOME/.deno/bin/deno` (not on default PATH). The worktree's `leanshot/` has no `node_modules` so `npx vitest` fails.
- **Fix:** Prepended `$HOME/.deno/bin` to PATH for Deno test runs. For vitest, ran the smoke test by copying the two test files into the main `/Users/karstenhaldan/minisite/leanshot/` (which has node_modules), executing, then deleting. Main repo is byte-identical to pre-run state. The files committed to the worktree are the canonical sources.
- **Files affected:** None (the copy-run-clean was a verification step).

### CLAUDE.md Adjustments

`leanshot/CLAUDE.md` requires GSD workflow entry; this work is dispatched by `/gsd-execute-phase` so the gate is satisfied.

## Threat Surface Scan

The plan's `<threat_model>` enumerated 6 STRIDE threats (T-34-05-01..06) all `mitigate` disposition. All mitigations are in place:

| Threat | Mitigation in code |
|--------|-------------------|
| T-34-05-01 Spoofing (stolen cookie_id) | SECDEF `WHERE merged_user_id IS NULL` excludes already-merged rows |
| T-34-05-02 Tampering (cookie_ids batch) | Body validator caps array at 8, each entry 8..64 chars |
| T-34-05-03 InfoDisclosure (drafts leak) | `auth.getUser(bearer)` validates JWT before RPC; D-10 RLS deny-all on anon role |
| T-34-05-04 EoP replay | Second call returns `winner_id:null` because all rows are merged_user_id != NULL |
| T-34-05-05 Repudiation | accept disposition; `merged_user_id + last_activity_at` provides audit trail |
| T-34-05-06 DoS (large array) | Same cap-of-8 as T-34-05-02 |

No new threat-flag surfaces introduced. Edge Fn is the ONLY new network entry point; it inherits Phase 24's auth boundary.

## Wire-Contract Pinning

The `callMergeAnonSession` helper + `merge-anon-session/index.ts` Body validator + 6 vitest contract assertions form a **lock** on the wire shape. Any change to:

- field name (`cookie_ids`, `anon_distinct_id`, `merged`, `draft_entries`)
- array bounds (1..8 cookie_ids; 8..64 char length)
- response status semantics (200 with merged:false vs 4xx for no-match)

…will surface as a failing test in either the Deno suite (server side) or the vitest suite (client side), before Plan 34-06 even runs.

## Self-Check: PASSED

Verified files exist on disk in worktree:

- supabase/migrations/20270706000007_p34_merge_anon_session_rpc.sql — FOUND
- supabase/functions/merge-anon-session/index.ts — FOUND
- supabase/functions/merge-anon-session/index.test.ts — FOUND
- supabase/functions/merge-anon-session/deno.json — FOUND
- supabase/functions/_shared/posthog-server.ts — MODIFIED (aliasServerSide present)
- leanshot/src/lib/anonymous/merge.ts — FOUND
- leanshot/src/lib/anonymous/__tests__/anon-merge.test.ts — FOUND

Verified commits exist on worktree branch:

- e29a82f feat(34-05): merge_anon_session SECDEF + aliasServerSide helper — FOUND
- 7b35962 feat(34-05): merge-anon-session Edge Fn + Deno tests + vitest smoke — FOUND

Verified test runs:

- `deno test supabase/functions/merge-anon-session/index.test.ts` — 8 passed | 0 failed
- `npx vitest run src/lib/anonymous/__tests__/anon-merge.test.ts` — 6 passed (run from main repo since worktree lacks node_modules)
