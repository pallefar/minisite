---
phase: 45
plan: 04
subsystem: community / dms
tags: [edge-function, dm, rate-limit, audit, debounce]
requires:
  - 45-01  # dm_threads, direct_messages, dm_thread_audit, user_block_list, profile cols
  - 45-02  # notify-community kind='dm_new'
  - 45-03  # dm-attachments bucket (attachment_path accepted but not validated here)
provides:
  - dm-create-thread Edge Function (POST endpoint)
affects:
  - 45-07 (DMComposer client surface — calls this Fn)
  - 45-09 (HUMAN-UAT — exercises this Fn end-to-end)
tech_stack:
  added: []
  patterns:
    - "Dual-auth (service-role OR user JWT with sub=creator_user_id binding)"
    - "Lazy admin singleton + Proxy override hook"
    - "Test-injectable notify-community callback via setNotifyCommunityForTest"
    - "Server-side body sanitization via regex allowlist (parity with browser FORBID_TAGS)"
key_files:
  created:
    - supabase/functions/dm-create-thread/index.ts
    - supabase/functions/dm-create-thread/index.test.ts
    - supabase/functions/dm-create-thread/deno.json
  modified: []
decisions:
  - "Skipped DOMPurify in Edge runtime (no DOM/jsdom); used regex FORBID_TAGS parity with browser policy. Browser sanitizer remains the authoritative gate at render time."
  - "Injected notify-community via __internal.setNotifyCommunityForTest rather than mocking globalThis.fetch — cleaner spy + isolates Fn↔Fn boundary."
  - "Self-DM defensive 400 invalid_body (DB CHECK is authoritative); cleaner UX than letting DB CHECK fail."
  - "UNIQUE-violation on dm_threads (creator, recipient) → re-fetch existing thread + insert new message (D-09 idempotency intent)."
  - "Rate-limit fail-closed on count query error: treat as over-limit with 3600s Retry-After (prevents runaway loops on transient DB errors)."
metrics:
  duration: ~25 minutes (executor wallclock)
  completed: 2026-05-24
---

# Phase 45 Plan 04: `dm-create-thread` Edge Function Summary

POST `/functions/v1/dm-create-thread` ships with dual-auth, 6 enforcement points (rate limit, clinician bypass, symmetric block, dm_closed, body sanitization, activity debounce), and 7 Deno tests covering all behavioural acceptance scenarios (T1-T7).

## What was built

**`supabase/functions/dm-create-thread/index.ts`** (350 lines, typecheck-clean):

- **CORS preflight** (OPTIONS → 204) reusing `corsHeaders` from notify-community.
- **Dual-auth** via `authenticate(req, body)`:
  - Path A: `SUPABASE_SERVICE_ROLE_KEY` bearer (constant-time compare).
  - Path B: user JWT → `admin.auth.getUser(bearer)` → JWT `sub` MUST equal `body.creator_user_id` (T-45-02 spoofing defense), else 403 `identity_mismatch`.
- **Body validation**: `recipient_user_id` non-empty string + `body` ≤ 2000 chars; rejects 400 `invalid_body` on shape mismatch or self-DM.
- **Server-side sanitization** (`sanitizeDmBody`): strips `FORBID_TAGS` set (`img|script|iframe|style|object|embed|base|form`) + rewrites `javascript:`/`data:`/`vbscript:` schemes in `href=`/`src=` to `#`. Parity with browser community sanitizer; defense-in-depth before persisting to DB.
- **Recipient profile fetch** (`dm_open, community_last_active_at, is_clinician_verified, leaderboard_handle`).
- **D-06**: `dm_open=false` → 403 `dm_closed`.
- **D-10**: symmetric block lookup `user_block_list(blocker=recipient, blocked=creator)` → 403 `blocked` (Edge Fn belt; RLS suspenders).
- **D-08**: sender profile lookup; if `is_clinician_verified=true`, skip rate limit and INSERT `dm_thread_audit (thread_id, actor_user_id=creator, reason='clinician_bypass')` after thread insert.
- **D-07**: `checkRateLimit(creatorId)` counts `dm_threads.creator_user_id=creator AND created_at >= now()-24h`; on `>=3`, returns 429 `rate_limited` + `Retry-After` computed from the oldest thread in the window.
- **Thread insert** with UNIQUE-violation fallback (re-fetch existing thread, reuse its id).
- **Message insert** with sanitized body + optional `attachment_path` passthrough.
- **`last_message_at` bump** on the thread (non-fatal on error).
- **D-20**: `community_last_active_at > now()-5min` → SKIP notify; else POST to `notify-community` with `kind='dm_new'` payload (`thread_id, sender_user_id, sender_handle, recipient_user_id, body_excerpt[0..80]`).
- **PII guard**: every `console.log` of a user id uses `hashForLog(value)` (sha256[0..12]).
- **`Deno.serve` guard** behind `import.meta.main && denoGlobal?.serve` (memory `reference_deno_test_top_level_serve_trap`).
- **`__internal` exports**: `handleDmCreateThread`, `setAdminForTest`, `resetAdminForTest`, `setNotifyCommunityForTest`, `sanitizeDmBody`.

**`supabase/functions/dm-create-thread/deno.json`** (verbatim copy of notify-community/deno.json — per-fn import map per memory `reference_supabase_functions_deploy_import_map_flag`).

**`supabase/functions/dm-create-thread/index.test.ts`** (435 lines, 7 Deno.test blocks):

| Test | Scenario | Outcome |
| ---- | -------- | ------- |
| T1 | missing bearer | 401 `unauthorized` |
| T2 | rate-limit at count=3 | 429 `rate_limited` + `Retry-After` header populated |
| T3 | recipient has blocked sender | 403 `blocked` |
| T4 | verified-clinician at count=5 | 201 + `dm_thread_audit` row `reason='clinician_bypass'` |
| T5 | recipient `dm_open=false` | 403 `dm_closed` |
| T6 | happy path | 201 + `notify-community` called once with `kind='dm_new'` |
| T7 | recipient active 2 min ago | 201 + `notify-community` NOT called (debounce) |

`makeFakeAdmin` PromiseLike chain handles count queries (`select('id',{count:'exact',head:true})`), `.single()`, `.maybeSingle()`, `.insert()`, `.update()`, and bare `.eq().eq()` UPDATE awaits. `installNotifySpy` injects a `setNotifyCommunityForTest` callback that records payloads.

## Test runtime

```
$HOME/.deno/bin/deno test --no-check --allow-env supabase/functions/dm-create-thread/index.test.ts
ok | 7 passed | 0 failed (14ms)
```

## Tasks

| Task | Name | Commit | Files |
| ---- | ---- | ------ | ----- |
| 1 | dm-create-thread Edge Fn implementation | `0ab078db` | `supabase/functions/dm-create-thread/index.ts`, `supabase/functions/dm-create-thread/deno.json` |
| 2 | Deno test suite T1-T7 | `98a55836` | `supabase/functions/dm-create-thread/index.test.ts` |

## Deviations from Plan

**None.** Plan executed as written. Two minor implementation choices documented in `decisions:` frontmatter:

1. **Sanitization parity by regex, not by jsdom-DOMPurify.** Plan §read_first acknowledged DOMPurify may be Deno-incompatible and authorised an "allowlist that mirrors the same policy"; we shipped the regex variant. No new sanitizer instance; browser sanitizer remains authoritative at render time.
2. **`notify-community` call injection via callback override**, not via `globalThis.fetch` mocking. Plan §action listed both as acceptable; the callback override is cleaner and avoids global side effects across tests.

## Verification

- Acceptance grep checks: PASS (all 11 conditions in Task 1, all 4 in Task 2).
- `deno check` on `index.ts`: PASS (typecheck clean).
- `deno test` on `index.test.ts`: 7/7 PASS in 14ms.
- No `Deno.serve` outside `import.meta.main` guard.
- No new DOMPurify policy instantiated (`grep -cE "new DOMPurify|createDOMPurify" index.ts` returns 0).
- No `--import-map` flag (per-fn `deno.json` owns imports).

## Deferred

- **Deploy**: Plan explicitly states "Do NOT run `supabase functions deploy`" — Fn is committed and ready for the Wave-N deploy step in 45-10 close-out.
- **Idempotency-key header**: Plan §behavior mentioned `X-Idempotency-Key` as "minimum viable: rely on UNIQUE (creator, recipient) constraint" — that's what we ship. No per-request idempotency key stored.
- **Direct dompurify-config import attempt**: Skipped per plan guidance + memory.

## Self-Check: PASSED

- `supabase/functions/dm-create-thread/index.ts`: FOUND (534 lines)
- `supabase/functions/dm-create-thread/index.test.ts`: FOUND (435 lines)
- `supabase/functions/dm-create-thread/deno.json`: FOUND (10 lines)
- Commit `0ab078db`: FOUND in `git log`
- Commit `98a55836`: FOUND in `git log`
- 7 Deno tests pass in 14ms
