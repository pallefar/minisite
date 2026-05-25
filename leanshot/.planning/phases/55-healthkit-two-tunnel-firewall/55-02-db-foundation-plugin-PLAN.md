---
phase: 55-healthkit-two-tunnel-firewall
plan: 02
type: execute
wave: 2
depends_on: [55-01]
files_modified:
  - supabase/migrations/20280301000001_p55_hk_source_columns.sql
  - supabase/migrations/20280301000002_p55_healthkit_sync_state.sql
  - supabase/migrations/20280301000003_p55_healthkit_rpcs.sql
  - leanshot/package.json
  - leanshot/package-lock.json
  - leanshot/src/lib/native/__mocks__/capgo-capacitor-health.ts
autonomous: false
requirements: [HEALTH-03, HEALTH-07]
user_setup: []
must_haves:
  truths:
    - "weights, sleep, workouts, meals each have a nullable hk_source text column for import tagging + purge"
    - "A per-user healthkit_sync_state row tracks enabled flag, sync interval, last_synced_at, revoked_at with RLS"
    - "A SECDEF purge RPC deletes only the calling user's hk_source='apple_health' rows"
    - "A SECDEF upsert RPC safely toggles the per-user enabled flag + sync interval"
    - "@capgo/capacitor-health is installed and a vitest mock exists for it"
  artifacts:
    - path: "supabase/migrations/20280301000001_p55_hk_source_columns.sql"
      provides: "hk_source nullable column on weights/sleep/workouts/meals"
      contains: "add column if not exists hk_source"
    - path: "supabase/migrations/20280301000002_p55_healthkit_sync_state.sql"
      provides: "healthkit_sync_state table + RLS own-row policy"
      contains: "create table public.healthkit_sync_state"
    - path: "supabase/migrations/20280301000003_p55_healthkit_rpcs.sql"
      provides: "purge_healthkit_imports + upsert_healthkit_state SECDEF RPCs"
      contains: "security definer"
    - path: "leanshot/src/lib/native/__mocks__/capgo-capacitor-health.ts"
      provides: "vitest mock of the Health plugin (isAvailable/requestAuthorization/readSamples)"
      exports: ["Health"]
  key_links:
    - from: "supabase/migrations/20280301000003_p55_healthkit_rpcs.sql"
      to: "weights/sleep/workouts/meals.hk_source"
      via: "DELETE WHERE hk_source = 'apple_health'"
      pattern: "hk_source = 'apple_health'"
    - from: "supabase/migrations/20280301000002_p55_healthkit_sync_state.sql"
      to: "auth.uid()"
      via: "RLS own-row policy"
      pattern: "auth.uid\\(\\) = user_id"
---

<objective>
Lay the database + dependency foundation for the HealthKit import pipeline:
1. Add the `hk_source` tag column to the four import-target tables so HealthKit-imported rows are distinguishable and purgeable.
2. Create the per-user `healthkit_sync_state` table (opt-in flag + interval + last-sync + revoke timestamp) with RLS so the server is the source of truth for HEALTH-07.
3. Create the SECDEF RPCs: `purge_healthkit_imports` (HEALTH-07 purge) and `upsert_healthkit_state` (safe toggle).
4. Install `@capgo/capacitor-health` (the only Capacitor-8-compatible HealthKit plugin) and create its vitest mock so Plan 55-03 / 55-04 unit tests run with no native runtime.

Purpose: every downstream task (import mapping, revoke/purge UI, sync state) needs this schema + the plugin present. This plan owns ALL migrations + the plugin install so no other plan touches them.
Output: 3 forward-dated migrations, plugin in package.json + lockfile, plugin mock.

NOTE: On-device HealthKit reads / entitlement provisioning / live sync are deferred to Phase 70 (per D-08). This plan ships only the schema, RPCs, and the installed (mock-testable) plugin.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/ROADMAP.md
@.planning/STATE.md

# Import-target table schemas (composite PK, client-generated uuid, RLS own-row):
@supabase/migrations/20260514000001_meals.sql

# Existing native plugin mock convention (mirror this shape for the health plugin mock):
@leanshot/src/lib/native/__mocks__/capgo-native-biometric.ts

<interfaces>
<!-- Import-target table contracts (confirmed by reading migrations) -->

weights:  PK (user_id, weight_id uuid); cols date text, weight numeric, body_fat numeric; RLS own-row; moddatetime LWW (client MUST NOT pass updated_at)
sleep:    PK (user_id, sleep_id uuid);  cols date text, hours numeric, quality numeric; RLS own-row; moddatetime LWW
meals:    PK (user_id, meal_id uuid);   cols date text, name text, calories numeric, protein numeric, fiber numeric, hunger numeric, satisfaction numeric, ts bigint; RLS own-row; moddatetime LWW
workouts: PK (user_id, workout_id uuid); type CHECK ('cardio','strength','flexibility','sport','walk','other'); cols date, type, name, minutes; RLS own-row

Forward-date floor: latest existing migration is 20280201000002. New migrations MUST sort AFTER it. Use the 20280301000001/2/3 prefixes above.

Plugin install: `npm install @capgo/capacitor-health --legacy-peer-deps` (the @sentry/capacitor sibling-check requires --legacy-peer-deps per project memory). Then `npx cap sync` (cap sync only — no `cap add`, no cocoapods; native dirs at leanshot/apps/ios + apps/android).

Plugin API surface to mock (from research, @capgo/capacitor-health ^8.5.2):
- `Health.isAvailable(): Promise<{ available: boolean }>`
- `Health.requestAuthorization({ read: string[], write: string[] }): Promise<{ authorized: boolean }>`
- `Health.readSamples({ dataType, startDate, endDate, limit }): Promise<{ samples: Array<{ dataType, value, unit, startDate, endDate, sourceName?, sourceId? }> }>`
(API shapes are MEDIUM-confidence per RESEARCH assumptions A1/A2; on-device verification is Phase 70.)
</interfaces>
</context>

<tasks>

<task type="checkpoint:human-verify" gate="blocking-human">
  <what-built>Pre-install package legitimacy verification for `@capgo/capacitor-health` ^8.5.2. RESEARCH tagged this package [ASSUMED] (slopcheck unavailable at research time): 13,372 weekly downloads, source repo github.com/Cap-go/capacitor-health, first published 2025-09-24, no postinstall script detected, Capgo is a known Capacitor plugin org. It is the ONLY Capacitor-8-compatible HealthKit plugin (the alternative @perfood/capacitor-healthkit requires @capacitor/core ^4.0.0).</what-built>
  <how-to-verify>
    1. Open https://www.npmjs.com/package/@capgo/capacitor-health — confirm it exists, weekly downloads are in the thousands, repo link resolves to github.com/Cap-go/capacitor-health.
    2. Confirm `peerDependencies` lists `@capacitor/core >= 8.0.0` (Capacitor-8 compatible).
    3. Confirm no suspicious `postinstall`/`preinstall` script in the package.json on the npm page.
    4. If satisfied, approve install. If anything looks off (typosquat, abandoned, malicious script), reject and the executor will fall back to a custom Swift bridge (deferred to Phase 70).
  </how-to-verify>
  <resume-signal>Type "approved" to authorize `npm install @capgo/capacitor-health --legacy-peer-deps`, or describe the concern.</resume-signal>
</task>

<task type="auto">
  <name>Task 1: Forward-dated migrations — hk_source columns, sync-state table, RPCs</name>
  <files>supabase/migrations/20280301000001_p55_hk_source_columns.sql, supabase/migrations/20280301000002_p55_healthkit_sync_state.sql, supabase/migrations/20280301000003_p55_healthkit_rpcs.sql</files>
  <action>Create three forward-dated migrations (all sort after 20280201000002). (1) `20280301000001_p55_hk_source_columns.sql`: `alter table public.{weights,sleep,workouts,meals} add column if not exists hk_source text;` (nullable; set to 'apple_health' for imported rows; existing manual rows stay NULL). (2) `20280301000002_p55_healthkit_sync_state.sql`: create `public.healthkit_sync_state` with `user_id uuid primary key references auth.users(id) on delete cascade`, `healthkit_enabled boolean not null default false`, `sync_interval text not null default '6h' check (sync_interval in ('1h','6h','24h'))`, `last_synced_at timestamptz`, `revoked_at timestamptz`, `created_at`/`updated_at timestamptz not null default now()`; enable RLS; add a `for all` own-row policy `using (auth.uid() = user_id) with check (auth.uid() = user_id)`; add a moddatetime trigger on updated_at to match the project LWW convention (extensions.moddatetime). (3) `20280301000003_p55_healthkit_rpcs.sql`: two SECDEF functions with `set search_path = public, extensions, pg_catalog`. `purge_healthkit_imports(p_user_id uuid) returns void` — raise exception 'not_authorized' errcode 28000 if `auth.uid() is null or auth.uid() != p_user_id`, then `delete from {weights,sleep,workouts,meals} where user_id = p_user_id and hk_source = 'apple_health'`; `revoke all from public`, `grant execute to authenticated`. `upsert_healthkit_state(p_enabled boolean, p_sync_interval text) returns public.healthkit_sync_state` — guard `auth.uid() is not null`, validate p_sync_interval in ('1h','6h','24h'), `insert ... (auth.uid(), p_enabled, p_sync_interval) on conflict (user_id) do update set healthkit_enabled = excluded.healthkit_enabled, sync_interval = excluded.sync_interval, revoked_at = case when excluded.healthkit_enabled then null else now() end` returning the row; revoke from public, grant execute to authenticated. The audit_phi_table_triggers already auto-audit weights/sleep/workouts/meals writes, so no extra log_phi_access call is needed inside the purge RPC.</action>
  <verify>
    <automated>cd /Users/karstenhaldan/minisite && ls supabase/migrations/20280301000001_p55_hk_source_columns.sql supabase/migrations/20280301000002_p55_healthkit_sync_state.sql supabase/migrations/20280301000003_p55_healthkit_rpcs.sql && grep -q "hk_source" supabase/migrations/20280301000001_p55_hk_source_columns.sql && grep -q "auth.uid() = user_id" supabase/migrations/20280301000002_p55_healthkit_sync_state.sql && grep -c "security definer" supabase/migrations/20280301000003_p55_healthkit_rpcs.sql</automated>
  </verify>
  <done>Three migrations exist; hk_source added to all four tables; sync_state table has RLS own-row policy; both RPCs are SECDEF with auth.uid() guards and a `hk_source = 'apple_health'` purge filter. (Live `supabase db push` is deferred to phase close-out / Phase 70 — these are file-only deliverables.)</done>
</task>

<task type="auto">
  <name>Task 2: Install @capgo/capacitor-health + vitest mock</name>
  <files>leanshot/package.json, leanshot/package-lock.json, leanshot/src/lib/native/__mocks__/capgo-capacitor-health.ts</files>
  <action>Run `npm install @capgo/capacitor-health --legacy-peer-deps` from `leanshot/` (the --legacy-peer-deps flag is required for the @sentry/capacitor sibling-check; if install still aborts, symlink the main node_modules per project memory). Pin the resolved `^8.5.2` in package.json dependencies. Run `npx cap sync` (cap sync only — no cap add / cocoapods). Create the vitest mock `src/lib/native/__mocks__/capgo-capacitor-health.ts` mirroring the shape of `capgo-native-biometric.ts`: export a `Health` object whose `isAvailable()` resolves `{ available: true }`, `requestAuthorization()` resolves `{ authorized: true }`, and `readSamples({ dataType })` resolves `{ samples: [] }` by default (tests in 55-03 will override per-metric). This mock lets 55-03/55-04 unit tests import the plugin without a native runtime. Do NOT write any ad-SDK names in this file.</action>
  <verify>
    <automated>cd leanshot && grep -q "@capgo/capacitor-health" package.json && test -f src/lib/native/__mocks__/capgo-capacitor-health.ts && npm run typecheck</automated>
  </verify>
  <done>Plugin in package.json + lockfile; `npx cap sync` succeeded; mock file exports `Health` with isAvailable/requestAuthorization/readSamples; typecheck passes.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| client → SECDEF RPC | caller-supplied p_user_id / p_enabled crosses into elevated-privilege execution |
| npm registry → repo | third-party package install (supply-chain) |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-55-02-01 | Elevation of Privilege | purge_healthkit_imports SECDEF | mitigate | raise not_authorized when auth.uid() is null or != p_user_id; revoke from public, grant only to authenticated |
| T-55-02-02 | Tampering | direct write of forged hk_source on a row | accept | RLS (auth.uid() = user_id) prevents cross-user writes; hk_source is a tag, not a trust boundary |
| T-55-02-03 | Input Validation | bad sync_interval value | mitigate | CHECK constraint ('1h','6h','24h') on table + validation in upsert RPC |
| T-55-02-04 | Information Disclosure | cross-user read of sync state | mitigate | RLS own-row policy (auth.uid() = user_id) on healthkit_sync_state |
| T-55-02-SC | Tampering | @capgo/capacitor-health install (supply chain) | mitigate | [ASSUMED] package gated behind blocking-human checkpoint (verify npmjs.com); no postinstall script |
</threat_model>

<verification>
- Three migration files exist and sort after 20280201000002
- `grep -c "security definer"` on the RPC migration returns 2
- Plugin present in package.json; mock exports Health; typecheck passes
- (Deferred) live `supabase db push` + on-device read → phase close-out / Phase 70
</verification>

<success_criteria>
- hk_source nullable column on weights/sleep/workouts/meals (HEALTH-03 import tagging, HEALTH-07 purge target).
- healthkit_sync_state table with RLS + purge/upsert SECDEF RPCs (HEALTH-07).
- @capgo/capacitor-health installed (legitimacy-checkpointed) + vitest mock ready for 55-03/04.
</success_criteria>

<output>
Create `.planning/phases/55-healthkit-two-tunnel-firewall/55-02-SUMMARY.md` when done.
Note in SUMMARY: migrations are file-only; live `supabase db push` deferred to phase close-out push-status matrix (per project phase-close-out db-push memory).
</output>
