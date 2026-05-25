# Phase 35 — Plan Review (iter-1)

**Reviewed:** 2026-05-21
**Plans reviewed:** 35-01..35-10 (10 plans)
**Reviewer:** gsd-plan-checker (goal-backward, 8 dimensions)
**Verdict:** NEEDS-FIX — 3 BLOCKERs + 6 FLAGs + 4 NITs

---

## Coverage Matrix

### ROADMAP Success Criteria → Plan Mapping

| SC | Description | Plan(s) | Status | Notes |
|----|-------------|---------|--------|-------|
| SC1 | xp_ledger append + deterministic level + replay rollback | 35-01 (Tasks 1-2, 4), 35-03 (Task 1) | COVERED | pgTAP determinism test in 35-01 Task 4 is the load-bearing artifact |
| SC2 | Streak survives across timezones + monthly freeze tokens prevent break | 35-02 (Tasks 1-4) | COVERED | DST idempotency via last_eval_date; monthly grant cron + UNIQUE INDEX |
| SC3 | Cohort-scoped opt-in leaderboard + 15-min refresh + opt-out cycle | 35-04 (Tasks 1-5), 35-08 (subtab) | COVERED | UNIQUE INDEX on matview is load-bearing for CONCURRENTLY |
| SC4 | Admin creates weekly challenge + A/B variant + notifies BEFORE break (no dark patterns) | 35-05 (Tasks 1-5), 35-09 (Tasks 1-2) | COVERED | D-21 Monday-only + 24h-ahead nudge; copy review via HUMAN gate in 35-10 |
| SC5 | Level-up generates OG share card via Vercel Fn + renders on Twitter/X/LinkedIn/Instagram + gamification-burst ≤ 8 kB | 35-07 (all tasks), 35-06 (chunk), 35-10 (bundle audit + HUMAN probe) | COVERED | Multi-signal HUMAN-UAT acceptable per memory; Instagram preview is mobile-device only |

### REQ-ID → Plan Mapping (REQUIREMENTS.md WS14)

| REQ | Plan(s) | Status |
|-----|---------|--------|
| GAME-01 | 35-01, 35-03, 35-06 | COVERED |
| GAME-02 | 35-02, 35-09 | COVERED |
| GAME-03 | 35-02 (Tasks 1-4) | COVERED |
| GAME-04 | 35-04, 35-08 | COVERED |
| GAME-05 | 35-05, 35-09 | COVERED |
| GAME-06 | 35-06 | COVERED |
| GAME-07 | 35-07 | COVERED |
| GAME-08 | 35-05 (A/B variants + Ship-Winner) | COVERED |
| GAME-09 | 35-01 (combo badge seed), 35-03 (combo trigger), 35-05 (challenge→badge_unlocks writer) | COVERED |

**No orphaned criteria or REQ-IDs.**

---

## Decision Coverage (CONTEXT D-01..D-21)

| D | Topic | Implementing plan(s) | Status |
|---|-------|----------------------|--------|
| D-01 | XP scale (25/25/10/50/etc.) | 35-03 Task 1 (XP_VALUES constant) | OK |
| D-02 | Quadratic level (N²·100) | 35-01 Task 2 (compute_level), 35-03 Task 4 (xp.ts mirror) | OK |
| D-03 | No max-level cap + Prestige | 35-01 Task 2 (compute_prestige), 35-06 (display) | OK |
| D-04 | Pure compute_level fn | 35-01 Task 2 (IMMUTABLE marker + pgTAP) | OK |
| D-05 | Server-side XP capture | 35-03 (hybrid triggers + xp-event Edge Fn) | OK |
| D-06 | ANY qualifying action keeps streak | 35-02 Task 1 (evaluate_streak_for_user IN clause) | OK |
| D-07 | Hourly UTC cron, 02:00-local gate | 35-02 Task 2 (5 * * * * + extract hour) | OK |
| D-08 | Freeze tokens 1/month, max 3, auto-applied | 35-02 (full coverage) | OK |
| D-09 | Single 24h-ahead streak-break warning | 35-09 Task 1 (streak-warn branch) | OK |
| D-10 | Admin grant path + audit trail | 35-02 Task 3 (admin-grant-freeze-token Edge Fn) | OK |
| D-11 | Admin-curated leaderboard subset | 35-04 Task 1 (leaderboard_enabled default false), 35-05 (LeaderboardEnable UI), 35-10 runbook | OK |
| D-12 | Opt-IN default + level-5 nudge + single-shot | 35-04 (RLS), 35-06 (nudge display), 35-08 (persistence) | OK |
| D-13 | Handle regex 6-24 alphanumeric | 35-04 Task 1 (CHECK constraint + Task 4 client mirror) | OK |
| D-14 | Top-10 + ±5 neighborhood | 35-04 Task 3 (get_leaderboard_for_user RPC) | OK |
| D-15 | Opt-out within 1 refresh cycle | 35-04 (active=false flag + 15-min matview) | OK |
| D-16 | Rolling 7d XP score | 35-04 Task 2 (matview LEFT JOIN xp_ledger WHERE created_at >= now() - 7d) | OK |
| D-17 | Simple form, 3 challenge_type, week/month duration, cohort scoping | 35-05 Tasks 1+4 | OK |
| D-18 | Max 2 active per user (1 global + 1 cohort) | 35-05 Task 2 (evaluate_challenge_progress_for_user CTE) | OK |
| D-19 | 4 reward types | 35-05 Task 1 (reward_xp + reward_badge_id + reward_freeze_tokens + reward_combo_badge_id) | OK |
| D-20 | A/B variants + PostHog flag + Ship-Winner | 35-05 Task 2 (ship_winner_challenge_variant RPC + Task 4 ship-winner-flag Fn invoke) | OK |
| D-21 | Monday kickoff + 24h nudge if not on track | 35-09 Task 1 (challenge-kickoff + challenge-nudge branches) | OK |

**Decision coverage: 21/21. No silent reduction detected.**

---

## Open-Question Resolution (RESEARCH §Open Questions)

| OQ | Recommended | Plan resolution | Status |
|----|-------------|-----------------|--------|
| 1 | xp-grant HYBRID (DB trigger + lightweight Edge Fn) | 35-03 ships exactly this | RESOLVED |
| 2 | Vercel rewrite carve-out via /share/level/* exclusion (option a) | 35-07 Task 2 ships carve-out + rewrite-order test | RESOLVED |
| 3 | Notification dispatch piggyback on lifecycle-behavior-triggered | 35-09 Task 1 EXTENDS existing Fn (no new sibling) | RESOLVED |
| 4 | AFTER INSERT triggers safe with Realtime | 35-03 Task 1 documents the trigger-vs-WAL ordering | RESOLVED |
| 5 | 16-badge seed (5 streak + 7 level + 3 challenge + 1 combo) | 35-01 Task 3 ships 17 badges (+1 social-proof per Research line 785) | RESOLVED |

All 5 open questions resolved per recommendations. Header in RESEARCH.md is not marked `(RESOLVED)` — see NIT-1.

---

## Pitfall Mitigation Matrix (RESEARCH §Common Pitfalls)

| # | Pitfall | Plan(s) | Status |
|---|---------|---------|--------|
| 1 | compute_level non-determinism via now()/current_setting | 35-01 Task 2 (IMMUTABLE marker + pgTAP provolatile=i) | OK |
| 2 | Streak cron DST double-fire | 35-02 Task 1 (last_eval_date idempotency) + Task 4 pgTAP DST test | OK |
| 3 | Matview UNIQUE INDEX missing → CONCURRENTLY fails | 35-04 Task 2 (idx_leaderboard_matview_cohort_user UNIQUE) + 35_matview_concurrent.sql | OK |
| 4 | Status enum widening missed for weekly_challenges | 35-05 Task 1 (full 4-value CHECK at creation) + pgTAP Test 1 | OK |
| 5 | freeze_tokens_remaining UPDATE no-ops on first grant | 35-02 (ledger SUM is source of truth; no counter column) | OK |
| 6 | Postgres $$ nesting in cron body | All cron migrations use named tags ($cron$ + $streak$/$refresh$/$grant$/$invoke$/$unschedule$) | OK |
| 7 | pg_cron + Edge Fn calls need vault.decrypted_secrets | 35-09 Task 2 (challenge-eval-cron migration uses vault pattern + hardcoded URL) | OK |
| 8 | SECDEF auth.uid() vs service-role mismatch | 35-01 Task 2 + 35-02 Task 1 + 35-03 Task 1 take p_user as PARAMETER; 35-04 RPCs documented as CLIENT-ONLY | OK |
| 9 | OG image Twitter cache invalidation | 35-07 Task 1 (buildShareUrl appends ?v=<unix_ts>) + 35-og-cache-bust.spec.ts | OK |
| 10 | Viral ?ref=share lands without OG meta | 35-07 Task 2 (vercel.json carve-out + SSR share page) + rewrite-order Vitest test | OK |
| 11 | Confetti burst spam on batch-log | 35-06 Task 1 (60s cooldown via localStorage in gamification-defer.ts) | OK |
| 12 | framer-motion + canvas-confetti in entry chunk | 35-06 Task 1 (type-only imports + dynamic import) + 35-10 bundle audit | OK |

**12/12 pitfalls explicitly mitigated.**

---

## Architectural Tier Compliance (RESEARCH §Responsibility Map)

| Capability | Expected tier | Plan tier | Status |
|------------|---------------|-----------|--------|
| XP ledger + level (GAME-01) | DB (primary), API (secondary) | 35-01 + 35-03 = DB + Edge Fn | OK |
| Streak cron (GAME-02) | DB | 35-02 = pg_cron + SECDEF SQL | OK |
| Freeze grant + admin path (GAME-03) | DB + API | 35-02 = pg_cron + admin-grant-freeze-token Edge Fn | OK |
| Leaderboard matview (GAME-04) | DB + Frontend Client | 35-04 = matview + SECDEF RPC; 35-06 LeaderboardCard reads via RPC | OK |
| Challenge progress (GAME-05) | DB + API | 35-05 SECDEF + 35-09 Edge Fn cron | OK |
| Progress rings (GAME-06) | Frontend Client | 35-06 | OK |
| OG share card (GAME-07) | Frontend Server (Vercel) + CDN | 35-07 leanshot/api/ on Vercel Edge runtime | OK |
| A/B variants (GAME-08) | API + Frontend Client | 35-05 RPC + Phase 34 ship-winner-flag + 35-06 getFeatureFlagPayload | OK |
| Cross-streak combo (GAME-09) | DB + API | 35-03 trigger + 35-05 challenge→badge writer | OK |

**No tier misassignments. Security-sensitive surfaces (admin grant + opt-in mutation + token sign) all live in API/DB tier; client surface is read-only.**

---

## Validation Alignment

- **35-VALIDATION.md rows:** 27 automated test entries (counting multi-test rows)
- **Plan-task automated verify commands declared:** 26 explicit `<automated>` blocks across 10 plans
- **Aligned:** 25/27 (alignment by command path, not exact task-ID prefix)
- **Discrepancies (NIT level — does not block execution):**
  - VALIDATION row `35-01-04` maps replay test to Task 4 in plan; plan 35-01 Task 4 actually ships the replay AND the RLS test together — the row is correct in spirit, but if downstream test-status tracker keys on task-ID, the same task-ID appears twice. Fine.
  - VALIDATION row `35-06-bundle` is a synthetic ID (no Task 6 in plan 35-06 with that name). The bundle audit row maps to scripts/assert-bundle-budget.sh, which Plan 35-10 Task 2 runs. Acceptable; the synthetic ID makes the row searchable.
- **Orphan rows:** none (every row has a wired test file path).
- **Orphan tasks:** none (every plan task either has `<automated>` or is a `checkpoint:human-verify` type with `<resume-signal>`).

**Sampling continuity:** Verified — no 3 consecutive implementation tasks lack automated verify. Wave 1 has dense pgTAP/Vitest coverage; Wave 2 has RTL tests; Wave 3 has Deno + Playwright (deploy-gated); Wave 4 has the full sweep.

**`nyquist_compliant: true`** is set in 35-VALIDATION.md frontmatter; Plan 35-10 Task 4 output instructs flipping it after sweep is green — acceptable.

---

## Findings

### BLOCKER (must fix before execute-phase)

#### B-1. xp-grant trigger ordering vs. challenge_progress reward dispatch — circular call risk

- **Severity:** BLOCKER
- **Plans:** 35-05 Task 2 + 35-03 Task 1
- **Issue:** `evaluate_challenge_progress_for_user` (Plan 35-05 RPC) calls `grant_xp_for_action` (Plan 35-03) on completion. `grant_xp_for_action` inserts into `xp_ledger`. The Plan 35-03 source-table triggers DO NOT fire on xp_ledger inserts (they fire on injections/weights/etc.), so no infinite loop there. **BUT** the combo-badge trigger (Plan 35-03 Task 2) fires AFTER INSERT on `badge_unlocks`. The challenge completion code (35-05) inserts into `badge_unlocks` with `source='challenge'` — this triggers `_p35_combo_badge_check`, which calls `grant_xp_for_action` again (for the +50 combo XP), which inserts another xp_ledger row, which could trigger level-up logic. **In Plan 35-03 Task 2 the recursion guard uses `set_config('p35.in_combo', '1', true)`** — but **`grant_xp_for_action` itself does NOT check this flag**, so the level-up branch inside `grant_xp_for_action` could insert a `badge_unlocks` row with `source='level'`, which fires the combo trigger again. The combo trigger checks `new.source = 'challenge'` and no-ops for `source='level'` — so the actual infinite-loop path is closed. **HOWEVER**, this only works if the recursion guard is set BEFORE the inner `grant_xp_for_action` call AND remains set THROUGH it. The Plan 35-03 code excerpt is ambiguous: the guard sets `p35.in_combo='1'` then calls `grant_xp_for_action`, then clears. If `grant_xp_for_action` does its own work and that triggers a third-level badge_unlocks insert (level badge), the combo trigger fires for the level badge — and at that point, `p35.in_combo` is still `'1'`, so the combo check returns early. **OK.** But this analysis is non-obvious and the plan does not include a pgTAP test specifically exercising the "challenge completion that ALSO levels-up the user" path.
- **Fix hint:** In 35-03 Task 2 trigger function, add explicit comment showing the 3-level call stack (challenge insert → combo trigger → grant_xp_for_action → level-up → badge_unlocks → combo trigger no-op via in_combo flag). In 35-03 Task 5 pgTAP `35_combo_badge.sql`, add a 5th assertion: synthesize a challenge completion that pushes user from level 4 to level 5 (XP grant of 250 lands user past 2500 threshold) AND has streak ≥ 7 — assert: exactly 1 combo-cross-streak badge + exactly 1 level-5 badge + correct xp_ledger totals (challenge +250 + combo +50). **Without this test, the recursion-guard correctness is unverified.**

#### B-2. challenge_progress.notified_kickoff_at requires UPDATE — but challenge_progress has monotonic completed_at trigger that fires on ALL updates

- **Severity:** BLOCKER
- **Plan:** 35-05 Task 1 (challenge_progress trigger) + 35-09 Task 1 (challenge-kickoff branch)
- **Issue:** Plan 35-05 Task 1 ships `_p35_challenge_progress_no_uncomplete` trigger that fires `BEFORE UPDATE` on EVERY row update and raises if `old.completed_at IS NOT NULL AND new.completed_at IS NULL`. **Plan 35-09 Task 1 challenge-kickoff branch updates `notified_kickoff_at`** via `admin.from('challenge_progress').update({ notified_kickoff_at: ... })`. If the row has `completed_at` already set (e.g., user completed the challenge before Monday kickoff fires — possible if challenge starts Sunday), this UPDATE strips `completed_at` because Supabase `.update({ notified_kickoff_at: ... })` only sends the named column — but Postgres trigger reads `new.completed_at` which is the existing value (not stripped). **So actually the trigger logic is safe** because Postgres `UPDATE ... SET notified_kickoff_at = ...` doesn't touch `completed_at` and `new.completed_at = old.completed_at`. The trigger check `old.completed_at IS NOT NULL AND new.completed_at IS NULL` is false in this case. **OK at runtime.** However, the test in 35-09 Task 3 attempts: `update public.challenge_progress set completed_at = null` — this WILL trigger the raise. The test passes because `throws_ok` is used. But for the kickoff-notify path in production, no test exists proving the notified_kickoff_at update survives the trigger when completed_at is already non-null. **Add a defensive test.**
- **Fix hint:** In Plan 35-09 Task 3 pgTAP `35_notification_single_per_cycle.sql`, add a 5th assertion: insert a challenge_progress row with `completed_at = now()`, then `UPDATE challenge_progress SET notified_kickoff_at = now() WHERE ...` — assert it succeeds (`lives_ok`). This proves the monotonic trigger does NOT block legitimate notify-flag updates.

#### B-3. Plan 35-10 Task 1 verification step queries `vault.secrets` view that requires admin/owner role — may fail under service-role/CI

- **Severity:** BLOCKER
- **Plan:** 35-10 Task 1 (vault secret check)
- **Issue:** The verification command `supabase db query --linked "select name from vault.secrets where name in (...)"` requires either: (a) running as the Supabase project owner via personal access token (works for operator-driven runs); or (b) the executing role has SELECT on `vault.secrets`. For Plans run from a CI / scripted context using `SUPABASE_ACCESS_TOKEN`, this may succeed — but `supabase db query --linked` against a service-role-rotated project where vault permissions are tight can return zero rows even when secrets exist (RLS / role visibility quirk). **More importantly**, the operator MUST insert `share_token_secret` (new for Phase 35) AND verify `service_role_key` (assumed shipped in Phase 19, but not confirmed) — and the plan's verification command checks BOTH simultaneously without distinguishing which one is missing. If only `service_role_key` is missing (legacy phase oversight), the operator might insert just `share_token_secret` and miss the second gap.
- **Fix hint:** In Plan 35-10 Task 1, split the vault check into two distinct queries with explicit failure handling: (a) `select 'share_token_secret' as name where exists(select 1 from vault.decrypted_secrets where name='share_token_secret') union all select 'MISSING'` — yields exactly one row that's either the name or `'MISSING'`; (b) same shape for `service_role_key`. Surface BOTH results in the HUMAN-UAT Signal 1 so the operator knows precisely which is missing. Also document in DEPLOY-NOTES.md that the `SUPABASE_ACCESS_TOKEN` used for `db query --linked` must be a personal access token (PAT) with project-owner role, NOT a service-role JWT.

---

### FLAG (should fix; will likely surface at execute-time)

#### F-1. Plan 35-09 Task 1 streak-warn dispatch reads from `xp_ledger` via correlated NOT EXISTS — but the lifecycle-behavior-triggered Edge Fn historically queries via supabase-js, not raw SQL

- **Plan:** 35-09 Task 1
- **Issue:** Plan 35-09 Task 1 documents the streak-warn query as raw SQL but lifecycle-behavior-triggered uses supabase-js `.from(...).select(...).filter(...)` shape. Executor needs to translate the raw SQL to a supabase-js query OR add a SECDEF helper RPC. Both options are valid but the plan doesn't specify which. Risk: executor invents a third option (e.g., `pg_net.http_post` to a SQL endpoint).
- **Fix hint:** In Plan 35-09 Task 1, explicitly state: "Add `find_streak_warn_users(p_now timestamptz)` SECDEF helper in 35-02's migration footprint (or a new migration `20270708000022_p35_streak_warn_helper.sql`) that returns user_ids matching the correlated NOT EXISTS; lifecycle-behavior-triggered calls `admin.rpc('find_streak_warn_users')` instead of inlining SQL." This keeps the Edge Fn clean and the SQL testable.

#### F-2. Plan 35-04 Task 2 matview JOIN against `cohort_membership` — but cohort_membership is a TABLE (per Research A4 + cohort_membership_matview.sql:114), and the cron `cohort_membership_rebuild` runs at 7,22,37,52 — leaderboard refresh runs at 12,27,42,57

- **Plan:** 35-04 Task 2
- **Issue:** A 5-min gap is documented as safe. BUT cohort_membership is rebuilt by deleting+reinserting (not in transaction with leaderboard refresh). If a user joins cohort A at T-1min, they may not appear in cohort_membership at T (cohort rebuild missed them) AND the leaderboard refresh at T+5min reads stale membership. This is a 15-30 min staleness window. **Per D-15 "Worst-case 15-min window of stale display"** — acceptable; documented in CONTEXT. No fix needed, but **add a comment in 35-04 Task 2 matview SQL explicitly stating the staleness contract** so future maintainers don't tighten the cron offset and break the safety margin.
- **Fix hint:** Add `comment on materialized view public.leaderboard_matview is '... Refresh cadence: 12,27,42,57 — 5-min offset AFTER cohort_membership_rebuild (7,22,37,52) ensures membership fresh; worst-case 15-30 min staleness window per D-15.';` (extend existing comment).

#### F-3. Plan 35-07 mint_share_token RPC uses `pgcrypto.hmac` + `encode(..., 'base64')` + `translate(..., '+/=\n', '-_')` — but base64 padding `=` is encoded as `=` and translate replaces it with `_` (placeholder char). Verify the resulting base64url string matches what Vercel Function's `verifyShareToken` expects (which uses `replace(/=+$/, '')` — drops trailing `=` entirely)

- **Plan:** 35-07 Task 1
- **Issue:** Postgres-side mint produces tokens with `_` where padding lives; Vercel-side verify strips padding entirely. These are DIFFERENT outputs and HMAC verification will fail. The plan acknowledges this is a "verify that the resulting string matches" gap but provides no concrete fix.
- **Fix hint:** In 35-07 Task 1 `mint_share_token` migration, replace the translate with: `replace(replace(replace(encode(...,'base64'), '+', '-'), '/', '_'), '=', '')` (or a Postgres function that mirrors `replace(/=+$/, '')`). Add an integration test that round-trips: client calls `mint_share_token(5)` → passes resulting string to Vercel Function `/api/og/level-up.png?token=<...>` → asserts 200 + PNG. This test is not in the current 35-07 Task 4 Playwright suite and is the single point where mint/verify can silently diverge.

#### F-4. Plan 35-09 Task 2 challenge-evaluate-cron Edge Fn calls `evaluate_challenge_progress_for_user` (a SECDEF RPC that uses `auth.uid()` inside its dispatch logic for some queries) — Pitfall 8 concern

- **Plan:** 35-09 Task 2 + 35-05 Task 2
- **Issue:** Re-reading Plan 35-05 Task 2 `evaluate_challenge_progress_for_user` — the function takes `p_user uuid` as PARAMETER and references `cohort_membership.user_id = p_user`. It does NOT call `auth.uid()` inside its body. So when called from service-role Edge Fn (cron context), it works correctly. **OK.** BUT the function also inserts into `badge_unlocks` with `source='challenge'`, which triggers `_p35_combo_badge_check`. That trigger function does NOT use `auth.uid()` (reads `new.user_id`). **OK.** And the combo trigger calls `grant_xp_for_action` which takes `p_user` as parameter. **OK.** End-to-end: no auth.uid() in the cron-triggered path. **Plan is correct; this is a FLAG for the SUMMARY** to confirm with grep that no SECDEF function in the cron path references `auth.uid()`.
- **Fix hint:** In Plan 35-09 Task 2 SUMMARY output, add a verification step: `grep -E "auth\.uid\(\)" supabase/migrations/20270708000018_p35_challenge_rpcs.sql supabase/migrations/20270708000008_p35_xp_grant_triggers.sql supabase/migrations/20270708000009_p35_combo_badge_trigger.sql | grep -v "create_weekly_challenge\|ship_winner_challenge_variant\|set_cohort_leaderboard_enabled\|set_leaderboard_optin\|get_leaderboard_for_user\|mint_share_token"` — expected: empty (the SECDEF functions in the cron path do NOT reference auth.uid()). Document this in the plan.

#### F-5. Plan 35-05 Task 2 `evaluate_challenge_progress_for_user` D-18 enforcement uses `cohort_membership` table — but if user is in MULTIPLE leaderboard-enabled cohorts, the SQL `order by c.created_at desc limit 1` picks the most-recent cohort, not "alphabetical by cohort name" as documented

- **Plan:** 35-05 Task 2
- **Issue:** The plan documents "cohort-specific wins if user is in multiple cohorts (alphabetical order by cohort name for tiebreak)" but the actual SQL uses `order by c.created_at desc limit 1` (most-recent challenge in the most-recent cohort). For a stable user experience (challenge doesn't switch when admin adds a new cohort the user happens to belong to), tiebreak should be deterministic — either cohort name OR cohort_id. The plan's spec contradicts the SQL.
- **Fix hint:** In 35-05 Task 2, change the inner subquery `active_cohort` to: `order by cd.name asc, c.created_at desc limit 1` (alphabetical by cohort name as documented in the plan body). Or revise the plan body to match the SQL. Pick one source of truth.

#### F-6. Plan 35-07 share-token TTL is 30d but no rotation guidance for SHARE_TOKEN_SECRET — Pitfall (out of scope for #11 but mentioned in T-35-07-09)

- **Plan:** 35-07 Task 1 + 35-10 DEPLOY-NOTES
- **Issue:** T-35-07-09 in threat model accepts secret rotation breaks existing tokens with 30d TTL blast radius. DEPLOY-NOTES Section 7 (Rollback Procedure) doesn't document the rotation cadence or process. If the secret is ever exposed (e.g., leaked via Vercel env logs), all share URLs become invalid within 30d, but operator has no documented procedure for emergency rotation.
- **Fix hint:** Add to DEPLOY-NOTES.md a Section 8 "Emergency Share-Token Secret Rotation" with steps: (1) generate new key via `openssl rand -hex 32`; (2) `vault.update_secret` for share_token_secret; (3) `vercel env rm SHARE_TOKEN_SECRET production && vercel env add SHARE_TOKEN_SECRET production` with new value; (4) `vercel --prod` redeploy; (5) communication template for users with broken share links.

---

### NIT (low-risk; consider if cheap)

#### N-1. RESEARCH.md `## Open Questions` section header missing `(RESOLVED)` suffix

- **File:** 35-RESEARCH.md line 760
- **Issue:** All 5 open questions have recommendations that the plans implement, but the section header isn't marked `(RESOLVED)` per Dimension 11 convention. Plan-checker Dim 11 PASSes because each question has an inline "Recommendation:" — but a future re-check would flag this.
- **Fix hint:** Rename header to `## Open Questions (RESOLVED)`.

#### N-2. Plan 35-01 Task 3 ships 17 badges but title + must_haves say "16 badges"

- **Plan:** 35-01 Task 3
- **Issue:** Task body documents 17-badge breakdown (5+7+3+1+1) explicitly but the must_haves frontmatter says "16 badges" (5+7+3+1). Internal inconsistency.
- **Fix hint:** In 35-01 frontmatter `must_haves.truths`, change `"badge_catalog seed lists 16 badges covering 5 streak + 7 level + 3 challenge-category + 1 combo"` to `"... 17 badges ... + 1 social-proof"`.

#### N-3. Plan 35-06 GamificationCard parent component renders 4 cards but App.tsx integration is "planner picks placement"

- **Plan:** 35-06 Task 3
- **Issue:** No concrete tab placement specified; risk that executor places card in wrong tab or skips integration entirely (file is created but not mounted).
- **Fix hint:** In 35-06 Task 3 `done` criteria, add: "GamificationCard imported and mounted in HomeTab.tsx (or specific tab name confirmed in 35-06-SUMMARY.md)."

#### N-4. Plan 35-03 Task 1 instructs executor to verify source-table names via runtime query before writing the migration — but the migration filename is hard-coded

- **Plan:** 35-03 Task 1
- **Issue:** The executor "MUST verify" table names like `weight_logs` vs `weights` and document which were skipped. But the migration filename is `20270708000008_p35_xp_grant_triggers.sql` (fixed); if executor finds, say, `weights` is the actual name and `weight_logs` doesn't exist, the migration still gets written with the correct name — fine. But if NO weight-tracking table exists at all, executor "documents which were skipped in SUMMARY" — yet the must_haves.truths assert "4 AFTER INSERT triggers". Mismatch between hard requirement and graceful degradation.
- **Fix hint:** In 35-03 frontmatter `must_haves.truths`, change `"4 AFTER INSERT triggers ..."` to `"AFTER INSERT triggers on the subset of {injections, weight_logs, symptom_logs, workouts} tables that exist in the schema; SUMMARY documents which (if any) were skipped"`.

---

## Wave Assignment & Migration Apply Order

Declared:

| Wave | Plans |
|------|-------|
| 1 (parallel) | 35-01, 35-02, 35-04, 35-05 |
| 2 (depends on Wave 1) | 35-03 (deps 01+02), 35-06 (deps 01+02+04+05), 35-08 (deps 04) |
| 3 (depends on Wave 2) | 35-07 (deps 01), 35-09 (deps 02+05) |
| 4 (BLOCKING close-out) | 35-10 (deps all) |

**Analysis:**
- Wave 1 plans 35-02/04/05 write SQL that references functions/tables from 35-01 + 35-03 — but **migration files are ordered by numeric filename**, and Plan 35-10 (the only one running `db push --linked`) applies them in `20270708000001..21` sequence. Postgres deferred-name-resolution handles forward references in SECDEF function BODIES. Tables (e.g., 35-04 matview JOINs xp_ledger) are referenced at CREATE-MATVIEW time, but 35-04's matview migration is `20270708000012` which runs AFTER 35-01's `20270708000001` (xp_ledger). **OK.**
- Wave 2 declares 35-03 deps on 35-02 — but 35-03 only reads `streak_state.current_streak_days` inside the combo-trigger plpgsql (deferred resolution). At code-write time, 35-03 needs `streak_state` table existing in PLAN.md interfaces section (it does — line 121-125). **OK.**
- 35-07 wave 3 depends only on 35-01 — but uses `mint_share_token` RPC which is itself in 35-07 migration. **No cross-plan dependency issue.**
- 35-09 wave 3 depends on 35-02 (streak helpers) and 35-05 (challenge tables + evaluate_challenge_progress RPC). **Correct.**
- 35-10 BLOCKING applies all 21 migrations + 4 Fn deploys + bundle audit. **Correct close-out.**

**No circular dependencies. No forward references that block at CREATE time.**

**Sibling-file scaffolding check (memory feedback_executor_tdd_scaffolds_sibling_files):**
- Plan 35-07 Task 3 documents an "additive integration seam" edit to `LevelUpBurst.tsx` (a file created by Plan 35-06). Plan 35-06 frontmatter does NOT explicitly list 35-07 as a writer, but 35-07's documentation makes the cross-plan touch explicit. This is the safe variant of the anti-pattern. **No conflict expected**, but flag for executor awareness — see N-3 fix hint.

---

## Memory-Feedback Red Flags Scanned

| Pattern | Found? | Notes |
|---|---|---|
| Shared-file choreography (2 plans writing same file) | 35-07 edits `LevelUpBurst.tsx` (created by 35-06) — additive seam only | Acceptable; documented |
| Hedge instructions ("maybe", "if needed", "consider") | Some "planner picks placement" in 35-06 + "planner's discretion" in 35-08 deep-link | NIT-3 covers placement; deep-link is genuinely discretionary |
| VALIDATION nyquist_compliant flag flipped prematurely | Set to `true` at plan-write; Plan 35-10 Task 4 says flip after sweep — slight ordering ambiguity | Acceptable; the flip is documented |
| Defensive jsonb contracts (un-typed jsonb when typed column would do) | 35-05 `create_weekly_challenge(p_payload jsonb)` — jsonb at RPC boundary | Acceptable; the underlying TABLE has fully-typed columns + CHECKs; jsonb is only at the RPC input boundary for flexibility (variant array). NOT a defensive-jsonb pattern. |
| DDL inside `BEGIN; ...; COMMIT;` with conflicting locks | All migrations are bare DDL (no BEGIN/COMMIT wrappers); Supabase wraps each migration in its own transaction | OK |
| Counter table bare-UPDATE on first event | 35-02 `freeze_tokens_ledger` uses ledger SUM (not counter); 35-09 `email_send_counters` uses UPSERT with onConflict | OK |
| Cron-callable Edge Fns hitting RPCs with auth.uid() | 35-09 challenge-evaluate-cron → evaluate_challenge_progress_for_user (takes p_user param, no auth.uid()) | OK (see F-4 for verification step) |
| State enum widening shipped separately from first writer | 35-05 weekly_challenges.status ships FULL 4-value CHECK at table creation | OK |

**No new red flags detected beyond the FLAGs above.**

---

## Threat Model Coverage

All 10 plans have `<threat_model>` blocks with explicit STRIDE-classified threat IDs (T-35-XX-NN). Severity: ASVS L1 throughout. Block-on threshold (high) is not exceeded — all `high`-impact threats are explicitly `mitigate`-dispositioned with concrete controls (RLS, SECDEF parameter passing, HMAC verify, CHECK constraints, UNIQUE indexes, append-only triggers).

Threat ID coverage by plan:
- 35-01: 8 threats (T-35-01-01..08)
- 35-02: 8 threats
- 35-03: 8 threats
- 35-04: 8 threats
- 35-05: 8 threats
- 35-06: 6 threats
- 35-07: 10 threats
- 35-08: 5 threats
- 35-09: 8 threats
- 35-10: 6 threats

**Total:** 75 distinct threats; all mapped to mitigations or explicit `accept` with rationale. Privacy-sensitive surfaces (leaderboard handles, share-token user IDs, notification payloads) have multiple defense layers.

---

## CLAUDE.md Compliance

- **Tech stack:** All plans honor React 19 + Vite + TS strict + Tailwind v4 + Zustand. Adds canvas-confetti ^1.9.3 + @vercel/og ^0.11.1 per Research/CONTEXT discretion.
- **Local-first:** Phase 35 is server-side gamification but does NOT block offline app usage; gamification cards degrade gracefully when supabase calls fail (NULL data → cards return null).
- **HIPAA posture:** No PHI in PostHog events; property allowlist on xp-event Fn; D-13 handle regex blocks real names; OG share card uses anonymized 16-hex user-id prefix.
- **Bundle:** gamification-burst chunk ≤ 8 kB enforced by existing script; canvas-confetti lazy-loaded via sync-defer mirror.
- **A11y:** useReducedMotion gates all animation; defense-in-depth with library-level disableForReducedMotion; aria-label on dialog overlays; lucide icons aria-hidden where decorative.

**No CLAUDE.md violations.**

---

## Verdict

**NEEDS-FIX** — 3 BLOCKERs + 6 FLAGs + 4 NITs

The plan set is structurally sound: full requirement coverage, all 21 locked decisions implemented, all 5 open questions resolved per recommendations, all 12 pitfalls explicitly mitigated, no circular dependencies, no scope reduction or silent simplification, no contradictions with CONTEXT.md.

The 3 BLOCKERs are surgical fixes:
- B-1: Add 1 pgTAP assertion (challenge-completion-AND-level-up edge case)
- B-2: Add 1 pgTAP assertion (notified_kickoff_at UPDATE survives monotonic trigger)
- B-3: Split vault check into per-secret queries + document PAT requirement

The 6 FLAGs are quality / robustness improvements that ship inline. The 4 NITs are documentation polish.

After inline fixes (estimated ~15 minutes of Edit tool work), this plan set is ready for execute-phase dispatch.

---

## CHECK NEEDS-FIX

- BLOCKERs: 3
- FLAGs: 6
- NITs: 4

Recommend orchestrator inline-fix (per memory feedback_inline_fix_over_replan) — surgical Edits, no planner re-spawn. Re-check after BLOCKER fixes land.
