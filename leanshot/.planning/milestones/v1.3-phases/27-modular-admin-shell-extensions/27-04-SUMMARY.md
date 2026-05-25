---
phase: 27-modular-admin-shell-extensions
plan: 04
subsystem: admin
tags: [admin, anomaly, funnel, cron, realtime, posthog]
requires:
  - phase-24 (log_admin_action, is_admin_at_least, admin_role enum, audit_logs.actor_user_id/row_pk shape)
  - phase-24 (_shared/posthog-server.ts captureServer)
  - phase-22 (_shared/lifecycle-utils.ts makeLazyAdmin + checkServiceRoleBearer + jsonResponse)
  - phase-22 (_shared/resend-domain-health-check.ts + lifecycle-send.ts sendResendEmail)
provides:
  - public.events_mirror table (closes RESEARCH q#5)
  - public.anomaly_tracked_funnels table + 5 seed rows
  - public.funnel_anomaly_alerts table + Realtime broadcast channel
  - public.funnel_anomaly_baseline_compute SQL SECDEF function (hybrid HOD/DOW baseline)
  - public.funnel_anomaly_acknowledge SECDEF RPC (firing → acknowledged)
  - pg_cron "funnel-anomaly-cron" job at */5
  - Edge Fn funnel-anomaly-cron (with Deno test)
  - leanshot/src/lib/admin/anomaly/{api,realtime-channel}.ts client lib
  - leanshot/src/components/admin/anomaly/{AdminAnomalyBanner,AdminAnomalyAcknowledgeQueue}.tsx
  - leanshot/src/components/admin/AdminGlobals.tsx coordination wrapper
affects:
  - leanshot/src/components/admin/AdminLayout.tsx (+1 import, +1 JSX per render mode)
  - supabase/functions/_shared/posthog-server.ts (events_mirror dual-write extension)
  - leanshot/vitest-e2e.config.ts (2 integration test files added to include)
tech-stack:
  added:
    - public.events_mirror (local PostHog mirror; no new external dep)
  patterns:
    - Pattern S2 — append-only RLS (events_mirror = zero policies; funnel_anomaly_alerts = SELECT only)
    - Pattern S3 — audit-trigger suppression GUC ('app.suppress_audit'='true')
    - Pattern S5 — vendor-gated send via resendDomainHealthCheck
    - Pattern S6 — makeLazyAdmin + setAdminForTest seam
    - Pattern S7 — discriminated AnomalyApiError RPC wrapper
    - Pattern S9 — UNIQUE(funnel_id, tick_bucket) idempotency on cron ticks
    - Pattern S10 — status-machine ownership (cron writes firing; RPC writes acknowledged; resolved DEFERRED v1.4)
key-files:
  created:
    - supabase/migrations/20260601000030_events_mirror.sql
    - supabase/migrations/20260601000031_anomaly_tracked_funnels.sql
    - supabase/migrations/20260601000032_funnel_anomaly_alerts.sql
    - supabase/migrations/20260601000033_funnel_anomaly_baseline_compute.sql
    - supabase/migrations/20260601000034_funnel_anomaly_acknowledge_rpc.sql
    - supabase/migrations/20260601000035_funnel_anomaly_cron_schedule.sql
    - supabase/functions/funnel-anomaly-cron/index.ts
    - supabase/functions/funnel-anomaly-cron/funnel-anomaly-cron.test.ts
    - supabase/functions/funnel-anomaly-cron/deno.json
    - leanshot/src/lib/admin/anomaly/realtime-channel.ts
    - leanshot/src/lib/admin/anomaly/api.ts
    - leanshot/src/lib/admin/anomaly/api.test.ts
    - leanshot/src/components/admin/anomaly/AdminAnomalyBanner.tsx
    - leanshot/src/components/admin/anomaly/AdminAnomalyAcknowledgeQueue.tsx
    - leanshot/src/components/admin/AdminGlobals.tsx
    - leanshot/tests/integration/funnel-anomaly-detection.test.ts
    - leanshot/tests/integration/anomaly-suppression.test.ts
  modified:
    - supabase/functions/_shared/posthog-server.ts
    - leanshot/src/components/admin/AdminLayout.tsx
    - leanshot/vitest-e2e.config.ts
key-decisions:
  - D-23-resolution — events_mirror added in THIS plan (Phase 24 omits); posthog-server.ts dual-writes via lazy admin singleton; closes RESEARCH q#5
  - Realtime via BROADCAST channel (not postgres_changes); cron explicit .send() on insert; avoids ALTER PUBLICATION + bypasses replication-slot latency; non-PHI payload by design
  - Rule 1 deviation: plan-stated set_config('app.suppress_audit','on',true) corrected to 'true' to match existing audit trigger check ('true' literal)
  - AdminGlobals.tsx wraps BOTH this plan's banner AND Plan 27-03's command palette (React.lazy with defensive try/catch) — single AdminLayout mount point avoids Wave-1 parallel-edit conflict
  - Phase 25 email-router.ts dynamic-import with sendResendEmail fallback per [[reference_vendor_gated_send_health_check]] — works whether Phase 25 has shipped or not
requirements-completed: [TAXO-05]
duration: ~30 min
completed: 2026-05-18
---

# Phase 27 Plan 04: Funnel-Anomaly Detection Cron Summary

Ships the */5 funnel-anomaly detection cron for TAXO-05 + SC#5: tracked-funnels config table (5 seeds), append-only alerts table, hybrid same-DOW + same-HOD weighted-blend SQL baseline function (0.6 DOW + 0.4 HOD per D-15), 5-minute Edge Function cron, Realtime broadcast to /admin/* banner, vendor-gated email alert via Phase 25 email-router (with sendResendEmail fallback), 4-hour same-funnel suppression, and an admin acknowledgment SECDEF RPC + queue UI. Closes RESEARCH question #5 by ALSO adding the events_mirror table + extending posthog-server.ts to dual-write into it (anomaly cron cannot reliably poll PostHog REST at 5-min cadence).

## What shipped

- 6 migrations (`20260601000030..35`) — events_mirror + anomaly_tracked_funnels (5 seeds) + funnel_anomaly_alerts + baseline_compute SECDEF + acknowledge SECDEF + pg_cron schedule
- 1 Edge Function — `funnel-anomaly-cron/` with 5-scenario Deno test (401 on no bearer; all-above-threshold no-op; below-threshold fire+broadcast; <4h suppression; Resend-unverified short-circuit)
- 1 shared Edge helper extension — `_shared/posthog-server.ts` adds lazy supabase admin singleton + fire-and-forget `events_mirror.insert` inside `captureServer()` (best-effort; never throws into caller)
- 2 client-lib modules — `lib/admin/anomaly/{api,realtime-channel}.ts` + 7-test unit suite
- 3 UI components — `AdminAnomalyBanner` (role=status, aria-live=polite), `AdminAnomalyAcknowledgeQueue` (mirrors AdminAffiliatesReviewQueue verbatim shape), `AdminGlobals` wrapper (single AdminLayout mount; lazy-imports AdminCommandPalette from Plan 27-03)
- 2 integration tests — detection (seeds events_mirror 7d×24h×20 baseline + 2-row anomalous live → fetch POST → asserts alert row + broadcast in <5s) + suppression (pre-seeded prior alert 2h ago → cron tick → asserts 0-delta + suppressed counter >=1)
- AdminLayout edit: +1 import + 1 JSX mount per render mode (Mode A + Mode B both call `<AdminGlobals adminRole={probe.adminRole} />`)

Duration: ~30 min. Tasks completed: 6 of 7 (Task 7 deferred — see below).

## Commits (this plan)

- `eff3b46` feat(27-04-01): events_mirror + anomaly_tracked_funnels (5 seeds) + funnel_anomaly_alerts migrations
- `86fc47c` feat(27-04-02): funnel_anomaly_baseline_compute SQL + funnel_anomaly_acknowledge SECDEF RPC
- `9a254de` feat(27-04-03): funnel-anomaly-cron Edge Fn + posthog-server.ts events_mirror dual-write + Deno test
- `5352808` feat(27-04-04): pg_cron */5 schedule for funnel-anomaly-cron via Vault service_role bearer
- `297f986` feat(27-04-05): anomaly api wrapper + realtime hook + Banner + AcknowledgeQueue + AdminGlobals coordination
- `22bfc21` feat(27-04-06): integration tests — funnel anomaly detection + 4h suppression

## Resolutions of pre-shipped questions

### RESEARCH question #5 — events_mirror

Phase 24 ships `_shared/posthog-server.ts` that captures events server-side to PostHog (TAXO-02) but does NOT ship a local mirror. The funnel-anomaly cron runs every 5 minutes — polling PostHog REST at that cadence risks rate-limit + lag.

**Resolution:** Added `public.events_mirror` (migration 30) + extended `captureServer()` to fire-and-forget INSERT into it via a lazy supabase admin singleton (mirrors `makeLazyAdmin` from `_shared/lifecycle-utils.ts`). Insert failures are caught + console.warn'd, never thrown — the PostHog send remains the source of truth; events_mirror is a query convenience for the anomaly cron. Composite index on `(event_name, created_at desc)` matches the baseline_compute hot path.

RLS posture: ENABLED with ZERO policies (Pattern S2). Only the service_role admin client (from posthog-server.ts) and the SECDEF baseline_compute function (table-owner bypass) access this table. Authenticated/anon → 42501.

### Realtime broadcast vs postgres_changes

`funnel_anomaly_alerts` is INTENTIONALLY NOT added to the `supabase_realtime` publication. The cron Edge Function explicitly calls `supabase.channel('funnel_anomaly_alerts').send({type:'broadcast', event:'anomaly_fired', payload:{...}})` on successful insert. Benefits:

- Avoids the `ALTER PUBLICATION` dance + idempotent-wrap migration
- Bypasses postgres_changes replication-slot latency (~1-3s)
- Gives the cron full control of payload shape (matches the AnomalyAlertPayload type exactly — no row-diff translation)
- Keeps the broadcast non-PHI by design (only IDs + metric numbers, no user_id, no event properties) — explicit T-27-04-03 mitigation

The client hook (`useAnomalyAlerts`) subscribes via `supabase.channel('funnel_anomaly_alerts').on('broadcast', {event:'anomaly_fired'}, handler).subscribe()` and removes the channel on unmount — verbatim shape of the proven `use-roster-realtime.ts` pattern.

### Status machine ownership (Pattern S10)

`funnel_anomaly_alerts.resolution_status` enum (`'firing' | 'resolved' | 'acknowledged'`):

| Value          | Writer                                  | When                                  |
| -------------- | --------------------------------------- | ------------------------------------- |
| `firing`       | funnel-anomaly-cron (service_role)      | On insert (cron tick fires alert)     |
| `acknowledged` | `funnel_anomaly_acknowledge` SECDEF RPC | Admin clicks Ack button               |
| `resolved`     | **NONE — DEFERRED to v1.4**             | No auto-resolution path in v1 per D-18 |

`resolved` is intentionally not written by any v1 surface. The UI renders 'Resolved' in the badge map (display-only) for forward-compat, but the column is never set to 'resolved' in v1.3. Per CONTEXT D-18 — v1 ships fixed 4h suppression; v1.4 adds "auto-resolve when count returns to within 1σ". `STATUS_FILTERS` in the queue UI exposes 3 pills (Firing / Acknowledged / All); the `'resolved'` value cannot appear in v1.3 so no orphan filter row.

### AdminLayout coordination with Plan 27-03

Plan 27-03 (Wave-1 parallel) ships AdminCommandPalette which also needs a global UI mount. Without coordination, both plan executors would race on the same AdminLayout edit + conflict in merge.

**Strategy:** This plan creates `src/components/admin/AdminGlobals.tsx` as the single mount point. AdminGlobals:

- Renders `<AdminAnomalyBanner />` directly (this plan)
- Dynamically lazy-imports `@/components/admin/AdminCommandPalette` inside a try/catch — if Plan 27-03 hasn't shipped yet, the lazy resolver returns `{default: () => null}` so AdminGlobals still compiles + runs. When 27-03 lands, the lazy import picks up the real component automatically — no edits to AdminGlobals.tsx needed.
- AdminLayout edit is +1 import + 1 JSX `<AdminGlobals adminRole={probe.adminRole} />` per render mode (Mode A and Mode B both render AdminGlobals).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] `set_config('app.suppress_audit', 'on', true)` → `'true'`**
- **Found during:** Task 2
- **Issue:** Plan task 2 action prescribed `set_config('app.suppress_audit', 'on', true)`. The existing audit trigger (`supabase/migrations/20260601000017_audit_trigger_suppress_guc.sql:52`) checks `current_setting('app.suppress_audit', true) = 'true'`. With the plan-stated `'on'` value, the trigger would NOT skip the audit row — the explicit log_admin_action INSERT + the AFTER trigger would BOTH fire → duplicate audit rows. This is the exact bug Pattern S3 exists to prevent.
- **Fix:** Used `'true'` literal in `funnel_anomaly_acknowledge_rpc.sql:65` (matches every existing call site in the repo — `grep "app.suppress_audit" supabase/migrations/`).
- **Files modified:** `supabase/migrations/20260601000034_funnel_anomaly_acknowledge_rpc.sql`
- **Verification:** `grep -q "set_config..app.suppress_audit" supabase/migrations/*_funnel_anomaly_acknowledge_rpc.sql && grep -q "'true'" supabase/migrations/*_funnel_anomaly_acknowledge_rpc.sql` → PASS
- **Commit:** `86fc47c`

**2. [Rule 2 - Missing critical] events_mirror RLS — defensive `coalesce(stddev_samp, 0)` in baseline function**
- **Found during:** Task 2
- **Issue:** Plan-stated SQL `coalesce(stddev_samp(cnt), 0)` runs but `avg(cnt)` over an empty result set returns NULL (not 0), producing NULL expected_mean → NULL z_score → cron comparison `z_score < -threshold` would be NULL-false → silent no-alert path. Empty events_mirror window for a never-fired event would never alert.
- **Fix:** Added `coalesce(avg(cnt), 0)` mirroring the stddev_samp coalesce. Function now returns 0/0/0 for never-fired events (z_score=0 via div-by-zero guard) — explicit no-op.
- **Files modified:** `supabase/migrations/20260601000033_funnel_anomaly_baseline_compute.sql`
- **Verification:** Inline review — both `avg` and `stddev_samp` wrapped in coalesce.
- **Commit:** `86fc47c`

**3. [Rule 3 - Blocker] worktree lacks node_modules — could not run vitest locally**
- **Found during:** Task 5 (api.test.ts verification step)
- **Issue:** This worktree (`agent-a0562b752038a97ab`) was created without `node_modules`. Per `[[feedback_worktree_executor_npm_install_leak]]`, running `npm install` in a worktree can write back to the MAIN checkout — destructive.
- **Fix:** Did NOT run `npm install` in the worktree. Test file was verified statically (mock shape mirrors `src/lib/admin/affiliate-review.ts` companion tests; vi.mock pattern is the project standard). The test will run during the orchestrator's post-merge `npm test` cycle.
- **Files modified:** none (decision documented here).
- **Verification:** Deferred to post-merge `npm test -- src/lib/admin/anomaly/api.test.ts`.
- **Impact:** Test exists + is structurally correct; just not executed in this worktree.

### Total deviations
3 auto-fixed (1 Rule 1 bug, 1 Rule 2 missing, 1 Rule 3 blocker workaround). **Impact:** Correctness-preserving — none changed plan scope. The `'true'` and `coalesce(avg)` fixes prevent silent failures; the npm-install workaround respects worktree isolation guarantees.

## Authentication Gates

None encountered in autonomous tasks 1-6.

## Deferred / vendor-gated tasks

### Task 7 — supabase db push + Edge Fn deploy + RPC sanity probes

**Status:** Deferred — requires `supabase` CLI which is not on PATH in this worktree.

The migrations + Edge Function code is committed and ready. To deploy:

```bash
cd /Users/karstenhaldan/minisite
supabase db push --linked 2>&1 | tee /tmp/27-04-push.log
# Verify no skips:
grep "^Skipping" /tmp/27-04-push.log && echo "FAIL — investigate skipped migrations"

supabase functions deploy funnel-anomaly-cron --no-verify-jwt --linked 2>&1 | tee /tmp/27-04-deploy.log

# Confirm table + function + cron presence:
supabase db query --linked "select count(*) from pg_tables where schemaname='public' and tablename in ('events_mirror','anomaly_tracked_funnels','funnel_anomaly_alerts')"
# expect 3
supabase db query --linked "select count(*) from public.anomaly_tracked_funnels where is_enabled=true"
# expect 5
supabase db query --linked "select count(*) from pg_proc where proname in ('funnel_anomaly_baseline_compute','funnel_anomaly_acknowledge')"
# expect 2
supabase db query --linked "select jobname, schedule from cron.job where jobname='funnel-anomaly-cron'"
# expect */5 * * * *
```

**Vendor secrets to set (Function Secrets — non-fatal if missing):**
- `SUPERADMIN_ALERTS_EMAIL` — `supabase secrets set SUPERADMIN_ALERTS_EMAIL=<founder-inbox>`. Without this set, email step is a graceful no-op + cron returns 200 with `email_skipped_unverified` or no email send.
- Vault `service_role_key` must be seeded (manual via Supabase Dashboard → Project Settings → Vault) per migration 35 header. Without it, the cron tick HTTP-POSTs with a literal `'Bearer '` (empty key) → Edge Fn `checkServiceRoleBearer` returns 401 → harmless no-op until Vault populated.

### Deno test — `supabase functions test`

Same blocker as Task 7 — requires `supabase` CLI (which bundles deno-cli). Test file follows the established `posthog-server.test.ts` shape; will run in CI when secrets + CLI are available.

### Phase 25 email-router integration

The Edge Fn dynamically imports `_shared/email-router.ts` with a try/catch fallback to `sendResendEmail`. If Phase 25 has already shipped, the dynamic import resolves the real router. If not, the fallback path sends a directly-formatted non-PHI email via `sendResendEmail`. No code change required when Phase 25 lands. Per `[[reference_vendor_gated_send_health_check]]`.

## Threat Flags

None new — every new threat is mapped to the threat-model table in the PLAN (`<threat_model>` block T-27-04-01..09) and mitigated in code:

| Threat ID    | Mitigated where                                                                          |
| ------------ | ---------------------------------------------------------------------------------------- |
| T-27-04-01   | `checkServiceRoleBearer` in `_shared/lifecycle-utils.ts` (constantTimeEqual)             |
| T-27-04-02   | events_mirror RLS enabled + zero policies                                                |
| T-27-04-03   | Broadcast payload schema is bounded: `{funnel_id, alert_id, fired_at, observed_count, expected_mean, expected_stddev, z_score, funnel_name}` — no user_id, no event properties |
| T-27-04-04   | funnel_anomaly_alerts RLS: SELECT-only for admin; NO INSERT/UPDATE/DELETE policy         |
| T-27-04-05   | acknowledge RPC writes audit_logs via log_admin_action (action_name='anomaly_acknowledged') with suppress_audit GUC |
| T-27-04-06   | 4h suppression check in cron handler + UNIQUE(funnel_id, tick_bucket) inner safety net   |
| T-27-04-07   | events_mirror has NO write policy → only service_role (= same trust boundary as PostHog) |
| T-27-04-08   | Accepted — SUPERADMIN_ALERTS_EMAIL is operator-managed; non-PHI payload limits blast radius |
| T-27-04-09   | funnel_anomaly_acknowledge SECDEF raises 42501 unless is_admin_at_least('admin')         |

## Known Stubs

None. AdminAnomalyBanner is fully wired to live Realtime data; AdminAnomalyAcknowledgeQueue is fully wired to live DB reads + RPC writes. AdminGlobals' lazy AdminCommandPalette renders null until Plan 27-03 ships — this is the intentional coordination pattern, not a stub.

## Next plan

Ready for `27-05` (Wave 2 — tracked-funnels admin config UI: /admin/anomaly settings page that lets superadmin manage `anomaly_tracked_funnels` rows). The data layer + acknowledge surface this plan ships are the read/write counterparts to Plan 27-05's config UI.

## Self-Check: PASSED

- Files created on disk verified via `ls`:
  - `supabase/migrations/20260601000030_events_mirror.sql` — FOUND
  - `supabase/migrations/20260601000031_anomaly_tracked_funnels.sql` — FOUND
  - `supabase/migrations/20260601000032_funnel_anomaly_alerts.sql` — FOUND
  - `supabase/migrations/20260601000033_funnel_anomaly_baseline_compute.sql` — FOUND
  - `supabase/migrations/20260601000034_funnel_anomaly_acknowledge_rpc.sql` — FOUND
  - `supabase/migrations/20260601000035_funnel_anomaly_cron_schedule.sql` — FOUND
  - `supabase/functions/funnel-anomaly-cron/{index,funnel-anomaly-cron.test}.ts` + deno.json — FOUND
  - `leanshot/src/lib/admin/anomaly/{api,realtime-channel}.ts` + `api.test.ts` — FOUND
  - `leanshot/src/components/admin/anomaly/{AdminAnomalyBanner,AdminAnomalyAcknowledgeQueue}.tsx` — FOUND
  - `leanshot/src/components/admin/AdminGlobals.tsx` — FOUND
  - `leanshot/tests/integration/{funnel-anomaly-detection,anomaly-suppression}.test.ts` — FOUND
- Modified files verified via `git diff --name-only`:
  - `supabase/functions/_shared/posthog-server.ts` — FOUND (events_mirror dual-write extension)
  - `leanshot/src/components/admin/AdminLayout.tsx` — FOUND (+1 import +1 JSX × 2 modes)
  - `leanshot/vitest-e2e.config.ts` — FOUND (2 integration test entries)
- Commits verified via `git log --oneline --grep="27-04"`: 6 of 6 task commits present (eff3b46 / 86fc47c / 9a254de / 5352808 / 297f986 / 22bfc21).
- Acceptance criteria re-run (grep-based static checks): all 4 in Task 1, 7 in Task 2, 4 in Task 3, 4 in Task 4 PASS.
- Dynamic acceptance criteria (vitest unit run + Deno test + supabase db push + functions test) require `node_modules` and `supabase`/`deno` CLIs which are not present in this worktree — deferred to post-merge / Task 7 manual deploy.
