---
phase: 51
slug: full-traffic-conversion-tracking-system-unified-dashboard
status: approved
nyquist_compliant: true
wave_0_complete: false
created: 2026-05-21
updated: 2026-05-21
---

# Phase 51 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution. Generated inline per `feedback_validation_md_inline_generation_when_missing` from each plan's `<verify><automated>` blocks + RESEARCH §Validation Architecture.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 4.1.5 (frontend + RLS) + Deno test (Edge Fns, via `$HOME/.deno/bin/deno test --no-check`) + Playwright (none in Phase 51) |
| **Config file** | `leanshot/vitest.config.ts` (existing); per-Fn `supabase/functions/<fn>/deno.json` |
| **Quick run command** | per-task `<verify><automated>` block (see map below) |
| **Full suite command** | `cd leanshot && npm test -- --run` + `$HOME/.deno/bin/deno test --no-check supabase/functions/{traffic-attribution-recorder,merge-anon-session,funnel-anomaly-cron}/` |
| **Estimated runtime** | ~90 seconds full suite |

---

## Sampling Rate

- **After every task commit:** Run the task's `<verify><automated>` block.
- **After every plan wave:** Run the full suite + a `supabase db query --linked` smoke for matview/cron presence (Wave 5 only — migrations don't land until Plan 51-10).
- **Before `/gsd:verify-work`:** Full suite green + Plan 51-10 multi-signal HUMAN-UAT either inline-approved or carry-over documented.
- **Max feedback latency:** ≤60s per task.

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 51-01-01 | 01 | 1 | TRAFFIC-01..12 | — | REQ-IDs registered | grep | `grep -c "TRAFFIC-12" leanshot/.planning/REQUIREMENTS.md` | ✅ | ⬜ pending |
| 51-01-02 | 01 | 1 | TRAFFIC-01, TRAFFIC-04, TRAFFIC-05, TRAFFIC-10 | T-51-01..04 | RLS + ON CONFLICT preserves first-touch; SECDEF gates | sql-static + grep | `ls supabase/migrations/20270712000001..06_*.sql && grep classify_channel_group + create policy` | ✅ | ⬜ pending |
| 51-01-03 | 01 | 1 | TRAFFIC-09, TRAFFIC-01 | T-51-02 | first_touch_* excluded from UPDATE | sql-static + lint | `grep "on conflict (anon_id)" + npm run lint events.ts` | ✅ | ⬜ pending |
| 51-02-01 | 02 | 2 | TRAFFIC-02 | T-51-08, T-51-13 | HttpOnly+Secure+SameSite=Lax cookie; no Domain= | static + middleware unit | `grep lt_anon_id + httpOnly + crypto.randomUUID; absence of Domain=` | ❌ Wave 0 (leanshot/test/middleware-cookie.test.ts) | ⬜ pending |
| 51-02-02 | 02 | 2 | TRAFFIC-01, TRAFFIC-03 | T-51-09..11, T-51-14 | origin-gate + PHI redaction + utm clamp | Deno unit | `$HOME/.deno/bin/deno test --no-check --allow-env --allow-net=localhost supabase/functions/traffic-attribution-recorder/` | ❌ Wave 0 (recorder.test.ts ships in this task) | ⬜ pending |
| 51-02-03 | 02 | 2 | TRAFFIC-03 | T-51-14 | alias + claim invoked under existing try/shutdownPostHog | Deno unit | `grep lt_anon_id + claim_traffic_attribution; deno test merge-anon-session/` | ✅ (merge-anon-session has existing tests) | ⬜ pending |
| 51-02-04 | 02 | 2 | TRAFFIC-01, TRAFFIC-02 | T-51-09 | SPA fires recorder exactly once per mount | vitest | `npx vitest run leanshot/src/lib/traffic/fire-touch.test.ts` | ❌ Wave 0 (added by W5 fix; this task) | ⬜ pending |
| 51-03-01 | 03 | 2 | TRAFFIC-07, TRAFFIC-08 | T-51-16..20 | UNIQUE indexes; no bare `now()` in matview SELECT | sql-static | per-task verify block (3 matview file presence + UNIQUE index grep + `now()` count ≤0) | ✅ | ⬜ pending |
| 51-03-02 | 03 | 2 | TRAFFIC-08, TRAFFIC-09, TRAFFIC-10 | T-51-16, T-51-20 | SECDEF accessors gate is_admin OR _is_org_clinician; cron uses $body$ tag; p_touch_mode toggle | sql-static | per-task verify block (RPC + SECDEF + `$body$` + new `p_touch_mode` param grep) | ✅ | ⬜ pending |
| 51-04-01 | 04 | 3 | TRAFFIC-11 | T-51-21..24 | RPC body avoids auth.uid; widening conditional | sql-static | `grep compute_channel_stage_rate; absent auth.uid()` | ✅ | ⬜ pending |
| 51-04-02 | 04 | 3 | TRAFFIC-11 | T-51-21 | per-channel-stage loop + dedup_key 4h suppression | Deno test (existing) + static | `grep compute_channel_stage_rate; deno test funnel-anomaly-cron/` | ✅ | ⬜ pending |
| 51-05-01 | 05 | 4 | TRAFFIC-12 | T-51-25 | manifest entry + URL-prefix branch | tsc + grep | `grep growth-traffic + TrafficDashboardPage + tsc --noEmit` | ✅ | ⬜ pending |
| 51-05-02 | 05 | 4 | TRAFFIC-12 | T-51-25..27 | 5 sub-tab stubs + typography compliance | tsc + grep | per-task verify block (stub presence + tsc clean + no off-grid `text-[14px]`) | ❌ Wave 0 (this task creates stubs) | ⬜ pending |
| 51-05-03 | 05 | 4 | TRAFFIC-12 | — | page render + tab switch | vitest+RTL | `npx vitest run TrafficDashboardPage.test.tsx` (5 tests) | ❌ Wave 0 (this task creates test) | ⬜ pending |
| 51-06-01 | 06 | 4 | TRAFFIC-09, TRAFFIC-12 | T-51-28..30 | get_traffic_channel_rollup call with p_touch_mode (D-02 toggle live) | vitest + tsc | per-task verify block (RPC + p_touch_mode grep + no off-grid typography) | ❌ Wave 0 (test added in 06-02) | ⬜ pending |
| 51-06-02 | 06 | 4 | TRAFFIC-09, TRAFFIC-12 | T-51-28, T-51-30 | 5 tests (happy / 42501 / drill / no-deep-link / touchMode toggle data-changing) | vitest+RTL | `npx vitest run TrafficChannelsTab.test.tsx` (5 tests) | ❌ Wave 0 | ⬜ pending |
| 51-07-01 | 07 | 4 | TRAFFIC-06, TRAFFIC-11, TRAFFIC-12 | T-51-31..33 | RPC + BaseChart + anomaly badge | tsc + grep | per-task verify block (get_traffic_funnel_rollup + BaseChart + no off-grid typography) | ✅ | ⬜ pending |
| 51-07-02 | 07 | 4 | TRAFFIC-06 | — | audience switcher refetch + drill | vitest+RTL | `npx vitest run TrafficFunnelsTab.test.tsx` (4 tests) | ❌ Wave 0 | ⬜ pending |
| 51-08-01 | 08 | 4 | TRAFFIC-12 | T-51-34..35 | get_traffic_landing_page_rollup + sortable | tsc + grep | per-task verify block (RPC + no off-grid typography) | ✅ | ⬜ pending |
| 51-08-02 | 08 | 4 | TRAFFIC-12 | — | filter + sort + top-N | vitest+RTL | `npx vitest run TrafficLandingPagesTab.test.tsx` (3 tests) | ❌ Wave 0 | ⬜ pending |
| 51-09-01 | 09 | 4 | TRAFFIC-12 | T-51-39..40 | visibility-aware poll + stale pip + no TanStack Query import | vitest + grep | per-task verify block (get_realtime_traffic_summary + visibilitychange + absent `@tanstack/react-query`) | ❌ Wave 0 (3 tests created in this task) | ⬜ pending |
| 51-09-02 | 09 | 4 | TRAFFIC-04, TRAFFIC-05 | T-51-36..38 | 4 SECDEF RPCs; admin gate; no auth.uid; default-fallback protected | sql-static | per-task verify block (upsert/delete RPC + is_admin + absent auth.uid) | ✅ | ⬜ pending |
| 51-09-03 | 09 | 4 | TRAFFIC-04, TRAFFIC-05, TRAFFIC-12 | T-51-36..38 | taxonomy CRUD via SECDEF; JSON validation; Confirm | vitest + tsc | `npx vitest run TrafficTaxonomyPage.test.tsx` (4 tests) | ❌ Wave 0 | ⬜ pending |
| 51-10-01 | 10 | 5 | TRAFFIC-02, TRAFFIC-10 | T-51-42 | middleware cookie unit + cross-tenant RLS deny | vitest | `npx vitest run leanshot/test/middleware-cookie.test.ts && leanshot/test/rls-traffic-attribution.test.ts` | ❌ Wave 0 (both files ship in this task) | ⬜ pending |
| 51-10-02 | 10 | 5 | TRAFFIC-01..12 | T-51-41, T-51-43 | 14 migrations applied; 3 Edge Fns deployed; cookie + e2e smoke | live SQL + curl | `supabase db query --linked "select count(*) from supabase_migrations.schema_migrations where version like '20270712%'"` (expect 14) + `curl -I https://app.leanshot.app/?utm_source=research_smoke` | ✅ (commands; runs against live) | ⬜ pending |
| 51-10-03 | 10 | 5 | TRAFFIC-01..12 | T-51-44 | 6-signal HUMAN-UAT (operator-driven, multi-signal pattern) | checkpoint | operator replies `approved:S1..S6` or `defer:Sn reason=...` per signal | n/a | ⬜ pending |
| 51-10-04 | 10 | 5 | TRAFFIC-01..12 | — | CARRY-OVER.md captures matrices; STATE.md updated | filesystem | `test -f 51-CARRY-OVER.md && grep "Push-status matrix"` | ❌ Wave 0 (task creates file) | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

These files do not exist yet on `main`; tasks above create them. Wave 0 (Plan 51-01) lands the SQL schema + REQ-IDs first; later waves add test scaffolds inline with the code they cover.

- [ ] `leanshot/test/middleware-cookie.test.ts` — created by Plan 51-10 Task 1 (covers TRAFFIC-02)
- [ ] `leanshot/test/rls-traffic-attribution.test.ts` — created by Plan 51-10 Task 1 (covers TRAFFIC-10; uses RLS fixture per `reference_rls_fixture_gotrueclient_flake`)
- [ ] `leanshot/src/lib/traffic/fire-touch.ts` + `leanshot/src/lib/traffic/fire-touch.test.ts` — created by Plan 51-02 Task 4 (covers TRAFFIC-01 end-to-end SPA-mount fallback per W5)
- [ ] `supabase/functions/traffic-attribution-recorder/traffic-attribution-recorder.test.ts` — created by Plan 51-02 Task 2 (covers TRAFFIC-01)
- [ ] `leanshot/src/components/admin/growth/TrafficDashboardPage.test.tsx` — created by Plan 51-05 Task 3 (covers TRAFFIC-12 page shell)
- [ ] `leanshot/src/components/admin/growth/TrafficChannelsTab.test.tsx` — created by Plan 51-06 Task 2 (covers TRAFFIC-09)
- [ ] `leanshot/src/components/admin/growth/TrafficFunnelsTab.test.tsx` — created by Plan 51-07 Task 2 (covers TRAFFIC-06/11)
- [ ] `leanshot/src/components/admin/growth/TrafficLandingPagesTab.test.tsx` — created by Plan 51-08 Task 2
- [ ] `leanshot/src/components/admin/growth/TrafficRealtimeTab.test.tsx` — created by Plan 51-09 Task 1
- [ ] `leanshot/src/components/admin/growth/TrafficTaxonomyPage.test.tsx` — created by Plan 51-09 Task 3 (covers TRAFFIC-04/05)
- [ ] 5 sub-tab stub files (`Traffic{Channels,Funnels,LandingPages,Realtime}Tab.tsx` + `TrafficTaxonomyPage.tsx`) — created by Plan 51-05 Task 2; overwritten by Plans 51-06..09 (prevents Wave 4 parallel TypeScript breakage per `feedback_executor_tdd_scaffolds_sibling_files`)
- [ ] Vitest existing infrastructure covers all suites — no framework install needed; project already has `leanshot/vitest.config.ts`

*Existing infrastructure covers Deno tests (`$HOME/.deno/bin/deno` per memory `reference_deno_binary_path`); pgtap not required (live SQL queries via `supabase db query --linked` suffice).*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| `lt_anon_id` cookie visible in browser DevTools | TRAFFIC-02 | Browser-only DOM inspection | Plan 51-10 Task 3 Signal-1: private window → DevTools → Application → Cookies → confirm `lt_anon_id` HttpOnly+Secure+SameSite=Lax+90d |
| Admin module renders + tab strip swaps `aria-pressed` | TRAFFIC-12 | Browser-only interaction | Plan 51-10 Task 3 Signal-2: log in as admin, click each of 5 tabs, observe `aria-pressed` swap |
| Cron tick refresh produces new rows | TRAFFIC-08 | Wall-clock wait for :10 tick OR manual `refresh materialized view concurrently` | Plan 51-10 Task 3 Signal-3: wait for next tick or trigger manually; reload Channels tab |
| Taxonomy edit applies at next refresh | TRAFFIC-04 | Wall-clock wait for cron tick | Plan 51-10 Task 3 Signal-4: add "Reddit Test" channel group, fire 1 curl touch with utm_source=reddit, await tick, verify row surfaces |
| Funnel anomaly alert surfaces | TRAFFIC-11 | Requires either organic anomaly or synthetic insert | Plan 51-10 Task 3 Signal-5: insert synthetic anomaly row OR observe organic; confirm admin_notifications row appears |

---

## Decision Coverage Map

Maps each CONTEXT decision (D-01..D-16) to the plan(s) that implement it.

| Decision | Summary | Covered By | Verification |
|----------|---------|------------|--------------|
| D-01 | Channel-group taxonomy (8 seeds + admin CRUD) | 51-01 Task 2 (table + seeds) + 51-09 Task 2 (CRUD RPCs) + 51-09 Task 3 (UI) | grep `is_default_fallback` + 51-09 vitest 4-test suite |
| D-02 | First-touch AND last-touch with dashboard toggle | 51-01 Task 2 (both columns), 51-03 Task 2 (`p_touch_mode` SECDEF param, B4 fix), 51-06 Task 1 (toggle passes touchMode through; data actually changes; B4 fix) | grep `p_touch_mode text default 'last'` in migration 011 + vitest assertion `toggle changes grouping` |
| D-03 | Referrer-domain rules table seeded from Snowplow | 51-01 Task 2 (table + 80 seeds + classify wrapper) + 51-09 Task 2 (CRUD RPCs) | grep `referrer_channel_rules` + seed count ≥60 |
| D-04 | Audience taxonomy (consumer / clinic-org / affiliate) | 51-01 Task 3 (events.ts), 51-03 Tasks 1-2 (audience CASE), 51-07 (3-pill switcher) | grep `audience` enum branches across migrations + UI tabs |
| D-05 | 3 funnels per audience with explicit stage pairs | 51-03 Task 1 (traffic_funnel_rollup stage_pairs CTE) + 51-07 (UI) | grep `stage_pairs` VALUES table + funnel UI tests |
| D-06 | Per-channel × audience × stage anomaly alerts | 51-04 (compute_channel_stage_rate RPC + cron loop) + 51-07 (badge surface) | grep `traffic_funnel_drop` + dedup_key |
| D-07 | (Reserved / addressed by D-06 family) | 51-04 | covered by D-06 |
| D-08 | (Reserved) | n/a | n/a |
| D-09 | (Reserved) | n/a | n/a |
| D-10 | Real-time tab — 5-min poll against events_mirror direct query | 51-03 Task 2 (`get_realtime_traffic_summary` SECDEF RPC + `traffic_realtime_v` VIEW) + 51-09 Task 1 (native setInterval polling; **W8: D-10's "TanStack-Query poll" wording is superseded — project does not ship TanStack Query; UI-SPEC override**) | grep `get_realtime_traffic_summary` + visibilitychange + absent `@tanstack/react-query` import |
| D-11 | Landing-page rollup with PAGEAB variant join (nullable) | 51-03 Task 1 (`traffic_landing_page_rollup` + page_variant_id nullable) + 51-08 (UI em-dash) | grep `page_variant_id` + carry-over note |
| D-12 | /share/clinic-{slug} → org_id flow | 51-02 Task 1 (middleware sets lt_clinic_slug_seen) + recorder Fn resolves + 51-01 RLS policies | middleware grep + RLS deny test |
| D-13 | user_traffic_attribution SQL table + PostHog mirror | 51-01 Task 2 (table) + 51-02 Task 2 (recordTouch helper) | grep `recordTouch` + `captureServer` |
| D-14 | 4 matviews + sequenced cron piggy-backed on P33 | 51-03 (3 matviews + 1 VIEW + sequenced cron) | grep `ad_revenue_and_traffic_refresh` |
| D-15 | LEFT JOIN to ad_spend_facts at (network → channel_group) × day | 51-03 Task 1 (ad_spend_by_channel_day CTE) | grep `ad_spend_by_channel_day` |
| D-16 | is_retained() helper for D1/D7/D14/D30/D60 retention curves | 51-01 Task 3 (is_retained SECDEF) + 51-03 Task 1 (retention_per_channel CTE) | grep `is_retained` |

---

## Requirement Coverage Map

| Req ID | Summary | Plan(s) | Test Anchor |
|--------|---------|---------|-------------|
| TRAFFIC-01 | UTM + referrer captured into user_traffic_attribution end-to-end | 51-01, 51-02 (recorder + middleware + W5 fire-touch), 51-10 (smoke) | `traffic-attribution-recorder.test.ts` + `fire-touch.test.ts` + Plan 51-10 e2e smoke |
| TRAFFIC-02 | lt_anon_id cookie set on first landing; refreshed each visit | 51-02 Task 1 (middleware) + 51-10 Task 1 (cookie unit) + 51-10 S1 (browser) | `middleware-cookie.test.ts` |
| TRAFFIC-03 | PostHog alias() called on signup with lt_anon_id | 51-02 Task 3 (merge-anon-session edit) | grep `aliasServerSide` + `claim_traffic_attribution` |
| TRAFFIC-04 | channel_groups CRUD + match algorithm | 51-01 Task 2 + 51-09 Tasks 2-3 | 51-09 vitest taxonomy suite |
| TRAFFIC-05 | referrer_channel_rules seeded with ≥80 rows; classification correct | 51-01 Task 2 (seeds + classify wrapper) | seed count grep |
| TRAFFIC-06 | 3 funnels: row counts in traffic_funnel_rollup | 51-03 Task 1 + 51-07 (UI) | 51-07 vitest funnels suite |
| TRAFFIC-07 | ad_spend_facts join produces non-null cac_to_activation | 51-03 Task 1 (channel_rollup) + 51-06 (UI CAC column) | grep `cac_to_activation` |
| TRAFFIC-08 | Matviews refresh CONCURRENTLY; cron ordered after P33 | 51-03 Task 2 (sequenced cron) | post-push `supabase db query --linked cron.job` (Plan 51-10) |
| TRAFFIC-09 | is_retained() helper + retention rendering | 51-01 Task 3 + 51-03 Task 1 + 51-06 (sparkline drill-in) | 51-06 vitest channels suite |
| TRAFFIC-10 | RLS deny: cross-tenant clinician gets 42501 | 51-01 Task 2 (RLS policies) + 51-10 Task 1 (cross-tenant deny test) | `rls-traffic-attribution.test.ts` against live |
| TRAFFIC-11 | funnel-anomaly-cron writes admin_notifications row when stage rate < baseline-2σ | 51-04 (cron loop + dedup key) + 51-07 (badge surface) | grep `traffic_funnel_drop` + Plan 51-10 S5 |
| TRAFFIC-12 | Dashboard module renders 5 tabs (Channels/Funnels/Landing/Realtime/Taxonomy) | 51-05 (shell) + 51-06..09 (sub-tabs) + 51-10 S2 (browser) | each sub-tab vitest suite + dashboard shell tests |

Every TRAFFIC-NN REQ-ID has at least one plan owner. Every plan's `requirements` frontmatter field is non-empty.

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 60s per task
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved 2026-05-21 (revision iter-1 — inline-generated per `feedback_validation_md_inline_generation_when_missing`).
