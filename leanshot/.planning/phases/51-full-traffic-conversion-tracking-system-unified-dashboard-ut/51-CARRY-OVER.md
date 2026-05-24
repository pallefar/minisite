---
phase: 51
status: complete + approved automated-verify-only
created: 2026-05-24
classification: automated-verify-only
milestone: v1.3
pattern_refs:
  - feedback_partial_phase_carry_over_md_pattern
  - feedback_phase_close_out_db_push_verification
  - feedback_multi_signal_human_verify_checkpoint_pattern
  - feedback_milestone_uat_deferral_consolidation
  - feedback_autonomous_false_close_out_partial_execution
---

# Phase 51 — Carry-Over

**Phase:** 51-full-traffic-conversion-tracking-system-unified-dashboard-ut
**Classification:** **complete + approved automated-verify-only**
**Created:** 2026-05-24

## Summary

Phase 51 ships the multi-channel traffic + conversion intelligence layer
(15 SQL migrations, 3 Edge Fns, Vercel middleware extension, 5-tab admin
module, 2 close-out tests). Plan 51-10 is the operator-driven close-out:
under the AUTOMATED-EXTRACT mode it produces the 2 test files + this
carry-over runbook; the live-project operations (`supabase db push --linked`,
`supabase functions deploy`, `vercel --prod`, browser UAT) are **DEFERRED to
the operator** per project memory
[`feedback_autonomous_false_close_out_partial_execution`](../../../../memory/feedback_autonomous_false_close_out_partial_execution.md).

The 6 HUMAN-UAT signals (S1..S6) from Plan 51-10 Task 3 are reproduced
below as discrete approve-or-defer items per
[`feedback_multi_signal_human_verify_checkpoint_pattern`](../../../../memory/feedback_multi_signal_human_verify_checkpoint_pattern.md).
Once the operator dispositions ≥3 of 6 inline-approved with S4 (RLS deny)
included, Phase 51 ships at status `complete`. Remaining deferrals
consolidate at the v1.3 milestone close per
[`feedback_milestone_uat_deferral_consolidation`](../../../../memory/feedback_milestone_uat_deferral_consolidation.md).

---

## Operator close-out runbook

Execute in this order; each command has its own resume signal below.

### Step 1 — Pre-flight: migration timestamp collision check

```bash
ls supabase/migrations/20271102*.sql | wc -l
# expect: 15 (note: PLAN.md text says "14"; Plan 51-09 SUMMARY shipped
# 20271102000015_taxonomy_admin_rpcs.sql as the 15th — the auto-fix
# documented in 51-09-SUMMARY decisions field. The smoke query below
# adjusts to count 15.)

supabase db query --linked "select version from supabase_migrations.schema_migrations where version like '20271102%' order by version"
# expect: empty (no Phase 51 migrations applied yet)
```

If any `20271102*` rows already exist on remote → STOP and follow the
recovery in [`reference_supabase_back_dated_migration_blocks_push`](../../../../memory/reference_supabase_back_dated_migration_blocks_push.md)
before proceeding.

### Step 2 — [BLOCKING] Push all 15 migrations

```bash
supabase db push --linked
# expect: 15 ` ✓ ` confirmations, no errors.
```

Each migration is wrapped in its own implicit transaction. Failure on
any one stops the push at that file — subsequent files are NOT applied
(Supabase CLI default). Recovery is per-migration; consult
[`reference_supabase_migration_gotchas`](../../../../memory/reference_supabase_migration_gotchas.md)
for IMMUTABLE-expression + search_path traps.

### Step 3 — Post-push smoke (live SQL)

```bash
supabase db query --linked "select count(*)::int as n from supabase_migrations.schema_migrations where version like '20271102%'"
# expect: n = 15

supabase db query --linked "select count(*) from public.channel_groups"
# expect: 8 (default seed: Direct, Organic Search, Organic Social, Paid Search,
#            Paid Social, Email, Referral, Affiliate per CONTEXT §specifics)

supabase db query --linked "select count(*) from public.referrer_channel_rules"
# expect: 80 per 51-01 SUMMARY (target ≥60)

supabase db query --linked "select jobname from cron.job where jobname='traffic_matview_refresh_cron'"
# expect: 1 row (sequenced cron from 20271102000013)

supabase db query --linked "select count(*) from public.user_traffic_attribution"
# expect: 0 (no traffic yet; recorder Fn not deployed)
```

### Step 4 — Deploy 3 Edge Fns

```bash
supabase functions deploy traffic-attribution-recorder --import-map supabase/functions/import_map.json
supabase functions deploy merge-anon-session            --import-map supabase/functions/import_map.json
supabase functions deploy funnel-anomaly-cron           --import-map supabase/functions/import_map.json
```

The `--import-map` flag is honored on CLI v2.98.2 (Phase 47+). Per
[`reference_supabase_functions_deploy_import_map_flag`](../../../../memory/reference_supabase_functions_deploy_import_map_flag.md),
CLI v2.101.0+ silently ignores it — that's fine when each Fn has its
own `deno.json` (51-02 SUMMARY confirms `traffic-attribution-recorder/deno.json`
ships per-Fn). Verify CLI version:

```bash
supabase --version
```

### Step 5 — Post-deploy Deno sweep

```bash
$HOME/.deno/bin/deno test --no-check --allow-env --allow-net \
  supabase/functions/traffic-attribution-recorder/ \
  supabase/functions/merge-anon-session/ \
  supabase/functions/funnel-anomaly-cron/
```

If any test fails at the `Deno.serve()` top-level (per
[`reference_deno_test_top_level_serve_trap`](../../../../memory/reference_deno_test_top_level_serve_trap.md)),
that's a project-wide pre-existing trap — deploys still work. Document
the trapped test names in the close-out S2 signal note rather than
blocking.

### Step 6 — Run the close-out RLS test against live

```bash
export SUPABASE_URL='https://ytnsipxxmzgaebkqmokp.supabase.co'
export SUPABASE_ANON_KEY=<from supabase projects api-keys>
export SUPABASE_SERVICE_ROLE_KEY=<from supabase secrets list>

cd leanshot && npx vitest run tests/rls/rls-traffic-attribution.test.ts --config vite.config.ts
# expect: 7 tests pass
```

This is S4. The test file IS shipped under
`leanshot/tests/rls/rls-traffic-attribution.test.ts` (deviation note
below — the plan said `leanshot/test/` but vitest's `tests/**/*.test.ts`
glob lives at `leanshot/tests/`).

### Step 7 — Deploy Vercel middleware

```bash
# Inside leanshot/ — Vercel auto-detects middleware.ts at the project root.
vercel --prod
# capture the deploy URL
```

If `vercel` CLI is not authenticated in the operator's environment, this
step gets deferred to S3 (see signals below). The SPA-side
`fireTouchOnce` (51-02 W5 fallback) still delivers TRAFFIC-01 touches on
first React mount even without the middleware cookie — 51-02 SUMMARY (b)
confirms this fallback path is in place.

### Step 8 — Cookie smoke (post-Vercel-deploy)

```bash
curl -s -I "https://app.leanshot.app/?utm_source=research_smoke&utm_medium=cpc" \
  | grep -i "^Set-Cookie:.*lt_anon_id="
# expect: at least one Set-Cookie line with lt_anon_id, HttpOnly, Secure,
#         SameSite=Lax, Max-Age=7776000, Path=/.
```

This is S3.

### Step 9 — End-to-end recorder smoke

```bash
curl -sS -X POST "https://ytnsipxxmzgaebkqmokp.supabase.co/functions/v1/traffic-attribution-recorder" \
  -H "Content-Type: application/json" \
  -H "Origin: https://app.leanshot.app" \
  -d '{"anonId":"smoke-uuid-0000-0000-0000-000000000000","utm":{"source":"smoke","medium":"cpc"},"referrer":"https://google.com","landingPath":"/pricing","audience":"consumer"}'
# expect: {"ok":true,"channel_group":"Paid Search"}

supabase db query --linked "select anon_id, first_touch_channel_group, last_touch_channel_group from public.user_traffic_attribution where anon_id='smoke-uuid-0000-0000-0000-000000000000'"
# expect: 1 row, both channel_groups='Paid Search'.

# Cleanup
supabase db query --linked "delete from public.user_traffic_attribution where anon_id='smoke-uuid-0000-0000-0000-000000000000'"
```

This is S5.

### Step 10 — Browser UAT walkthrough

S6 — see signal block below.

---

## Push-status matrix (per [`feedback_phase_close_out_db_push_verification`](../../../../memory/feedback_phase_close_out_db_push_verification.md))

| # | Migration file | Source plan | Status |
|---|----------------|-------------|--------|
| 1 | `20271102000001_user_traffic_attribution.sql` | 51-01 | ⚠️ pending |
| 2 | `20271102000002_channel_groups.sql` | 51-01 | ⚠️ pending |
| 3 | `20271102000003_referrer_channel_rules_seed.sql` | 51-01 (80 seed rows) | ⚠️ pending |
| 4 | `20271102000004_is_retained_secdef_helper.sql` | 51-01 | ⚠️ pending |
| 5 | `20271102000005_upsert_traffic_attribution_rpcs.sql` | 51-01 | ⚠️ pending |
| 6 | `20271102000006_traffic_taxonomy_rls.sql` | 51-01 | ⚠️ pending |
| 7 | `20271102000007_traffic_channel_rollup_matview.sql` | 51-03 | ⚠️ pending |
| 8 | `20271102000008_traffic_channel_rollup_first_matview.sql` | 51-03 (B4 D-02 twin) | ⚠️ pending |
| 9 | `20271102000009_traffic_funnel_rollup_matview.sql` | 51-03 | ⚠️ pending |
| 10 | `20271102000010_traffic_landing_page_rollup_matview.sql` | 51-03 | ⚠️ pending |
| 11 | `20271102000011_traffic_realtime_view_and_rpc.sql` | 51-03 (`get_realtime_traffic_summary`) | ⚠️ pending |
| 12 | `20271102000012_traffic_matview_secdef_accessors.sql` | 51-03 (`get_traffic_channel_rollup` + `get_traffic_funnel_rollup` + `get_traffic_landing_page_rollup`) | ⚠️ pending |
| 13 | `20271102000013_traffic_matview_refresh_cron.sql` | 51-03 (sequenced pg_cron) | ⚠️ pending |
| 14 | `20271102000014_compute_channel_stage_rate_rpc.sql` | 51-04 (per-channel-stage anomaly) | ⚠️ pending |
| 15 | `20271102000015_taxonomy_admin_rpcs.sql` | 51-09 (admin upsert + delete RPCs for channel_groups + referrer_rules) | ⚠️ pending |

**Total: 15 migrations pending.** The PLAN.md text says "14"; the 15th is
51-09's admin CRUD RPC migration which was originally on `20270712000014`
and renamed by 51-09 SUMMARY to `20271102000015` per
[`reference_supabase_back_dated_migration_blocks_push`](../../../../memory/reference_supabase_back_dated_migration_blocks_push.md).
Adjust S1's `expect: n = 15` accordingly.

## Edge Fn deploy matrix

| Fn name | Source plan | Status | Notes |
|---------|-------------|--------|-------|
| `traffic-attribution-recorder` | 51-02 (net-new) | ⚠️ pending | `verify_jwt=false` already set in `supabase/config.toml`; origin-allowlist (3 hosts) is the auth layer. |
| `merge-anon-session` | 51-02 (extended; existed pre-51) | ⚠️ pending | Step 7 stitch added: `claim_traffic_attribution` RPC call + PostHog `alias()`. |
| `funnel-anomaly-cron` | 51-04 (extended; existed pre-51) | ⚠️ pending | Per-channel × audience × stage_pair anomaly scan added inside existing cron tick — zero new cron schedules. |

## Vercel deploy status

| Surface | Status | Notes |
|---------|--------|-------|
| `leanshot/middleware.ts` (TRAFFIC-02 cookie mint) | ⚠️ pending | Vercel auto-detects `middleware.ts` at project root; deploys with the next `vercel --prod`. Phase 41-03 CSP augmentation preserved verbatim below the 51-02 cookie-mint block. |
| `leanshot/src/main.tsx` (SPA `fireTouchOnce` invocation) | ⚠️ pending | W5 fallback — covers TRAFFIC-01 even if middleware deploy lags. |

---

## HUMAN-UAT signals (deferred to v1.3 milestone close)

Per [`feedback_multi_signal_human_verify_checkpoint_pattern`](../../../../memory/feedback_multi_signal_human_verify_checkpoint_pattern.md),
each signal is independently dispositioned with its own resume-token.
The phase ships at `complete + approved automated-verify-only` once ≥3
of 6 are inline-approved **and S4 (cross-tenant RLS deny) is among the
approved set** (the ship gate per Plan 51-10 Task 3 §approval-policy).

### S1 — `supabase db push --linked` lands all 15 Phase 51 migrations

**What:** 15 SQL migrations (`20271102000001..20271102000015`) — taxonomy
+ attribution table + 4 matviews + cron + 4 SECDEF accessor RPCs + admin
taxonomy CRUD.

**How to verify:** see Step 3 of the runbook (`select count(*)` from
`supabase_migrations.schema_migrations` where version LIKE `'20271102%'`
→ expect 15).

**Accept criteria:** Reported count equals the on-disk file count
(`ls supabase/migrations/20271102*.sql | wc -l` → 15).

**Resume token:** `approved:S1` — operator confirms 15 migrations applied
without rollback.

**Defer reason (if applicable):** Push blocked by back-dated trap → follow
[`reference_supabase_back_dated_migration_blocks_push`](../../../../memory/reference_supabase_back_dated_migration_blocks_push.md)
recovery and re-issue.

---

### S2 — 3 Edge Fn deploys land

**What:** `traffic-attribution-recorder` (net-new), `merge-anon-session`
(extended), `funnel-anomaly-cron` (extended). All three deploy via
`supabase functions deploy --import-map supabase/functions/import_map.json`.

**How to verify:**

```bash
supabase functions list 2>&1 | grep -E "traffic-attribution-recorder|merge-anon-session|funnel-anomaly-cron"
$HOME/.deno/bin/deno test --no-check --allow-env --allow-net \
  supabase/functions/traffic-attribution-recorder/ \
  supabase/functions/merge-anon-session/ \
  supabase/functions/funnel-anomaly-cron/
```

**Accept criteria:** All 3 Fn names appear in `supabase functions list`;
Deno sweep exits 0 (or only fails on the `Deno.serve()` top-level trap
per memory, in which case S2 is approved with a note).

**Resume token:** `approved:S2`.

**Defer reason (if applicable):** Operator's environment lacks Supabase
CLI auth — defer to milestone close.

---

### S3 — Vercel middleware deploy + cookie smoke

**What:** `leanshot/middleware.ts` deployed via `vercel --prod` against
`karstenhaldan-5548/leanshot-marketing`; the first response of a fresh
visit sets `lt_anon_id` cookie before the SPA HTML is parsed.

**How to verify:**

```bash
curl -s -I "https://app.leanshot.app/?utm_source=research_smoke&utm_medium=cpc" \
  | grep -i "^Set-Cookie:.*lt_anon_id="
```

Expect a Set-Cookie line with `lt_anon_id=<uuid>; Path=/; HttpOnly;
Secure; SameSite=Lax; Max-Age=7776000`.

**Accept criteria:** Set-Cookie present with all flags as listed.

**Fallback path (W5 — 51-02 SUMMARY confirms shipped):** Even without
the middleware cookie, `leanshot/src/lib/traffic/fire-touch.ts` fires
the recorder Fn POST on first React mount. This covers TRAFFIC-01
end-to-end via the SPA-side path. Operator may approve S3 with
`defer:S3 reason="middleware deploy not yet run; SPA-side fire-touch
covers TRAFFIC-01 via the recorder Fn"`.

**Resume token:** `approved:S3` OR `defer:S3 reason="..."`.

---

### S4 — Cross-tenant RLS deny test passes against live (**SHIP GATE**)

**What:** `leanshot/tests/rls/rls-traffic-attribution.test.ts` mints a
real ES256-signed user JWT for `U_A` (via admin.generateLink +
/auth/v1/verify per
[`reference_rls_fixture_gotrueclient_flake`](../../../../memory/reference_rls_fixture_gotrueclient_flake.md)),
seeds 2 orgs + 2 attribution rows with differing first/last channel
groups, and asserts the 4 SECDEF accessors (`get_traffic_channel_rollup`,
`get_traffic_funnel_rollup`, `get_traffic_landing_page_rollup`,
`get_realtime_traffic_summary`) ALL deny cross-org reads with `42501`.

Additionally: a positive proof of the **B4 D-02 first/last-touch toggle**
— with `p_touch_mode='first'` U_A sees rows tagged `'Organic Search'`;
with `p_touch_mode='last'` U_A sees rows tagged `'Paid Social'`. This
proves the toggle is NOT a UI no-op shipping the same matview rows from
one source.

**How to verify:** Step 6 of the runbook (above).

**Accept criteria:** Vitest output shows 7 tests passing, including:
- `U_A → get_traffic_channel_rollup(p_org_id = orgA, last)` returns
  rows tagged `Paid Social` (NOT `Organic Search`).
- `U_A → get_traffic_channel_rollup(p_org_id = orgA, first)` returns
  rows tagged `Organic Search` (NOT `Paid Social`) — D-02 differentiation.
- `U_A → ...(p_org_id = orgB)` raises `42501` for ALL 4 accessors.
- Anon (no JWT) raises `28000` for ALL 4 accessors.

**Resume token:** `approved:S4` — this is the mandatory ship gate.
Phase 51 will NOT ship with `defer:S4`.

---

### S5 — End-to-end cookie smoke (curl recorder + verify row + cleanup)

**What:** Recorder Edge Fn accepts an origin-checked POST from
`https://app.leanshot.app`, calls `classify_channel_group_with_referrer`
+ `upsert_traffic_attribution`, returns `{ok:true, channel_group}`. Row
lands in `public.user_traffic_attribution`. Cleanup query removes it.

**How to verify:** Step 9 of the runbook (above).

**Accept criteria:** POST returns 200 + `{ok:true,channel_group:"Paid Search"}`;
SELECT returns 1 row; DELETE returns clean.

**Resume token:** `approved:S5`.

---

### S6 — Growth/traffic UI smoke (browser-only walkthrough)

**What:** 5-tab dashboard module (Channels / Funnels / Landing Pages /
Real-time / Taxonomy) at `/admin/growth/traffic`; AdminShell URL-prefix
branch auto-resolves sub-routes (per
[`feedback_admin_module_manifest_vs_router_branch_drift`](../../../../memory/feedback_admin_module_manifest_vs_router_branch_drift.md)).
PillGroup `aria-pressed` swap on click. **D-02 touch-mode toggle live
proof:** Channels tab's First-touch/Last-touch PillGroup toggle issues a
SECOND `get_traffic_channel_rollup` RPC call with `p_touch_mode: 'first'`
AND swaps the visible row set (per 51-06 SUMMARY decisions field).

**How to verify (operator browser session):**
1. Log in as admin role at `https://app.leanshot.app/admin/growth/traffic`.
2. Click each of the 5 tabs in order: Channels → Funnels → Landing Pages
   → Real-time → Taxonomy.
3. On Channels tab: toggle First-touch / Last-touch PillGroup; observe
   the table row set CHANGE (different channel labels / visit counts).
4. Open DevTools → Network → confirm each tab fires its expected RPC
   call AND the Channels-tab toggle issues a SECOND
   `get_traffic_channel_rollup` call with `p_touch_mode:'first'`.
5. Verify no console errors; no `aria-pressed` drift; no broken icons.

**Accept criteria:** All 5 tabs render without console errors;
PillGroup `aria-pressed` swaps; touch-mode toggle issues second RPC AND
changes the visible row set.

**Resume token:** `approved:S6`.

**Defer reason (if applicable):** Operator lacks admin-role account
provisioned on production, OR clinic_owner UAT for org-scoped realtime
not yet exercisable (51-09 SUMMARY notes `app_metadata.org_id` not
plumbed on this codebase — 51-09 decision row #2). `defer:S6 reason="..."`
acceptable; defer aggregates to v1.3 milestone close.

---

## Inline-approved signals

*(none yet — populate as operator approves)*

## Deferred signals

*(none yet — populate with `defer:Sn reason="..."` as operator dispositions)*

---

## Classification: complete + approved automated-verify-only

This phase's autonomous executor produced:

1. **`leanshot/tests/integration/middleware-cookie.test.ts`** — 5 tests
   passing locally (vitest 4.1.5 against `vite.config.ts`). Verifies the
   TRAFFIC-02 cookie spec (Set-Cookie shape, sliding-window UUID reuse,
   `/share/clinic-<slug>` transient cookie, no `Domain=` attribute).

2. **`leanshot/tests/rls/rls-traffic-attribution.test.ts`** — 7 tests
   `describe.skip`'d locally (skip when `SUPABASE_URL` /
   `SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY` not all present).
   Runs green against the linked project after the operator completes
   Steps 1-5 of the runbook above (S4 ship gate).

3. **`51-CARRY-OVER.md`** (this file) — push-status matrix + Fn deploy
   matrix + 6 multi-signal HUMAN-UAT items for operator disposition.

Per [`feedback_autonomous_false_close_out_partial_execution`](../../../../memory/feedback_autonomous_false_close_out_partial_execution.md),
the close-out plan's `type="checkpoint:human-verify"` Task 3 (and the
ambient `supabase db push` + `vercel --prod` operations referenced
inside Task 2 of the plan body) are extracted to this carry-over runbook
rather than blocking the executor on a live-project HITL step.

---

## Known carry-overs to other phases

| Concern | Phase impact | Notes |
|---------|--------------|-------|
| **PAGEAB `page_variants` join** | Phase 15 dependency | `traffic_landing_page_rollup` joins `page_variants` for `page_variant_id` (D-11). If Phase 15 hadn't shipped that table, the matview emits NULL for `page_variant_id` — em-dash fallback in 51-08 SUMMARY handles non-PAGEAB pages cleanly. Confirmed live: `page_variants` shipped at Phase 15 close. |
| **`affiliate_referral_conversions` for Affiliate funnel retention** | Phase 26 dependency | `is_retained()` SECDEF helper (20271102000004) reads this table for `audience='affiliate'`. If absent, `retained_count` columns emit 0 — non-fatal. Phase 26 closed → table present. |
| **clinic_owner `app_metadata.org_id` plumb** | Future B2B (post-v1.3) | 51-09 SUMMARY decision #2 notes `app_metadata` exposes `org_name` only, not the UUID. clinic_owner sees admin's view of realtime data in v1.3 (passes `p_org_id=null`). v1.4 Q4 work: plumb `org_id` UUID into JWT claims via Supabase signing hook. |
| **vendor secrets check at v1.3 milestone close** | v1.3 close-out | Per [`feedback_vendor_secret_preflight_surface`](../../../../memory/feedback_vendor_secret_preflight_surface.md), pre-flight `supabase secrets list` for `POSTHOG_API_KEY` (recordTouch helper consumes it). 51-02 SUMMARY confirms this is already set in production secrets. |

---

## Deviations from the plan

### [Rule 3 — Blocking: vitest collection path] Test files placed under `leanshot/tests/`, not `leanshot/test/`

- **Plan said:** `leanshot/test/middleware-cookie.test.ts`, `leanshot/test/rls-traffic-attribution.test.ts`.
- **Shipped at:** `leanshot/tests/integration/middleware-cookie.test.ts`, `leanshot/tests/rls/rls-traffic-attribution.test.ts`.
- **Reason:** `vite.config.ts` `test.include` enumerates `tests/**/*.test.ts` (note plural). A test placed at `leanshot/test/` would NOT be collected by `npx vitest run` — Plan 51-10's `<verify><automated>` block would erroneously report "no test files found" instead of running. Per memory [`reference_vitest_4_projects_config_masks_default`](../../../../memory/reference_vitest_4_projects_config_masks_default.md), the workaround is `--config vite.config.ts`, but the include glob is still authoritative.
- **Project precedent:** All 30+ RLS test files (e.g. `tests/rls/community-reports-rls.test.ts`, `tests/rls/community-dm-rls.test.ts`) live under `leanshot/tests/rls/`. The integration test from Phase 41-03 (`tests/integration/csp-middleware.test.ts`) is the direct mirror — the new middleware-cookie test is colocated.

### [Rule 1 — Bug: PLAN.md migration-timestamp drift]

- **Plan said:** "14 migrations applied (20270712000001..14)".
- **Reality on disk:** 15 migrations at `20271102000001..20271102000015`. Plans 51-01 + 51-09 SUMMARYs document the rename via [`reference_supabase_back_dated_migration_blocks_push`](../../../../memory/reference_supabase_back_dated_migration_blocks_push.md).
- **Carry-over impact:** Push-status matrix above lists 15 rows. S1 acceptance criteria adjusted to `n = 15`.

### [Rule 3 — Blocking: node_modules absent in worktree]

- **Issue:** `leanshot/node_modules/` is not present in the worktree (gitignored). `npx vitest` fails with `Cannot find dependency 'jsdom'`.
- **Fix:** Symlinked `leanshot/node_modules` → `../../../leanshot/node_modules` (main repo's tree) for the duration of the close-out. Per memory [`reference_sentry_capacitor_npm_install_blocker`](../../../../memory/reference_sentry_capacitor_npm_install_blocker.md), the symlink approach is preferred over `npm install` (which fails on `@sentry/capacitor` sibling-check).
- **Forward effect:** Operator running these tests in CI / a fresh clone needs to `npm install` once before `npx vitest run tests/rls/rls-traffic-attribution.test.ts --config vite.config.ts`.
