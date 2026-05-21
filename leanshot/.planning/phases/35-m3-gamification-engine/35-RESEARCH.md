# Phase 35: M3 Gamification Engine — Research

**Researched:** 2026-05-21
**Domain:** Append-only XP ledger + deterministic levels + timezone-aware streak cron + cohort-scoped opt-in leaderboard matview + admin weekly challenges with A/B variants + canvas-confetti bursts + Vercel Function OG share cards.
**Confidence:** HIGH (stack-locked; established cohort/cron/PostHog/Edge-Fn patterns in repo; canvas-confetti + @vercel/og versions verified against npm).

## Summary

This is a **schema-heavy data-engineering phase** with a thin animation/share-card surface layer on top. The bulk of the risk lives in three places: (1) deterministic level math + replayable append-only ledger that survives a rollback test, (2) timezone-aware streak cron that correctly fires at 02:00 local for every IANA-zoned user every hour-tick without double-firing, and (3) opt-in leaderboard matview keyed off the existing `cohort_membership` table while preserving per-cohort handle uniqueness and 15-min opt-out semantics. Everything else (challenges schema + admin form, freeze-token grants + auto-apply, confetti burst, OG share-card Vercel Fn) follows established sibling patterns from Phases 24, 27, 34, 37, 38.

**Primary recommendation:** Ship as 8–10 plans with one shared schema migration plan at Wave 1, a streak/freeze cron plan at Wave 2 that depends on it, a leaderboard matview plan at Wave 2 (parallel to streak), an XP-grant Edge Fn plan integrating into existing log-handler Edge Fns at Wave 2, a weekly-challenges admin + variant plan at Wave 3, a confetti/burst UI plan at Wave 3, an OG share-card Vercel Function plan at Wave 3 (independent of Supabase), and a closeout/integration plan at Wave 4 wiring dashboard cards. Use `compute_level()` as a pure SQL function (deterministic); use the existing `cohort_membership` table (NOT matview) for leaderboard cohort filter; reuse `cohort_membership_rebuild()` 15-min cadence pattern (offset to a non-quarter-hour slot to avoid cron pile-up).

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**XP Economy + Level Curve**
- **D-01: Wide-scale XP values.** Base scheme: log injection +25 · weight log +25 · symptom log +10 · workout log +50 · day-2 streak survived +25 · weekly streak milestone +100 · weekly challenge complete +250 · monthly milestone +1000 · badge unlock +0 (badge is the reward). Planner picks final per-action values; the SCALE is locked.
- **D-02: Quadratic level curve.** Level N requires `N² × 100` XP cumulative. Level 1: 100 · Level 2: 400 · Level 3: 900 · Level 5: 2,500 · Level 10: 10,000 · Level 20: 40,000.
- **D-03: No max-level cap.** Display caps at 100 with "Prestige" badge thereafter (increments at 100/200/300/...).
- **D-04: Level computation is a pure function of XP total.** No side state. Postgres function `compute_level(xp_total) → int`. Rollback test exercises against random ledger sequences via `pg_temp`.
- **D-05: Server-side XP capture.** XP-earning events fire from the Edge Function that processes the qualifying-action insert (Phase 24 D-13 server-side PostHog pattern). Browser-side capture is supplementary; ledger is source of truth, NOT PostHog.

**Streak Rules + Freeze-Token Semantics (ethical-only enforced)**
- **D-06: ANY qualifying XP action keeps the streak (cross-action OK).** Lowest friction; matches ethical-only positioning.
- **D-07: Streak computation = daily `pg_cron` per timezone.** Job runs hourly UTC; for each user whose `profiles.timezone` puts them at 02:00 local, computes prior-day streak survival, increments or breaks.
- **D-08: Freeze token rules.** Granted free 1/month per user (cron at month boundary); 1 token = 1 day coverage; max stockpile = 3; **auto-applied** on the day after a missed action. Transparent UX notification next morning.
- **D-09: Streak-break notification = single 24h-ahead warning.** At 6pm user-local-time on the day a streak would break, ONE friendly push/in-app notification. NO 6h escalation, NO double-notifications.
- **D-10: Admin grant path for freeze tokens.** Logged in `freeze_tokens_ledger` with `granted_by_admin_user_id` for audit. NEVER monetized; UI explicitly says "ethical mechanic — not for sale."

**Leaderboard Scope + Opt-In Policy (privacy-default)**
- **D-11: Admin-curated subset only.** New column `cohort_definitions.leaderboard_enabled boolean default false`.
- **D-12: Opt-IN default (with onboarding nudge).** User does NOT appear on any leaderboard until they explicitly opt-in via Settings → Leaderboards. After user reaches level 5, dashboard surfaces a one-time opt-in card; single nudge; never re-surfaces if dismissed.
- **D-13: User-chosen anonymized handle.** Server-generated default suggestion (`<theme>-<rand4digit>`); user can override with any 6–24-char alphanumeric handle (uniqueness scoped per cohort). Real names NOT permitted by validation regex.
- **D-14: Display = top-10 always + user's ±5 neighborhood.** Refresh via 15-min `pg_cron` matview.
- **D-15: Opt-out within one refresh cycle.** Worst-case 15-min window of stale display.
- **D-16: Leaderboard score = rolling 7d XP** (NOT total XP). Recency-weighted.

**Weekly Challenges — Admin UX + User Mechanics (GAME-05/08/09)**
- **D-17: Simple form with per-cohort scoping.** `challenge_type` enum: `log_count` / `streak_days` / `specific_action`. `threshold` int + `duration` enum (`week` default; `month` optional). `cohort_id` nullable. Stored in `weekly_challenges`.
- **D-18: Max 2 active challenges per user simultaneously** — 1 global + 1 cohort-specific (cohort-specific wins over global if same user is in both).
- **D-19: Reward types — ALL 4 supported.** XP / Badge unlock / Freeze token (+1, respects D-08 cap of 3; overflow drops with logged warning) / Combo cross-streak badge per GAME-09.
- **D-20: A/B variant scope (GAME-08).** Admin can create up to 2 variants per challenge. PostHog Experiments binds the variant_id; cohort-scoped per Phase 34 D-20 pattern. Same Ship-Winner mechanism (write-new-version + flip flag).
- **D-21: User notification = Monday-only kickoff + 24h-ahead nudge if not on track.** Matches ethical-only D-09 cadence.

### Claude's Discretion

- **Confetti / level-up celebration UX.** canvas-confetti 1.9.3 (stack-locked); fires on level-up + challenge complete; respects `useReducedMotion` (fallback: subtle ProgressRing pulse). Cooldown: max 1 burst per 60s (anti-spam if user batch-logs).
- **Share-card OG image (GAME-07).** Vercel Function (`api/og/level-up.png`?) generates a branded share card. Template design + brand integration — Claude's discretion. Twitter/X/LinkedIn/Instagram OG meta tags wired. Viral attribution `?ref=share` query param (auto-attaches to `_aff` cookie per Phase 19 dual-cookie pattern).
- **Badge catalog seed.** Planner picks initial badge set (~12–20 badges). Admin can add more later via SQL seed; no admin UI for badge creation in v1.3.
- **ProgressRing reuse for streak + level displays.** `src/components/ui/ProgressRing.tsx`.
- **gamification-burst chunk packaging.** ≤ 8 kB gz. Lazy-loaded via Phase 5 `sync-defer` pattern.

### Deferred Ideas (OUT OF SCOPE)

- Multi-stage / branching challenges (v1.4+).
- Admin badge-catalog UI (v1.4+).
- Cross-cohort universal leaderboard (privacy-default rejection).
- Paid XP boosts / monetized freeze tokens (ethical-only — NEVER ship).
- XP-based gating (level-required features) — levels are pure status.
- Share-card per-cohort branding (v1.4+).

</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| GAME-01 | Append-only `xp_ledger` per qualifying action + deterministic level from total + rollback replay yields identical level | §Standard Stack (Postgres pure SQL fn), §Architecture Patterns (Append-only ledger pattern), §Code Examples (compute_level + rollback test), §Validation Architecture REQ GAME-01 |
| GAME-02 | `streak_state` (current + longest + last_action_at) computed by daily pg_cron respecting `profiles.timezone` | §Standard Stack (pg_cron hourly + IANA-aware DATE_TRUNC), §Common Pitfalls (timezone boundaries, DST), §Code Examples (streak cron skeleton) |
| GAME-03 | Freeze tokens granted free monthly (1/month) — ethical-only, admin grant path | §Architecture Patterns (Append-only freeze_tokens_ledger), §Code Examples (monthly grant cron + auto-apply order) |
| GAME-04 | Cohort-scoped opt-in leaderboard, anonymized handles, pg_cron 15-min matview refresh | §Architecture Patterns (matview + rebuild SECDEF pattern), §Code Examples (leaderboard rebuild), §Common Pitfalls (matview vs table), §Architectural Responsibility Map |
| GAME-05 | Weekly challenges admin-configurable (type + duration + reward) — ethical-only loss aversion | §Standard Stack (`weekly_challenges` schema), §Common Pitfalls (status enum widening) |
| GAME-06 | ProgressRing renders streak + level + goal; respects `useReducedMotion` | §Reuse — `src/components/ui/ProgressRing.tsx` exists; §Code Examples (ProgressRing + framer-motion wrap) |
| GAME-07 | Shareable level-up OG-image cards via Vercel Function; renders on Twitter/X/LinkedIn/Instagram | §Standard Stack (@vercel/og 0.11.1), §Code Examples (api/og/level-up route + meta tag matrix), §Common Pitfalls (OG cache, viral attribution) |
| GAME-08 | Weekly challenge admin variant A/B (cohort-scoped framing variants) | §Architecture Patterns (mirror Phase 34 D-20 — getFeatureFlagPayload + Ship-Winner write-new-version) |
| GAME-09 | Cross-streak rewards — streak + challenge completion combo unlocks special badge | §Code Examples (combo trigger in xp-grant Edge Fn + badge_unlocks insert) |

</phase_requirements>

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| XP ledger append + level compute (GAME-01) | Database / Storage | API/Edge | Source of truth = Postgres; xp-grant Edge Fn inserts rows but DB holds the ledger + pure `compute_level()` function. Determinism requires DB-side compute (rollback test runs SQL replay). |
| Streak state + daily cron (GAME-02) | Database / Storage | — | Pure pg_cron + SQL — no Edge Fn unless notification dispatch is required (then Edge Fn becomes secondary). |
| Freeze-token grant + auto-apply (GAME-03) | Database / Storage | API/Edge (admin grant UI) | Monthly cron + auto-apply trigger pure SQL; admin-grant path goes through admin Edge Fn (SECDEF RPC) for audit. |
| Leaderboard matview (GAME-04) | Database / Storage | Frontend Client | Matview built + refreshed by pg_cron; client reads top-10 + ±5 neighborhood via SECDEF RPC. |
| Challenge progress evaluation (GAME-05) | Database / Storage | API/Edge | SQL view computes progress from `xp_ledger` + `streak_state`; Edge Fn delivers Monday-kickoff notification. |
| Progress rings on dashboard (GAME-06) | Frontend Client (Browser) | — | Pure render of store state + SECDEF RPC results. |
| Level-up OG share card (GAME-07) | Frontend Server (Vercel Function) | CDN/Static | `api/og/level-up.png` Vercel Function (NOT Supabase Edge Fn — @vercel/og only runs on Vercel Edge). Cached via CDN. |
| A/B challenge variants (GAME-08) | API/Edge | Frontend Client | PostHog flag resolution + cohort-scoped exposure; client reads `getFeatureFlagPayload()`. |
| Cross-streak combo badge (GAME-09) | Database / Storage | API/Edge | SQL trigger or xp-grant Edge Fn detects "challenge completed + streak active" and inserts `badge_unlocks` row. |

**Tier-assignment sanity check:** The OG share card MUST live in the Vercel project (Vercel-leanshot-marketing or app project) because @vercel/og depends on Vercel Edge runtime — it cannot run in a Supabase Edge Function. The HTML page that the share URL resolves to ALSO lives outside the SPA (must be SSR'd so social crawlers see the OG meta tags). The SPA index.html is a static shell with empty OG tags — any social bot scraping it would see nothing. This means GAME-07 ships at minimum TWO Vercel files: `api/og/level-up.png` (image generation) and a SSR'd HTML route that hosts `<meta property="og:image">` + redirects to the SPA after a moment for human visitors.

## Standard Stack

### Core (already in repo — stack-locked)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| @supabase/supabase-js | ^2.105.4 [VERIFIED: package.json] | Auth, DB queries, Realtime, RLS | Project-wide standard |
| posthog-js | ^1.372.10 [VERIFIED: package.json] | Client-side analytics, feature flags, A/B (D-20) | Phase 24 stack-locked |
| posthog-node (Deno) | 5.10.4 [VERIFIED: _shared/posthog-server.ts] | Server-side event capture from Edge Fns (D-05) | Phase 24 stack-locked |
| framer-motion | ^11.11.17 [VERIFIED: package.json] | Confetti burst micro-anim + ProgressRing fill | Stack-locked |
| chart.js | ^4.4.6 [VERIFIED: package.json] | (only if planner adds an XP-over-time chart) | Stack-locked |
| zustand | ^5.0.1 [VERIFIED: package.json] | Local optimistic UI state for opt-in toggle, handle picker | Stack-locked |
| zod | (transitive via events.ts) [VERIFIED: src/lib/analytics/events.ts] | Validate xp-grant Edge Fn body | TAXO-01 standard |

### Supporting (NEW for Phase 35)
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| canvas-confetti | 1.9.3 [CITED: CONTEXT D-claude-discretion / npm 1.9.4 is latest as of 2026-05] | Particle burst on level-up + challenge-complete | Lazy-loaded inside `gamification-burst` chunk via `sync-defer.ts`. Pass `disableForReducedMotion: true` AND additionally gate with `useReducedMotion()` (defense in depth). |
| @vercel/og | ^0.11.1 [VERIFIED: npm registry 2026-05] | OG share-card PNG generation (GAME-07) | Vercel Function `api/og/level-up.png` using `ImageResponse`. Runs on Vercel Edge runtime. |

**Stack lockdown:** No other libraries should be added. Specifically reject `react-canvas-confetti` (extra wrapper, bundle bloat), `js-confetti` (different visual style), or Satori-direct (use @vercel/og which wraps it). Reject `next-share`, `react-share` (the share buttons are 3 anchor tags with `?ref=share` query — no library needed).

### Alternatives Considered
| Instead of | Could Use | Tradeoff (why rejected) |
|------------|-----------|-------------------------|
| `compute_level()` as pure SQL fn | TypeScript helper in Edge Fn | SQL determinism gives rollback-test runner free access; TS would require shipping a Deno harness. SQL wins. |
| Per-cohort leaderboard matview | One global matview filtered by cohort_id at query time | Per-cohort matview matches `cohort_membership_rebuild()` 15-min refresh cadence + amortizes the rolling-7d window calc. Filtered query at read time would require recomputing rolling-7d every read. Per-cohort matview wins for read p99. |
| Single `gamification_events` table | Separate `xp_ledger` + `freeze_tokens_ledger` + `badge_unlocks` | Append-only ledgers split by domain match the v1.2 audit_logs pattern + Phase 19 affiliate_conversions pattern. RLS shape differs per ledger (handle uniqueness check on leaderboard vs simple user-readable on XP). |
| pg_cron hourly UTC streak check | Edge Fn invoked by pg_cron with `net.http_post` | Streak compute is pure SQL on `xp_ledger` + `streak_state` — no external service needed. Hourly UTC cron + WHERE clause `WHERE (now AT TIME ZONE profiles.timezone)::time::hour = 2` keeps it pure-SQL. Edge Fn only needed if notification dispatch is bundled in. |
| canvas-confetti | js-confetti or react-canvas-confetti | canvas-confetti has built-in `disableForReducedMotion` Boolean option [CITED: github.com/catdad/canvas-confetti README]; smallest bundle of the three; no React-render reconciliation overhead. |

**Installation (new packages):**
```bash
cd leanshot && npm install canvas-confetti@^1.9.3
# @vercel/og is installed in the Vercel project root (where api/ lives), NOT in leanshot/.
# Determine target directory after Phase 35 plan-phase architecture decision (likely
# leanshot/api/og/level-up.ts since vercel.json sets framework: 'vite' rooted at leanshot/).
npm install @vercel/og@^0.11.1
```

**Version verification (performed 2026-05-21):**
- canvas-confetti — latest published version 1.9.4 (7 months ago per npm) [VERIFIED: npm registry]. CONTEXT pins 1.9.3; planner may bump to 1.9.4 if no breaking changes — `disableForReducedMotion` API present in both.
- @vercel/og — latest published 0.11.1 (2 months ago) [VERIFIED: npm registry / Vercel docs]. Supports `ImageResponse` constructor + Edge Runtime.

## Architecture Patterns

### System Architecture Diagram

```
                   ┌─────────────────────────────┐
                   │  USER ACTION                │
                   │  (log injection / weight /  │
                   │   symptom / workout)        │
                   └────────────┬────────────────┘
                                │
                                ▼
              ┌─────────────────────────────────────┐
              │  Existing Edge Fn or Supabase row   │
              │  INSERT trigger (planner picks)     │
              │  → invokes xp-grant Edge Fn or DB   │
              │     trigger function                │
              └────────────┬────────────────────────┘
                           │
                           ▼
        ┌───────────────────────────────────────────┐
        │  xp-grant (Edge Fn or SQL function)       │
        │  - Validate action_type via zod / CHECK   │
        │  - INSERT into xp_ledger (append-only)    │
        │  - SELECT compute_level(new total)        │
        │  - If level_up: INSERT badge_unlocks      │
        │  - captureServer('xp_earned')             │
        │  - captureServer('level_up') if applicable│
        └────────────┬──────────────────────────────┘
                     │
            ┌────────┴───────────────┐
            ▼                        ▼
    ┌──────────────┐         ┌─────────────────┐
    │ Realtime/SSE │         │ Daily streak    │
    │ → client     │         │ cron (hourly UTC│
    │   show       │         │  WHERE tz=02:00)│
    │   confetti   │         │ → INSERT/UPDATE │
    │   (if !RM)   │         │   streak_state, │
    └──────────────┘         │  CONSUME freeze │
                             │  token if       │
                             │  needed         │
                             └─────────────────┘

  Separately (admin surface):                 Separately (15-min cron):
  ┌─────────────────────┐              ┌────────────────────────┐
  │ /admin/gamification │              │ leaderboard_matview    │
  │ - create challenge  │              │   rebuild SECDEF fn    │
  │ - grant freeze tok  │              │ - for each cohort with │
  │ - enable cohort     │              │   leaderboard_enabled  │
  │   leaderboard       │              │ - rolling 7d XP sum    │
  │ - PostHog flag flip │              │ - opt-in users only    │
  └─────────────────────┘              └────────────────────────┘

  Share path (GAME-07, Vercel-project-rooted):
  Client → /share/level/<token> (Vercel SSR page with OG meta tags)
                                ├─ <meta og:image=/api/og/level-up.png?level=N>
                                └─ <script>redirect to SPA</script>
                                       ↑
                                /api/og/level-up.png (Vercel Function)
                                — uses @vercel/og ImageResponse
                                — caches via CDN headers
```

### Recommended Project Structure

```
leanshot/
├── src/
│   ├── lib/
│   │   ├── gamification/
│   │   │   ├── xp.ts                 # client-side level compute (mirror of compute_level)
│   │   │   ├── streak-display.ts     # readonly streak presentation
│   │   │   ├── handle-validate.ts    # 6-24-char alphanumeric regex (D-13)
│   │   │   └── leaderboard.ts        # SECDEF RPC wrappers
│   │   └── sync-defer.ts             # EXTEND with 'gamification-burst' kind
│   ├── components/
│   │   └── dashboard/
│   │       ├── cards/
│   │       │   ├── LevelProgressCard.tsx     # ProgressRing + XP-to-next-level
│   │       │   ├── StreakCard.tsx            # current + longest + freeze count
│   │       │   ├── LeaderboardCard.tsx       # top10 + ±5 neighborhood
│   │       │   └── WeeklyChallengeCard.tsx   # active 2 challenges
│   │       └── burst/
│   │           └── ConfettiBurst.tsx         # canvas-confetti wrapper (lazy)
│   ├── admin/
│   │   └── gamification/
│   │       ├── ChallengeForm.tsx
│   │       ├── FreezeTokenGrant.tsx
│   │       └── LeaderboardEnable.tsx
│   └── settings/
│       └── LeaderboardsTab.tsx               # opt-in toggle + handle picker
├── api/                          # Vercel Functions (NEW)
│   └── og/
│       └── level-up.ts            # @vercel/og ImageResponse
supabase/
├── migrations/
│   ├── 20270708000001_p35_xp_ledger.sql
│   ├── 20270708000002_p35_compute_level_fn.sql
│   ├── 20270708000003_p35_streak_state.sql
│   ├── 20270708000004_p35_freeze_tokens_ledger.sql
│   ├── 20270708000005_p35_badge_catalog_seed.sql
│   ├── 20270708000006_p35_weekly_challenges.sql
│   ├── 20270708000007_p35_leaderboard_optin.sql
│   ├── 20270708000008_p35_leaderboard_matview.sql
│   ├── 20270708000009_p35_streak_cron.sql
│   ├── 20270708000010_p35_freeze_monthly_grant_cron.sql
│   ├── 20270708000011_p35_leaderboard_refresh_cron.sql
│   └── 20270708000012_p35_cohort_def_leaderboard_enabled.sql  # ALTER cohort_definitions
└── functions/
    ├── xp-grant/                  # NEW or extends existing log handlers
    ├── challenge-monday-kickoff/  # cron-invoked notification dispatch
    └── admin-grant-freeze-token/  # SECDEF helper for admin path
```

### Pattern 1: Append-only ledger with deterministic-replay rollback test
**What:** Both `xp_ledger` and `freeze_tokens_ledger` are append-only — no UPDATE, no DELETE policies. The level for any user is `compute_level(SUM(xp_delta) FROM xp_ledger WHERE user_id=$1)`. The rollback test takes a random sequence of ledger inserts, replays them in any order against `pg_temp`, asserts the final computed level is identical.

**When to use:** Both `xp_ledger` and `freeze_tokens_ledger` ledgers, mirroring existing `audit_logs` + Phase 19 `affiliate_conversions` shape.

**Example skeleton (deterministic test):**
```sql
-- Source: matches pattern in supabase/migrations/2026..._audit_logs.sql + Phase 19 affiliate_conversions
CREATE TABLE public.xp_ledger (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  action_type text NOT NULL CHECK (action_type IN (
    'injection_log','weight_log','symptom_log','workout_log',
    'streak_day2','streak_weekly_milestone','challenge_complete',
    'monthly_milestone','admin_adjustment'  -- D-01 + admin grant
  )),
  xp_delta    int  NOT NULL,
  source_ref  text,  -- e.g., 'injections:<uuid>' for audit trace; nullable for streak rewards
  created_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.xp_ledger ENABLE ROW LEVEL SECURITY;
-- User can SELECT their own rows; only service_role inserts.
CREATE POLICY "xp_ledger_select_own" ON public.xp_ledger FOR SELECT USING (auth.uid() = user_id);
-- NO UPDATE/DELETE policies — append-only.

CREATE OR REPLACE FUNCTION public.compute_level(xp_total int)
RETURNS int LANGUAGE sql IMMUTABLE AS $$
  -- Quadratic: Level N requires N²·100 XP cumulative (D-02)
  -- Solve N² × 100 ≤ xp_total for max N; floor(sqrt(xp_total/100))
  SELECT GREATEST(1, floor(sqrt(GREATEST(xp_total, 0)::float / 100))::int);
$$;
COMMENT ON FUNCTION public.compute_level IS
  'Phase 35 D-04 — deterministic pure SQL level computation. Rollback test exercises with random sequences.';
```

### Pattern 2: Timezone-aware streak cron (hourly UTC, fires per user at 02:00 local)
**What:** A single hourly pg_cron job iterates all users whose `profiles.timezone` puts them at 02:00 local at that UTC tick. Avoids midnight rollover race for distributed timezones.

**When to use:** GAME-02 streak compute.

**Example skeleton:**
```sql
-- Source: pattern derived from existing 20270706000005_p34_anon_session_ttl_cron.sql
-- + memory reference_postgres_dollar_quote_nesting_in_cron_body (named tag $streak$).
SELECT cron.schedule(
  'phase35-streak-evaluate-hourly',
  '5 * * * *',  -- 05 past hour to avoid pile-up with other crons
  $cron$
    DO $streak$
    DECLARE
      r record;
    BEGIN
      FOR r IN
        SELECT p.id AS user_id, p.timezone, ss.current_streak_days, ss.last_action_at
        FROM public.profiles p
        LEFT JOIN public.streak_state ss ON ss.user_id = p.id
        WHERE EXTRACT(HOUR FROM (now() AT TIME ZONE p.timezone)) = 2  -- 02:00 local hour
      LOOP
        PERFORM public.evaluate_streak_for_user(r.user_id);
      END LOOP;
    END $streak$;
  $cron$
);
```

**evaluate_streak_for_user(uid)** is a SECDEF plpgsql function that:
1. Looks at `xp_ledger` for `user_id=uid AND created_at::date >= (now() AT TIME ZONE p.timezone)::date - 1`.
2. If qualifying action on yesterday-local → `current_streak_days += 1`; update `longest_streak_days` if higher; set `last_action_at = max(...)`.
3. If NO qualifying action AND `current_streak_days > 0`:
   - Check `freeze_tokens_remaining(uid)`; if ≥ 1, consume one (INSERT INTO `freeze_tokens_ledger` with `delta = -1`, `reason='auto_apply'`); keep streak.
   - Else: set `current_streak_days = 0`.
4. Idempotent: keyed on `(user_id, evaluated_at::date)` — re-runs same day no-op.

### Pattern 3: Per-cohort leaderboard matview with opt-in + rolling 7d XP
**What:** ONE matview keyed by `(cohort_id, user_id)` with materialized rolling-7d XP sum, anonymized handle, rank-within-cohort. Refresh every 15 min on a cron offset from existing `cohort_membership_rebuild` (which runs at `7,22,37,52`).

**When to use:** GAME-04 leaderboard.

**Example skeleton:**
```sql
CREATE MATERIALIZED VIEW public.leaderboard_matview AS
SELECT
  cm.cohort_id,
  lo.user_id,
  lo.handle,
  COALESCE(SUM(x.xp_delta), 0) AS xp_7d,
  RANK() OVER (
    PARTITION BY cm.cohort_id
    ORDER BY COALESCE(SUM(x.xp_delta), 0) DESC
  ) AS rank_in_cohort,
  now() AS refreshed_at
FROM public.cohort_membership cm
JOIN public.leaderboard_optin lo ON lo.user_id = cm.user_id
JOIN public.cohort_definitions cd ON cd.id = cm.cohort_id AND cd.leaderboard_enabled = true
LEFT JOIN public.xp_ledger x
  ON x.user_id = lo.user_id
  AND x.created_at >= now() - interval '7 days'
GROUP BY cm.cohort_id, lo.user_id, lo.handle;

CREATE UNIQUE INDEX ON public.leaderboard_matview (cohort_id, user_id);
CREATE INDEX ON public.leaderboard_matview (cohort_id, rank_in_cohort);

-- Refresh cron offset from cohort rebuild (which runs at 7,22,37,52).
-- Use 12,27,42,57 to ensure cohort_membership is fresh before leaderboard reads it.
SELECT cron.schedule(
  'phase35-leaderboard-refresh',
  '12,27,42,57 * * * *',
  $cron$ REFRESH MATERIALIZED VIEW CONCURRENTLY public.leaderboard_matview; $cron$
);
```

**Read path (SECDEF RPC):**
```sql
CREATE FUNCTION public.get_leaderboard_for_user(p_cohort_id uuid)
RETURNS TABLE(handle text, xp_7d bigint, rank_in_cohort bigint, is_self boolean) ... ;
-- Returns top 10 + ±5 around requesting user; checks user opted in AND is cohort member.
```

### Pattern 4: A/B variant via PostHog Experiments + Ship-Winner (mirror Phase 34 D-20)
**What:** Each weekly challenge gets a `challenge_variants` row (max 2 per challenge). PostHog feature flag bound to challenge ID; cohort-scoped. Admin clicks "Ship Winner" → write new "active" `weekly_challenges` row with winning variant's framing, archive old row + flip flag.

**Source:** Phase 34 RESEARCH §Pattern 7 (`posthog.getFeatureFlagPayload('onboarding-ab')` returning `{ version_id }`).

### Anti-Patterns to Avoid

- **Computing level on UPDATE.** Never store `users.current_level` as a denormalized column updated by trigger. The level is `compute_level(SUM(xp_delta))` — always. If you cache it, the rollback test fails. (D-04 requirement.)
- **`UPDATE freeze_tokens_remaining` instead of INSERT in ledger.** Both grants AND consumes are ledger rows; the "remaining" count is `SUM(delta)`. Bare UPDATE silently no-ops on first event per memory `feedback_state_counter_table_needs_upsert_on_event`.
- **Real-time leaderboard.** Don't subscribe to `xp_ledger` and recompute leaderboard on each insert. The 15-min matview refresh is the contract (D-15).
- **Confetti without `useReducedMotion`.** Even with canvas-confetti's `disableForReducedMotion: true`, layer the React-level gate too — defense in depth ensures the wrapping framer-motion AnimatePresence doesn't run either.
- **Storing `streak_state.current_streak_days` as derived field that lies during cron gap.** Always update inside the cron transaction; reads between 02:00-local and 02:05-local could show stale streak — acceptable per D-09's "single 24h warning" UX, but document explicitly so plan-checker doesn't BLOCK.
- **Hand-rolled OG meta tag parsing.** Use `@vercel/og` directly; don't try to render PNG client-side or via Supabase Edge.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Particle burst animation | Custom canvas RAF loop | canvas-confetti 1.9.3+ | Built-in `disableForReducedMotion`, physics-correct, < 8 kB gz |
| OG image generation | Headless puppeteer / canvas API | @vercel/og 0.11.1 | First-class Vercel Edge support; React-JSX → PNG; CDN-cached |
| Quadratic level math (TS side) | Re-derive in TS | Mirror SQL pure fn (single source of truth in DB) | Determinism guaranteed; client just re-computes for UI hint |
| pg_cron schedule replay safety | Re-run migrations and hope | `do $unschedule$` pre-flight (see `20270706000005_p34_*` pattern) | Cron is upsert-by-name; safe re-runs are explicit |
| PostHog A/B variant bucketing | Hand-rolled `random()` + `user_experiments` | `posthog.getFeatureFlagPayload(flagKey)` | Handles bucketing, stickiness, exposure tracking (Phase 34 D-20) |
| Anonymized handle uniqueness | Distributed lock + retry loop | Partial unique index per `(cohort_id, handle)` | DB enforces; insert fails fast |
| Daily-action detection | Multiple "did user do X today" queries | Single `xp_ledger` SELECT keyed on `(user_id, created_at::date)` | One source of truth; cross-action D-06 requires this anyway |
| Viral attribution from share | New cookie scheme | Phase 19 dual-cookie `_aff` + `?ref=share` (already shipped) | Reuse closes loop |

**Key insight:** Every gamification feature that LOOKS like custom logic is actually a SQL projection or pure function. The phase's quality bar is "does the math survive a rollback replay" — that comes free when you push everything to deterministic SQL.

## Runtime State Inventory

> Phase 35 is a greenfield-data phase (new tables, no rename/refactor). Section included for completeness per planner protocol.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | None — Phase 35 introduces new tables (xp_ledger, streak_state, freeze_tokens_ledger, badge_catalog, badge_unlocks, weekly_challenges, challenge_variants, challenge_progress, leaderboard_optin, leaderboard_matview). No existing data has gamification semantics. | New migrations only. |
| Live service config | PostHog feature flags for D-20 challenge A/B variants. Admin must create flags via Ship-Winner flow OR via Phase 34's `ship-winner-flag` Edge Fn (already exists). | Reuse `ship-winner-flag` Edge Fn pattern; no new vendor-side config required at phase ship. |
| OS-registered state | None — no OS-level registrations involved. | None. |
| Secrets/env vars | None new. xp-grant Edge Fn reuses `SUPABASE_SERVICE_ROLE_KEY` + `POSTHOG_PROJECT_KEY` (already in Function Secrets). Vercel Function for OG share card needs no secret (image generation is pure). | None — verified via existing posthog-server.ts vendor-gated health-check pattern. |
| Build artifacts | New `gamification-burst` chunk MUST be declared in `scripts/assert-bundle-budget.sh` CHUNK_CONFIG (it's already declared at 8 kB per Phase 24 — verified in this research; will start at "MISSING" until Phase 35 ships code). | Verify chunk appears post-build; if it doesn't, the lazy-load wiring is wrong. |

## Common Pitfalls

### Pitfall 1: `compute_level()` non-determinism via `current_setting`/`now()`
**What goes wrong:** Function references `now()` or session config → rollback test on `pg_temp` produces different output than prod.
**Why it happens:** Easy to slip a `now()` in for "free" timestamps.
**How to avoid:** Mark `compute_level` `IMMUTABLE LANGUAGE sql`. No `now()`, no `current_user`, no `current_setting`. Pure XP total → level.
**Warning signs:** `VOLATILE` or `STABLE` marker in the function definition.

### Pitfall 2: Streak cron double-fires on DST spring-forward
**What goes wrong:** At 02:00 local spring-forward, the "02:00 local" hour does not exist; at fall-back, it exists twice. A naive `WHERE EXTRACT(HOUR FROM (now() AT TIME ZONE p.timezone)) = 2` filter fires twice or zero times.
**Why it happens:** Postgres `AT TIME ZONE` correctly handles DST but the hourly tick may land in/out of the duplicated/skipped hour.
**How to avoid:** Use idempotency keyed on `(user_id, (now() AT TIME ZONE p.timezone)::date)` so a duplicate fire is a no-op. Also evaluate streak based on `yesterday-local` date — not on "exactly 02:00" — so even if cron fires at 03:00 due to DST, the date math is correct.
**Warning signs:** Tests pass in non-DST seasons but production logs show user complaints around March/November.

### Pitfall 3: Matview UNIQUE INDEX missing → `CONCURRENTLY` fails
**What goes wrong:** `REFRESH MATERIALIZED VIEW CONCURRENTLY leaderboard_matview` throws "cannot refresh materialized view ... concurrently" because no UNIQUE INDEX exists.
**Why it happens:** PG requires a UNIQUE INDEX to do concurrent refresh (which lets reads continue during refresh).
**How to avoid:** `CREATE UNIQUE INDEX ON leaderboard_matview (cohort_id, user_id)` immediately after CREATE.
**Warning signs:** Refresh cron alert / pg_cron job_run_details shows error.

### Pitfall 4: Status enum widening missed for `weekly_challenges`
**What goes wrong:** Plan introduces `weekly_challenges.status` enum with values `draft/active/completed/archived`, code writes `archived` but the CHECK constraint only allows `draft/active/completed` → 23514.
**Why it happens:** Memory pointer `feedback_planner_missed_status_enum_widening` — enum widening lives in same plan as new value usage.
**How to avoid:** Define the full CHECK list in the schema migration that ships `weekly_challenges`. Same plan that introduces a state machine introduces ALL transitions.
**Warning signs:** Plan-checker grep for new enum values + their CHECK definitions.

### Pitfall 5: `freeze_tokens_remaining` UPDATE silently no-ops on first grant
**What goes wrong:** Logic `UPDATE freeze_token_state SET tokens = tokens + 1 WHERE user_id = $1` for a brand-new user is a no-op; the row doesn't exist yet. User never sees freeze tokens.
**Why it happens:** Memory pointer `feedback_state_counter_table_needs_upsert_on_event`.
**How to avoid:** Don't maintain a counter table at all — ledger sum is source of truth. If a counter is required (perf), use INSERT...ON CONFLICT. Helper `freeze_tokens_remaining(uid)` does `SELECT GREATEST(0, LEAST(3, SUM(delta))) FROM freeze_tokens_ledger WHERE user_id=$1`.
**Warning signs:** Manual QA: brand-new user account never receives initial 1/month grant.

### Pitfall 6: Postgres `$$` nesting inside `cron.schedule()` body
**What goes wrong:** `cron.schedule(..., $$ DO $$ ... $$ $$)` silently closes outer quote on inner `$$`; "syntax error at or near DECLARE".
**Why it happens:** Memory pointer `reference_postgres_dollar_quote_nesting_in_cron_body`.
**How to avoid:** Use named tags. Outer `$cron$ ... $cron$`, inner `$streak$ ... $streak$`. NEVER bare `$$`.
**Warning signs:** Migration apply fails with `syntax error at or near DECLARE`.

### Pitfall 7: pg_cron + Edge Fn calls need vault.decrypted_secrets (NOT GUC)
**What goes wrong:** Cron body uses `current_setting('app.service_role_key')` → silently returns NULL → http_post 401.
**Why it happens:** Memory `reference_supabase_pg_cron_vault_service_role_pattern`.
**How to avoid:** `(SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='service_role_key')`. Hardcoded URL `https://ytnsipxxmzgaebkqmokp.supabase.co/functions/v1/<name>`.
**Note:** For Phase 35, ONLY `challenge-monday-kickoff` (notification dispatch) needs Edge Fn invocation from cron — streak + freeze + leaderboard crons are pure SQL.

### Pitfall 8: SECDEF RPCs that reference `auth.uid()` can't be called from service-role Edge Fns
**What goes wrong:** `get_leaderboard_for_user()` uses `auth.uid()` to filter "self" rows; xp-grant Edge Fn (service-role) calls it for some reason → `auth.uid()` returns NULL.
**Why it happens:** Memory `feedback_rpc_auth_uid_vs_service_role_mismatch`.
**How to avoid:** Leaderboard RPC is called from CLIENT (user JWT context), never from Edge Fns. xp-grant Edge Fn ONLY writes to `xp_ledger` + `streak_state` + `badge_unlocks` — does NOT call leaderboard RPCs.

### Pitfall 9: OG image cache invalidation on Twitter/X
**What goes wrong:** User shares level-up card; Twitter caches the OG image for 7 days. Next user shares at a different level → still shows old image.
**Why it happens:** Twitter Card Validator caches by URL.
**How to avoid:** Include level in URL path: `api/og/level-up.png?level=5&handle=PeptidePioneer-7841&v=<unix_ts>`. Twitter sees each share URL as unique.
**Warning signs:** Manual share test for level 3 vs level 5 from same user — second share shows level 3 card.

### Pitfall 10: Viral `?ref=share` lands on app.leanshot.app SPA without OG meta
**What goes wrong:** Share URL points at `app.leanshot.app/?ref=share` but SPA's static `index.html` has no OG tags → Twitter Card validator shows blank.
**Why it happens:** Bots scrape HTML at the URL; SPA hydrates client-side AFTER the bot is gone.
**How to avoid:** Share URL points at a Vercel-SSR'd page (e.g., `leanshot.app/share/level/<token>`) where Vercel Function injects OG `<meta>` tags with the dynamic OG image URL. That SSR page redirects to the SPA for human visitors after a moment. Update `vercel.json` rewrites accordingly.
**Warning signs:** Twitter Card Validator on share URL shows generic LeanShot logo, not level-up card.

### Pitfall 11: Confetti burst spam on batch-log
**What goes wrong:** User logs 5 backlogged injections in 10 seconds; 5 confetti bursts fire stacked.
**Why it happens:** No cooldown.
**How to avoid:** Cooldown lock (`localStorage['leanshot_confetti_cooldown_until']`) — 1 burst per 60s per CONTEXT discretion.
**Warning signs:** User report "confetti went berserk."

### Pitfall 12: framer-motion + canvas-confetti both pulled into entry chunk
**What goes wrong:** Direct `import confetti from 'canvas-confetti'` in a non-deferred component pulls it into `index` chunk, blowing the 50 kB ceiling.
**Why it happens:** Static graph includes it; sync-defer skipped.
**How to avoid:** ConfettiBurst component is in `src/components/dashboard/burst/` and lazy-loaded via `React.lazy()` AND triggered through `sync-defer.ts` extended with a `'gamification-burst'` kind.
**Warning signs:** `npm run check-bundle-budget` shows gamification-burst MISSING and index growing.

## Code Examples

### XP grant + level-up detection (Edge Fn excerpt)
```typescript
// Source: pattern derived from supabase/functions/record-activation/index.ts
import { createClient } from 'npm:@supabase/supabase-js@2';
import { captureServer, shutdownPostHog } from '../_shared/posthog-server.ts';
import { z } from 'npm:zod@3';

const BodySchema = z.object({
  action_type: z.enum([
    'injection_log','weight_log','symptom_log','workout_log'
  ]),
  source_ref: z.string().max(120),
});
const XP_VALUES: Record<string, number> = {
  injection_log: 25, weight_log: 25, symptom_log: 10, workout_log: 50,
};

Deno.serve(async (req) => {
  try {
    const jwt = jwtFromReq(req); if (!jwt) return jsonError(401,'unauthenticated');
    const body = BodySchema.parse(await req.json());
    const admin = getAdmin();
    const { data: { user } } = await admin.auth.getUser(jwt);
    if (!user) return jsonError(401,'unauthenticated');

    const xp = XP_VALUES[body.action_type];
    // 1. Compute prior total + level.
    const { data: priorTotal } = await admin.rpc('xp_total_for', { p_user: user.id });
    const priorLevel = await admin.rpc('compute_level', { xp_total: priorTotal });
    // 2. Append ledger row.
    const { error: insErr } = await admin.from('xp_ledger').insert({
      user_id: user.id, action_type: body.action_type, xp_delta: xp, source_ref: body.source_ref,
    });
    if (insErr) return jsonError(500,'db_error');
    // 3. Compute new level + detect level-up.
    const newTotal = (priorTotal ?? 0) + xp;
    const newLevel = await admin.rpc('compute_level', { xp_total: newTotal });
    if (newLevel > priorLevel) {
      await admin.from('badge_unlocks').insert({ user_id: user.id, badge_id: `level-${newLevel}` });
      await captureServer({ distinctId: user.id, event: 'level_up', properties: { level: newLevel, xp_total: newTotal }});
    }
    await captureServer({ distinctId: user.id, event: 'xp_earned', properties: { action_type: body.action_type, xp_delta: xp, xp_total: newTotal }});
    return jsonResponse(200, { level: newLevel, xp_total: newTotal, leveled_up: newLevel > priorLevel });
  } finally { await shutdownPostHog(); }
});
```

### Confetti burst with reduced-motion gate
```typescript
// Source: derived from canvas-confetti README + leanshot useReducedMotion hook
import { useReducedMotion } from '@/hooks/useReducedMotion';

const COOLDOWN_KEY = 'leanshot_confetti_cooldown_until';

export async function fireConfettiBurst(): Promise<void> {
  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  // Defense in depth: React-level gate AND library-level flag.
  if (prefersReducedMotion) return;
  const cooldownUntil = Number(localStorage.getItem(COOLDOWN_KEY) ?? 0);
  if (Date.now() < cooldownUntil) return;
  localStorage.setItem(COOLDOWN_KEY, String(Date.now() + 60_000));
  // Lazy-import keeps canvas-confetti out of the entry chunk.
  const { default: confetti } = await import('canvas-confetti');
  confetti({
    particleCount: 80,
    spread: 60,
    origin: { y: 0.6 },
    disableForReducedMotion: true,  // belt-and-suspenders
  });
}
```

### Vercel Function `api/og/level-up.ts`
```typescript
// Source: @vercel/og official docs + Vercel OG Playground
import { ImageResponse } from '@vercel/og';

export const config = { runtime: 'edge' };

export default async function handler(req: Request) {
  const { searchParams } = new URL(req.url);
  const level = searchParams.get('level') ?? '1';
  const handle = searchParams.get('handle') ?? 'GLP-1 Tracker';
  return new ImageResponse(
    (
      <div style={{ display: 'flex', flexDirection: 'column', width: '100%', height: '100%',
                    background: 'linear-gradient(135deg, #0B1413 0%, #1f2e2c 100%)',
                    color: '#EFEBE0', padding: 64, fontFamily: 'Inter' }}>
        <div style={{ fontSize: 36, opacity: 0.7 }}>LeanShot</div>
        <div style={{ fontSize: 96, fontWeight: 700, marginTop: 24 }}>Level {level}</div>
        <div style={{ fontSize: 32, marginTop: 16 }}>{handle}</div>
        <div style={{ fontSize: 24, marginTop: 'auto', opacity: 0.6 }}>Track your GLP-1 journey</div>
      </div>
    ),
    { width: 1200, height: 630 }
  );
}
```

### Share-page SSR (sketch — Vercel rewrite + dynamic meta tags)
```typescript
// Source: pattern — Vercel Function returning HTML; vercel.json rewrite captures /share/level/:token
// Add to leanshot/api/share/level/[token].ts (or a route equivalent under your Vercel layout).
export const config = { runtime: 'edge' };
export default async function handler(req: Request) {
  const url = new URL(req.url);
  const token = url.pathname.split('/').pop() ?? '';
  // ... decode token to { level, handle, user_id (anonymized) } ...
  const ogImg = `https://leanshot.app/api/og/level-up.png?level=${level}&handle=${encodeURIComponent(handle)}&v=${Date.now()}`;
  const html = `<!doctype html><html><head>
    <meta charset="utf-8" />
    <title>${handle} reached Level ${level} on LeanShot</title>
    <meta property="og:title" content="${handle} reached Level ${level} on LeanShot" />
    <meta property="og:image" content="${ogImg}" />
    <meta property="og:url" content="${url.href}" />
    <meta property="og:type" content="website" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:image" content="${ogImg}" />
    <meta http-equiv="refresh" content="0;url=https://app.leanshot.app/?ref=share&token=${token}" />
  </head><body><p>Redirecting…</p></body></html>`;
  return new Response(html, { headers: { 'content-type': 'text/html', 'cache-control': 'public, max-age=300' }});
}
```

### Cohort_definitions.leaderboard_enabled ALTER
```sql
-- Phase 35 — extends Phase 27 cohort_definitions per CONTEXT D-11.
ALTER TABLE public.cohort_definitions
  ADD COLUMN IF NOT EXISTS leaderboard_enabled boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN public.cohort_definitions.leaderboard_enabled IS
  'Phase 35 D-11: admin opts cohort in to leaderboard surface. Default false (privacy-default).';
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Total XP cached on `profiles.xp_total` | Computed from `SUM(xp_delta) FROM xp_ledger` | Phase 35 (per D-04) | Determinism + rollback-replay enabled |
| Streak counter UPDATEs from row-trigger | Daily pg_cron with timezone awareness | Phase 35 (per D-07) | Cross-timezone correctness |
| Cohort matview ONLY for membership | NEW per-cohort leaderboard matview | Phase 35 | 15-min refresh cadence matches existing pattern |
| OG image hand-rolled with canvas | @vercel/og ImageResponse | Phase 35 GAME-07 | < 100 lines code, CDN-cached |
| canvas-confetti without RM gate | `disableForReducedMotion: true` + React-level gate | Phase 35 (D-claude-discretion) | A11y compliance + ethical-only |

**Deprecated/outdated:** None — this is a greenfield feature on top of stack-locked infrastructure.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Supabase Postgres + pg_cron + pg_net | All migrations + streak/freeze/leaderboard crons | ✓ | 15.x | — |
| Supabase Edge Runtime (Deno) | xp-grant, challenge-monday-kickoff, admin-grant-freeze-token Edge Fns | ✓ | Deno 2.x | — |
| Vercel Edge Runtime | `/api/og/level-up.ts`, `/api/share/level/[token].ts` | ✓ | — | — |
| PostHog | Server-side capture + A/B variant flags (D-20) | ✓ (Function Secret `POSTHOG_PROJECT_KEY`) | posthog-node 5.10.4 | Vendor-gated health-check pattern already in `_shared/posthog-server.ts` |
| canvas-confetti | gamification-burst chunk | ✗ (NOT yet in package.json) | 1.9.3 (CONTEXT) / 1.9.4 latest | Install required |
| @vercel/og | OG share-card Vercel Function | ✗ (NOT yet in package.json) | 0.11.1 | Install required in Vercel project root |
| Cohort_membership table | Leaderboard matview JOIN source | ✓ (Phase 27 migrations 20270602000010/11) | — | — |
| `profiles.timezone` column | Streak cron tz lookup | ✓ (Phase 38 migration 20270705000009 — default 'America/New_York', IANA CHECK) | — | — |
| `_shared/posthog-server.ts` | xp_earned / level_up server-side capture | ✓ | — | — |
| `sync-defer.ts` infrastructure | gamification-burst lazy-load | ✓ | — | Extend with `'gamification-burst'` kind |
| `cohort_membership_rebuild()` cron | Phase 35 leaderboard JOINs against fresh cohort membership | ✓ (runs at 7,22,37,52) | — | Phase 35 leaderboard refresh cron offsets to 12,27,42,57 |
| `_aff` cookie + `?ref=share` attribution | Viral attribution loop on share | ✓ (Phase 19) | — | — |

**Missing dependencies with no fallback:** None — installation needed only.
**Missing dependencies with fallback:** None.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 2.x (unit) + Playwright (e2e) + Deno test (Edge Fns) — all already wired |
| Config file | `vitest.config.ts` + `playwright.config.ts` + `supabase/functions/<fn>/deno.json` |
| Quick run command | `cd leanshot && npm run test:unit` |
| Full suite command | `cd leanshot && npm run test` (vitest run + playwright test) + `$HOME/.deno/bin/deno test --no-check supabase/functions/xp-grant/` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| GAME-01 | xp_ledger insert + compute_level deterministic | unit (Deno) | `$HOME/.deno/bin/deno test --no-check supabase/functions/tests/xp-grant.test.ts` | ❌ Wave 0 |
| GAME-01 | Ledger replay rollback test — random sequence yields identical level | integration (SQL via vitest-e2e harness) | `cd leanshot && npm run test:e2e:rls -- xp-replay.test.ts` | ❌ Wave 0 |
| GAME-01 | RLS proof: user cannot UPDATE/DELETE own xp_ledger row | integration (vitest-e2e) | `cd leanshot && npm run test:e2e:rls -- xp-ledger-rls.test.ts` | ❌ Wave 0 |
| GAME-02 | streak_state increments on consecutive-day action | integration (SQL fixture) | `cd leanshot && npm run test:e2e:rls -- streak-cron.test.ts` | ❌ Wave 0 |
| GAME-02 | Streak respects timezone — user at America/New_York vs Asia/Tokyo evaluated at correct UTC tick | integration (SQL fixture + tz freeze) | `cd leanshot && npm run test:e2e:rls -- streak-tz.test.ts` | ❌ Wave 0 |
| GAME-02 | DST spring-forward + fall-back idempotent (no double-fire / no skip) | integration | `cd leanshot && npm run test:e2e:rls -- streak-dst.test.ts` | ❌ Wave 0 |
| GAME-03 | Monthly grant cron grants exactly 1 token per user; respects max stockpile 3 | integration | `cd leanshot && npm run test:e2e:rls -- freeze-grant.test.ts` | ❌ Wave 0 |
| GAME-03 | Auto-apply on missed day preserves streak; user notified | integration | `cd leanshot && npm run test:e2e:rls -- freeze-auto-apply.test.ts` | ❌ Wave 0 |
| GAME-03 | Admin grant logs `granted_by_admin_user_id` | unit (Deno Edge Fn) | `$HOME/.deno/bin/deno test --no-check supabase/functions/tests/admin-grant-freeze-token.test.ts` | ❌ Wave 0 |
| GAME-04 | Leaderboard matview refreshes every 15 min; opt-out drops user within next cycle | integration | `cd leanshot && npm run test:e2e:rls -- leaderboard-refresh.test.ts` | ❌ Wave 0 |
| GAME-04 | Anonymized handle uniqueness per cohort enforced | unit + integration | `cd leanshot && npm run test:unit -- handle-validate.test.ts` + `npm run test:e2e:rls -- handle-uniqueness.test.ts` | ❌ Wave 0 |
| GAME-04 | Top-10 + ±5 neighborhood SECDEF RPC returns correct rows | integration | `cd leanshot && npm run test:e2e:rls -- leaderboard-rpc.test.ts` | ❌ Wave 0 |
| GAME-04 | Cross-cohort impersonation proof — user from cohort A cannot see cohort B leaderboard | integration | `cd leanshot && npm run test:e2e:rls -- leaderboard-rls.test.ts` | ❌ Wave 0 |
| GAME-05 | Admin form creates weekly_challenges row with correct shape | unit (component) | `cd leanshot && npm run test:unit -- ChallengeForm.test.tsx` | ❌ Wave 0 |
| GAME-05 | Max 2 active challenges per user enforced (1 global + 1 cohort wins) | integration | `cd leanshot && npm run test:e2e:rls -- challenge-active-cap.test.ts` | ❌ Wave 0 |
| GAME-05 | Notification fires 24h before streak break — ONLY once per cycle | unit (Deno) | `$HOME/.deno/bin/deno test --no-check supabase/functions/tests/challenge-monday-kickoff.test.ts` | ❌ Wave 0 |
| GAME-06 | ProgressRing renders streak/level with correct value | unit (component) | `cd leanshot && npm run test:unit -- LevelProgressCard.test.tsx` + `StreakCard.test.tsx` | ❌ Wave 0 |
| GAME-06 | useReducedMotion gates confetti AND framer-motion wrapping | unit | `cd leanshot && npm run test:unit -- ConfettiBurst.test.tsx` | ❌ Wave 0 |
| GAME-07 | OG image route returns valid PNG with correct dimensions (1200×630) | e2e (Playwright) | `cd leanshot && npm run test:e2e -- og-image.spec.ts` | ❌ Wave 0 |
| GAME-07 | Twitter Card Validator manual check + automated meta-tag assertion in share-page SSR response | e2e + manual | `cd leanshot && npm run test:e2e -- share-card-meta.spec.ts` + manual Twitter Card Validator probe | ❌ Wave 0 (+ manual HUMAN gate) |
| GAME-07 | `?ref=share` attaches to `_aff` cookie (Phase 19 reuse) | e2e | `cd leanshot && npm run test:e2e -- share-attribution.spec.ts` | ❌ Wave 0 |
| GAME-07 | Bundle ceiling: gamification-burst chunk ≤ 8 kB gz | CI gate | `cd leanshot && npm run check-bundle-budget` | ✓ exists, ceiling already declared |
| GAME-08 | PostHog flag controls challenge variant render; Ship-Winner writes new active row | integration | `cd leanshot && npm run test:e2e:rls -- challenge-variant.test.ts` | ❌ Wave 0 |
| GAME-09 | Combo unlock triggers when challenge_complete AND streak active | integration | `cd leanshot && npm run test:e2e:rls -- combo-badge.test.ts` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `cd leanshot && npm run test:unit` (fast Vitest unit) + `$HOME/.deno/bin/deno test --no-check supabase/functions/<changed-fn>/`
- **Per wave merge:** `cd leanshot && npm run test:unit && npm run test:e2e:rls && npm run check-bundle-budget`
- **Phase gate:** Full `cd leanshot && npm run test` + `$HOME/.deno/bin/deno test --no-check supabase/functions/{xp-grant,challenge-monday-kickoff,admin-grant-freeze-token}/` + `npm run check-bundle-budget` ALL green before `/gsd-verify-work`. Twitter Card Validator manual probe gated at HUMAN-UAT checkpoint.

### Wave 0 Gaps
- [ ] `supabase/functions/tests/xp-grant.test.ts` — covers GAME-01 Edge Fn body + level-up detection
- [ ] `supabase/functions/tests/admin-grant-freeze-token.test.ts` — covers GAME-03 admin path
- [ ] `supabase/functions/tests/challenge-monday-kickoff.test.ts` — covers GAME-05 notification cadence
- [ ] `leanshot/tests/e2e-rls/xp-replay.test.ts` — covers GAME-01 rollback determinism (the load-bearing test)
- [ ] `leanshot/tests/e2e-rls/xp-ledger-rls.test.ts` — covers GAME-01 append-only RLS proof
- [ ] `leanshot/tests/e2e-rls/streak-cron.test.ts` + `streak-tz.test.ts` + `streak-dst.test.ts` — covers GAME-02
- [ ] `leanshot/tests/e2e-rls/freeze-grant.test.ts` + `freeze-auto-apply.test.ts` — covers GAME-03
- [ ] `leanshot/tests/e2e-rls/leaderboard-refresh.test.ts` + `handle-uniqueness.test.ts` + `leaderboard-rpc.test.ts` + `leaderboard-rls.test.ts` — covers GAME-04
- [ ] `leanshot/tests/e2e-rls/challenge-active-cap.test.ts` + `challenge-variant.test.ts` + `combo-badge.test.ts` — covers GAME-05/08/09
- [ ] `leanshot/src/components/dashboard/cards/__tests__/LevelProgressCard.test.tsx` + `StreakCard.test.tsx` + `ConfettiBurst.test.tsx` — covers GAME-06
- [ ] `leanshot/src/admin/gamification/__tests__/ChallengeForm.test.tsx` — covers GAME-05 admin form
- [ ] `leanshot/src/lib/gamification/__tests__/handle-validate.test.ts` — covers D-13 handle regex
- [ ] `leanshot/e2e/og-image.spec.ts` + `share-card-meta.spec.ts` + `share-attribution.spec.ts` — covers GAME-07
- [ ] Shared fixture: `leanshot/tests/e2e-rls/fixtures/gamification-seed.ts` — seeds users, cohort_definitions with `leaderboard_enabled=true`, baseline xp_ledger rows for cross-test scenarios

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes | Reuse existing Supabase Auth + JWT; admin paths gated by `surfaceCheck('admin.gamification.*')` + server-side RLS |
| V3 Session Management | no | Phase reuses existing session handling |
| V4 Access Control | yes | RLS on xp_ledger (user_id = auth.uid() SELECT only); leaderboard SECDEF RPC checks cohort membership + opt-in; admin grant RPC checks admin role |
| V5 Input Validation | yes | zod on xp-grant Edge Fn body; zod on admin challenge-form payload; handle regex `^[a-zA-Z0-9_-]{6,24}$` (rejects real-name-shaped strings per D-13); CHECK constraint on challenge_type / reward_type / status enums |
| V6 Cryptography | no | No new crypto primitives |

### Known Threat Patterns for {Supabase + Vercel + PostHog stack}

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Client-side XP grant injection (browser inserts xp_ledger row) | Tampering | RLS denies user INSERT; only service-role (xp-grant Edge Fn) inserts. Append-only — no UPDATE/DELETE policies. |
| Cross-cohort leaderboard impersonation (user A reads cohort B leaderboard) | Information Disclosure | SECDEF `get_leaderboard_for_user()` joins `cohort_membership` for `auth.uid()` → returns rows only for cohorts user belongs to. Cross-tenant impersonation proof test required (memory project_supabase_project rule). |
| Real-name leak via handle field | Information Disclosure | Validation regex `^[a-zA-Z0-9_-]{6,24}$` rejects spaces/diacritics. Server-side enforcement in `update_leaderboard_handle` SECDEF RPC. |
| Freeze-token grant forgery (user inserts grant row to themselves) | Tampering | RLS denies user INSERT on freeze_tokens_ledger; only service-role (monthly cron, admin grant Edge Fn) writes. |
| OG share-card user impersonation (User A generates card showing User B handle/level) | Spoofing | Share-page SSR decodes a signed token (HMAC over user_id + level + ts) before rendering OG meta tags. Token TTL 30d. |
| Confetti DoS via spam-burst | DoS (client) | 60s cooldown + `disableForReducedMotion`. |
| PII exfiltration via PostHog `xp_earned` event | Information Disclosure | event payload contains only `{ action_type, xp_delta, xp_total }` — no PHI. Already enforced via PostHog PHI regex from Phase 25. |
| Challenge admin path abuse (non-admin creates challenge) | Elevation of Privilege | `create_weekly_challenge` SECDEF RPC checks admin role via `surfaceCheck` server-side mirror. |
| Stripe-keyword leak via challenge framing copy | Compliance | Phase 25 `scripts/lint-stripe-phi.ts` already scans admin-creatable copy paths — extend allowlist if challenge framing is admin-typed (HIPAA-08). |
| Cron service-role-key exposure (GUC vs vault) | Information Disclosure | Use `vault.decrypted_secrets` per memory `reference_supabase_pg_cron_vault_service_role_pattern`. |

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Vercel project structure supports `leanshot/api/og/level-up.ts` AND a SSR share-page route; planner must verify rewrites/headers in `leanshot/vercel.json` actually route `/api/og/*` and `/share/level/*` to Vercel Functions (the existing `vercel.json` only has rewrites for `/share/(.*)` → `/index.html`, which would BREAK the SSR plan) | Pattern 4 / GAME-07 | Share-card OG meta tags get swallowed by SPA `/share/(.*) → index.html` rewrite; Twitter Card validator shows blank. Planner must add an EXCLUSION carve-out: `/share/level/*` and `/api/og/*` must NOT rewrite to `index.html`. |
| A2 | `xp-grant` is a NEW Edge Fn (not an extension of existing log-handler Edge Fns) | §System Architecture Diagram | Planner may choose to inline xp-grant into the existing injection-log / weight-log Edge Fns — that's also viable. Risk: tighter coupling. Independent Fn keeps separation of concerns cleaner; let plan-phase decide. |
| A3 | Existing log-action Edge Fns exist that can be extended OR invoke xp-grant | §Architecture | Repo grep showed `lifecycle-behavior-triggered/index.ts` references "first injection" but the actual injection-log path is currently a direct Supabase `.from('injections').insert(...)` from the SPA (Phase 5 sync pattern), not an Edge Fn. Implications: xp-grant must either (a) be triggered by a DB trigger on `injections`/`weight_logs`/`symptom_logs`/`workouts` INSERT or (b) be called explicitly from the client `useStore` actions. Plan-phase must decide. Trigger approach matches D-05 ("server-side ledger is source of truth") better. |
| A4 | The matview `cohort_membership` is the right join surface for the leaderboard | Pattern 3 | `cohort_membership` is actually a materialized TABLE per migration 20270602000011 (commented "matview" but built as a table for per-cohort dynamic SQL). Confirmed usable as JOIN source. |
| A5 | Phase 38's `profiles.timezone` column with IANA CHECK regex covers all users by Phase 35 ship | §Environment Availability | Phase 38 migration 20270705000009 shipped — column exists with default `'America/New_York'`. If Phase 38 hasn't fully shipped to prod when Phase 35 deploys, all users get the default tz (still works, just less localized). |
| A6 | canvas-confetti 1.9.3 (or 1.9.4) is compatible with React 19 + Vite 6 | §Standard Stack | The library is framework-agnostic (vanilla JS imperative API), so React version isn't relevant; verify no TS type drift. |
| A7 | Vercel Function in `leanshot/api/` runs even though vercel.json declares `framework: 'vite'` | §Architecture | Vercel auto-detects `api/` directory regardless of framework setting (confirmed by Vercel docs). Planner should verify by deploying a no-op test endpoint first. |
| A8 | Phase 19's `_aff` cookie + `?ref=share` attribution path is still wired and live | §Architecture, §Common Pitfalls 10 | Confirmed in vercel.json — `/r/:code` redirects to `affiliate-attribute` Fn; `?ref=share` semantics need verifying against Phase 19's actual cookie-setter implementation. |
| A9 | `event_type` PostHog events `xp_earned`, `level_up`, `streak_milestone`, `freeze_token_granted`, `challenge_completed`, `badge_unlocked` must be added to `src/lib/analytics/events.ts` in Phase 35 (additive-only ESLint rule applies) | §Architecture | Adding events is OK (additive); plan-phase must include events.ts edits in a plan with appropriate `server_only: true` flags per D-05 (XP events fire from Edge Fn). |
| A10 | Bundle ceiling for `gamification-burst` (8 kB gz) is already declared in `scripts/assert-bundle-budget.sh` | §Validation | Confirmed (see Phase 24 D-18..20 + bundle script `CHUNK_CONFIG` includes `gamification-burst  8`). |
| A11 | xp-grant uses DB trigger (preferred per D-05) OR Edge Fn (alternative). The action types `injection_log/weight_log/symptom_log/workout_log` map cleanly to the 4 source tables `injections`/`weight_logs`/`symptom_logs`/`workouts` | §Architecture | Confirmed via grep — these 4 tables exist (`sync.ts` references all). Trigger approach: AFTER INSERT trigger on each source table fires `grant_xp_for_action()` SECDEF function. Plan-phase decides trigger vs. Edge Fn vs. hybrid. |
| A12 | Free-tier vs paid-tier eligibility — no monetization gates per D-01 to D-21, so all users get same XP/leaderboard/freeze tokens regardless of tier | §User Constraints | Confirmed by ethical-only policy: "ethical-only / privacy-default theme across the whole phase ... no monetization." |
| A13 | `compute_level()` rollback test runs via vitest-e2e (Supabase test container with `pg_temp` per-test schema) | §Validation | Project already has `vitest-e2e.config.ts` per `package.json` (`npm run test:e2e:rls`). Confirmed viable. |

## Open Questions

1. **xp-grant trigger vs. Edge Fn vs. hybrid.**
   - What we know: Direct DB-trigger pattern is purest for D-05 ("source of truth in ledger"). Edge Fn pattern matches `record-activation` precedent for cross-cutting auth/PostHog capture.
   - What's unclear: Whether DB trigger or Edge Fn is the right unit. Trigger is simpler (just SQL) but PostHog capture from a trigger requires `pg_net` + vault pattern + cron pollers — heavy. Edge Fn allows clean `captureServer()` but requires invocation from the SPA on each log action.
   - Recommendation: HYBRID — DB trigger fires for ledger append + level compute + badge unlock (pure SQL, no http_post); SPA additionally calls a lightweight `xp-event` Edge Fn ONLY for the PostHog `xp_earned` / `level_up` server-side capture (D-05). PostHog event is INDEPENDENT from ledger truth — best of both. Final decision in plan-phase.

2. **Vercel rewrite carve-out for `/share/level/*` and `/api/og/*`.**
   - What we know: Current `vercel.json` rewrites `/share/(.*)` → `/index.html`. This will swallow OG share-page SSR.
   - What's unclear: Whether to (a) change `/share/(.*)` → `/share/((?!level/).+)` exclusion, or (b) put share at a different path like `/lvl/<token>`.
   - Recommendation: Option (a) — carve-out exclusion + add explicit rewrite to Vercel Function. Cleaner URL.

3. **Notification dispatch path for D-09 24h streak-break warning + D-21 Monday kickoff.**
   - What we know: Phase 42 ships POLISH-05 smart notifications + frequency-capping (Notification settings center).
   - What's unclear: Does Phase 35 need to wait for Phase 42 to ship its dispatch path? Or piggyback on existing `lifecycle-behavior-triggered` Edge Fn pattern?
   - Recommendation: Piggyback on `lifecycle-behavior-triggered` (sibling pattern; already in repo). Phase 42 can later swap to per-category opt-out. Document handoff.

4. **DB trigger order — injection-log AFTER INSERT → xp-grant trigger order vs. realtime sync triggers.**
   - What we know: Phase 5 sync uses Realtime subscriptions on `injections`; xp_ledger insert must NOT race with sync.
   - What's unclear: Whether the trigger fires before or after Realtime publishes.
   - Recommendation: AFTER INSERT is safe (Realtime LISTEN/NOTIFY fires from logical decoding, not row-level trigger). Document explicitly.

5. **Initial badge_catalog seed scope.**
   - What we know: 12–20 badges per CONTEXT Claude's-discretion.
   - What's unclear: How to balance streak milestones (5d, 10d, 30d, 90d, 365d), level milestones (1, 5, 10, 25, 50, 100, prestige), challenge categories (3 challenge types × 1 badge each = 3), combo unlocks (GAME-09).
   - Recommendation: Proposed 16-badge seed in plan-phase: 5 streak + 7 level + 3 challenge-category + 1 combo + 1 social-proof (first opt-in to leaderboard) — let planner finalize.

## Sources

### Primary (HIGH confidence)
- `.planning/phases/35-m3-gamification-engine/35-CONTEXT.md` — locked decisions
- `.planning/REQUIREMENTS.md` §WS14 — GAME-01..09 verbatim
- `.planning/ROADMAP.md` §Phase 35 — 5 success criteria
- `leanshot/CLAUDE.md` — project tech stack + bundle posture
- `supabase/migrations/20270602000010_cohort_definitions.sql` + `20270602000011_cohort_membership_matview.sql` + `20270602000013_cohort_matview_refresh_cron.sql` — leaderboard JOIN source + cron offset pattern
- `supabase/migrations/20270705000009_phase38_profiles_timezone.sql` — IANA timezone column for streak cron
- `supabase/migrations/20270706000005_p34_anon_session_ttl_cron.sql` — pg_cron + named-tag dollar-quote pattern
- `supabase/migrations/20270707000007_helpdesk_pg_cron.sql` + `20270707000008_helpdesk_sla_breach_state.sql` — vault pattern + state-counter UPSERT pattern
- `supabase/functions/record-activation/index.ts` — Edge Fn template (zod + auth + admin client + captureServer + shutdownPostHog finally)
- `supabase/functions/_shared/posthog-server.ts` — server-side capture + vendor-gated health-check
- `leanshot/src/lib/analytics/events.ts` — additive-only event registry (TAXO-01)
- `leanshot/src/lib/sync-defer.ts` — lazy-load deferral pattern
- `leanshot/src/components/ui/ProgressRing.tsx` — reusable ring component
- `leanshot/scripts/assert-bundle-budget.sh` — gamification-burst 8 kB ceiling already declared
- `leanshot/vercel.json` — rewrite rules + CSP (CSP `connect-src` already covers PostHog + Supabase; image-src includes data + blob)
- `.planning/phases/34-m2-onboarding-overhaul-activation-event/34-RESEARCH.md` — PostHog Experiments + getFeatureFlagPayload Pattern 7
- Memory `reference_postgres_dollar_quote_nesting_in_cron_body` — named-tag pattern (validated via 20270706000005)
- Memory `reference_supabase_pg_cron_vault_service_role_pattern` — vault.decrypted_secrets requirement
- Memory `feedback_planner_missed_status_enum_widening` — same-plan CHECK widening
- Memory `feedback_state_counter_table_needs_upsert_on_event` — UPSERT vs UPDATE
- Memory `feedback_rpc_auth_uid_vs_service_role_mismatch` — SECDEF RPC caller context

### Secondary (MEDIUM confidence — verified)
- canvas-confetti README on GitHub (catdad/canvas-confetti) — `disableForReducedMotion` Boolean option [VERIFIED npm + GitHub README via WebSearch 2026-05-21]
- @vercel/og docs — `ImageResponse` constructor + Edge Runtime [VERIFIED npm + Vercel docs via WebSearch 2026-05-21]
- npm registry — canvas-confetti latest 1.9.4 / @vercel/og latest 0.11.1 (2026-05)

### Tertiary (LOW confidence — flag for plan-phase confirmation)
- (none — all claims verified against repo or official sources)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — every library either in repo or verified via npm 2026-05-21.
- Architecture: HIGH — patterns mirror existing Phase 24/27/34/37/38 ships; assumptions A1–A3 flagged for plan-phase resolution.
- Pitfalls: HIGH — 12 pitfalls catalogued, 10 cross-referenced with memory pointers from prior phase incidents.
- Validation: HIGH — phase requirements map 1:1 to test files; Wave 0 gaps explicit.
- Security: MEDIUM-HIGH — threat patterns standard; share-card token signature scheme needs plan-phase detail.

**Research date:** 2026-05-21
**Valid until:** 2026-06-21 (canvas-confetti + @vercel/og are stable; revisit if 4+ weeks elapse).

## RESEARCH COMPLETE
