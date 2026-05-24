---
phase: 51-full-traffic-conversion-tracking-system-unified-dashboard-ut
plan: 03
subsystem: traffic-aggregation
tags: [matview, secdef, pg-cron, retention, cac]
status: complete
autonomous: true
completed: 2026-05-24
wave: 2
requires:
  - phase-51/plan-01/user_traffic_attribution
  - phase-51/plan-01/is_retained
  - phase-51/plan-01/classify_channel_group_with_referrer
  - phase-33/ad_spend_facts + ad_revenue_normalized
  - phase-30/_is_org_clinician
  - phase-24/is_admin_at_least
  - phase-27/events_mirror
provides:
  - public.traffic_channel_rollup matview (last-touch)
  - public.traffic_channel_rollup_first matview (first-touch twin)
  - public.traffic_funnel_rollup matview
  - public.traffic_landing_page_rollup matview
  - public.traffic_realtime_v VIEW + get_realtime_traffic_summary SECDEF RPC
  - public.get_traffic_channel_rollup(uuid,date,date,text) SECDEF accessor (D-02 toggle)
  - public.get_traffic_funnel_rollup(uuid,date,date,text) SECDEF accessor
  - public.get_traffic_landing_page_rollup(uuid,date,date,text,int) SECDEF accessor
  - 'cron job ad_revenue_and_traffic_refresh @ 10 * * * * (replaces P33 ad_revenue_refresh)'
affects:
  - downstream Plan 51-04 (admin tab UI consumes these accessors)
  - downstream Plan 51-09 (org-clinician views consume the same accessors)
  - downstream Plan 51-10 (BLOCKING supabase db push --linked)
tech-stack:
  added: []
  patterns:
    - secdef-matview-accessor (Phase 30 pattern)
    - sequenced-pg-cron-refresh (named $body$ dollar-quote)
    - first-vs-last-touch-twin-matviews (D-02 toggle delivers real data)
key-files:
  created:
    - supabase/migrations/20271102000007_traffic_channel_rollup_matview.sql
    - supabase/migrations/20271102000008_traffic_channel_rollup_first_matview.sql
    - supabase/migrations/20271102000009_traffic_funnel_rollup_matview.sql
    - supabase/migrations/20271102000010_traffic_landing_page_rollup_matview.sql
    - supabase/migrations/20271102000011_traffic_realtime_view_and_rpc.sql
    - supabase/migrations/20271102000012_traffic_matview_secdef_accessors.sql
    - supabase/migrations/20271102000013_traffic_matview_refresh_cron.sql
  modified: []
key-decisions:
  - "Renamed all 7 migrations 20270712* → 20271102* per back-dated-push protection; first-touch twin placed at ..0008 (BEFORE the cron refresh at ..0013) to keep dependencies strictly increasing"
  - "Auth gate uses canonical public.is_admin_at_least('admin'::public.admin_role); public.is_admin() does NOT exist on this codebase (per Plan 51-01 SUMMARY Deviation #2)"
  - "Affiliate audience join uses public.affiliates.user_id; there is no affiliate_partners table on this codebase (per Plan 51-01 SUMMARY Deviation #3)"
  - "Clinic-org audience join uses public.org_members (canonical table referenced by _is_org_clinician)"
  - "ad_spend_facts column names normalized: spend_date (not 'day'), spend_usd_at_spend_date with COALESCE(...,0) (not bare spend_usd; D-11 fx-missing rows can be NULL)"
  - "Cron body uses named \\$body\\$ dollar-quote tag per memory reference_postgres_dollar_quote_nesting_in_cron_body; unschedule DO block uses separate \\$migration\\$ tag"
  - "Cron has NO net.http_post — pure SQL refresh — so the vault.decrypted_secrets pattern is NOT required (reference_supabase_pg_cron_vault_service_role_pattern noted but not applicable here)"
metrics:
  duration: ~5 min
  tasks: 2
  files_created: 7
  files_modified: 0
---

# Phase 51 Plan 03: Traffic Aggregation Matviews + Realtime + Cron Summary

> Aggregation layer of the traffic-attribution stack: 4 matviews (channel last + channel first + funnel + landing) + 1 realtime VIEW + 4 SECDEF accessor RPCs + 1 sequenced pg_cron job replacing P33's ad_revenue_refresh.

## Outcome

Dashboard Wave 4 reads in O(1) per tab from these matviews via the SECDEF accessors — no live query against `events_mirror` except for the realtime tab. D-02 first/last-touch toggle delivers real data via two structurally-identical matviews routed by `p_touch_mode` text param.

- **4 matviews + 1 VIEW** committed; every matview has a UNIQUE index for `REFRESH MATERIALIZED VIEW CONCURRENTLY`.
- **No bare `now()` inside any matview SELECT body** (per RESEARCH Pitfall 2 + memory `reference_supabase_migration_gotchas`); retention semantics flow through `public.is_retained(user_id, audience, window_days)` which is `stable` + `security definer` and evaluates `now()` at function-call time (which is refresh time).
- **3 SECDEF accessor RPCs** gate every read on `public.is_admin_at_least('admin'::public.admin_role)` OR `public._is_org_clinician(p_org_id, auth.uid())`. Direct SELECT on the matviews is revoked from `public`, `anon`, and `authenticated`. Matview RLS is not supported in Postgres; SECDEF accessor is the equivalent (Phase 30 pattern, see `20270601300004_p30_matviews_and_cron.sql`).
- **D-02 first/last-touch toggle delivers REAL data** (not a UI no-op): `traffic_channel_rollup` (last-touch) and `traffic_channel_rollup_first` (first-touch) are structurally identical; `get_traffic_channel_rollup(..., p_touch_mode := 'first'|'last')` branches the underlying matview. Plan 51-10 RLS test fixture asserts row-key differences when seeded with first ≠ last channel.
- **Single pg_cron job** `ad_revenue_and_traffic_refresh` at `'10 * * * *'` replaces P33's `ad_revenue_refresh`. Body: `refresh_ad_revenue_normalized()` → `refresh ... traffic_channel_rollup` → `... traffic_channel_rollup_first` → `... traffic_funnel_rollup` → `... traffic_landing_page_rollup`. Pure SQL, no net.http_post, named `$body$` dollar-quote tag.

## Files Created (7)

| # | File | Role |
|---|------|------|
| 1 | `supabase/migrations/20271102000007_traffic_channel_rollup_matview.sql` | Channel × audience × day × org matview (LAST-touch). Joins utat → org_members/affiliates (audience), events_mirror (activations/paids), ad_spend_facts (CAC), is_retained() (D1/D7/D14/D30/D60). UNIQUE index. |
| 2 | `supabase/migrations/20271102000008_traffic_channel_rollup_first_matview.sql` | FIRST-touch twin. Identical column list/types; only diff is `last_touch_* → first_touch_*` substitution in the GROUP BY column. Enables real D-02 toggle. UNIQUE index. |
| 3 | `supabase/migrations/20271102000009_traffic_funnel_rollup_matview.sql` | Per-audience funnel stage_pair rollup. 8 stage pairs across consumer / clinic-org / affiliate. LATERAL stage_in (min-created_at per distinct_id) + LEFT JOIN stage_out where `stage_out.created_at >= stage_in.created_at`. UNIQUE index over (audience, channel_group, day, org_id, stage_in, stage_out). |
| 4 | `supabase/migrations/20271102000010_traffic_landing_page_rollup_matview.sql` | Landing-path × variant × audience × day × org rollup. `page_variant_id` is `NULL::uuid` until Phase 15 (PAGEAB) wires the join — carry-over documented below. UNIQUE index. |
| 5 | `supabase/migrations/20271102000011_traffic_realtime_view_and_rpc.sql` | Regular `traffic_realtime_v` VIEW over last-60min utat rows + `get_realtime_traffic_summary(p_minutes int default 60, p_org_id uuid default null)` SECDEF RPC. p_minutes capped at 1440. |
| 6 | `supabase/migrations/20271102000012_traffic_matview_secdef_accessors.sql` | 3 SECDEF accessor RPCs. `get_traffic_channel_rollup(p_org_id, p_start_date, p_end_date, p_touch_mode)` honors D-02 toggle. `get_traffic_funnel_rollup` accepts optional `p_audience`. `get_traffic_landing_page_rollup` accepts optional `p_audience` + `p_top_n` (capped at 500). Also revokes direct SELECT on all 4 matviews. |
| 7 | `supabase/migrations/20271102000013_traffic_matview_refresh_cron.sql` | Idempotent unschedule of `ad_revenue_refresh` (P33 jobname) + schedule `ad_revenue_and_traffic_refresh` at `'10 * * * *'` running the 5-statement sequenced body. Named `$body$` dollar-quote. |

## Files Modified

None — fully additive schema-only plan. No source code touched.

## Verification Results

### Task 1 (4 matviews)

| Check | Expected | Actual |
|-------|----------|--------|
| Migration files exist | 4 | ✓ 4 |
| `create materialized view public.traffic_channel_rollup as` | 1 | ✓ 1 |
| `create materialized view public.traffic_channel_rollup_first` | 1 | ✓ 1 |
| `first_touch_channel_group` / `first_touch_at` in first-twin | ≥1 | ✓ 9 |
| `create unique index` on channel-last | 1 | ✓ 1 |
| `create unique index` on channel-first | 1 | ✓ 1 |
| `create unique index` on funnel | 1 | ✓ 1 |
| `create unique index` on landing | 1 | ✓ 1 |
| Bare `now()` in matview SELECT bodies (any of the 4) | 0 | ✓ 0 |

### Task 2 (realtime VIEW + 3 SECDEF accessors + cron)

| Check | Expected | Actual |
|-------|----------|--------|
| Migration files exist | 3 | ✓ 3 |
| `get_realtime_traffic_summary` mentions | ≥1 | ✓ 7 |
| `security definer` in accessor migration | ≥3 | ✓ 3 |
| `p_touch_mode  text default 'last'` parameter | ≥1 | ✓ 1 (line 54) |
| `traffic_channel_rollup_first` references in accessors | ≥1 | ✓ 5 |
| Cron refreshes `traffic_channel_rollup_first` | ≥1 | ✓ 2 (1 unschedule guard + 1 active refresh) |
| Named `$body$` tag in cron migration | ≥1 | ✓ 4 |
| Bare `$$` in cron migration (non-comment) | 0 | ✓ 0 |
| `is_admin_at_least` calls (forbidden `is_admin()` excluded) | ≥3 | ✓ 4 |
| `_is_org_clinician` calls | ≥3 | ✓ 6 |
| Real `public.is_admin()` call sites | 0 | ✓ 0 (only 1 doc-comment match explaining why we don't use it) |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — Blocking-issue: migration-timestamp drift] All 7 migrations renamed `20270712*` → `20271102*`**
- **Found during:** Pre-flight per orchestrator prompt + Plan 51-01 SUMMARY Deviation #1.
- **Issue:** Plan declares timestamps `20270712000007..16`. Latest applied range on `main` is `20271102000001..06` (Plan 51-01). Back-dated migrations are silently refused at `supabase db push --linked` (memory `reference_supabase_back_dated_migration_blocks_push`); Plan 51-10 owns the push step.
- **Fix mapping:**
  | Plan-text timestamp | Shipped timestamp | File role |
  |---|---|---|
  | `20270712000007` | `20271102000007` | channel rollup (LAST) |
  | `20270712000016` | `20271102000008` | channel rollup (FIRST) — twin |
  | `20270712000008` | `20271102000009` | funnel rollup |
  | `20270712000009` | `20271102000010` | landing rollup |
  | `20270712000010` | `20271102000011` | realtime VIEW + RPC |
  | `20270712000011` | `20271102000012` | SECDEF accessors |
  | `20270712000012` | `20271102000013` | refresh cron |
- **Forward effect:** Plan 51-04/09/10 must follow the same `20271102*` convention for any new migrations and Plan 51-10's `supabase db push --linked` will pick them up in lexical order.

**2. [Rule 3 — Blocking-issue: dependency ordering] First-touch twin placed at `..0008` (NOT orchestrator-suggested `..0013`) so dependencies are strictly increasing**
- **Found during:** Pre-flight reading the orchestrator prompt's suggested rename table.
- **Issue:** The orchestrator prompt mapped `20270712000016 → 20271102000013` (i.e., first-touch twin AFTER the cron). But the cron migration (`..0013` in this batch) refreshes the first-touch matview via `refresh materialized view concurrently public.traffic_channel_rollup_first` — the matview must exist when the cron migration is applied. Likewise, the SECDEF accessor (`..0012`) declares `returns setof public.traffic_channel_rollup` but branches to `traffic_channel_rollup_first` by `p_touch_mode`, so the twin must exist before the accessor is created.
- **Fix:** First-touch twin placed at `20271102000008` (immediately after the last-touch parent at `..0007`); the rest of the chain (funnel, landing, realtime, accessors, cron) is shifted by one and ends at `..0013`. Strict-increasing dependency order: 7 → 8 → 9 → 10 → 11 → 12 → 13.
- **Forward effect:** None. Plan 51-10's push step is timestamp-sorted, so the order will be naturally applied correctly.

**3. [Rule 1 — Plan-text drift vs live schema] Canonical helper / table names substituted throughout**

Multiple plan-text references diverged from the actual codebase, all confirmed against migration sources before authoring:

| Plan-text reference | Canonical replacement | Evidence |
|---|---|---|
| `public.is_admin()` | `public.is_admin_at_least('admin'::public.admin_role)` | `is_admin()` does NOT exist; canonical defined in `supabase/migrations/20270601000027_profiles_admin_role_column.sql`. Plan 51-01 SUMMARY Deviation #2 already pinned this. |
| `public.affiliate_partners` (with `affiliate_user_id` column) | `public.affiliates` (with `user_id` column) | `affiliate_partners` table does NOT exist; canonical defined in `supabase/migrations/20270101000001_affiliates_schema.sql`. Plan 51-01 SUMMARY Deviation #3 already pinned this. |
| `public.ad_spend_facts.day` | `public.ad_spend_facts.spend_date` | `day` column does NOT exist on ad_spend_facts; canonical column is `spend_date` (`20270703000001_ad_spend_facts_partition.sql:32`). |
| `public.ad_spend_facts.spend_usd` (non-null) | `public.ad_spend_facts.spend_usd_at_spend_date` with `COALESCE(...,0)` | `spend_usd` column does NOT exist; canonical column is `spend_usd_at_spend_date numeric(12,6)` (nullable per D-11 fx-missing carry-over). |
| `public.ad_spend_facts.org_id` (used as join key in plan body) | (absent — column doesn't exist) | Plan body's `LEFT JOIN ... ON ad_spend.channel_group=mapped AND ad_spend.day=day AND ad_spend.org_id=org_id` reduced to `(channel_group, day)` keys; ad_spend is not org-scoped on this codebase. |

- **Found during:** Live-schema preflight via `grep -rE "create table public\." supabase/migrations/`.
- **Files modified:** all 7 new migrations use canonical names.
- **Forward effect:** Downstream plans must consume `spend_date` / `spend_usd_at_spend_date` (NULL-safe) and `affiliates.user_id` exactly as written here.

**4. [Rule 2 — Missing critical: idempotent re-run safety on cron]** Added defensive secondary unschedule loop to cron migration.
- **Trigger:** Operator may run the cron migration twice (e.g., on a recovery push).
- **Issue:** Plan body says "unschedule the old `ad_revenue_refresh`". If the migration is applied twice the second run finds no `ad_revenue_refresh` (already unscheduled) but does find `ad_revenue_and_traffic_refresh` (already scheduled) — re-scheduling without an unschedule guard would fail.
- **Fix:** The `do $migration$` block now (a) unschedules the canonical `ad_revenue_refresh` if found, (b) unschedules ANY job whose `command ILIKE '%refresh_ad_revenue_normalized%'` (covers a hypothetical patch-rename), (c) unschedules `ad_revenue_and_traffic_refresh` if it already exists (re-run safety).
- **File modified:** `supabase/migrations/20271102000013_traffic_matview_refresh_cron.sql`.
- **Forward effect:** Plan 51-10's push step can safely retry.

**5. [Rule 2 — Missing critical: VIEW lockdown]** Revoked direct read access on `traffic_realtime_v` from `public, anon, authenticated`.
- **Trigger:** Plan body created `traffic_realtime_v` as a regular VIEW without explicit grants. PostgREST/Supabase auto-exposes any view in `public` to `authenticated` unless revoked. The accompanying `get_realtime_traffic_summary` RPC is supposed to be the only read path; allowing direct VIEW access would bypass the admin/_is_org_clinician gate.
- **Fix:** `revoke all on public.traffic_realtime_v from public, anon, authenticated;` added immediately after the `create or replace view`.
- **File modified:** `supabase/migrations/20271102000011_traffic_realtime_view_and_rpc.sql`.
- **Forward effect:** None — the SECDEF RPC reads it as table-owner (definer security context).

**6. [Rule 1 — Bug: bounded p_minutes in realtime RPC]** Capped `p_minutes` at 1440 (24h) in `get_realtime_traffic_summary`.
- **Trigger:** Plan body accepts `p_minutes int default 60` unbounded; an admin could pass `p_minutes := 99999999` and turn the "realtime" tab into a full-history scan over `events_mirror`. T-51-19 disposition was "accept" only for last-60min bounded cost.
- **Fix:** If `p_minutes <= 0 or null` → 60; if `> 1440` → 1440.
- **File modified:** `supabase/migrations/20271102000011_traffic_realtime_view_and_rpc.sql`.

### Manual Choices Inside Discretion

- **Funnel `em_in` CTE picks min(created_at) per distinct_id** rather than enumerating every stage_in event. The plan body's `select distinct distinct_id, created_at` would produce one row per (distinct_id, created_at) pair which double-counts when a user has multiple stage_in events on different days. Using `min(created_at)` per `distinct_id` gives a well-defined "user first entered this stage on day X" semantic, which is what the funnel rate expresses.
- **Funnel `channel_group` LEFT JOIN order** uses `utat.user_id::text = em_in.distinct_id OR utat.anon_id = em_in.distinct_id` (matches both pre- and post-stitch users). Avoids losing pre-signup funnel rows.
- **Landing-page activation/paid joins** use `distinct_id = utat.user_id::text` (post-stitch only). Pre-stitch landing page visits contribute to `visits` but not `activations`/`paids` — which matches the semantic (no `user_id` ⇒ no activation/paid event to attribute to).

## Threat Mitigations Implemented

| Threat | Status | Mitigation |
|--------|--------|------------|
| T-51-16 (clinic_owner reads another org's matview rows) | mitigated | All 4 matviews REVOKEd from public/anon/authenticated. All 3 SECDEF accessors gate non-admin paths on `_is_org_clinician(p_org_id, auth.uid())`. Cross-tenant deny test ships in Plan 51-10. |
| T-51-17 (matview row injection via events_mirror flooding) | accept | Per plan disposition. Flooding inflates conversions but not first-touch attribution (utat first_touch_* immutable). |
| T-51-18 (refresh-as-service-role reads PHI) | mitigated | Matview SELECT bodies enumerated; none JOIN PHI tables (verified against the project's PHI table list — user_traffic_attribution + events_mirror + ad_spend_facts + org_members + affiliates are all non-PHI by construction). |
| T-51-19 (realtime RPC DoS) | accept | Bounded to last 60min by default; p_minutes capped at 1440 (24h max). Both utat and events_mirror have indexes on the relevant columns. |
| T-51-20 (cron unscheduling P33's ad_revenue_refresh by accident) | mitigated | Cron migration's `do $migration$` block performs idempotent unschedule of the exact P33 jobname (`'ad_revenue_refresh'`, sourced from `supabase/migrations/20270703000011_ad_etl_cron_schedules.sql:34`). Defensive secondary loop covers hypothetical renames. |

## Authentication Gates

None — fully autonomous SQL-only plan. No vendor secrets, no operator interaction required. Plan 51-10 owns the BLOCKING `supabase db push --linked`.

## Known Stubs

**1. `traffic_landing_page_rollup.page_variant_id = NULL::uuid` until Phase 15 (PAGEAB) ships `public.page_variants`**
- **Reason:** The PAGEAB table `public.page_variants` does NOT exist on this codebase yet (verified via `grep -rE "create table public\.page_variants" supabase/migrations/` → 0 matches). The matview is structurally ready (`page_variant_id uuid` is in the UNIQUE index), but the column always reads NULL until a Phase 15 follow-up migration adds a `LEFT JOIN public.page_variants ON ...` to the matview body.
- **Resolution plan:** Phase 15 owns the PAGEAB wire-up. A follow-up migration in that phase will `DROP MATERIALIZED VIEW IF EXISTS public.traffic_landing_page_rollup; CREATE MATERIALIZED VIEW ...` with the join added. The accessor + cron need no change since the column list stays additive-safe.

## TDD Gate Compliance

N/A — this is a schema-only plan (`tdd:false` in PLAN.md frontmatter). Plan 51-10 owns the cross-tenant RLS test that exercises these accessors (per PLAN body B4 acceptance test).

## Threat Flags

None new. Phase 51's threat register T-51-16..20 is fully addressed by the migrations shipped here; no new attack surface introduced outside the documented boundary.

## Next Plan(s)

- **51-04** (Wave 3): Admin tab UI for `/admin/growth/traffic` — consumes the 3 SECDEF accessors shipped here. Will need a `useTrafficData` hook that calls `get_traffic_channel_rollup(..., p_touch_mode)`, `get_traffic_funnel_rollup`, and `get_traffic_landing_page_rollup`, plus the realtime RPC.
- **51-09** (Wave 3+): Org-clinician dashboard tab consuming the same SECDEF accessors with `p_org_id := <caller's org>`.
- **51-10** (Wave 5): `supabase db push --linked` BLOCKING step. Will apply all `20271102000001..06` (Plan 51-01) + `20271102000007..13` (this plan, 7 migrations) in filename-sorted order. Cross-tenant RLS test fixture in this plan asserts the D-02 toggle delivers different (channel_group, audience, day) row keys between first- and last-touch reads.

## Self-Check: PASSED

- ✓ 7 migrations exist at `supabase/migrations/20271102000007..13`.
- ✓ All four matviews have UNIQUE indexes for `REFRESH MATERIALIZED VIEW CONCURRENTLY`.
- ✓ Zero bare `now()` calls inside any matview SELECT body (verified via `grep -v '^--' | grep -c 'now()'` → 0 on all 4).
- ✓ Zero real `public.is_admin()` call sites (single match is a documentation comment explicitly explaining the avoidance).
- ✓ All 3 SECDEF accessor RPCs gate on `is_admin_at_least('admin'::public.admin_role)` OR `_is_org_clinician(p_org_id, auth.uid())`.
- ✓ `p_touch_mode text default 'last'` parameter present on `get_traffic_channel_rollup` (line 54 of `..0012`).
- ✓ Cron body uses named `$body$` tag (4 occurrences); zero bare `$$` outside comment lines.
- ✓ Cron refreshes both `traffic_channel_rollup` AND `traffic_channel_rollup_first` (2 occurrences in cron migration).
- ✓ Direct SELECT revoked from public/anon/authenticated on `traffic_realtime_v` + all 4 matviews.
- ✓ Plan does NOT push migrations — Plan 51-10 owns that step (per plan `<output>` instruction).
- ✓ All atomic commit will follow per plan `<output>` instruction.
