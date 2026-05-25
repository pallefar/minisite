---
phase: 51-full-traffic-conversion-tracking-system-unified-dashboard-ut
plan: 01
subsystem: traffic-attribution
tags: [schema, secdef, rls, events-taxonomy, foundation]
status: complete
autonomous: true
completed: 2026-05-24
wave: 1
requires:
  - phase-24/is_admin_at_least
  - phase-30/_is_org_clinician
  - phase-24/events_mirror
  - phase-14/subscriptions
  - phase-26/affiliates+affiliate_conversions
provides:
  - public.user_traffic_attribution
  - public.channel_groups + classify_channel_group()
  - public.referrer_channel_rules + classify_channel_group_with_referrer()
  - public.is_retained(uuid, text, int) SECDEF helper
  - public.upsert_traffic_attribution(...) SECDEF RPC
  - public.claim_traffic_attribution(text, uuid) SECDEF RPC
  - events.ts +4 traffic_* defs
affects:
  - downstream plans 51-02 through 51-10 (all consume the schema)
tech-stack:
  added: []
  patterns: [secdef-search_path, on-conflict-immutable-first-touch, channel-taxonomy-jsonb-matcher]
key-files:
  created:
    - supabase/migrations/20271102000001_user_traffic_attribution.sql
    - supabase/migrations/20271102000002_channel_groups.sql
    - supabase/migrations/20271102000003_referrer_channel_rules_seed.sql
    - supabase/migrations/20271102000004_is_retained_secdef_helper.sql
    - supabase/migrations/20271102000005_upsert_traffic_attribution_rpcs.sql
    - supabase/migrations/20271102000006_traffic_taxonomy_rls.sql
  modified:
    - leanshot/src/lib/analytics/events.ts
key-decisions:
  - "Rename migrations 20270712* → 20271102* to avoid back-dated push block (reference_supabase_back_dated_migration_blocks_push)"
  - "is_retained helper rewritten to use canonical column names (subscriptions.current_period_end; affiliates JOIN affiliate_conversions on invoice_paid_at)"
  - "RLS policies use canonical is_admin_at_least('admin') helper, NOT non-existent is_admin()"
metrics:
  duration: ~18 min
  tasks: 3
  files_created: 6
  files_modified: 1
---

# Phase 51 Plan 01: Traffic Attribution Foundation Summary

> Foundation plan for Phase 51: 6 SQL migrations + REQUIREMENTS.md verification + 4 additive traffic_* event defs. Every downstream plan in this phase consumes this schema.

## Outcome

Schema + classifier + retention helper foundation for the full traffic-attribution layer:

- 12 TRAFFIC-NN REQ-IDs verified present in REQUIREMENTS.md (already inserted at planner-orchestrator time; this task confirmed).
- `user_traffic_attribution` table with first-touch + last-touch column pairs, 3 indexes (anon_id UNIQUE, user_id partial, org_id+last_touch_at partial), RLS enabled.
- `channel_groups` table with 8 seed rows (Paid Search 10 / Paid Social 11 / Email 20 / Affiliate 30 / Organic Search 40 / Organic Social 41 / Referral 50 / Direct 99 default-fallback) + `classify_channel_group()` SQL helper (AND-across-keys, OR-within-key, priority order).
- `referrer_channel_rules` table with **80 seed rows** (25 search engines + 25 social + 15 webmail + 15 referral) sourced from Snowplow `referer-parser` + `classify_channel_group_with_referrer()` wrapper that falls through utm → referrer-host → 'Direct'.
- `is_retained(p_user_id, p_audience, p_window_days)` SECDEF helper with three audience branches (consumer events_mirror activity / clinic-org active subscription / affiliate paid conversion).
- `upsert_traffic_attribution(...)` SECDEF RPC with ON CONFLICT clause that NEVER overwrites first_touch_* columns (D-02 immutability via column exclusion).
- `claim_traffic_attribution(p_anon_id, p_user_id)` SECDEF RPC — idempotent anon→user stitch; only sets user_id on previously-NULL rows.
- 3 RLS policies on `user_traffic_attribution` (admin_all, org_clinician_select, self_user) + admin-only ALL on each of `channel_groups` and `referrer_channel_rules`.
- 4 additive event defs in `events.ts` (`traffic_visit` / `traffic_signup` / `traffic_activation` / `traffic_paid`), all PHI:false, `server_only:true` on visit/activation/paid (per D-13 captureServer ITP/uBlock-resilient path).

## Files Created (6)

| File | Role |
|------|------|
| `supabase/migrations/20271102000001_user_traffic_attribution.sql` | Authoritative table + 3 indexes + RLS-enable |
| `supabase/migrations/20271102000002_channel_groups.sql` | Operator-editable taxonomy + 8 seeds + classify_channel_group fn |
| `supabase/migrations/20271102000003_referrer_channel_rules_seed.sql` | Referrer-domain rules + 80 seeds + wrapper fn |
| `supabase/migrations/20271102000004_is_retained_secdef_helper.sql` | Per-audience retention SECDEF helper |
| `supabase/migrations/20271102000005_upsert_traffic_attribution_rpcs.sql` | UPSERT RPC + claim RPC (both SECDEF, service-role only) |
| `supabase/migrations/20271102000006_traffic_taxonomy_rls.sql` | 5 RLS policies + grant lockdown on 3 surfaces |

## Files Modified (1)

| File | Change |
|------|--------|
| `leanshot/src/lib/analytics/events.ts` | +4 additive event defs (traffic_visit / traffic_signup / traffic_activation / traffic_paid). Additive-only ESLint rule passes (exit 0). |

## Verification Results

| Check | Command | Status |
|-------|---------|--------|
| REQ-IDs present | `grep -c "TRAFFIC-12" leanshot/.planning/REQUIREMENTS.md` | ✓ 1 |
| 12 unchecked TRAFFIC entries | `grep -c "^- \\[ \\] \\*\\*TRAFFIC-" leanshot/.planning/REQUIREMENTS.md` | ✓ 12 |
| 4 Task-2 migrations exist | `ls 20271102000001/02/03/06` | ✓ 4 |
| Task-2 schema markers | `grep create-table + is_default_fallback + seed-domains` | ✓ 1 / 5 / 13 |
| 2 Task-3 migrations exist | `ls 20271102000004/05` | ✓ 2 |
| Task-3 helper + UPSERT markers | `grep is_retained + on-conflict-anon-id` | ✓ 1 / 1 |
| 4 traffic_* event defs | `grep -E traffic_visit\|...` | ✓ 12 matches across name+def references |
| ESLint additive-only | `npx eslint leanshot/src/lib/analytics/events.ts` | ✓ exit 0 |
| TypeScript build | `npx tsc -p tsconfig.app.json --noEmit` | ✓ exit 0 |
| Seed row count | `grep -cE "^  \\('[a-z]" 20271102000003*` | ✓ 80 (target ≥60) |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — Blocking-issue: migration-timestamp drift] Renamed all 6 migrations from `20270712*` → `20271102*`**
- **Found during:** Pre-flight per orchestrator prompt.
- **Issue:** Plan declares timestamps `20270712000001..06`. Latest applied migration on the remote is `20271001000008`; Phase 41 (just shipped) added `20271101000001` + `20271101000002` (Nov 2027). Back-dated migrations are silently rejected at `supabase db push --linked` (see memory `reference_supabase_back_dated_migration_blocks_push`), and Plan 51-10 owns the push step — leaving the old timestamps would block the entire phase from landing.
- **Fix:** All six migrations renamed to `20271102000001..06_*.sql`. File contents unchanged from plan intent; only filenames advanced one day past Phase 41's newest migration. The 14-digit filename regex (`reference_supabase_migration_filename_regex`) is preserved. The new range has zero collisions (`ls supabase/migrations/20271102* 2>/dev/null | wc -l` returned 0 pre-creation).
- **Files modified:** all 6 migration filenames (originally enumerated under `20270712*` in PLAN.md `files_modified` frontmatter).
- **Forward effect:** Downstream Plans 51-02/03/04/09 must follow the same `20271102*` convention for new migrations they ship (and Plan 51-10 must scan the new range in its `supabase db query --linked` smoke).

**2. [Rule 1 — Wrong helper name in plan + reference RLS docstrings] Used canonical `is_admin_at_least('admin'::public.admin_role)` instead of non-existent `public.is_admin()`**
- **Found during:** Task 2 schema-existence preflight before writing the RLS migration.
- **Issue:** PLAN.md `<action>` for migration 06 and `<success_criteria>` both reference `public.is_admin()` — but no migration defines such a function. The canonical admin gate on this codebase is `public.is_admin_at_least(min_role public.admin_role)`, shipped in `supabase/migrations/20270601000027_profiles_admin_role_column.sql`. Several Phase 33 reference migrations also write the docstring "is_admin()" but actually emit `is_admin_at_least('admin'::public.admin_role)` in policy bodies (e.g., `20270703000010_rls_deny_ad_tables.sql`).
- **Fix:** Both `using` and `with check` clauses in all 3 policies in `20271102000006_traffic_taxonomy_rls.sql` emit `public.is_admin_at_least('admin'::public.admin_role)`. Comment block added to the migration header documenting the helper-name resolution.
- **Files modified:** `supabase/migrations/20271102000006_traffic_taxonomy_rls.sql`.
- **Forward effect:** Downstream plans 51-03/04/09 referring to "is_admin()" must use the same canonical form. SECDEF accessor RPCs in 51-03 will need the same correction.

**3. [Rule 1 — Plan-text column drift vs live schema] is_retained() helper uses canonical column names rather than the plan's invented ones**
- **Found during:** Task 3 schema-existence preflight per PLAN.md's own protocol ("if any column name differs from what the helper expects, adjust the helper body to match the live schema; do NOT add new columns to other phases' tables").
- **Issue:** PLAN.md body for `20271102000004_is_retained_secdef_helper.sql` references:
  - `public.subscriptions.is_paid_seat` — **does not exist** anywhere (grep across all migrations returns zero column hits).
  - `public.subscriptions.activated_at` — **does not exist** on `public.subscriptions`; column lives on `public.activation_events` + `public.plan_history`, which are different tables with different semantics.
  - `public.affiliate_referral_conversions` — **table does not exist**. Canonical table on this codebase is `public.affiliate_conversions` (Phase 26).
  - `public.affiliate_referral_conversions.affiliate_user_id` / `.converted_at` — the canonical equivalents are `public.affiliate_conversions.affiliate_id` (FK to `public.affiliates`) and `public.affiliate_conversions.invoice_paid_at`. The affiliate user is reached by JOINing `affiliates.user_id`.
- **Fix:** Helper body rewritten to use the actual canonical columns:
  - **consumer** branch: `events_mirror` JOIN on `user_id = p_user_id OR distinct_id = p_user_id::text` (covers both pre- and post-stitch).
  - **clinic-org** branch: `org_members om JOIN subscriptions s ON s.clinic_id = om.org_id` filtered by `s.status = 'active' AND s.current_period_end >= v_threshold`.
  - **affiliate** branch: `affiliates a JOIN affiliate_conversions ac ON ac.affiliate_id = a.id` filtered by `a.user_id = p_user_id AND ac.status IN ('confirmed','paid') AND ac.invoice_paid_at >= v_threshold`.
- **Files modified:** `supabase/migrations/20271102000004_is_retained_secdef_helper.sql`. Header comment block documents the rename and the live-schema evidence (paths to the canonical migrations).
- **Forward effect:** Downstream Plan 51-03 (`traffic_channel_rollup` matview retention_per_channel CTE) will read these audience semantics. The matview SQL must call `is_retained(user_id, audience, window_days)` with the SAME audience text values used here (`'consumer' | 'clinic-org' | 'affiliate'`) — and must NOT reference the dropped column names.

### Manual Choices Inside Claude's Discretion

- **Referrer-channel seed list — 80 rows exactly.** Plan target was "~80, ≥60". Chose 25 search / 25 social / 15 webmail / 15 referral for a clean four-bucket spread. Snowplow `referer-parser` (Apache-2.0) is cited in the migration header per CONTEXT D-03.
- **Migration 06 grants:** Granted `SELECT` to `authenticated` on all 3 tables even though RLS policy narrows further (admin-only). This mirrors the P30 matview pattern (`20270601300004_p30_matviews_and_cron.sql`) and keeps the matview-refresh service-role path uniform; downstream Plan 51-09 admin CRUD UI consumes the SELECT grant + admin RLS gate jointly.

## Threat Mitigations Implemented

| Threat | Mitigation |
|--------|------------|
| T-51-01 (anon → user_traffic_attribution disclosure) | `revoke all from anon, authenticated` + RLS denies anon by default + SECDEF RPCs are the only write path. |
| T-51-02 (tampering of first_touch_*) | `on conflict (anon_id) do update set` lists ONLY last_touch_* + org_id (coalesce-preserving) + updated_at. first_touch_* columns physically absent from the UPDATE list. |
| T-51-03 (cross-org clinician elevation) | `utat_org_clinician_select` gates on `_is_org_clinician(org_id, auth.uid())`; full deny test ships in Plan 51-10. |
| T-51-04 (taxonomy admin-only) | `channel_groups` + `referrer_channel_rules` policies use `is_admin_at_least('admin')` ONLY; no clinic-owner / no anon. |

## Authentication Gates

None — fully autonomous schema/migration plan. No vendor secrets, no operator interaction required.

## Known Stubs

None. Every file ships its full intended functionality. The Plan does NOT push migrations (Plan 51-10 owns `supabase db push --linked`), which is by design.

## TDD Gate Compliance

N/A — this is a schema-only plan (`tdd:false` in PLAN.md); per the plan's frontmatter the plan-level TDD cycle does not apply. Downstream Plan 51-02 / 51-10 own the test scaffolds per VALIDATION.md Wave 0 map.

## Threat Flags

None new. Phase 51's existing threat register (T-51-01..07) is fully covered by the migrations shipped here; no new attack surface introduced outside the plan's documented boundary.

## Next Plan(s)

- **51-02** (Wave 2): Vercel Edge Middleware (cookie set) + traffic-attribution-recorder Edge Fn + merge-anon-session extension. Consumes `upsert_traffic_attribution` + `claim_traffic_attribution` RPCs shipped here.
- **51-03** (Wave 2): 3 matviews + realtime VIEW + sequenced pg_cron refresh. Consumes `is_retained` + `classify_channel_group_with_referrer` shipped here.
- **51-10** (Wave 5): `supabase db push --linked` BLOCKING step. **Wave 5 must apply migrations 20271102000001..06 in filename-sorted order.**

## Self-Check: PASSED

- ✓ 6 migrations exist at the new `20271102*` timestamps.
- ✓ `leanshot/src/lib/analytics/events.ts` modified with 4 traffic_* defs (file size increased; existing exports preserved).
- ✓ ESLint exit 0 (additive-only rule passes).
- ✓ TypeScript `tsc -p tsconfig.app.json --noEmit` exit 0.
- ✓ Per-task verify blocks all return ≥ expected counts.
- ✓ Single atomic commit will follow per plan `<output>` instruction.
