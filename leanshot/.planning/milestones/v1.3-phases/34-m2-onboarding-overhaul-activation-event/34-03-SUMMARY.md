---
phase: 34-m2-onboarding-overhaul-activation-event
plan: 03
subsystem: activation-event-pipeline
tags: [analytics, edge-function, posthog, activation, server-side-capture, secdef-rpc]
requires:
  - 38-06  # activation_events shell + plan_personalize_facts RPC
  - 34-01  # activation_events ALTER (goal_type, action_type, window_days, source) — Wave 1 sibling
provides:
  - EVENTS.activation_completed         # registry contract
  - Phase38Event union member
  - record-activation Edge Fn (POST)
  - public.record_activation_event RPC  # SECDEF fire-once gate
affects:
  - 34-04  # first-action detector calls record-activation
  - 34-05  # plan/conversion telemetry consumes activation_completed
  - 38     # plan_personalize_facts (activation_score / activated_at)
  - 39     # paywall consumes activation_completed
tech-stack:
  added:
    - posthog-node@5.10.4 (already wired in _shared/posthog-server.ts)
  patterns:
    - server-side-capture (Phase 24 D-11 + memory feedback_planner_iter1_anti_patterns try/finally)
    - secdef-advisory-lock (memory feedback_state_counter_table_needs_upsert_on_event)
    - same-plan union widening (memory feedback_planner_missed_status_enum_widening)
key-files:
  created:
    - supabase/functions/record-activation/index.ts
    - supabase/functions/record-activation/index.test.ts
    - supabase/functions/record-activation/deno.json
    - supabase/migrations/20270706000006_p34_record_activation_rpc.sql
  modified:
    - leanshot/src/lib/analytics/events.ts
    - leanshot/src/lib/analytics/__tests__/events-registry.test.ts
    - supabase/functions/_shared/posthog-server.ts
decisions:
  - "D-03 supersession: activation_first_log retained with aem_dropped:true; aem_priority:3 kept per ADDITIVE-ONLY ESLint rule. activation_completed takes the live AEM slot 3."
  - "D-04 fire-once: SECDEF RPC with pg_advisory_xact_lock + activated_at IS NULL guard. Re-invocations return 200 already_activated:true with NO PostHog capture."
  - "D-02 7-day window: server-computed days_since_signup from profiles.created_at. Body NEVER carries days_since_signup (T-34-03-01 mitigation)."
  - "Same-plan widening: Phase38Event union extended in same commit as record-activation/index.ts (memory feedback_planner_missed_status_enum_widening)."
  - "Capture/shutdown test seams added to Edge Fn (__internal.setCaptureSpyForTest, setShutdownSpyForTest) so concurrent + finally-block tests assert behavior without a real PostHog client."
metrics:
  duration_minutes: ~10
  completed_at: "2026-05-20"
  tasks_completed: 2
  files_created: 4
  files_modified: 3
  tests_added: 13  # 5 vitest + 8 Deno
---

# Phase 34 Plan 34-03: activation_completed Event Contract + record-activation Edge Function Summary

## One-Liner

Locked `activation_completed` event contract (zod payload + Phase38Event union widening) and shipped the server-side `record-activation` Edge Fn with fire-once + 7-day-window enforcement via a SECDEF advisory-lock RPC.

## What Shipped

### Task 1 — events.ts registry + Phase38Event union (commits `a7db869` RED, `618e3d3` GREEN)

- **`EVENTS.activation_completed`** added to `leanshot/src/lib/analytics/events.ts`:
  - `server_only: true` (D-05 — Edge Fn only emits; client MUST NOT)
  - `aem_priority: 3` (D-03 — supersedes activation_first_log at AEM slot 3)
  - `phi: false`, `owner: 'product'`, `version: 1`
  - zod payload: `{ goal_type: enum(8-goal-catalog), action_type: string.min(1), window_days: literal(7), days_since_signup: int.nonneg, source: literal('first_log') }`
- **`EVENTS.activation_first_log`** marked `aem_dropped: true` (D-03 supersession marker). `aem_priority: 3` preserved per ADDITIVE-ONLY ESLint rule.
- **`Phase38Event` union** in `supabase/functions/_shared/posthog-server.ts` widened to include `'activation_completed'`. Per memory `feedback_planner_missed_status_enum_widening`, this widening LANDED IN THE SAME PLAN as the Edge Fn that fires the event.
- **vitest assertions** appended to `leanshot/src/lib/analytics/__tests__/events-registry.test.ts` (new `describe` block for Phase 34 — does not clobber Phase 50 rag_* tests):
  - exists with `server_only/aem_priority/phi/owner/version`
  - payload parses valid sample
  - payload accepts all 8 goal_type enum values
  - payload rejects 4 invalid samples (window_days != 7, bad goal_type, negative days, missing source)
  - `activation_first_log.aem_dropped === true`
  - both events at `aem_priority: 3` coexist (dropped-marker pattern)

### Task 2 — record-activation Edge Fn + SECDEF RPC (commits `2dc31e9` RED, `cfcd2d9` GREEN)

- **`supabase/functions/record-activation/index.ts`** — POST handler:
  - Auth via `admin.auth.getUser(bearer)` (T-34-03-04 mitigation)
  - Inline 8-enum + non-empty-string body validation (cold-start lean; matches events.ts zod schema)
  - Server-computed `days_since_signup` from `profiles.created_at` (T-34-03-01 — never trust body)
  - 7-day-window guard returns `200 { skipped: true, reason: 'outside_window' }` without RPC call
  - Calls `public.record_activation_event` SECDEF RPC — atomic fire-once
  - When `did_fire === true`: `captureServer({ event: 'activation_completed', properties: { goal_type, action_type, window_days: 7, days_since_signup, source: 'first_log' } })`
  - When `did_fire === false`: returns `200 { already_activated: true }` with NO capture
  - `try/finally` with `shutdownPostHog()` in `finally` even on auth/validation/RPC errors (PITFALL 1 + T-34-03-06)
  - `__internal` test seams for admin / captureServer / shutdownPostHog
- **`supabase/migrations/20270706000006_p34_record_activation_rpc.sql`** — `public.record_activation_event(uuid, text, text, int) returns jsonb`:
  - `security definer` + `set search_path = pg_catalog, public, extensions` (Pitfall 2)
  - `pg_advisory_xact_lock(hashtext('record_activation:' || p_user_id::text))` (T-34-03-02 — serializes concurrent invocations)
  - SELECT-then-UPSERT-with-WHERE-activated-at-IS-NULL (defense-in-depth race-safety + UPSERT-not-bare-UPDATE per memory `feedback_state_counter_table_needs_upsert_on_event`)
  - Returns `jsonb { did_fire, reason?, days_since_signup? }`
  - EXECUTE revoked from anon/authenticated/public; granted only to `service_role`
- **`supabase/functions/record-activation/deno.json`** — esm.sh imports for `@supabase/supabase-js@2.105.4` and `zod@3.23.8`.
- **`supabase/functions/record-activation/index.test.ts`** — 8 Deno tests covering all 8 plan behaviors (T1 happy / T2 already-activated / T3 outside-window / T4 invalid-goal / T5 no-auth / T6 OPTIONS / T7 concurrency / T8 finally-block).

## Verification

- ✅ **vitest** (`npm run test:unit -- --run src/lib/analytics/__tests__/events-registry.test.ts`) — 17/17 pass (12 pre-existing rag_* + 5 new activation_completed assertions).
- ✅ **Deno test** (`deno test --allow-env --allow-net --no-check supabase/functions/record-activation/index.test.ts`) — 8/8 pass.
- ✅ **Phase38Event grep gate** — `'activation_completed'` confirmed in posthog-server.ts union.
- ✅ **RPC grep gates** — `pg_advisory_xact_lock` + `security definer` both present in migration.
- ✅ **ESLint** — no lint errors on any of the three modified files (events.ts, events-registry.test.ts, posthog-server.ts). Pre-existing lint errors exist in unrelated Phase 50 rag test files; out-of-scope per executor SCOPE BOUNDARY rule.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — Blocker] Worktree path drift**

- **Found during:** Task 1 first commit attempt
- **Issue:** Initial `Edit` calls used absolute paths under `/Users/karstenhaldan/minisite/leanshot/...` (main repo) instead of the worktree path `/Users/karstenhaldan/minisite/.claude/worktrees/agent-a531d0b500d991363/leanshot/...`. The main-repo edit succeeded but did not show in the worktree's `git status`, so the first commit attempt reported "nothing to commit". Per memory `feedback_worktree_executor_pwd_drift_leaks_to_main`, this is a known executor footgun.
- **Fix:** Reverted main-repo modifications (`git -C /Users/karstenhaldan/minisite checkout -- ...`), then re-applied the edits under the worktree's absolute path.
- **Files affected:** `leanshot/src/lib/analytics/__tests__/events-registry.test.ts` (corrected to worktree path before commit).
- **Commit:** N/A (caught before commit landed).

**2. [Rule 3 — Blocker] Worktree missing node_modules**

- **Found during:** Task 1 GREEN verification
- **Issue:** `git worktree add` does not copy `node_modules/`. `npm run test:unit` failed with `vitest: command not found`. Cannot `npm install` per memory `feedback_worktree_executor_npm_install_leak` — npm install in worktree can leak into main checkout.
- **Fix:** Symlinked `leanshot/node_modules` → `/Users/karstenhaldan/minisite/leanshot/node_modules`. Vite/vitest resolve all package paths via the symlink without writing anywhere. Symlink shows as untracked but is not committed.
- **Files affected:** worktree-local symlink only; not staged.

### Decisions Made During Execution

**3. Test seam strategy for captureServer / shutdownPostHog**

- **Plan said:** Mock the admin client + spy.
- **What I did:** Added explicit `setCaptureSpyForTest` and `setShutdownSpyForTest` seams to the Edge Fn's `__internal` export so the Deno tests can count capture invocations and assert `finally`-block behavior WITHOUT instantiating a real PostHog client. The seams default-fall-through to the real `captureServer` / `shutdownPostHog` imports when no spy is set.
- **Rationale:** The PostHog node SDK creates a network-bound batch flusher on construction; mocking it via the admin layer is awkward and the events_mirror dual-write would silently no-op in tests anyway. The seam pattern matches the plan's hint about `__internal` exports and keeps test surface explicit.

**4. zod-free body validation in Edge Fn**

- **Plan suggested:** `const BodySchema = z.object({ ... })` via esm.sh.
- **What I did:** Inline 8-enum check + non-empty string check.
- **Rationale:** Cold-start lean. The Edge Fn is on the activation hot path and zod via esm.sh adds ~80 KB to the cold isolate. The validation surface is small (2 fields) and the canonical zod schema lives in `events.ts:activation_completed.payload` (the source of truth, exercised by vitest). The Edge Fn's inline check duplicates the constraint surface, which is verified manually:
  - `VALID_GOAL_TYPES` exactly matches the zod enum members in events.ts.
  - `action_type` non-empty string mirrors `z.string().min(1)`.
  - `window_days: 7` and `source: 'first_log'` are server-constants (never from body).
  - `days_since_signup` is server-computed (never from body).
- **Risk:** if events.ts goal_type enum changes without updating `VALID_GOAL_TYPES` in index.ts, drift could occur. Plan 34-10 (e2e) will catch this via integration test; consider extracting a shared TS const in a follow-up.
- **Plan 34-10 follow-up flag:** see "Open Considerations" below.

## Open Considerations / Plan 34-10 Follow-Ups

1. **goal_type enum drift between events.ts and record-activation/index.ts** — current implementation duplicates the 8-goal enum in both files for cold-start performance. Plan 34-10 e2e test should assert parity, or a shared `goal-types.ts` const should be extracted.
2. **ESLint co-presence of `aem_priority` + `aem_dropped`** — plan 34-03 flagged this as a possible blocker. In practice the ESLint rule (`additive-only-events.cjs`) only blocks payload-field removal/type changes and `phi:true + aem_priority` co-presence. Adding `aem_dropped:true` while preserving `aem_priority:3` on a `phi:false` event lints clean. No follow-up needed.

## Self-Check: PASSED

- ✅ `leanshot/src/lib/analytics/events.ts` modified (commit `618e3d3`)
- ✅ `leanshot/src/lib/analytics/__tests__/events-registry.test.ts` modified (commits `a7db869` + still present after Task 2)
- ✅ `supabase/functions/_shared/posthog-server.ts` modified (commit `618e3d3`)
- ✅ `supabase/functions/record-activation/index.ts` created (commits `2dc31e9` stub, `cfcd2d9` real impl)
- ✅ `supabase/functions/record-activation/index.test.ts` created (commit `2dc31e9`)
- ✅ `supabase/functions/record-activation/deno.json` created (commit `2dc31e9`)
- ✅ `supabase/migrations/20270706000006_p34_record_activation_rpc.sql` created (commit `cfcd2d9`)
- ✅ All four commits land on `worktree-agent-a531d0b500d991363` per-agent branch
- ✅ vitest 17/17 pass; Deno 8/8 pass; grep gates pass
