---
phase: 35
slug: m3-gamification-engine
status: planned
nyquist_compliant: true
wave_0_complete: false
created: 2026-05-21
updated: 2026-05-21
---

# Phase 35 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Task ID / Plan / Wave / Command columns filled by plan-phase 2026-05-21.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 1.x (SPA unit + RLS); Playwright 1.x (e2e); Deno test 1.x (Edge Fns); pgTAP (Postgres pure functions / cron / matview) |
| **Config file** | `leanshot/vitest.config.ts`, `leanshot/playwright.config.ts`, `supabase/functions/deno.json`, `supabase/tests/*.sql` |
| **Quick run command** | `cd leanshot && npx vitest run --changed` |
| **Full suite command** | `cd leanshot && npx vitest run && npx playwright test && cd ../supabase && $HOME/.deno/bin/deno test --no-check functions/ && supabase test db --linked` |
| **Estimated runtime** | ~120 seconds (quick), ~600 seconds (full) |

---

## Sampling Rate

- **After every task commit:** Run `cd leanshot && npx vitest run --changed`
- **After every plan wave:** Run full suite (above)
- **Before `/gsd:verify-work`:** Full suite must be green AND bundle-budget script passes (`scripts/assert-bundle-budget.sh`)
- **Max feedback latency:** 120 seconds (quick), 600 seconds (full)

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 35-01-04 | 35-01 | 1 | GAME-01 | T-35-01-04 | Append a row to `xp_ledger` on qualifying-action insert; `compute_level(xp_total)` is IMMUTABLE; ledger replay against random sequences yields identical level | unit (pgTAP) | `supabase test db --linked --file supabase/tests/35_xp_ledger_replay.sql` | ❌ W0 | ⬜ pending |
| 35-01-04 | 35-01 | 1 | GAME-01 | T-35-01-01 | `xp_ledger` INSERT-only (UPDATE/DELETE blocked at RLS + defense-in-depth raise-exception triggers); service-role insert + user-readable select | unit (pgTAP) | `supabase test db --linked --file supabase/tests/35_xp_ledger_rls.sql` | ❌ W0 | ⬜ pending |
| 35-01-05 | 35-01 | 1 | GAME-01 | T-35-01-03 | Cross-tenant impersonation proof: user B sees ZERO of user A xp_ledger rows; direct INSERT fails 42501 | unit (Vitest RLS) | `cd leanshot && npx vitest run e2e/rls-xp-ledger.test.ts` | ❌ W0 | ⬜ pending |
| 35-02-04 | 35-02 | 1 | GAME-02 | T-35-02-04 | Hourly UTC cron computes streak survival per `profiles.timezone`; idempotent across cron-retry; DST boundary safe via `last_eval_date` keying | unit (pgTAP) | `supabase test db --linked --file supabase/tests/35_streak_cron_dst.sql` | ❌ W0 | ⬜ pending |
| 35-02-04 | 35-02 | 1 | GAME-02 / GAME-03 | T-35-02-05 | Freeze token auto-applied the morning after a missed action; max stockpile 3 enforced via clamp; monthly grant cron blocked from double-grant by UNIQUE INDEX | unit (pgTAP) | `supabase test db --linked --file supabase/tests/35_freeze_token_autoapply.sql` | ❌ W0 | ⬜ pending |
| 35-02-03 | 35-02 | 1 | GAME-03 | T-35-02-02 / T-35-02-03 | Admin grant Edge Fn: user-JWT + server-side admin_role check; logs `granted_by_admin_user_id` in `freeze_tokens_ledger`; rejects non-admins 403; UI copy "ethical mechanic — not for sale" (Plan 35-05 UI) | unit (Deno) | `$HOME/.deno/bin/deno test --no-check supabase/functions/admin-grant-freeze-token/index.test.ts` | ❌ W0 | ⬜ pending |
| 35-02-05 | 35-02 | 1 | GAME-03 | T-35-02-01 | Cross-tenant proof: user B cannot read user A freeze_tokens_ledger; direct INSERT 42501; append-only triggers block UPDATE/DELETE | unit (Vitest RLS) | `cd leanshot && npx vitest run e2e/rls-freeze-tokens-ledger.test.ts` | ❌ W0 | ⬜ pending |
| 35-03-01 | 35-03 | 2 | GAME-01 / GAME-09 | T-35-03-01 / T-35-03-02 | AFTER INSERT triggers on injections/weight_logs/symptom_logs/workouts append xp_ledger + detect level-up + insert badge_unlocks; defense-in-depth `exception when others` prevents source-insert block | unit (pgTAP) | `supabase test db --linked --file supabase/tests/35_xp_ledger_replay.sql` (covers via grant_xp_for_action call path) | ❌ W0 | ⬜ pending |
| 35-03-02 | 35-03 | 2 | GAME-09 | T-35-03-03 | Combo / cross-streak badge unlocks when challenge complete AND streak >= 7; recursion guard via transaction-local set_config; combo grants +50 XP | unit (pgTAP) | `supabase test db --linked --file supabase/tests/35_combo_badge.sql` | ❌ W0 | ⬜ pending |
| 35-03-03 | 35-03 | 2 | GAME-01..09 | T-35-03-04 / T-35-03-05 / T-35-03-08 | xp-event Edge Fn: bearer auth + 6-event enum + 8-key property allowlist (PHI guard); captureServer + shutdownPostHog finally | unit (Deno) | `$HOME/.deno/bin/deno test --no-check supabase/functions/xp-event/index.test.ts` | ❌ W0 | ⬜ pending |
| 35-03-04 | 35-03 | 2 | GAME-01 / GAME-06 | T-35-06-05 | Client compute_level mirrors SQL fn at D-02 locked spot values (0, 100, 400, 2500, 10000, 40000, 1000000); xpToNextLevel correct | unit (Vitest) | `cd leanshot && npx vitest run src/lib/gamification/__tests__/xp.test.ts` | ❌ W0 | ⬜ pending |
| 35-04-02 | 35-04 | 1 | GAME-04 | T-35-04-07 | Cohort matview JOINs cohort_membership × leaderboard_optin × cohort_definitions (enabled=true); rolling 7d XP rank; UNIQUE INDEX makes REFRESH CONCURRENTLY safe | unit (pgTAP) | `supabase test db --linked --file supabase/tests/35_leaderboard_matview.sql` | ❌ W0 | ⬜ pending |
| 35-04-02 | 35-04 | 1 | GAME-04 | T-35-04-07 | `REFRESH MATERIALIZED VIEW CONCURRENTLY public.leaderboard_matview` succeeds (UNIQUE INDEX present) | unit (pgTAP) | `supabase test db --linked --file supabase/tests/35_matview_concurrent.sql` | ❌ W0 | ⬜ pending |
| 35-04-04 | 35-04 | 1 | GAME-04 | T-35-04-02 | Handle regex `^[a-zA-Z0-9_-]{6,24}$` rejects real names; client + server (CHECK constraint + SECDEF RPC mirror) | unit (Vitest) | `cd leanshot && npx vitest run src/lib/gamification/__tests__/handle-validate.test.ts` | ❌ W0 | ⬜ pending |
| 35-04-05 | 35-04 | 1 | GAME-04 | T-35-04-01 / T-35-04-05 | Cross-cohort impersonation proof: user A cannot read cohort B leaderboard; opt-in to admin-disabled cohort fails | unit (Vitest RLS) | `cd leanshot && npx vitest run test/rls/35-leaderboard-cross-tenant.test.ts` | ❌ W0 | ⬜ pending |
| 35-04-05 | 35-04 | 1 | GAME-04 | T-35-04-04 | Opt-in lifecycle: handle uniqueness per cohort; opt-out drops user from matview within 15 min; same handle re-usable in different cohort | unit (Vitest RLS) | `cd leanshot && npx vitest run e2e/rls-leaderboard-optin.test.ts` | ❌ W0 | ⬜ pending |
| 35-05-05 | 35-05 | 1 | GAME-05 | T-35-05-04 | `weekly_challenges.status` CHECK lists ALL 4 enum values at creation (draft/active/completed/archived); rejects out-of-set; max 2 variants per challenge (UNIQUE block) | unit (pgTAP) | `supabase test db --linked --file supabase/tests/35_challenge_status_check.sql` | ❌ W0 | ⬜ pending |
| 35-05-04 | 35-05 | 1 | GAME-05 / GAME-08 | T-35-05-01 | Admin form creates weekly_challenges row with reward shape (D-19); A/B variants binds PostHog flag id; D-18 max 2 active per user enforced in evaluate_challenge_progress_for_user | unit (Vitest + RTL) | `cd leanshot && npx vitest run src/components/admin/gamification/__tests__/ChallengeForm.test.tsx` | ❌ W0 | ⬜ pending |
| 35-05-03/04 | 35-05 | 1 | GAME-05 | T-35-05-01 | Admin SECDEF RPCs gated by `(select admin_role from profiles where id = auth.uid()) in (...)` server-side mirror of surfaceCheck — non-admin gets 403 | e2e (Playwright; deploy-gated) | `cd leanshot && npx playwright test e2e/35-admin-rbac.spec.ts` (deferred: written in Wave 0, gated by LEANSHOT_TEST_BASE_URL in Plan 35-10) | ❌ W0 | ⬜ pending |
| 35-06-01 | 35-06 | 2 | GAME-01 / GAME-06 | T-35-06-01 / T-35-06-02 | ConfettiBurst defense-in-depth: useReducedMotion gate + canvas-confetti disableForReducedMotion: true; cooldown 1 burst/60s via localStorage | unit (Vitest + RTL) | `cd leanshot && npx vitest run src/components/dashboard/burst/__tests__/LevelUpBurst.test.tsx` | ❌ W0 | ⬜ pending |
| 35-06-03 | 35-06 | 2 | GAME-06 | — | LevelProgressCard renders ProgressRing + XP-to-next-level + prestige; StreakCard renders current/longest/freeze | unit (Vitest + RTL) | `cd leanshot && npx vitest run src/components/dashboard/cards/__tests__/` | ❌ W0 | ⬜ pending |
| 35-06-bundle | 35-06 / 35-10 | 4 | GAME-01..09 | T-35-06-03 / T-35-10-06 | `gamification-burst` chunk ≤ 8 kB gz enforced at build time | unit (shell) | `cd leanshot && bash scripts/assert-bundle-budget.sh` | ✅ exists | ⬜ pending |
| 35-07-01 | 35-07 | 3 | GAME-07 | T-35-07-01 / T-35-07-02 | HMAC token sign/verify uses Web Crypto + constant-time compare; 30d TTL; build URL appends cache-bust ?v= | unit (Vitest) | `cd leanshot && npx vitest run src/lib/gamification/__tests__/share-token.test.ts` | ❌ W0 | ⬜ pending |
| 35-07-02 | 35-07 | 3 | GAME-07 | T-35-07-04 | Vercel rewrite carve-out: /api/og/* and /share/level/* land ABOVE the SPA /share/(.*) → /index.html fallback | unit (Vitest) | `cd leanshot && npx vitest run test/vercel-rewrite.spec.ts` | ❌ W0 | ⬜ pending |
| 35-07-04 | 35-07 | 3 | GAME-07 | T-35-07-04 | OG image route returns 200 + image/png 1200x630; SSR share page emits og:image meta + redirects after 2s; invalid token → 410 | e2e (Playwright; deploy-gated) | `cd leanshot && LEANSHOT_TEST_BASE_URL=<preview> npx playwright test e2e/35-og-share-card.spec.ts` | ❌ W0 | ⬜ pending |
| 35-07-04 | 35-07 | 3 | GAME-07 | — | Viral attribution `?ref=share` propagates to `_aff` cookie per Phase 19 dual-cookie pattern | e2e (Playwright; deploy-gated) | `npx playwright test e2e/35-share-attribution.spec.ts` | ❌ W0 | ⬜ pending |
| 35-07-04 | 35-07 | 3 | GAME-07 | T-35-07-07 | OG image cache busts on level change via ?v= versioning; different level URLs render byte-different content | e2e (Playwright; deploy-gated) | `npx playwright test e2e/35-og-cache-bust.spec.ts` | ❌ W0 | ⬜ pending |
| 35-08-02 | 35-08 | 2 | GAME-04 | T-35-08-05 | Settings → Leaderboards subtab lists user's leaderboard-enabled cohorts; suggest-handle button populates from RPC; invalid handle rejected inline; opt-out reflected within one refresh cycle | unit (Vitest + RTL) | `cd leanshot && npx vitest run src/components/dashboard/settings/__tests__/LeaderboardsSubtab.test.tsx` | ❌ W0 | ⬜ pending |
| 35-09-01 | 35-09 | 3 | GAME-02 / GAME-05 | T-35-09-01 / T-35-09-02 | lifecycle-behavior-triggered extension: streak-warn fires ONCE per cycle (6pm user-local); challenge-kickoff Monday-only; challenge-nudge 24h ahead; ethical-only single-notification guardrail enforced via UPSERT email_send_counters | unit (Deno) | `$HOME/.deno/bin/deno test --no-check supabase/functions/lifecycle-behavior-triggered/index.test.ts` | ❌ W0 | ⬜ pending |
| 35-09-02 | 35-09 | 3 | GAME-05 | T-35-09-04 | challenge-evaluate-cron Edge Fn: service-role-bearer auth; per-user error handling; lifecycle-dispatch trigger; captureServer summary | unit (Deno) | `$HOME/.deno/bin/deno test --no-check supabase/functions/challenge-evaluate-cron/index.test.ts` | ❌ W0 | ⬜ pending |
| 35-09-03 | 35-09 | 3 | GAME-02 / GAME-05 | T-35-09-01 | `email_send_counters` UPSERT (NOT bare UPDATE) prevents double-notify per cycle; monotonic completed_at on challenge_progress | unit (pgTAP) | `supabase test db --linked --file supabase/tests/35_notification_single_per_cycle.sql` | ❌ W0 | ⬜ pending |
| 35-10-02 | 35-10 | 4 | GAME-01..09 | T-35-10-05 | Server-side PostHog events (xp_earned, level_up, badge_unlocked, freeze_token_granted, challenge_completed, streak_milestone) emitted from xp-event / admin-grant-freeze-token / challenge-evaluate-cron / lifecycle-behavior-triggered Edge Fns with PHI-safe property allowlist (D-05) | unit (Deno; PHI scan) | All 4 Edge Fn `index.test.ts` files combined via `$HOME/.deno/bin/deno test --no-check supabase/functions/{xp-event,admin-grant-freeze-token,challenge-evaluate-cron,lifecycle-behavior-triggered}/` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

Per per-task wiring above. Single Wave 0 mass-create owned by execute-phase before Wave 1 begins:

- [ ] `supabase/tests/35_xp_ledger_replay.sql` (Plan 35-01 Task 4) — pgTAP rollback determinism
- [ ] `supabase/tests/35_xp_ledger_rls.sql` (Plan 35-01 Task 4) — append-only RLS proof
- [ ] `supabase/tests/35_streak_cron_dst.sql` (Plan 35-02 Task 4) — DST + idempotency
- [ ] `supabase/tests/35_freeze_token_autoapply.sql` (Plan 35-02 Task 4) — auto-apply + max-3
- [ ] `supabase/tests/35_combo_badge.sql` (Plan 35-03 Task 5) — GAME-09 combo
- [ ] `supabase/tests/35_leaderboard_matview.sql` (Plan 35-04 Task 5) — matview JOIN + rolling-7d
- [ ] `supabase/tests/35_matview_concurrent.sql` (Plan 35-04 Task 5) — Pitfall 3
- [ ] `supabase/tests/35_challenge_status_check.sql` (Plan 35-05 Task 5) — status enum widening
- [ ] `supabase/tests/35_notification_single_per_cycle.sql` (Plan 35-09 Task 3) — UPSERT idempotency
- [ ] `leanshot/e2e/rls-xp-ledger.test.ts` (Plan 35-01 Task 5)
- [ ] `leanshot/e2e/rls-freeze-tokens-ledger.test.ts` (Plan 35-02 Task 5)
- [ ] `leanshot/test/rls/35-leaderboard-cross-tenant.test.ts` (Plan 35-04 Task 5)
- [ ] `leanshot/e2e/rls-leaderboard-optin.test.ts` (Plan 35-04 Task 5)
- [ ] `leanshot/test/vercel-rewrite.spec.ts` (Plan 35-07 Task 2)
- [ ] `leanshot/e2e/35-og-share-card.spec.ts` + `35-share-attribution.spec.ts` + `35-og-cache-bust.spec.ts` (Plan 35-07 Task 4; deploy-gated)
- [ ] `supabase/functions/admin-grant-freeze-token/index.test.ts` (Plan 35-02 Task 3)
- [ ] `supabase/functions/xp-event/index.test.ts` (Plan 35-03 Task 3)
- [ ] `supabase/functions/challenge-evaluate-cron/index.test.ts` (Plan 35-09 Task 2)
- [ ] `supabase/functions/lifecycle-behavior-triggered/index.test.ts` (Plan 35-09 Task 1 — EXTEND existing)
- [ ] `leanshot/src/lib/gamification/__tests__/xp.test.ts` (Plan 35-03 Task 4)
- [ ] `leanshot/src/lib/gamification/__tests__/handle-validate.test.ts` (Plan 35-04 Task 4)
- [ ] `leanshot/src/lib/gamification/__tests__/share-token.test.ts` (Plan 35-07 Task 1)
- [ ] `leanshot/src/components/dashboard/burst/__tests__/LevelUpBurst.test.tsx` (Plan 35-06 Task 1)
- [ ] `leanshot/src/components/dashboard/cards/__tests__/LevelProgressCard.test.tsx` + `StreakCard.test.tsx` (Plan 35-06 Task 3)
- [ ] `leanshot/src/components/admin/gamification/__tests__/ChallengeForm.test.tsx` (Plan 35-05 Task 4)
- [ ] `leanshot/src/components/dashboard/settings/__tests__/LeaderboardsSubtab.test.tsx` (Plan 35-08 Task 2)

---

## Manual-Only Verifications (Plan 35-10 HUMAN-UAT checkpoint Task 4)

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Twitter/X card preview renders correctly | GAME-07 | Twitter cache requires submission to Card Validator; no automated path | (1) Mint sample share URL via SPA; (2) submit to https://cards-dev.twitter.com/validator; (3) confirm 1200x630 image + title + summary_large_image |
| LinkedIn share preview renders correctly | GAME-07 | LinkedIn Post Inspector requires authenticated session | Submit same URL to https://www.linkedin.com/post-inspector/ |
| Instagram share preview renders correctly | GAME-07 | Instagram has no inspector; render is in mobile app | iOS or Android device; DM the share URL; confirm preview card |
| Notification copy passes ethical-only review | GAME-05 / GAME-06 | Subjective tone check requires human reviewer | Read 3 templates (streak-warn / challenge-kickoff / challenge-nudge); confirm NO urgency-escalation / NO FOMO / NO shame language per D-09 |
| Cohort psychological-fit runbook reviewed | GAME-04 | Admin role responsibility documented in runbook | Operator reads `runbooks/leaderboard-cohort-criteria.md`; confirms decision tree present |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references (single-batch Wave 0 mass-create owned by execute-phase)
- [x] No watch-mode flags
- [x] Feedback latency < 120s (quick) / < 600s (full)
- [x] `nyquist_compliant: true` set in frontmatter (wired by plan-phase 2026-05-21)

**Approval:** pending (Plan 35-10 HUMAN-UAT Task 4)
