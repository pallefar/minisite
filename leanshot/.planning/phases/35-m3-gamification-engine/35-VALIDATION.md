---
phase: 35
slug: m3-gamification-engine
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-05-21
---

# Phase 35 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

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

> Plan-phase fills exact `Task ID`/`Wave`/`Command` cells once plans are written. The per-criterion behaviors below are the load-bearing contract — each must have at least one automated test row in the final table.

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 35-XX-01 | XX | N | GAME-01 | — | Append a row to `xp_ledger` on qualifying-action insert; `compute_level(xp_total)` is IMMUTABLE; ledger replay against random sequences yields identical level | unit (pgTAP) | `supabase test db --linked --file supabase/tests/35_xp_ledger_replay.sql` | ❌ W0 | ⬜ pending |
| 35-XX-02 | XX | N | GAME-01 | — | `xp_ledger` INSERT-only (UPDATE/DELETE blocked at RLS); service-role insert + user-readable select | unit (pgTAP) | `supabase test db --linked --file supabase/tests/35_xp_ledger_rls.sql` | ❌ W0 | ⬜ pending |
| 35-XX-03 | XX | N | GAME-02 | T-35-streak-cron | Daily cron computes streak survival per `profiles.timezone`; idempotent across cron-retry; DST boundary safe | unit (pgTAP) | `supabase test db --linked --file supabase/tests/35_streak_cron_dst.sql` | ❌ W0 | ⬜ pending |
| 35-XX-04 | XX | N | GAME-02 | — | Freeze token auto-applied the morning after a missed action; max stockpile 3 enforced; monthly grant cron grants exactly 1 | unit (pgTAP) | `supabase test db --linked --file supabase/tests/35_freeze_token_autoapply.sql` | ❌ W0 | ⬜ pending |
| 35-XX-05 | XX | N | GAME-03 | — | Admin grant logs `granted_by_admin_user_id` in `freeze_tokens_ledger`; UI copy includes "ethical mechanic — not for sale" | e2e (Playwright) | `npx playwright test e2e/35-admin-freeze-grant.spec.ts` | ❌ W0 | ⬜ pending |
| 35-XX-06 | XX | N | GAME-04 | — | Cohort matview refreshes every 15 min via pg_cron; rolling 7d XP score; top-10 + ±5 neighborhood query renders | unit (pgTAP) | `supabase test db --linked --file supabase/tests/35_leaderboard_matview.sql` | ❌ W0 | ⬜ pending |
| 35-XX-07 | XX | N | GAME-04 | T-35-leaderboard-pii | Handle uniqueness scoped per-cohort; regex blocks real names; opt-out reflected within one matview refresh | e2e (Playwright) | `npx playwright test e2e/35-leaderboard-optin-optout.spec.ts` | ❌ W0 | ⬜ pending |
| 35-XX-08 | XX | N | GAME-05 / GAME-08 | — | Admin creates weekly challenge via form; A/B variant binds PostHog Experiments id; max 2 active per user (1 global + 1 cohort, cohort wins) | e2e (Playwright) | `npx playwright test e2e/35-admin-challenge-create.spec.ts` | ❌ W0 | ⬜ pending |
| 35-XX-09 | XX | N | GAME-05 | T-35-challenge-status-enum | `weekly_challenges.status` CHECK widening migration ships with status writes; rejects out-of-set values | unit (pgTAP) | `supabase test db --linked --file supabase/tests/35_challenge_status_check.sql` | ❌ W0 | ⬜ pending |
| 35-XX-10 | XX | N | GAME-05 | — | Monday-only kickoff push notification + 24h-ahead nudge if not on track; ONE notification per user per cycle (anti-spam) | unit (Deno) | `$HOME/.deno/bin/deno test --no-check supabase/functions/challenge-notify/test.ts` | ❌ W0 | ⬜ pending |
| 35-XX-11 | XX | N | GAME-06 | — | Streak-break notification fires ONCE 24h ahead at 6pm user-local; ethical-only guardrail blocks any second notification per cycle | unit (Deno) | `$HOME/.deno/bin/deno test --no-check supabase/functions/streak-warn/test.ts` | ❌ W0 | ⬜ pending |
| 35-XX-12 | XX | N | GAME-07 | T-35-og-token-forge | `api/og/level-up.png` returns 200 + image/png; HMAC token validates user_id + level + ts; cache headers correct; Twitter/X + LinkedIn + Instagram meta-tag matrix renders | e2e (Playwright) | `npx playwright test e2e/35-og-share-card.spec.ts` | ❌ W0 | ⬜ pending |
| 35-XX-13 | XX | N | GAME-07 | — | Vercel rewrite carve-out for `/share/level/*` and `/api/og/*` (per Research A1); not swallowed by SPA fallback | unit (Vitest) | `npx vitest run leanshot/test/vercel-rewrite.spec.ts` | ❌ W0 | ⬜ pending |
| 35-XX-14 | XX | N | GAME-07 | — | Viral attribution `?ref=share` propagates to `_aff` cookie per Phase 19 dual-cookie pattern | e2e (Playwright) | `npx playwright test e2e/35-share-attribution.spec.ts` | ❌ W0 | ⬜ pending |
| 35-XX-15 | XX | N | GAME-09 | — | Combo / cross-streak reward unlocks compound-consistency badge when challenge complete AND streak maintained | unit (pgTAP) | `supabase test db --linked --file supabase/tests/35_combo_badge.sql` | ❌ W0 | ⬜ pending |
| 35-XX-16 | XX | N | GAME-01 / GAME-06 | — | canvas-confetti respects `useReducedMotion` → fallback ProgressRing pulse; cooldown 1 burst/60s anti-spam | unit (Vitest + RTL) | `npx vitest run leanshot/src/components/gamification/LevelUpBurst.test.tsx` | ❌ W0 | ⬜ pending |
| 35-XX-17 | XX | N | GAME-01..09 | — | `gamification-burst` chunk ≤ 8 kB gz enforced at build time | unit (shell) | `bash scripts/assert-bundle-budget.sh gamification-burst` | ✅ | ⬜ pending |
| 35-XX-18 | XX | N | GAME-01 | T-35-xp-grant-auth | xp-grant Edge Fn rejects non-service-role callers; cannot grant XP to other users | unit (Deno) | `$HOME/.deno/bin/deno test --no-check supabase/functions/xp-grant/test.ts` | ❌ W0 | ⬜ pending |
| 35-XX-19 | XX | N | GAME-04 | T-35-leaderboard-pii | Cross-tenant impersonation test proves leaderboard scoping does NOT leak handles or scores across cohorts | unit (Vitest RLS suite) | `npx vitest run leanshot/test/rls/35-leaderboard-cross-tenant.test.ts` | ❌ W0 | ⬜ pending |
| 35-XX-20 | XX | N | GAME-05 | T-35-challenge-admin-rbac | Admin challenge form gated via `surfaceCheck('admin.gamification.challenges.write')`; non-admin gets 403 | e2e (Playwright) | `npx playwright test e2e/35-admin-rbac.spec.ts` | ❌ W0 | ⬜ pending |
| 35-XX-21 | XX | N | GAME-01..09 | — | Server-side PostHog events fire from Edge Fns (xp_earned, level_up, streak_milestone, freeze_token_granted, challenge_completed, badge_unlocked); browser-side capture is supplementary | unit (Deno) | `$HOME/.deno/bin/deno test --no-check supabase/functions/xp-grant/posthog.test.ts` | ❌ W0 | ⬜ pending |
| 35-XX-22 | XX | N | GAME-04 | — | Matview uses UNIQUE INDEX so REFRESH CONCURRENTLY is safe; no read-lock during refresh | unit (pgTAP) | `supabase test db --linked --file supabase/tests/35_matview_concurrent.sql` | ❌ W0 | ⬜ pending |
| 35-XX-23 | XX | N | GAME-07 | — | OG image cache busts on level change via query-param versioning (Twitter card cache invalidation) | e2e (Playwright) | `npx playwright test e2e/35-og-cache-bust.spec.ts` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `supabase/tests/35_*.sql` — pgTAP stubs for ledger replay, streak DST, freeze auto-apply, matview, status enum, combo badge, matview concurrent (8 files)
- [ ] `leanshot/test/rls/35-leaderboard-cross-tenant.test.ts` — RLS cross-tenant proof
- [ ] `leanshot/test/vercel-rewrite.spec.ts` — Vercel rewrite carve-out unit test
- [ ] `leanshot/e2e/35-*.spec.ts` — Playwright stubs for admin freeze grant, leaderboard opt-in/out, admin challenge create, share card, share attribution, admin RBAC, OG cache bust (7 files)
- [ ] `supabase/functions/xp-grant/test.ts` + `posthog.test.ts` — Deno tests
- [ ] `supabase/functions/streak-warn/test.ts` — Deno test
- [ ] `supabase/functions/challenge-notify/test.ts` — Deno test
- [ ] `leanshot/src/components/gamification/LevelUpBurst.test.tsx` — RTL + useReducedMotion mock

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Twitter/X card preview renders correctly | GAME-07 | Twitter cache requires submission to Card Validator; no automated path | (1) Generate share URL; (2) submit to https://cards-dev.twitter.com/validator; (3) confirm image renders + title + description |
| LinkedIn share preview renders correctly | GAME-07 | LinkedIn Post Inspector requires authenticated session | (1) Generate share URL; (2) submit to https://www.linkedin.com/post-inspector/; (3) confirm image + title |
| Instagram share preview renders correctly | GAME-07 | Instagram has no inspector; render is determined inside the mobile app | (1) Open Instagram mobile app; (2) paste share URL into a DM; (3) confirm preview card renders |
| Notification copy passes ethical-only review | GAME-05 / GAME-06 | Subjective tone check requires human reviewer | Read each notification template (Monday kickoff, 24h nudge, streak-break warn); confirm no urgency-escalation / no FOMO / no shame language |
| Cohort psychological-fit runbook reviewed | GAME-04 | Admin role responsibility documented in runbook | Operator reads `runbooks/leaderboard-cohort-criteria.md`; confirms decision tree present |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 120s (quick) / < 600s (full)
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
