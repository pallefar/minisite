---
phase: 46
plan: 05
subsystem: courses
tags: [courses, mux, edge-fn, extension, signed-playback, admin-only]
requires: [44-04]   # Phase 44 mux-create-upload + mux-webhook (deployed)
provides:
  - "mux-create-upload kind='course-lesson' branch (admin-only, signed playback, 30-min cap)"
  - "mux-webhook passthrough.kind dispatch (course_lessons UPDATE branch)"
affects:
  - "supabase/functions/mux-create-upload/index.ts"
  - "supabase/functions/mux-webhook/index.ts"
tech_stack:
  added: []
  patterns:
    - "passthrough.kind discriminator (forward-compatible add-only branching)"
    - "is_staff gate via profiles.is_staff (separate from tier_effective — T-46-07)"
    - "Mux signed playback policy (paired with Plan 46-04 JWT minting)"
key_files:
  created: []
  modified:
    - "supabase/functions/mux-create-upload/index.ts (+56 lines: course-lesson branch)"
    - "supabase/functions/mux-create-upload/index.test.ts (+9 tests, +1 mock field)"
    - "supabase/functions/mux-webhook/index.ts (+58 lines: kind dispatch + course_lessons branch)"
    - "supabase/functions/mux-webhook/index.test.ts (+7 tests, table-tagged tracker)"
decisions:
  - "Used kind discriminator in body + passthrough envelope (NOT separate Fns) — preserves Plan 46-04 JWT integration and minimizes deploy surface"
  - "is_staff lookup against public.profiles (NOT public.is_staff() helper) — keeps Fn simple, no extra RPC call"
  - "Missing lesson_id returns 200+warn (NOT 400) — Mux retries on non-200, and orphan passthroughs from admin tooling errors should not retry-loop"
  - "No video.view handler — RESEARCH Pitfall 1 confirmed this Mux event does not exist; anti-skip is client-side accumulate (Plan 46-04 + later plans)"
metrics:
  duration_minutes: ~25
  completed: 2026-05-24
---

# Phase 46 Plan 05: Mux Edge Fns — Course-Lesson Branch Extension Summary

Extended two existing Mux Edge Fns (`mux-create-upload`, `mux-webhook`) with a `kind: 'course-lesson'` discriminator that routes admin-only signed-playback uploads through a separate branch and dispatches Mux asset-lifecycle webhooks to `course_lessons` instead of `community_posts`.

## Files Changed

| File | Change | Lines |
|------|--------|-------|
| `supabase/functions/mux-create-upload/index.ts` | +course-lesson branch (admin gate, signed policy, 30-min cap, English subtitles, kind/lesson/course passthrough) | +56 |
| `supabase/functions/mux-create-upload/index.test.ts` | +9 Deno tests + `isStaff` mock field + extended `MuxUploadCallArgs.generated_subtitles` | +241 |
| `supabase/functions/mux-webhook/index.ts` | +course-lesson dispatch branch (3 event types → course_lessons UPDATE, missing-lesson_id 200+warn) | +58 |
| `supabase/functions/mux-webhook/index.test.ts` | +7 Deno tests + table-tagged `UpdateCall` tracker + `communityUpdateCalls()`/`courseLessonUpdateCalls()` helpers | +254 |

## Test Results

| Function | Before | After | New | Status |
|----------|--------|-------|-----|--------|
| mux-create-upload | 11 pass | 21 pass | +10 (9 course-lesson + 1 regression for community-post path explicitly asserting unchanged `playback_policies:['public']` + `max_duration_seconds:300`) | All green |
| mux-webhook | 8 pass | 15 pass | +7 (3 event-type handlers + missing-lesson_id + 2 isolation/regression + 1 video.view-as-unknown) | All green |
| **Total** | **19** | **36** | **+17** | **36/36 green** |

Run: `$HOME/.deno/bin/deno test --no-check --allow-env --allow-net supabase/functions/mux-create-upload/ supabase/functions/mux-webhook/`

## Commits

- `a4e8a411` — test(46-05): add failing tests for mux-create-upload course-lesson branch (RED)
- `7fd35a4d` — feat(46-05): extend mux-create-upload with course-lesson kind branch (GREEN)
- `b822e207` — test(46-05): add failing tests for mux-webhook course-lesson dispatch (RED)
- `5a77385d` — feat(46-05): extend mux-webhook to dispatch course-lesson events to course_lessons (GREEN)

## Critical Divergences from Community-Post Path (per RESEARCH)

| Aspect | community-post | course-lesson | Why |
|--------|----------------|---------------|-----|
| `playback_policies` | `['public']` | `['signed']` | Course content is tier-gated; requires Plan 46-04 JWT minting to play |
| `max_duration_seconds` | 300 (5 min) | 1800 (30 min) | D-05: course lessons are long-form |
| Auth gate | tier_effective ∈ {pro, lifetime, trial} | `profiles.is_staff = true` | T-46-01/T-46-07: only admins author course content |
| `generated_subtitles` | absent | `[{language_code:'en'}]` | D-06: caption auto-gen for accessibility |
| Passthrough envelope | `{user_id, post_id}` | `{kind, lesson_id, course_id}` | Discriminator + lesson-scoped routing |
| Webhook target table | `community_posts` | `course_lessons` | Dispatched by `passthrough.kind` |

## Threat Mitigations Verified

- **T-46-01 (Information Disclosure):** `is_staff` checked BEFORE Mux call. Test `course-lesson + is_staff=false → 403 ADMIN_REQUIRED` confirms no Mux upload is minted for non-admins. `lastMuxCallArgs == null` asserted.
- **T-46-07 (Elevation of Privilege):** Test `course-lesson + is_staff=false denies even when tier=pro` confirms tier eligibility does NOT bypass admin gate. Pro user with `is_staff=false` returns 403.

## Deviations from Plan

1. **[Rule 1 - Bug] Comment containing `video.view` substring broke the plan's negation grep gate.**
   - **Found during:** Task 2 GREEN verification
   - **Issue:** Initial implementation included a comment `// Critical: NO video.view handler — RESEARCH Pitfall 1 confirmed this event does not exist` which matched `! grep -qE "video\.view"` and failed the gate (per `feedback_negation_grep_defeated_by_comment_string`).
   - **Fix:** Rephrased comment without the literal string `video.view`: "Critical: only the three real Mux webhook events handled here. Anti-skip accounting is client-side accumulate per RESEARCH Pitfall 1; there is no server-side per-playback-segment webhook from Mux."
   - **Files modified:** `supabase/functions/mux-webhook/index.ts`
   - **Commit:** included in `5a77385d`

2. **[Plan adherence] Added a "course-lesson + is_staff=false denies even when tier=pro (T-46-07)" test not enumerated in the plan's `<action>` list.**
   - **Why:** T-46-07 explicitly mitigated via "profiles.is_staff lookup is separate from tier_effective"; a passing test was the cheapest way to lock that mitigation in regression. Counts as a plan-aligned addition, not a divergence in behavior.

3. **[Test infra] Refactored `updateCalls` tracker in mux-webhook tests to be table-tagged (`{table, payload, filterCol, filterVal}`).**
   - **Why:** Required to assert "course-lesson does NOT touch community_posts" (test isolation). Pre-existing tests still pass because they only check `updateCalls.length` and `call.payload`/`call.filterCol`/`call.filterVal` fields, which remain present.

## Reminder for Plan 46-11 (deploy + UAT close-out)

**DEPLOY `mux-create-upload` AND `mux-webhook` AS A PAIR.** If only one is deployed:
- `mux-webhook` ships first → admin uploads via Plan 46-04/46-05 UI will succeed, but the asset-ready webhook will execute the new course_lessons UPDATE branch against an OLD `mux-create-upload` that mints `kind: undefined` passthroughs → falls through to community-post path → silently UPDATEs `community_posts WHERE id=null` (no-op) → admin's `course_lessons.mux_status` stays `'pending'` forever.
- `mux-create-upload` ships first → admin can mint signed uploads with new passthrough envelope, but the OLD `mux-webhook` will read `passthrough.post_id` (undefined) → log "missing/malformed passthrough; skipping UPDATE" → again, `course_lessons.mux_status` stays `'pending'`.

Both must deploy in the same window. Per phase precedent, deploy `mux-create-upload` first, then `mux-webhook` within 60s.

Additionally:
- `MUX_TOKEN_ID`, `MUX_TOKEN_SECRET`, `MUX_WEBHOOK_SECRET` already set from Phase 44.
- `MUX_SIGNING_KEY_ID`, `MUX_SIGNING_KEY_PRIVATE` (Plan 46-04 secrets) required only by `mux-sign-playback` Fn, not by these two.
- E2E UAT probe: admin uploads test MP4 via Classroom UI → Mux processes within ~60s → `course_lessons.mux_status` transitions `pending → processing → ready` and `mux_playback_id` populated.

## Self-Check: PASSED

- File `supabase/functions/mux-create-upload/index.ts` — FOUND, contains `kind === 'course-lesson'`
- File `supabase/functions/mux-create-upload/index.test.ts` — FOUND, 21 tests
- File `supabase/functions/mux-webhook/index.ts` — FOUND, contains `kind === 'course-lesson'` and `from('course_lessons')`
- File `supabase/functions/mux-webhook/index.test.ts` — FOUND, 15 tests
- Commit `a4e8a411` — FOUND
- Commit `7fd35a4d` — FOUND
- Commit `b822e207` — FOUND
- Commit `5a77385d` — FOUND
- Deno test sweep: 36/36 green
- All plan grep gates (Task 1: 5 gates, Task 2: 5 gates): PASS
