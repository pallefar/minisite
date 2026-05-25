---
phase: 47-m4-events-calendar-zoom-reminders-recording
plan: 09
subsystem: events / mux
tags: [mux, edge-function, webhook, dispatch, kind-discriminator, event-recording, third-arm]
requires:
  - 47-01-PLAN (events.attach_to_module_id, recording_mux_asset_id, recording_playback_id columns)
  - 47-05-PLAN (Wave 0 RED test scaffold at supabase/functions/mux-webhook/event-recording.test.ts)
  - 46-* (Phase 46 mux-create-upload + mux-webhook course-lesson branches; course_lessons schema)
provides:
  - kind:'event-recording' on mux-create-upload
  - passthrough.kind === 'event-recording' dispatch on mux-webhook
  - Conditional INSERT course_lessons | UPDATE events.recording_* branching on events.attach_to_module_id
affects:
  - 47-11-PLAN (events-admin recording uploader UI — call site for mux-create-upload kind:'event-recording')
  - 47-12-PLAN (close-out — MUST deploy both mux-create-upload + mux-webhook as a PAIR; passthrough envelope shape changed)
tech-stack:
  added: []
  patterns:
    - kind-discriminator-third-arm
    - admin-gated-direct-upload (mirrors Phase 46 course-lesson)
    - defense-in-depth-event-existence-check
    - duration-rounding-on-Mux-callback
    - conditional-INSERT-vs-UPDATE-by-FK-presence
key-files:
  created: []
  modified:
    - supabase/functions/mux-create-upload/index.ts (+60 lines: kind:'event-recording' branch with is_staff gate + event_id pre-flight)
    - supabase/functions/mux-create-upload/index.test.ts (+145 lines: 5 new Deno.test cases + makeMockAdmin events stub)
    - supabase/functions/mux-webhook/index.ts (+84 lines: third dispatch arm, MuxEventData.duration field, passthrough.event_id field)
    - supabase/functions/mux-webhook/event-recording.test.ts (rewritten: 4 TODO stubs → 10 real Deno.test assertions)
decisions:
  - max_duration_seconds=7200 (2h cap) on event-recording branch — event recordings can be long-form (multi-hour AMA / coaching sessions); plan did not pin a value, chose 2h as upper bound consistent with practical event length
  - playback_policies=['public'] on event-recording branch — events are open to RSVP'd attendees; signed-URL entitlement (Phase 46 course-lesson pattern) is gated by RSVP/membership at view-time, not at Mux level. If signed playback becomes required, switch is a one-line change.
  - INSERT course_lessons with is_required=false AND is_free_preview=false — D-15 mandates is_required=false (don't break completion math); is_free_preview=false matches default schema posture (admin can flip later if recording should be preview-eligible)
  - 404 event_not_found short-circuit BEFORE Mux call — saves Mux quota + provides cleaner DX error vs deferring discovery to webhook time
metrics:
  duration: ~10 min
  completed: 2026-05-24T12:16Z
  tasks: 2/2
  files-modified: 4
  commits: 4
---

# Phase 47 Plan 09: mux-create-upload + mux-webhook event-recording branch Summary

EXTEND `mux-create-upload` + `mux-webhook` with the THIRD `kind` discriminator value `'event-recording'`, completing the multi-kind passthrough envelope established in Phase 44 (community-post) and Phase 46 (course-lesson).

## Outcome

Both Edge Functions now dispatch on `passthrough.kind`:

| kind | mux-create-upload | mux-webhook |
|------|-------------------|-------------|
| `community-post` (default) | tier-gated (Pro/Lifetime/Trial); public playback; 300s cap | UPDATE community_posts.video_status |
| `course-lesson` (Phase 46) | is_staff gated; signed playback; 1800s cap; en subtitles | UPDATE course_lessons.mux_* |
| `event-recording` (**THIS PLAN**) | is_staff gated; public playback; 7200s cap | INSERT course_lessons (if events.attach_to_module_id) OR UPDATE events.recording_* |

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1a | RED: mux-create-upload event-recording tests | `61eed137` | supabase/functions/mux-create-upload/index.test.ts |
| 1b | GREEN: mux-create-upload kind:'event-recording' branch | `e99556ac` | supabase/functions/mux-create-upload/index.ts |
| 2a | RED: mux-webhook event-recording assertions (replace 47-05 scaffold) | `b2175207` | supabase/functions/mux-webhook/event-recording.test.ts |
| 2b | GREEN: mux-webhook passthrough.kind=event-recording dispatch | `6f5c00f8` | supabase/functions/mux-webhook/index.ts |

## Verification

### Plan gates (all pass)

- `grep -c "kind === 'event-recording'\\|kind: 'event-recording'" supabase/functions/mux-create-upload/index.ts` → **2** (≥1 required)
- `grep -c 'event_id' supabase/functions/mux-create-upload/index.ts` → **6** (≥1 required)
- `grep -c "passthrough\\.kind === 'event-recording'\\|passthrough?.kind === 'event-recording'" supabase/functions/mux-webhook/index.ts` → **1** (≥1 required)
- `grep -c 'attach_to_module_id' supabase/functions/mux-webhook/index.ts` → **6** (≥1 required)
- `grep -c 'course_lessons' supabase/functions/mux-webhook/index.ts` → **8** (≥1 required)
- `grep -c 'recording_mux_asset_id' supabase/functions/mux-webhook/index.ts` → **2** (≥1 required)
- `grep -c 'is_required: *false' supabase/functions/mux-webhook/index.ts` → **1** (≥1 required)
- `grep -c 'video\\.view' supabase/functions/mux-webhook/index.ts` → **0** (exactly 0 required — anti-skip is client-side per `reference_mux_video_view_event_for_antiskip`)

### Test sweep (51/51 green)

```
$HOME/.deno/bin/deno test --no-check --allow-all \
  supabase/functions/mux-webhook/ \
  supabase/functions/mux-create-upload/
→ ok | 51 passed | 0 failed
```

Breakdown:
- mux-create-upload/index.test.ts: 26 tests (21 prior + 5 new event-recording)
- mux-webhook/index.test.ts: 15 tests (Phase 44 + Phase 46 — unchanged)
- mux-webhook/event-recording.test.ts: 10 tests (this plan — replaced 47-05 scaffold)

### Existing branches preserved (manual diff review)

- mux-create-upload: community-post tier-gate branch (lines 233-273) UNCHANGED; course-lesson branch (lines 177-214) UNCHANGED.
- mux-webhook: community-posts UPDATE branch (post-event-recording-branch, current lines 295-318) UNCHANGED; Phase 46 course-lesson UPDATE branch (lines 172-208) UNCHANGED.

## Deviations from Plan

### Auto-fixed / planner-empty values

**1. [Rule 2 — missing critical] Chose max_duration_seconds=7200 (2h cap)**
- **Found during:** Task 1 GREEN implementation
- **Issue:** Plan did not pin a `max_duration_seconds` for the event-recording branch (community-post=300, course-lesson=1800 were both stated, but the third value was left implicit)
- **Fix:** Picked 7200 (2 hours) as a defensible upper bound for long-form event recordings (AMA / coaching marathons can run 90+ min). Caller-facing impact: Mux rejects uploads exceeding the cap at upload-creation time.
- **Files modified:** supabase/functions/mux-create-upload/index.ts
- **Commit:** `e99556ac`
- **Reversibility:** one-line constant change if 7200 proves wrong.

**2. [Rule 2 — missing critical] Chose playback_policies=['public']**
- **Found during:** Task 1 GREEN implementation
- **Issue:** Plan did not specify signed vs public; course-lesson uses 'signed' but event semantics are different (open to RSVP'd attendees, not paid course content).
- **Fix:** Chose 'public' — event recording entitlement is RSVP-gated at app layer (Phase 47-08 event-join-url Edge Fn handles the gate). If a future requirement demands Mux-level JWT signing, swap to `['signed']` + add `event-sign-playback` Fn mirroring `mux-sign-playback`.
- **Files modified:** supabase/functions/mux-create-upload/index.ts
- **Commit:** `e99556ac`

**3. [Rule 2 — missing critical] Added 404 event_not_found short-circuit**
- **Found during:** Task 1 GREEN implementation
- **Issue:** Plan mentioned "Pre-flight check: event row exists" but didn't specify the HTTP code on miss.
- **Fix:** 404 + `{ error: 'event_not_found' }` — saves Mux API call + provides clean error code for the events-admin uploader UI (47-11) to surface to the operator.
- **Files modified:** supabase/functions/mux-create-upload/index.ts
- **Commit:** `e99556ac`

**4. [Rule 3 — blocking] Extended MuxEventData.duration field**
- **Found during:** Task 2 GREEN implementation
- **Issue:** The existing `MuxEventData` interface (Phase 44) did not include `duration`. RESEARCH Example 6 reads `event.data.duration` to populate `course_lessons.duration_seconds`. Without the type extension, the GREEN impl would have to cast or fail tsc.
- **Fix:** Added `duration?: number` (optional, Math.round on read for fractional seconds).
- **Files modified:** supabase/functions/mux-webhook/index.ts
- **Commit:** `6f5c00f8`

**5. [Rule 3 — blocking] Extended passthrough type with optional event_id**
- **Found during:** Task 2 GREEN implementation
- **Issue:** Existing passthrough type Union (Phase 46) lacked `event_id`. Required for `passthrough.event_id` narrowed-type access.
- **Fix:** Added `event_id?: string` to the inline union type.
- **Files modified:** supabase/functions/mux-webhook/index.ts
- **Commit:** `6f5c00f8`

### Cwd-drift incident (caught + corrected)

During the first RED test run for mux-create-upload, an initial `cd /Users/karstenhaldan/minisite` command landed in the **main repo checkout** (not the worktree) — Deno picked up an older test file from before the test additions were written and reported 21 tests instead of 26 (silently filtering out the new ones). Per memory `reference_gsd_sdk_state_complete_phase_cwd_sensitivity` + the executor's cwd-drift assertion, all subsequent Deno runs use `$(git rev-parse --show-toplevel)` or implicit worktree-relative paths. **No incorrect commits resulted** — only delayed RED confirmation.

## Pair-Deploy Hazard (for 47-12 close-out)

**CRITICAL** — passthrough envelope shape **expanded** on both Fns:
- `mux-create-upload` now MINTS `{ kind:'event-recording', event_id, user_id }` envelopes.
- `mux-webhook` now CONSUMES `passthrough.kind === 'event-recording'` + `passthrough.event_id`.

**Deploy order constraint:** Both Edge Functions MUST be deployed as a PAIR.

- If `mux-create-upload` deploys FIRST: any admin upload that hits the new branch will mint event-recording passthrough envelopes, but the prior `mux-webhook` will dispatch them through the community-post path (which logs "missing/malformed passthrough; skipping UPDATE" and 200's). Asset bits land in Mux but never get attached → silent failure.
- If `mux-webhook` deploys FIRST: harmless (no callers mint the new envelope yet); webhook branch is dormant.

**Recommended close-out (47-12) sequence:**
1. `supabase functions deploy mux-webhook` (idempotent dormancy).
2. `supabase functions deploy mux-create-upload` (activates uploader UI in 47-11).
3. Spot-check via `supabase functions logs mux-webhook --tail` while 47-11 operator uploads first admin recording.

Memory anchor for the global pattern: `feedback_mux_fn_pair_deploy_passthrough_drift` (referenced in plan context; reinforced by this plan).

## Threat Flags

None — branch operates entirely within the trust boundaries already mitigated by Phase 44 wiring:
- T-44-03 (spoofing): `@mux/mux-node` verifySignature gate runs BEFORE branch dispatch.
- T-47-36 (tampering): webhook reads admin-pre-configured `events.attach_to_module_id`; no privilege escalation from webhook caller.
- T-47-37 (info disclosure): event_id is a UUID; not PII.
- T-47-38 (retry loop): 200 OK on missing event_id / event_not_found; Mux won't retry on 2xx.

No new network endpoints, no new auth paths, no schema changes (events + course_lessons schemas owned by 47-01 + Phase 46).

## Memory References Applied

- `reference_mux_fn_pair_deploy_passthrough_drift` — pair-deploy hazard documented above for 47-12.
- `reference_mux_video_view_event_for_antiskip` — confirmed NO video.view handler (anti-skip is client-side per Phase 46 architecture).
- `reference_deno_test_top_level_serve_trap` — both index.ts files already have `import.meta.main` + `denoGlobal?.serve` guards from prior phases; tests import handler directly.
- `reference_supabase_service_role_key_format_divergence` — webhook uses service-role admin client unchanged from Phase 44.
- `reference_supabase_functions_deploy_import_map_flag` — per-Fn deno.json already exists for both Fns; no new deno.json needed.
- `feedback_negation_grep_defeated_by_comment_string` — source comments do NOT mention `video.view` rejected name; only the regression test references it as a test fixture (intentional, matches existing index.test.ts:486 precedent).
- `feedback_batched_edits_verify_file_count` — read each file before editing; post-commit `git diff --stat` confirmed both source files modified.
- `feedback_executor_auto_adds_missing_migration` — verified at execute-time: `course_lessons` table + `events.attach_to_module_id` FK already in main from Phase 46 + 47-01 merges (no auto-add needed).

## Self-Check: PASSED

- [x] supabase/functions/mux-create-upload/index.ts — FOUND, modified, 26/26 tests green
- [x] supabase/functions/mux-create-upload/index.test.ts — FOUND, 5 new tests added
- [x] supabase/functions/mux-webhook/index.ts — FOUND, modified, dispatch branch added
- [x] supabase/functions/mux-webhook/event-recording.test.ts — FOUND, 10/10 tests green (replaced RED scaffold)
- [x] Commit 61eed137 — FOUND in git log
- [x] Commit e99556ac — FOUND in git log
- [x] Commit b2175207 — FOUND in git log
- [x] Commit 6f5c00f8 — FOUND in git log
- [x] All 8 plan grep gates pass
- [x] 51/51 Deno tests pass across both Fns
- [x] No `video.view` references in source (only in test fixture — intentional regression)
- [x] Existing community-post + course-lesson branches preserved (manual diff review)
