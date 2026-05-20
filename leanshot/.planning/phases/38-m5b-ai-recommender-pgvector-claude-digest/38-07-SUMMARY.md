---
phase: 38-m5b-ai-recommender-pgvector-claude-digest
plan: 07
subsystem: winback-scorer
wave: 3
tags: [edge-function, cron, no-llm, save-handoff, hitl-audit, resend, recommend-07, recommend-10]
requires:
  - 38-01 (win_back_sends + ai_suggestion_review schema)
  - 38-05 (email-router patterns; lifecycle-send Resend helper)
  - Phase 25 (_shared/lifecycle-utils + sendResendEmail)
  - Phase 42 (user_notifications table — 20270704000003)
provides:
  - supabase/functions/winback-scorer (nightly cron handler)
  - public.at_risk_users_for_winback RPC (pure-SQL detection)
  - win_back_sends.payload jsonb column (Phase 40 SAVE handoff metadata)
  - ai_suggestion_review.status += 'auto_approved_hardcoded' (enum widening)
affects:
  - Phase 40 SAVE engine (downstream consumer of pending_handoff rows)
  - Phase 38-09 cron schedule (installs nightly invocation)
tech-stack:
  added: []
  patterns:
    - "Edge Fn lazy-admin singleton via _shared/lifecycle-utils.makeLazyAdmin"
    - "service_role bearer auth via _shared/lifecycle-utils.checkServiceRoleBearer"
    - "Resend consumer path via _shared/lifecycle-send.sendResendEmail (test-stub branch supported)"
    - "Status-enum widening in same plan as writer (memory feedback_planner_missed_status_enum_widening)"
    - "Vendor-gated handoff (memory feedback_scaffolding_for_deferred_mobile_pattern) — Phase 40 absence does NOT block this phase"
key-files:
  created:
    - supabase/functions/winback-scorer/index.ts
    - supabase/functions/winback-scorer/index.test.ts
    - supabase/migrations/20270705000014_phase38_winback_scorer_schema.sql
    - leanshot/tests/e2e/winback-scorer.spec.ts
  modified:
    - leanshot/vitest-e2e.config.ts (include[] extended)
decisions:
  - "D-07a: HITL audit row uses NEW status 'auto_approved_hardcoded' rather than reusing 'auto_approved_kb' — winback copy is hardcoded non-AI text, semantically distinct from KB-sourced content recs (separable for super-admin review filters)."
  - "D-07b: In-app banner maps to existing Phase 42 user_notifications schema (category='ai-insights' + payload.subtype='winback') instead of introducing a new category='winback'. Plan asked for category='winback' + expires_at column; existing CHECK constraint allows only {dose-reminders, ai-insights, clinic-alerts, billing, marketing} and table has no expires_at. Open jsonb payload carries subtype + expires_at_iso."
  - "D-07c: Batch-complete event emitted via Sentry breadcrumb + structured log rather than PostHog captureServer — Phase 27 D-13 mandates per-user distinct_id for PostHog events, and batch_complete is a system-level event."
  - "D-07d: Vendor-gated SAVE handoff — Phase 40 may not be planned yet; the handler writes pending_handoff + payload.handoff_url unconditionally. Phase 40's SAVE engine will consume on its own cron schedule."
metrics:
  duration: ~35min
  completed: 2026-05-20
---

# Phase 38 Plan 07: winback-scorer — Summary

Nightly cron Edge Function that detects users inactive for 14+ days, respects the 30-day
per-user cap, queues a Phase 40 SAVE handoff, sends a hardcoded non-PHI winback email via
Resend, and queues an in-app banner — all without any LLM calls (cost = $0/user/night).

## What shipped

### Edge Function `supabase/functions/winback-scorer/index.ts`

- **Auth gate** — `checkServiceRoleBearer` constant-time compare against
  `SUPABASE_SERVICE_ROLE_KEY`. 401 on missing/wrong bearer; 405 on non-POST.
- **Detection** — calls `at_risk_users_for_winback(p_inactive_days=14, p_cap_days=30,
  p_limit=500)` RPC (pure SQL, no LLM per D-09). The RPC computes
  `GREATEST(max(injections.created_at), max(weights.created_at), max(meals.created_at),
  max(mood.created_at))` per user and filters to those whose result is older than 14d
  AND who have no `win_back_sends` row newer than 30d.
- **Per-user dispatch sequence:**
  1. `INSERT ai_suggestion_review (type='win_back', status='auto_approved_hardcoded',
     payload={subject, body_snippet}, decided_at=now())` — audit trail BEFORE send.
  2. `INSERT win_back_sends (reason='inactive_14d', save_engine_status='pending_handoff',
     payload={handoff_url:'/save?reason=inactive_14d', reason, email_subject})`.
  3. `sendResendEmail` with hardcoded subject "We miss you on LeanShot" + 1-click
     unsubscribe footer (Phase 49 DIGEST-04). Non-PHI body (no symptom/dose data).
  4. `INSERT user_notifications (category='ai-insights', channel='in-app',
     payload={subtype:'winback', cta_url, expires_at_iso, reason})`.
  5. `captureServer({event:'win_back_trigger', userId, properties:{reason}})` — PostHog.
- **Batch complete** — Sentry breadcrumb + structured JSON log with
  `{candidate_count, inserted_count, error_count}`.

### Migration `20270705000014_phase38_winback_scorer_schema.sql`

1. `win_back_sends.payload jsonb NOT NULL DEFAULT '{}'::jsonb` — additive, carries the
   SAVE handoff payload (Phase 40 consumes).
2. `ai_suggestion_review.status` CHECK widened to include `'auto_approved_hardcoded'`
   (memory `feedback_planner_missed_status_enum_widening` — required in same plan as
   writer; otherwise INSERT throws 23514).
3. `at_risk_users_for_winback(p_inactive_days, p_cap_days, p_limit)` RPC — SECURITY DEFINER,
   locked `search_path = public, extensions`, `REVOKE` from public/anon/authenticated,
   `GRANT EXECUTE` to `service_role` only.

### Unit tests `supabase/functions/winback-scorer/index.test.ts`

11/11 passing (Deno test runner):
- T1: 14d-inactive user → win_back_sends INSERT
- T2: zero at-risk → no inserts
- T3: 30d cap held → not inserted
- T4: email subject + unsubscribe footer
- T5: in-app banner via user_notifications
- T6: SAVE handoff payload shape
- T7 / T7b: auth gate (401 on missing/wrong bearer)
- T8: batch cap=500 + batch_complete emission
- T9: zero fetches to ai-gateway.vercel.sh (no LLM)
- T10: HITL audit row with `auto_approved_hardcoded` status

### E2E test `leanshot/tests/e2e/winback-scorer.spec.ts`

6 live-staging tests (vitest, auto-skip when SUPABASE env missing). Seeds 10 users
(5 active / 3 inactive-eligible / 2 inactive-capped), runs the handler over HTTP,
asserts table state across two invocations + a 31d time-warp re-run. Cleanup deletes
seeded users + cascade rows in `afterAll`.

`leanshot/vitest-e2e.config.ts` `include[]` extended.

## Decisions Made

- **D-07a — HITL audit status:** New `auto_approved_hardcoded` enum value (not reusing
  `auto_approved_kb`). Winback copy is hardcoded non-AI text; KB-sourced recs are a
  separate review category. Lets super-admin filters distinguish them.
- **D-07b — Banner schema mapping:** Plan asked for `category='winback'` + `expires_at`
  column. Existing Phase 42 `user_notifications` table has a CHECK-constrained category
  enum (5 values, none of them `winback`) and no `expires_at` column. Pragmatic mapping:
  `category='ai-insights'` + `channel='in-app'` + `payload.subtype='winback'` +
  `payload.expires_at_iso` (open jsonb shape per memory `feedback_planner_iter1_anti_patterns`).
  Banner UI filters by `payload->>subtype='winback'`.
- **D-07c — Batch-complete event channel:** PostHog `captureServer` enforces per-user
  distinct_id (Phase 27 D-13). Batch_complete is a system-level event with no per-user
  identity — emitted via Sentry breadcrumb + structured log instead.
- **D-07d — SAVE handoff is vendor-gated:** Phase 40 may not be planned yet. The handler
  writes `pending_handoff` rows unconditionally. Phase 40's SAVE engine consumes on its
  own cron schedule when it ships (memory `feedback_scaffolding_for_deferred_mobile_pattern`).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical Functionality] `ai_suggestion_review.status` enum did not include `auto_approved_hardcoded`**
- **Found during:** Task 1 GREEN phase (planning the audit-row INSERT).
- **Issue:** The existing CHECK constraint from migration `20270705000008` only allows
  `{pending, approved, rejected, edited, auto_approved_kb}`. Test 10 of the plan
  requires `status='auto_approved_hardcoded'` — the INSERT would throw 23514.
- **Fix:** Migration `20270705000014` drops the autogenerated CHECK constraint and
  re-adds it under the explicit name `ai_suggestion_review_status_chk` with the
  widened enum.
- **Files modified:** `supabase/migrations/20270705000014_phase38_winback_scorer_schema.sql`
- **Memory reference:** `feedback_planner_missed_status_enum_widening` — status enum
  widenings MUST ship in the same plan as the writer.
- **Commit:** `a3f4a99`

**2. [Rule 2 - Missing Critical Functionality] `win_back_sends.payload` column did not exist**
- **Found during:** Task 1 GREEN phase (planning the SAVE handoff metadata write).
- **Issue:** The Phase 40 SAVE engine consumes the handoff via
  `payload->>handoff_url`. The original Phase 38-01 `win_back_sends` schema has
  no `payload` column.
- **Fix:** Same migration adds `payload jsonb NOT NULL DEFAULT '{}'::jsonb`
  (additive, backward-compatible). The 38-01 schema comment about 30d-cap-via-index
  remains accurate; this is a pure addition.
- **Commit:** `a3f4a99`

**3. [Rule 1 - Bug] In-app banner table doesn't match plan's assumed schema**
- **Found during:** Task 1 GREEN phase (planning the user_notifications INSERT).
- **Issue:** Plan asked for `user_notifications.type='winback'` + `expires_at` column.
  Actual table (Phase 42 migration `20270704000003_user_notifications.sql`) uses
  `category` (CHECK enum) + `channel` + `fired_at` + `payload jsonb` — no `type`
  column, no `expires_at` column. The category enum allows
  `{dose-reminders, ai-insights, clinic-alerts, billing, marketing}`, with no
  `winback` value.
- **Fix:** Map under `category='ai-insights'` + `channel='in-app'`; carry
  `subtype='winback'` + `expires_at_iso` inside `payload jsonb`. Banner UI filters by
  `payload->>subtype='winback'`. Documented inline + in this SUMMARY.
- **Files modified:** `supabase/functions/winback-scorer/index.ts` (lines marked
  `DEVIATION (Rule 1 - Bug)`)
- **Alternative considered:** Widen `user_notifications` category enum to include
  `winback` + add an `expires_at` column. Rejected because (a) `user_notifications`
  is the shared notifications table whose categories map to user preference flags
  in Phase 42's settings UI; adding `winback` would surface a new category toggle
  in user settings that isn't an actual user-controllable channel, and (b) the
  existing `fired_at` + expiration-via-`payload.expires_at_iso` pattern is
  back-compatible with the existing dismissal/cap-window queries.

**4. [Rule 1 - Bug] PostHog `captureServer` requires `userId`; batch-complete event has none**
- **Found during:** Task 1 GREEN phase (unit test T8 failure).
- **Issue:** `_shared/posthog-server.ts:captureServer` throws when `args.userId` is
  missing (Phase 27 D-13 invariant). Emitting `winback.batch_complete` via
  `captureServer` with no user ID failed silently in a try/catch.
- **Fix:** Emit `winback.batch_complete` via Sentry breadcrumb + structured JSON log
  instead. Captures the same `{candidate_count, inserted_count, error_count}`
  payload without violating the per-user-event invariant.
- **Commit:** `a3f4a99`

**5. [Rule 1 - Bug] Resend stub branch + ok-branch double-pushed sentEmails**
- **Found during:** Task 1 GREEN phase (unit test T4 failure — expected length 1, got 2).
- **Issue:** `sendResendEmail` returns `{ok:true, stubbed:true}` when
  `RESEND_API_KEY=test-stub`. The first conditional pushed on `sent.ok`; a follow-up
  `if (sent.stubbed)` block pushed again.
- **Fix:** Removed the redundant `if (sent.stubbed)` block — the `ok` branch covers
  both real-send and stubbed paths. Test passes.
- **Commit:** `a3f4a99`

### Worktree pwd-drift leak (operational note — not a code deviation)

The Task 1 RED commit (`c46d78c`) was made via `cd /Users/karstenhaldan/minisite &&
deno test && git add && git commit`. The `cd` shifted the working directory to the
main repo root, bypassing the worktree isolation. The commit landed on `main` instead
of the `worktree-agent-a0b8f9c7cb1cff550` branch (memory
`feedback_worktree_executor_pwd_drift_leaks_to_main`).

**Recovery:** Per the destructive-git rule (`git update-ref refs/heads/main`,
`git reset --hard` on protected refs prohibited), the leaked commit was cherry-picked
onto the worktree branch as `d1f5d71` (identical tree). The original `c46d78c` was
left on `main` for the orchestrator's merge step to reconcile — when the worktree
branch merges back, git sees the file as already present and resolves cleanly. No
data lost.

**Prevention applied for the rest of the plan:** Every subsequent `deno test` and
`git` invocation was run from `pwd=/Users/karstenhaldan/minisite/.claude/worktrees/agent-a0b8f9c7cb1cff550`
(verified by `pwd && ... && git rev-parse --abbrev-ref HEAD` showing the worktree
branch). The Deno binary was invoked via absolute path
`/Users/karstenhaldan/.deno/bin/deno` and the test target via worktree-relative path
`./supabase/functions/winback-scorer/index.test.ts`. No further leaks.

## Threat Mitigations Applied

| Threat | Mitigation Location |
|--------|--------------------|
| T-38-31 (duplicate winback within 30d) | RPC `NOT EXISTS` clause + handler-side trust in RPC LIMIT + (user_id, last_sent_at DESC) index from 38-01 (defense in depth) |
| T-38-32 (non-cron caller forces winback) | `checkServiceRoleBearer` constant-time compare at handler entry; 401 on missing/wrong bearer |
| T-38-33 (PHI leak in winback copy) | Hardcoded `WINBACK_EMAIL_SUBJECT` + body string in `renderWinbackEmail`; no user-data interpolation beyond a CTA URL with a non-PHI `?reason=inactive_14d` query string |

## Deferred Items

None for this plan. The Phase 40 SAVE engine integration (consumer side) is
vendor-gated and ships in its own phase per CONTEXT D-10.

## Known Stubs

None. The handler ships the production path end-to-end (Resend, banner, audit, RPC).
The `RESEND_API_KEY=test-stub` env value is the test-only branch that
`_shared/lifecycle-send.ts` already supports — not a stub introduced by this plan.

## Verification

- **Unit tests:** 11/11 pass via `deno test supabase/functions/winback-scorer/index.test.ts
  --allow-env --allow-net --no-check` (run from worktree root).
- **E2E syntax:** Spec parses + auto-skips 6 tests locally when SUPABASE env unset
  (same auto-skip pattern as sibling `tests/e2e/recommender.spec.ts`). CI/staging
  run requires `SUPABASE_URL` + `SUPABASE_ANON_KEY` + `SUPABASE_SERVICE_ROLE_KEY`.
- **Migration timestamp:** `20270705000014` is the next in sequence after
  `...000013`; no collision.
- **Deploy:** `supabase functions deploy winback-scorer --import-map supabase/functions/import_map.json`
  (memory `reference_supabase_functions_deploy_import_map_flag`). Cron schedule
  installed by Plan 38-09.

## Commits

| Commit | Phase | Description |
|--------|-------|-------------|
| `d1f5d71` | RED | test(38-07): RED — 10 winback-scorer behaviors |
| `a3f4a99` | GREEN | feat(38-07): Edge Fn + RPC + status-enum widening + payload column |
| `aaf77be` | E2E | test(38-07): e2e — 6 lifecycle scenarios with cleanup |

## Self-Check: PASSED

- FOUND: supabase/functions/winback-scorer/index.ts
- FOUND: supabase/functions/winback-scorer/index.test.ts
- FOUND: supabase/migrations/20270705000014_phase38_winback_scorer_schema.sql
- FOUND: leanshot/tests/e2e/winback-scorer.spec.ts
- FOUND: leanshot/vitest-e2e.config.ts (modified)
- FOUND commit d1f5d71
- FOUND commit a3f4a99
- FOUND commit aaf77be
