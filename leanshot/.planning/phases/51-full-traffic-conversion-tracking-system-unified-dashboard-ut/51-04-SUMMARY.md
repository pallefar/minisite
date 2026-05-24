---
phase: 51-full-traffic-conversion-tracking-system-unified-dashboard-ut
plan: 04
subsystem: traffic-anomaly-alerting
tags: [traffic, anomaly, cron, secdef-rpc, admin-notifications]
status: complete
completed: 2026-05-24
requirements:
  - TRAFFIC-11
dependency_graph:
  requires:
    - 51-01 (channel_groups taxonomy + classify wrapper)
    - 51-03 (traffic_funnel_rollup matview + SECDEF accessors)
  provides:
    - compute_channel_stage_rate SECDEF RPC (service-role-only)
    - per-channel-stage anomaly scan inside existing funnel-anomaly-cron tick
    - admin_notifications widened with (kind, dedup_key, payload) columns
  affects:
    - downstream Plan 51-07 TrafficFunnelsTab anomaly badge surface (reads kind='traffic_funnel_drop' rows)
    - downstream Plan 51-10 multi-signal HUMAN-UAT Signal-5 (synthetic / organic anomaly verification)
tech_stack:
  added: []
  patterns:
    - SECDEF RPC + service_role grant (no auth.uid; cron-callable per memory feedback_rpc_auth_uid_vs_service_role_mismatch)
    - Multi-dimensional dedup_key + 4h suppression + onConflict:ignoreDuplicates
    - Additive Edge-Fn extension (pure-additive; per-funnel loop untouched, runs serially first)
key_files:
  created:
    - supabase/migrations/20271102000014_compute_channel_stage_rate_rpc.sql
  modified:
    - supabase/functions/funnel-anomaly-cron/index.ts
    - supabase/functions/funnel-anomaly-cron/funnel-anomaly-cron.test.ts
    - supabase/config.toml
    - leanshot/.planning/ROADMAP.md
decisions:
  - "D-06 / D-08 per-channel × audience × stage_pair anomaly alerting implemented entirely inside existing Phase 24 funnel-anomaly-cron tick — zero new cron schedules."
  - "admin_notifications widened with kind + dedup_key + payload columns (preflight outcome #2 — table structure inferred from code; no CHECK constraint to amend)."
  - "Stage-pair list hardcoded as a mirror of the migration 20271102000009 stage_pairs VALUES list; if 51-03 widens funnels, this constant + the matview must update together."
metrics:
  duration_minutes: ~25
  tasks_completed: 2
  files_changed: 5
---

# Phase 51 Plan 51-04: compute_channel_stage_rate RPC + funnel-anomaly-cron per-channel-stage anomaly scan Summary

**One-liner:** Per-channel × audience × stage_pair funnel-drop anomaly alerting, plugged into the existing 5-min funnel-anomaly-cron tick via a new SECDEF RPC (`compute_channel_stage_rate`) reading `traffic_funnel_rollup` and writing dedup-keyed rows into the existing `admin_notifications` surface — zero new cron infrastructure.

## What shipped

1. **Migration `20271102000014_compute_channel_stage_rate_rpc.sql`** (new):
   - Widens `public.admin_notifications` with three additive columns (`kind text`, `dedup_key text`, `payload jsonb`), each nullable.
   - Partial UNIQUE index `admin_notifications_dedup_key_uq` on `dedup_key WHERE dedup_key IS NOT NULL` — required for the `onConflict:'dedup_key'` upsert path; preserves legacy rows untouched.
   - SECDEF function `compute_channel_stage_rate(text, text, text, text, int) RETURNS TABLE (observed_rate, expected_rate, expected_stddev)` reading `traffic_funnel_rollup` over a rolling window (`p_window_days` default 7, excludes today). `EXECUTE` granted to `service_role` only; revoked from `public`/`anon`/`authenticated`. Body contains zero session-user lookups.
   - `STABLE`, `LANGUAGE plpgsql`, `SET search_path = pg_catalog, public, extensions`.

2. **`supabase/functions/funnel-anomaly-cron/index.ts`** (extended):
   - New `runTrafficFunnelAnomalyScan(admin, result, now)` helper iterates `channel_groups.label × {consumer, clinic-org, affiliate} × stage_pairs[audience]`. For each tuple it calls `compute_channel_stage_rate`, computes `sigmas = (expected - observed) / stddev`, skips rows lacking baseline (`stddev=0` or `expected=0`), 4h-suppression-checks `admin_notifications` by `dedup_key` + `created_at >= now()-4h`, then upserts with `onConflict:'dedup_key', ignoreDuplicates:true`.
   - Dedup key shape: `traffic_funnel_drop:<channel_group>:<audience>:<stage_in>_<stage_out>:<YYYY-MM-DD>` — full plan-mandated multi-dimensional fingerprint.
   - Upsert row populates BOTH the new (`kind`, `dedup_key`, `payload`) and legacy (`type`, `title`, `body`) columns so the existing P27 admin UI surfaces these rows without code changes.
   - New counter triplet `channel_stage_checked / fired / suppressed` appended to the cron response envelope. Existing `checked / fired / suppressed / emails_sent / email_skipped_unverified` counters untouched.
   - Wrapped in `try/catch` — extension errors log + the per-funnel loop's results still propagate.

3. **`supabase/config.toml`** (extended):
   - Added `[functions.funnel-anomaly-cron] verify_jwt = false` block — the cron caller carries a service-role bearer that the Fn's own `checkServiceRoleBearer` validates; dropping the gateway gate is required when the project ships the new `sb_secret_*` token format (memory: `reference_supabase_service_role_key_format_divergence`).

4. **`funnel-anomaly-cron.test.ts`** (extended):
   - Test stub `makeStubAdmin` extended with `channel_groups` + `admin_notifications` table handlers and a `compute_channel_stage_rate` rpc branch. Defaults return empty/null so the new loop short-circuits — keeping the 5 existing Phase-27 behaviors green without rewriting them.
   - **Auto-fixed** (Rule 1) a pre-existing JSDoc block-comment in the test header that contained `*/5` and silently aborted `deno test` parsing on `main`. Verified pre-existing by running `deno test` on a stashed working tree.

## Verification

| Verify block | Result |
|--------------|--------|
| Task 1: `test -f migration + compute_channel_stage_rate grep + zero auth.uid + search_path grep` | ✅ all four green |
| Task 2: `compute_channel_stage_rate grep + traffic_funnel_drop grep + dedup_key grep` | ✅ all three green (counts 3 / 1 / 5) |
| Task 2: `deno test --no-check --allow-env --allow-net supabase/functions/funnel-anomaly-cron/` | ✅ 5 / 5 tests passed in 45ms |
| `deno check --no-config` on the modified Edge Fn | ✅ clean |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 — Bug] Pre-existing JSDoc `*/5` aborted `deno test` parser**
- **Found during:** Task 2 verify (`deno test` step).
- **Issue:** `funnel-anomaly-cron.test.ts:2` contained `*/5 cron Edge Function` inside the leading JSDoc. Deno's TS parser closes the block comment at the first `*/`, then chokes on the trailing token. The file has been un-runnable since 27-04-03 shipped on 2026-04-? — caught here because the plan's verify block runs the test suite.
- **Fix:** Rewrote the JSDoc opening line to spell out "every-5-minute" + added a one-line warning comment explaining the trap so future edits don't reintroduce it.
- **Files modified:** `supabase/functions/funnel-anomaly-cron/funnel-anomaly-cron.test.ts`.
- **Scope:** This is technically pre-existing breakage outside Plan 51-04's declared `files_modified`, but the plan's verify block requires the test suite to be runnable. Self-contained one-line fix; no behavior change. Logged here (not in `deferred-items.md`) because the fix shipped in this plan's commit.

**2. [Rule 3 — Blocking] admin_notifications canonical schema mismatch — widen with new columns**
- **Found during:** Task 1 preflight (post-orchestrator-prompt; live db not queryable in worktree).
- **Issue:** Plan must_haves assume `admin_notifications` already has `kind` / `dedup_key` / `payload` columns. Code references in `supabase/functions/_shared/ad-etl-utils.ts:206` and three Phase 33 migrations (`20270703000011..13`) prove the **canonical columns are `(title, body, type)`** — the `kind` / `dedup_key` / `payload` set does not exist. No `create table public.admin_notifications` ships in tracked migrations (table predates the tracked window; Phase 27 created it via a path not present on `main`).
- **Fix:** The migration adds the three required columns as nullable, with a partial UNIQUE index on `dedup_key` (preserves legacy NULL-keyed rows). Edge Fn writes BOTH the new and legacy column sets in the same upsert so existing admin-UI consumers continue to render these rows. This is the "no new table" path mandated by plan must_haves and treated as preflight outcome #2 + structural widening.
- **Files modified:** `supabase/migrations/20271102000014_compute_channel_stage_rate_rpc.sql`, `supabase/functions/funnel-anomaly-cron/index.ts`.

### Renames

**3. [Orchestrator preflight] Migration timestamp `20270712000013` → `20271102000014`**
- The plan-declared timestamp `20270712000013` collided with the existing tracked-migration window (Phase 33 reserved `20270703*`; Phase 51 reserved `20271102*`). Latest applied: `20271102000013_traffic_matview_refresh_cron.sql`. Renamed to `20271102000014` to slot atop the 51-01 + 51-03 stack — matches per-phase migration-stamp convention.

### API-shape adaptations

**4. [Plan vs runtime] `admin()` function → `admin` proxy**
- Plan code used `admin()` (function call). The actual `makeLazyAdmin()` helper returns a Proxy `admin` (not a function — see `supabase/functions/_shared/lifecycle-utils.ts:63`). Adapted all extension calls to `admin.from(...)` / `admin.rpc(...)`.

## Forward effects for downstream plans

> Per memory `feedback_summary_forward_effects_section`. Plans 51-07 + 51-10 should consult this before authoring their own slabs.

- **Plan 51-07 (TrafficFunnelsTab anomaly badge surface):**
  - Read `admin_notifications` filtered by `kind = 'traffic_funnel_drop'` (use the new `kind` column, NOT `type` — `type` is a legacy mirror).
  - `payload` is the structured envelope: `{ channel_group, audience, funnel, stage_in, stage_out, observed_rate, expected_rate, expected_stddev, sigmas, date }`. All numeric fields are returned as PostgREST `number` (RPC originated, not text).
  - Dedup key shape is `traffic_funnel_drop:<channel_group>:<audience>:<stage_in>_<stage_out>:<YYYY-MM-DD>` — if the badge surface wants "today's anomalies" it can filter `created_at >= date_trunc('day', now())` OR slice the dedup_key suffix.
  - Anomaly threshold is **2σ negative** (i.e. observed < expected by ≥ 2 sample-stddev). The cron's logic flips the sign so `sigmas` in `payload` is always positive when an alert fires (`sigmas >= 2`).
  - The legacy mirror (`type`, `title`, `body`) is populated for backward-compatible admin-UI rendering — if 51-07 surfaces these in a dedicated drawer, prefer `payload` for typed access.

- **Plan 51-10 (push gate + multi-signal HUMAN-UAT):**
  - **Push order matters:** this migration MUST land before the funnel-anomaly-cron Fn is re-deployed (or the deploy must follow immediately). Otherwise the cron's upsert would fail the `dedup_key` UNIQUE absence check at runtime — caught by the `if (insErr) console.warn(...)` guard, so the per-funnel loop still ticks, but no traffic anomalies fire. Plan 51-10 should sequence: `supabase db push --linked` → `supabase functions deploy funnel-anomaly-cron`.
  - The `[functions.funnel-anomaly-cron] verify_jwt = false` block in `supabase/config.toml` will take effect on the next deploy; the existing Phase 24 cron schedule continues to send the service-role bearer the Fn's internal `checkServiceRoleBearer` validates.
  - **Signal-5 (Funnel anomaly alert surfaces) UAT recipe:** insert a synthetic row into `traffic_funnel_rollup` (matview is concurrent-refresh — direct INSERT is impossible; instead seed `events_mirror` with a sharp drop for a single `(channel_group, audience, stage_pair, day)` then wait for the next P51 matview refresh tick) OR wait for organic data. After the next funnel-anomaly-cron tick (within 5min), expect a new `admin_notifications` row with `kind = 'traffic_funnel_drop'` and a matching `dedup_key`.

- **Plan 51-04 → 51-03 stage-pair coupling (PRESERVATION INVARIANT):**
  - The TS constant `TRAFFIC_STAGE_PAIRS` in `funnel-anomaly-cron/index.ts` is a hand-mirror of the `stage_pairs (audience, funnel, stage_in, stage_out, ...) values ...` VALUES list in migration `20271102000009`. If a future plan widens the funnels (e.g. adds a `'retained'` stage), BOTH the migration AND this constant MUST be updated atomically — otherwise the cron will silently miss anomalies for the new stage.

## Threat Flags

None. The plan's `<threat_model>` (T-51-21..24) covers DoS, info-disclosure, tampering, and repudiation — all dispositions implemented as-designed (serial loop bounds RPC pressure; admin_notifications RLS preserved from P27; matview-only read path for baseline; 4h dedup window).

## Known Stubs

None — the per-channel-stage loop is wired end-to-end (taxonomy read → RPC → admin_notifications upsert). Empty `channel_groups` causes a no-op log + early return (correct behavior pre-51-01 deploy, but 51-01 has already shipped + merged so the taxonomy is populated in main).

## Self-Check

- [x] `supabase/migrations/20271102000014_compute_channel_stage_rate_rpc.sql` exists.
- [x] `supabase/functions/funnel-anomaly-cron/index.ts` contains `compute_channel_stage_rate` (3 occurrences) + `traffic_funnel_drop` (1) + `dedup_key` (5).
- [x] `supabase/config.toml` contains `[functions.funnel-anomaly-cron]` + `verify_jwt = false`.
- [x] `funnel-anomaly-cron.test.ts` parses + 5/5 Deno tests pass.
- [x] No `auth.uid()` in the new SECDEF body (grep count 0).
- [x] ROADMAP.md 51-04 row toggled `[ ]` → `[x]`.

## Self-Check: PASSED
