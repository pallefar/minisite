# Phase 35: M3 Gamification Engine - Context

**Gathered:** 2026-05-19
**Status:** Ready for planning

<domain>
## Phase Boundary

Ship the M3 gamification engine as **ethical-only mechanics** (explicit user direction; no monetization, no dark patterns, privacy-default everywhere):

1. Append-only `xp_ledger` (per qualifying action) + deterministic level computation; rollback test proves ledger replay yields identical level.
2. Streak tracking (`streak_state`) computed via daily `pg_cron` respecting `profiles.timezone`; freeze tokens granted free monthly (1/month), auto-applied.
3. Cohort-scoped opt-IN leaderboards (admin-curated subset only) on a 15-min `pg_cron`-refreshed matview; user-chosen anonymized handles.
4. Admin weekly challenges (simple form + per-cohort scoping; max 2 active per user); ethical-only loss-aversion (24h-ahead streak break warning; no FOMO escalation).
5. Progress rings on dashboard (reuse `ProgressRing.tsx`); `useReducedMotion` respected everywhere.
6. Shareable level-up cards via Vercel Function (OG image); `gamification-burst` chunk ≤ 8 kB gz.

**Out of scope (explicitly deferred):**
- XP-economy monetization (selling freeze tokens, paid XP boosts, gated levels). Out-of-bounds per user direction.
- Multi-stage / branching challenges — single-condition challenges only; complex builder belongs in a future polish phase.
- Cross-cohort universal leaderboards — leaderboards are per-cohort (admin-curated) only; no "global top users" view.
- Real-name display on leaderboards — privacy-default; user-chosen handle only.

</domain>

<decisions>
## Implementation Decisions

### XP Economy + Level Curve

- **D-01: Wide-scale XP values.** Base scheme:
  - log injection +25 · weight log +25 · symptom log +10 · workout log +50
  - day-2 streak survived +25 (autom. on day 2 check) · weekly streak milestone +100
  - weekly challenge complete +250 · monthly milestone +1000 · badge unlock +0 (badge is the reward)
  - Planner picks final per-action values; the SCALE is locked. Bigger integers feel more rewarding per ethical-only positioning (no inflation; just psychological feel).
- **D-02: Quadratic level curve.** Level N requires `N² × 100` XP cumulative.
  - Level 1: 100 · Level 2: 400 · Level 3: 900 · Level 5: 2,500 · Level 10: 10,000 · Level 20: 40,000.
  - Standard game-design pacing: rapid early levels (engagement), gentle ramp later (long-tail). Backs the GAME-01 ledger-replay rollback test (deterministic given the formula).
- **D-03: No max-level cap.** Users level indefinitely. Display caps at 100 with "Prestige" badge thereafter (increments at 100/200/300/...). Long-term power-user satisfaction without late-game cliff.
- **D-04: Level computation is a pure function of XP total.** No side state. Implements as a Postgres function `compute_level(xp_total) → int` that the rollback test exercises against random ledger sequences. Function deterministic; tests use `pg_temp` for replay.
- **D-05: Server-side XP capture.** XP-earning events fire from the Edge Function that processes the qualifying-action insert (Phase 24 D-13 server-side PostHog pattern). Browser-side capture is supplementary; ledger is the source of truth, NOT PostHog.

### Streak Rules + Freeze-Token Semantics (ethical-only enforced)

- **D-06: ANY qualifying XP action keeps the streak (cross-action OK).** Log injection OR weight OR symptom OR workout — any single action that day. Lowest friction; matches ethical-only positioning (user doesn't have to repeat a specific action).
- **D-07: Streak computation = daily `pg_cron` per timezone.** Job runs hourly UTC; for each user whose `profiles.timezone` puts them at 02:00 local, computes prior-day streak survival, increments or breaks. Avoids the "midnight rollover" race for distributed-timezone users.
- **D-08: Freeze token rules** — granted free 1/month per user (cron at month boundary); 1 token = 1 day coverage; max stockpile = 3; **auto-applied** on the day after a missed action (no user action needed). Transparent UX shows next-morning notification: "Freeze token used — streak preserved (2 tokens remaining)." Ethical-only: no "use-it-or-lose-it" panic, no surprise depletion.
- **D-09: Streak-break notification = single 24h-ahead warning.** At 6pm user-local-time on the day a streak would break, send ONE friendly push/in-app notification ("You have time today to log something — your 12-day streak is at stake"). No 6h escalation, no double-notifications. ETHICAL-ONLY guardrail; planner blocks any second notification per cycle.
- **D-10: Admin grant path for freeze tokens.** Per GAME-03 — admin can grant freeze tokens via admin module (support cases). Logged in `freeze_tokens_ledger` with `granted_by_admin_user_id` for audit. NEVER monetized; UI explicitly says "ethical mechanic — not for sale."

### Leaderboard Scope + Opt-In Policy (privacy-default)

- **D-11: Admin-curated subset only.** New column `cohort_definitions.leaderboard_enabled boolean default false`. Only cohorts admin explicitly enables get a leaderboard. Admin curates psychological-fit (e.g., enable for "GLP-1 Veterans 6mo+"; do NOT enable for "Newly Diagnosed"). Safest ethical posture; admin owns the responsibility.
- **D-12: Opt-IN default (with onboarding nudge).** User does NOT appear on any leaderboard until they explicitly opt-in via Settings → Leaderboards. Privacy-default. After user reaches level 5, dashboard surfaces a one-time opt-in card ("Join the leaderboard for your cohort?"). Single nudge; never re-surfaces if dismissed. Respects user agency without burying the feature.
- **D-13: User-chosen anonymized handle.** Settings exposes a "Leaderboard handle" field with a server-generated default suggestion (`<theme>-<rand4digit>` e.g. `PeptidePioneer-7841`). User can override with any 6-24-char alphanumeric handle (uniqueness scoped per cohort). Real names NOT permitted by validation regex.
- **D-14: Display = top-10 always + user's ±5 neighborhood.** Leaderboard renders top 10 (visible to all opted-in members) PLUS the requesting user's ±5 neighborhood (their position + 5 above + 5 below). Standard Strava/MMO pattern. Refresh via 15-min `pg_cron` matview (GAME-04 / ROADMAP-locked).
- **D-15: Opt-out within one refresh cycle.** User opts out → on next 15-min matview refresh, their row is excluded. UI immediately shows "You're no longer on this leaderboard" (optimistic). Worst-case 15-min window of stale display.
- **D-16: Leaderboard score = rolling 7d XP** (NOT total XP). Recency-weighted prevents long-time users from sitting at the top forever. Refreshes inside the matview compute. Planner picks alternative score functions only if the gamification-burst bundle ceiling becomes a concern.

### Weekly Challenges — Admin UX + User Mechanics (GAME-05/08/09)

- **D-17: Simple form with per-cohort scoping.** Admin creates a challenge via form (no drag-drop builder for v1.3):
  - `challenge_type` enum: `log_count` (e.g., "log 5 injections this week") / `streak_days` ("hit a 5-day streak") / `specific_action` ("log a workout this week").
  - `threshold` int + `duration` enum (`week` default; `month` optional).
  - `cohort_id` nullable — null = global (all users); else scoped to that cohort.
  - `reward_*` fields per D-19.
  - Stored in `weekly_challenges` table.
- **D-18: Max 2 active challenges per user simultaneously** — 1 global + 1 cohort-specific (cohort-specific wins over global if same user is in both). Manageable cognitive load; clean A/B isolation per GAME-08.
- **D-19: Reward types — ALL 4 supported.** Admin picks any combination per challenge:
  - **XP** (admin-set amount, e.g., +250)
  - **Badge unlock** (collectible — admin picks a `badge_id` from `badge_catalog`; non-economic flair)
  - **Freeze token** (+1 to stockpile, respects D-08 cap of 3 — overflow drops on the floor with logged warning)
  - **Combo / cross-streak** (per GAME-09 — completing the challenge AND maintaining a streak unlocks a special "compound consistency" badge; admin picks the combo badge)
- **D-20: A/B variant scope (GAME-08).** Admin can create up to 2 variants of a challenge with different framing (e.g., A: "Log 5 injections this week" vs B: "Build a 5-day streak"). PostHog Experiments binds the variant_id; cohort-scoped per the Phase 34 D-20 pattern. Same Ship-Winner mechanism (write-new-version + flip flag).
- **D-21: User notification = Monday-only kickoff + 24h-ahead nudge if not on track.** Monday morning local-time push/in-app: "This week's challenge: <framing>". If the user hasn't made progress by Friday evening, single 24h-ahead nudge: "You can still hit this week's challenge." Matches the ethical-only D-09 notification cadence.

### Claude's Discretion

- **Confetti / level-up celebration UX.** canvas-confetti 1.9.3 (stack-locked); fires on level-up + challenge complete; respects `useReducedMotion` (fallback: subtle ProgressRing pulse). Cooldown: max 1 burst per 60s (anti-spam if user batch-logs).
- **Share-card OG image (GAME-07).** Vercel Function (`api/og/level-up.png`?) generates a branded share card. Template design + brand integration — Claude's discretion. Twitter/X/LinkedIn/Instagram OG meta tags wired. Viral attribution back-link via `?ref=share` query param (auto-attaches to `_aff` cookie per Phase 19 dual-cookie pattern).
- **Badge catalog seed.** Planner picks initial badge set (~12-20 badges) covering streak milestones, level milestones, challenge categories, and combo unlocks. Admin can add more later via SQL seed; no admin UI for badge creation in v1.3 (deferred).
- **ProgressRing reuse for streak + level displays.** `src/components/ui/ProgressRing.tsx` already exists from v1.2 DS-9. Planner picks dashboard placement + per-card sizing.
- **gamification-burst chunk packaging.** ≤ 8 kB gz (Phase 24 D-18..20). Lazy-loaded via the Phase 5 `sync-defer` pattern. Canvas-confetti + framer-motion bursts are the chunk's primary occupants.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### ROADMAP + REQUIREMENTS
- `.planning/ROADMAP.md` §"Phase 35: M3 Gamification Engine" — 5 success criteria
- `.planning/REQUIREMENTS.md` §WS14 lines 180–188 — GAME-01..09 verbatim

### Prior-phase load-bearing decisions
- `.planning/phases/24-foundation-modular-admin-shell-event-taxonomy-server-side-po/24-CONTEXT.md` — D-13 server-side PostHog capture; D-18..20 bundle ceilings (gamification-burst 8 kB gz)
- `.planning/phases/27-modular-admin-shell-extensions/` — admin shell module pattern + `surfaceCheck()` extension points
- `.planning/phases/34-m2-onboarding-overhaul-activation-event/34-CONTEXT.md` — D-11 8-goal catalog (relevant for D-06 streak action mapping if planner picks goal-aware variant); D-20 PostHog Experiments pattern (mirrored by D-20 here)
- Phase 25 (HIPAA) — Sentry mask + PostHog PII regex apply to leaderboard handles and challenge framing copy

### Codebase
- `leanshot/src/components/ui/ProgressRing.tsx` — reuse for streak/level rings (v1.2 DS-9)
- `leanshot/src/lib/analytics/events.ts` — extend with `xp_earned`, `level_up`, `streak_milestone`, `freeze_token_granted`, `challenge_completed`, `badge_unlocked` events
- `leanshot/src/lib/sync-defer.ts` — lazy-loading pattern for gamification-burst chunk
- `leanshot/src/lib/org.ts` — `surfaceCheck()` for admin challenge-creation gates
- `leanshot/src/hooks/useReducedMotion.ts` — confetti / burst respect
- `supabase/migrations/20270602000010_cohort_definitions.sql` + `20270602000011_cohort_membership_matview.sql` — leaderboard binds to these; add `leaderboard_enabled` column

### Codebase maps
- `.planning/codebase/ARCHITECTURE.md` — App.tsx lazy-load conventions
- `.planning/codebase/CONVENTIONS.md` — naming + pattern
- `.planning/codebase/STACK.md` — canvas-confetti 1.9.3 + framer-motion already locked

### Memory pointers (project conventions planner MUST honor)
- [[reference_supabase_migration_filename_regex]] — `<14-digits>_name.sql` strict
- [[reference_supabase_migration_gotchas]] — SECDEF search_path; RLS deny patterns
- [[reference_postgres_dollar_quote_nesting_in_cron_body]] — if challenges or freeze-token cron uses `DO $$...$$` inside `cron.schedule(...)`, use named tags
- [[reference_supabase_pg_cron_vault_service_role_pattern]] — pg_cron + SECDEF calling Edge Fns needs vault decrypted_secrets pattern
- [[feedback_planner_missed_status_enum_widening]] — if challenges introduce status enums (active / completed / archived), ship CHECK widening in same plan
- [[feedback_planner_iter1_anti_patterns]] — 5 BLOCKER patterns to dodge

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `ProgressRing.tsx` (v1.2 DS-9 site-rotation card) — drop-in for streak progress + level progress UI.
- `events.ts` event registry (Phase 24) — extends with gamification events; server-side capture path established.
- `cohort_definitions` + `cohort_membership_matview` (Phase 27 migrations 20270602000010/11) — leaderboard binds here via new `leaderboard_enabled` column.
- `useReducedMotion` (v1.2 hook) — gates ALL animation per D-claude-discretion.
- `surfaceCheck('admin.gamification.*')` — extend permission surface for admin challenge creation + freeze-token grant.
- `sync-defer.ts` (v1.2 bundle-protection pattern) — wraps canvas-confetti + framer-motion bursts to stay inside 8 kB gz chunk.
- Phase 24 server-side PostHog capture (`captureServer`) — XP-earning events fire here (D-05).

### Established Patterns
- Append-only ledgers (xp_ledger, freeze_tokens_ledger) match the v1.2 audit_logs / Phase 19 affiliate_conversions append-only pattern; RLS = service-role insert + user-readable select.
- 15-min `pg_cron` matview refresh matches the v1.2/v1.3 leaderboard pattern (cohort_membership_matview).
- Per-tier feature flags via PostHog Experiments + Ship-Winner version write — mirrors Phase 34 D-20.
- Ethical-only / privacy-default theme across the whole phase — single notification per cycle, opt-IN leaderboards, no monetization. Document this prominently in PLAN.md `must_haves.truths` so plan-checker enforces.

### Integration Points
- `App.tsx` dashboard tab — new GamificationCard / LevelProgressCard / StreakCard / LeaderboardCard widgets (per-tab placement Claude's discretion).
- Admin shell — new `/admin/gamification` module (challenges + leaderboard config + freeze-token grant).
- Settings → Leaderboards subtab — opt-in toggle + handle picker.
- Vercel Function `api/og/level-up.png` (Claude's discretion path) — outside leanshot/src, in Vercel project root.
- Edge Fn `xp-grant` or extension to existing Edge Fns — fires from injection-log / weight-log handlers (Plan picks integration shape).

</code_context>

<specifics>
## Specific Ideas

- "Ethical-only" is repeated in ROADMAP, REQUIREMENTS, and user discussion language. This is a load-bearing design constraint that must surface in every plan's `must_haves.truths` — "no dark patterns" is not aspirational, it's a hard rule. Examples that would VIOLATE: a streak counter that turns red 12h before break with shake animation; a "limited-time" challenge with 1-hour timer; auto-applied freeze tokens that surprise-deplete; opt-out leaderboards.
- The cross-action streak (D-06) is deliberately generous — user wants to reward consistency without forcing specific behavior. The streak-break notification (D-09) is deliberately one-shot — user wants to remind, not nag.
- Admin-curated leaderboards (D-11) put the ethical responsibility on the admin role — admin must judge cohort psychological fit. Plan should include a doc/runbook for admins describing the criteria ("don't enable for early-stage / newly-diagnosed cohorts").
- The 4 reward types for challenges (D-19) is intentionally broad — gives admin flexibility for variety. Most challenges in practice will likely be XP-only; combo / cross-streak (GAME-09) is the rarer power feature.

</specifics>

<deferred>
## Deferred Ideas

### Multi-stage / branching challenges
The "full builder with branching" option was raised but explicitly rejected for v1.3 (D-17 chose simple form). Multi-stage challenges with conditional branches ("complete A then B then C") belong in a future polish phase — likely v1.4 once usage patterns surface.

### Admin badge-catalog UI
Badge catalog seeded via SQL in v1.3; no admin UI for creating new badges. If admin demand surfaces, build a CRUD UI in a v1.4 polish plan.

### Cross-cohort universal leaderboard
Leaderboards are per-cohort (admin-curated) only. "Global top users" view explicitly rejected per privacy-default + ethical-only positioning. Could reconsider in a future phase if demand surfaces — but the default answer is no.

### Paid XP boosts / monetized freeze tokens
Explicit OUT-OF-SCOPE per ethical-only positioning. Never ship even if a future business case forms — user direction is unambiguous on this.

### XP-based gating (level-required features)
No "you must be level 10 to access X" gates in v1.3. Levels are pure status; do not gate functionality.

### Share-card per-cohort branding
v1.3 ships one share-card template. Per-cohort or per-clinic branded templates could come in a future white-label extension (Phase 31 already shipped path-based org branding — could extend later).

</deferred>

---

*Phase: 35-m3-gamification-engine*
*Context gathered: 2026-05-19*
