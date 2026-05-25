---
phase: 46
plan: 04
subsystem: courses
tags: [courses, mux, jwt, edge-fn, signed-playback]
requires: [46-01, 46-03]
provides: [mux-sign-playback-fn]
affects: [signed-playback-flow]
tech-stack:
  added:
    - "@mux/mux-node@14 jwt.signPlaybackId (explicit keyId/keySecret options)"
  patterns:
    - "Lazy admin singleton + Proxy + setAdminForTest hooks (verbatim from mux-create-upload)"
    - "setMuxForTest stub returning deterministic tokens — zero live Mux calls in tests"
    - "Deno.serve guard via import.meta.main (prevents top-level-serve trap)"
    - "Per-fn deno.json imports map (no --import-map deploy flag)"
key-files:
  created:
    - "supabase/functions/mux-sign-playback/index.ts (257 lines)"
    - "supabase/functions/mux-sign-playback/deno.json (11 lines)"
    - "supabase/functions/mux-sign-playback/index.test.ts (386 lines, 8 Deno.test cases)"
  modified: []
decisions:
  - "Explicit { keyId, keySecret } options on mux.jwt.signPlaybackId (NOT env-var auto-read) per RESEARCH Pitfall 4 + T-46-04 — env var names MUX_SIGNING_KEY_ID + MUX_SIGNING_KEY_PRIVATE (matches CONTEXT.md, decouples from SDK MUX_SIGNING_KEY/MUX_PRIVATE_KEY defaults that collide with VITE_* naming risk)"
  - "Free-preview bypass: tier check skipped only when lesson row itself has is_free_preview=true (server-trusted, not client-supplied)"
  - "4h exp on both video + thumbnail tokens; thumbnail params { time: 1 } for poster frame"
  - "Removed literal 'video.view' string from doc comment to satisfy grep gate (per feedback_negation_grep_defeated_by_comment_string)"
metrics:
  duration: "~15min"
  completed: "2026-05-24"
  tests_passing: "8/8"
---

# Phase 46 Plan 04: `mux-sign-playback` Edge Fn Summary

Mints time-limited RS256 JWT tokens (video + thumbnail) for Mux signed playback of paid course lessons, with tier_effective gating + free-preview bypass; 8 Deno tests green.

## What Shipped

Three files at exact paths declared in plan frontmatter:

| File | Lines | Commit |
|------|-------|--------|
| `supabase/functions/mux-sign-playback/index.ts` | 257 | `9f3ed91c` |
| `supabase/functions/mux-sign-playback/deno.json` | 11 | `9f3ed91c` |
| `supabase/functions/mux-sign-playback/index.test.ts` | 386 | `a8194053` |

## Behavior Implemented

| Scenario | Status | Body |
|----------|--------|------|
| Valid bearer + valid lesson + (free-preview OR has_active) | 200 | `{playback, thumbnail, playback_id}` |
| Missing Authorization header | 401 | `{error: "unauthorized"}` |
| Invalid bearer (admin.auth.getUser → null) | 401 | `{error: "unauthorized"}` |
| Free-tier user + non-preview lesson | 403 | `{error: "tier_required"}` |
| Lesson row not found | 404 | `{error: "lesson_not_found"}` |
| Lesson row present but mux_playback_id null OR mux_status != 'ready' | 404 | `{error: "lesson_not_ready"}` |
| Missing/non-string `lesson_id` in body | 400 | `{error: "invalid_body"}` |
| Body not JSON | 400 | `{error: "invalid_body"}` |
| Either signing key env empty | 500 | `{error: "signing_key_missing"}` |
| Mux SDK throws | 500 | `{error: "mux_error"}` |
| OPTIONS preflight | 204 | empty + CORS headers |
| Non-POST | 405 | `{error: "method_not_allowed"}` |

## Test Sweep

```
$HOME/.deno/bin/deno test --no-check --allow-env --allow-net supabase/functions/mux-sign-playback/
running 8 tests from ./supabase/functions/mux-sign-playback/index.test.ts
returns 401 when no Authorization header ... ok (1ms)
returns 401 when bearer JWT resolves to null user ... ok (0ms)
returns 404 lesson_not_found when lesson row absent ... ok (0ms)
returns 404 lesson_not_ready when mux_playback_id is null ... ok (0ms)
returns 403 tier_required for free user requesting non-preview lesson ... ok (0ms)
returns 200 + tokens for free user when lesson.is_free_preview=true (bypass) ... ok (0ms)
returns 200 + tokens for pro user requesting non-preview lesson ... ok (0ms)
returns 500 signing_key_missing when MUX_SIGNING_KEY_ID env is empty ... ok (0ms)
ok | 8 passed | 0 failed (6ms)
```

The two 200-path tests assert `mux.jwt.signPlaybackId` was called with explicit `keyId` + `keySecret` + `expiration: '4h'` on both tokens, and `params.time === 1` on the thumbnail call. No live Mux network calls — `setMuxForTest` returns deterministic `test.jwt.<type>.<playbackId>` strings.

## Plan Acceptance Criteria

- [x] 3 files at exact paths
- [x] Explicit `keyId`/`keySecret` options pattern (not env-var auto-read)
- [x] Env names `MUX_SIGNING_KEY_ID` + `MUX_SIGNING_KEY_PRIVATE` (matches CONTEXT.md)
- [x] 4h expiration on both tokens
- [x] Thumbnail params `{ time: 1 }`
- [x] No `video.view` references in shipped file (literal removed from comment per `feedback_negation_grep_defeated_by_comment_string`)
- [x] CORS + OPTIONS preflight handled
- [x] Deno.serve guard `if (import.meta.main && denoGlobal?.serve)` at end
- [x] 8 Deno.test cases pass
- [x] Free-preview bypass test green
- [x] Tier-required 403 test green
- [x] `signing_key_missing` 500 test green
- [x] No live Mux API calls (all signing stubbed)
- [x] No `--import-map` flag references (per-fn deno.json handles imports)

## Threat Model Coverage

| Threat ID | Mitigation Shipped |
|-----------|-------------------|
| T-46-01 (Info Disclosure: free user fetches signed URL for paid lesson) | `tier_effective.has_active` checked server-side from `auth.uid()`; bypass only when the lesson row's `is_free_preview=true`. Covered by test `returns 403 tier_required for free user requesting non-preview lesson`. |
| T-46-04 (Info Disclosure: Mux signing key leak to browser) | `MUX_SIGNING_KEY_ID` + `MUX_SIGNING_KEY_PRIVATE` read from `Deno.env.get`; NEVER returned to client; NEVER in `VITE_*` vars. Explicit-options pattern decouples from SDK auto-read defaults. |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Removed literal `video.view` string from doc comment**
- **Found during:** Task 1 grep gate verification
- **Issue:** Plan grep gate `! grep -qE "video\.view"` failed because the file's anti-skip docstring contained the literal phrase `"video.view webhook references"` (intended as a rejected-alternative note). Per memory `feedback_negation_grep_defeated_by_comment_string`, rejected-alternative names in committed source defeat negation greps.
- **Fix:** Rewrote the docstring to say `"view-event webhook references (that webhook does not exist in Mux)"` — preserves the documentation intent (Mux has no view-event webhook, anti-skip is client-side) without leaking the regex token into the file.
- **Files modified:** `supabase/functions/mux-sign-playback/index.ts` (lines 35-38)
- **Commit:** `9f3ed91c` (rolled into Task 1 commit; never committed broken state)

No other deviations.

## Deferred / Plan 46-11 Reminders

Plan 46-11 (close-out) MUST:

1. **Deploy the Fn:**
   ```bash
   npx supabase functions deploy mux-sign-playback
   ```
   No `--import-map` flag (per-fn `deno.json` handles imports — per `reference_supabase_functions_deploy_import_map_flag`).

2. **Set the two signing-key Function Secrets** (operator action via CLI):
   ```bash
   npx supabase secrets set MUX_SIGNING_KEY_ID=<mux_signing_key_id> --project-ref ytnsipxxmzgaebkqmokp
   npx supabase secrets set MUX_SIGNING_KEY_PRIVATE="$(cat private-key.base64)" --project-ref ytnsipxxmzgaebkqmokp
   ```
   These are DISTINCT from `MUX_TOKEN_ID` / `MUX_TOKEN_SECRET` (already set Phase 44).
   Generate via Mux dashboard → Settings → Signing Keys (or `mux signing-keys create` CLI).

3. **Smoke test the live deploy** with a curl request carrying a real user JWT + lesson_id of a `mux_status='ready'` lesson, expecting `{playback, thumbnail, playback_id}` JSON.

## Self-Check: PASSED

Verified all claimed files + commits exist on `worktree-agent-ae8c2612308539873`:

```
FOUND: supabase/functions/mux-sign-playback/index.ts (257 lines)
FOUND: supabase/functions/mux-sign-playback/deno.json (11 lines)
FOUND: supabase/functions/mux-sign-playback/index.test.ts (386 lines)
FOUND: commit 9f3ed91c (feat 46-04 Edge Fn)
FOUND: commit a8194053 (test 46-04 8-case Deno suite)
FOUND: 8/8 Deno tests passing
```
