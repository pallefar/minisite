---
phase: 55-healthkit-two-tunnel-firewall
plan: 03
type: execute
wave: 3
depends_on: [55-01, 55-02]
files_modified:
  - leanshot/src/lib/native/health.ts
  - leanshot/src/lib/native/health.test.ts
autonomous: true
requirements: [HEALTH-01, HEALTH-03, HEALTH-06, HEALTH-07]
must_haves:
  truths:
    - "health.ts exposes the full read-only HealthKit API: isHealthKitAvailable, requestHealthKitAuthorization, syncNow, revokeAccess, isEnabled, purgeImportedData"
    - "Mock HealthKit samples map to the correct destination: bodyMass→weights, sleep→sleep, steps→Zustand, heartRate+calories→workouts(cardio), protein→meals, height→profile"
    - "Imports are idempotent — re-syncing the same day's sample does not create a duplicate row (deterministic UUID-v5 dedupe)"
    - "Every public health.ts export calls assertHealthTunnel (runtime firewall layer)"
    - "On non-iOS the read functions no-op gracefully (return empty / false)"
    - "dietaryProtein returns empty (plugin limitation) with a Phase 70 note — not a silent drop"
  artifacts:
    - path: "leanshot/src/lib/native/health.ts"
      provides: "Full HealthKit read-only import implementation (replaces Phase 12 stub)"
      min_lines: 120
      exports: ["isHealthKitAvailable", "requestHealthKitAuthorization", "syncNow", "revokeAccess", "isEnabled", "purgeImportedData"]
    - path: "leanshot/src/lib/native/health.test.ts"
      provides: "Import-mapping unit tests with mock samples + dedupe + platform-guard + firewall-guard"
      min_lines: 80
  key_links:
    - from: "leanshot/src/lib/native/health.ts"
      to: "leanshot/src/lib/native/healthAssert.ts"
      via: "import { assertHealthTunnel } at top of public exports"
      pattern: "assertHealthTunnel"
    - from: "leanshot/src/lib/native/health.ts"
      to: "leanshot/src/lib/native/platform.ts"
      via: "detectPlatform (NOT @capacitor/core directly)"
      pattern: "detectPlatform"
    - from: "leanshot/src/lib/native/health.ts"
      to: "useStore.bulkSetSteps / supabase upsert"
      via: "import mapping writes"
      pattern: "bulkSetSteps|hk_source"
---

<objective>
Replace the Phase 12 `health.ts` stub with the full read-only HealthKit import implementation (HEALTH-01, HEALTH-03) and the revoke/purge/sync-state logic (HEALTH-06 structure, HEALTH-07 logic), all unit-tested against mock HealthKit samples (no device needed).

Purpose: this is the engine that turns Apple Health samples into rows in the user's existing dashboard tables, with idempotent dedupe and the runtime firewall guard wired in. On-device permission grant + real reads + background/battery behavior are deferred to Phase 70 — Phase 55 ships the code shape + mock tests for all of it.
Output: full `health.ts` + comprehensive `health.test.ts`.

DEPENDS ON: 55-01 (`healthAssert.ts` runtime guard) and 55-02 (plugin install + mock, `hk_source` columns, `upsert_healthkit_state`/`purge_healthkit_imports` RPCs).
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/ROADMAP.md
@.planning/STATE.md

# The stub being replaced + the firewall-safe platform helper:
@leanshot/src/lib/native/health.ts
@leanshot/src/lib/native/platform.ts

# Predecessor summaries (only the contracts this plan consumes):
@.planning/phases/55-healthkit-two-tunnel-firewall/55-01-SUMMARY.md
@.planning/phases/55-healthkit-two-tunnel-firewall/55-02-SUMMARY.md

<interfaces>
<!-- Contracts this plan builds against. Use directly — no codebase exploration. -->

From 55-01 (src/lib/native/healthAssert.ts):
  export function assertHealthTunnel(callerContext: string): void;  // throws in dev/test

From src/lib/native/platform.ts:
  export type Platform = 'web' | 'ios' | 'android' | 'capacitor-web';
  export function detectPlatform(): Platform;   // SOLE legitimate @capacitor/core import site

From @capgo/capacitor-health (mocked at src/lib/native/__mocks__/capgo-capacitor-health.ts by 55-02):
  Health.isAvailable(): Promise<{ available: boolean }>
  Health.requestAuthorization({ read: string[], write: [] }): Promise<{ authorized: boolean }>
  Health.readSamples({ dataType, startDate, endDate, limit }): Promise<{ samples: HKSample[] }>
  // HKSample: { dataType, value, unit, startDate, endDate, sourceName?, sourceId? }

From src/lib/store.ts (Zustand actions — call via useStore.getState()):
  bulkSetSteps(entries: Record<string, number>): void   // steps are Zustand-only, NO DB table
  upsertWeight(w: WeightLog): void
  addWorkout(w: Workout): void
  upsertSleep(s: SleepLog): void
  addMeal(m: Meal): void

Import-mapping table (plugin dataType → destination):
  'weight'    → public.weights  (date, weight, hk_source='apple_health'); dedupe UUID-v5(user:date:'weight':sourceId)
  'steps'     → Zustand bulkSetSteps({ [YYYY-MM-DD]: count })  (date-keyed dict = natural dedup; NO supabase.from('steps'))
  'sleep'     → public.sleep    (date, hours, hk_source); dedupe UUID-v5(user:date:'sleep':sourceId)
  'heartRate' → public.workouts (type='cardio', name='Apple Health – Heart Rate', minutes=1, hk_source); 1 synthetic row/day
  'calories'  → public.workouts (type='cardio', name='Apple Health Activity', hk_source)
  protein     → public.meals    (date, name='Apple Health Nutrition', protein, calories=0, fiber=0, meal_id=UUID-v5(user:date:'protein':sourceId), hk_source). meals PK is (user_id, meal_id).
  'height'    → profiles.height (one-time upsert)
  workouts.type CHECK = ('cardio','strength','flexibility','sport','walk','other') — HealthKit activity MUST use 'cardio'.

PITFALLS (obey):
- detectPlatform() !== 'ios' → all reads no-op (return [] / false). HealthKit is iOS-only.
- Do NOT import { Capacitor } from '@capacitor/core' in this file — use detectPlatform from ./platform.
- Do NOT write supabase.from('steps') — no such table. Steps = Zustand bulkSetSteps only.
- dietaryProtein is NOT in @capgo/capacitor-health v8.5.2 supported types → readDietaryProtein returns [] with a `// Phase 70:` note; HEALTH-03 lists it so ship the code shape, not a silent drop.
- Negation-grep trap: do NOT write ad-SDK names (ads/admob/marketing) as bare prose in this file — the existing Phase 12 import-x zones + 55-01 grep gate scan native/health*. Keep the firewall rationale in commit/SUMMARY only. (The mandatory "DO NOT import from ad surfaces" header from the original stub uses directory paths, not bare ad-SDK tokens — preserve that exact style.)
- Deterministic UUID: uuid v5 from `${userId}:${date}:${metric}:${sourceId}` (DNS namespace). Use the `uuid` package if present, else Web Crypto.
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Full health.ts implementation</name>
  <files>leanshot/src/lib/native/health.ts</files>
  <action>Replace the entire Phase 12 stub. Preserve the existing directory-path "DO NOT import from ad surfaces" header comment style (paths, not bare ad-SDK tokens). Imports: `Health` from '@capgo/capacitor-health', `detectPlatform` from './platform', `assertHealthTunnel` from './healthAssert', the Zustand store, supabase client, and a uuid-v5 helper. Export the public API: `isHealthKitAvailable(): Promise<boolean>` (returns false unless detectPlatform()==='ios' && Health.isAvailable().available); `requestHealthKitAuthorization(): Promise<boolean>` (calls assertHealthTunnel first, then Health.requestAuthorization with read:['weight','steps','sleep','heartRate','calories','height'], write:[]); `readHealthSamples(metric, start, end)` (assertHealthTunnel; iOS-guard returns [] off-iOS; Health.readSamples); `syncNow(start, end)` (reads each supported metric, maps + writes per the import-mapping table, sets hk_source='apple_health' on DB rows, dedupes via deterministic UUID-v5, updates last_synced_at via upsert_healthkit_state, returns a per-metric import count summary); `isEnabled(): Promise<boolean>` (reads healthkit_sync_state.healthkit_enabled); `revokeAccess(): Promise<void>` (calls upsert_healthkit_state(false, ...) → blocks future syncs, sets revoked_at); `purgeImportedData(): Promise<void>` (calls purge_healthkit_imports RPC for the current user); `readDietaryProtein()` returns [] with a `// Phase 70:` note (plugin gap). Mapping helpers: bodyMass→upsertWeight, steps→bulkSetSteps (Zustand-only), sleep→upsertSleep, heartRate→synthetic cardio workout 'Apple Health – Heart Rate' minutes=1, calories→cardio workout 'Apple Health Activity', protein→addMeal name='Apple Health Nutrition' meal_id=UUID-v5, height→profile upsert. Battery-aware skip + background-task registration are structural stubs with `// Phase 70:` notes (HEALTH-06 on-device deferred per D-08) — ship a `shouldSkipForBattery()` shape returning false in mock/non-iOS. Every public export's FIRST statement is assertHealthTunnel('<fnName>').</action>
  <verify>
    <automated>cd leanshot && npm run typecheck && npm run lint -- src/lib/native/health.ts && grep -c "assertHealthTunnel" src/lib/native/health.ts</automated>
  </verify>
  <done>health.ts typechecks, lints clean (firewall rules pass), every public export calls assertHealthTunnel, uses detectPlatform (no direct @capacitor/core import), no supabase.from('steps').</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: health.test.ts — import-mapping, dedupe, guards</name>
  <files>leanshot/src/lib/native/health.test.ts</files>
  <behavior>
    - vi.mock('@capgo/capacitor-health') uses the 55-02 mock; detectPlatform mocked to 'ios'.
    - mock weight samples → upsertWeight called with date/weight + hk_source='apple_health'.
    - mock step samples → bulkSetSteps called with a date-keyed dict; NO supabase.from('steps').
    - mock sleep samples → upsertSleep with hours + hk_source.
    - mock heartRate/calories samples → addWorkout with type='cardio' + hk_source.
    - mock protein samples → addMeal name='Apple Health Nutrition' + meal_id present + hk_source.
    - dedupe: syncing the SAME sample twice produces the SAME deterministic id (no duplicate distinct row).
    - platform guard: detectPlatform mocked to 'web'/'android' → readHealthSamples returns [], no writes.
    - dietaryProtein: readDietaryProtein returns [] (plugin gap; Phase 70).
    - revokeAccess calls upsert_healthkit_state(false); purgeImportedData calls purge_healthkit_imports RPC.
  </behavior>
  <action>Create the vitest suite covering every `<behavior>` case. Mock the plugin (vi.mock to the 55-02 __mocks__ file), mock detectPlatform per-test, spy on the Zustand actions (useStore.getState) and the supabase RPC calls. Assert destination correctness, hk_source tagging, deterministic-id dedupe (call the id helper twice with the same inputs → equal), the iOS platform guard, and the dietaryProtein empty-return. Use the Vitest 4.x targeted-run caveat: tests live under the default `src/**/*.test.ts` glob.</action>
  <verify>
    <automated>cd leanshot && npx vitest run src/lib/native/health.test.ts</automated>
  </verify>
  <done>All mapping/dedupe/guard tests pass; mock samples land in correct tables with hk_source; steps go to Zustand only; revoke/purge call the right RPCs; non-iOS no-ops.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| HealthKit native → client mapping | PHI enters app state; must be tagged + isolated from ad surfaces |
| client → supabase upsert / RPC | per-user write of imported rows under RLS |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-55-03-01 | Information Disclosure | health.ts PHI reaching ad context | mitigate | assertHealthTunnel at every public export (runtime firewall layer 2); import-x zones + grep gate cover static |
| T-55-03-02 | Tampering | duplicate/forged imported rows on re-sync | mitigate | deterministic UUID-v5 dedupe (user:date:metric:sourceId); RLS prevents cross-user writes |
| T-55-03-03 | Denial of Service | bulk import overwhelming DB | mitigate | limit:500 per readSamples; one metric at a time |
| T-55-03-04 | Spoofing | non-iOS calling HealthKit | mitigate | detectPlatform()==='ios' guard before any plugin call |
</threat_model>

<verification>
- `npx vitest run src/lib/native/health.test.ts` — all mapping/dedupe/guard tests green
- `npm run typecheck` — strict pass
- `npm run lint` — Phase 12 import-x zones + 55-01 rule + grep gate all pass on health.ts
- `grep "detectPlatform" src/lib/native/health.ts` present; `grep "@capacitor/core" src/lib/native/health.ts` absent
- `grep "supabase.from('steps')" src/lib/native/health.ts` absent
</verification>

<success_criteria>
- Full read-only HealthKit implementation replacing the stub (HEALTH-01, HEALTH-03).
- Idempotent mock-tested import mapping to existing tables + Zustand steps (HEALTH-03).
- revoke/purge/sync-state logic wired to 55-02 RPCs (HEALTH-07); battery/background structural stubs noted for Phase 70 (HEALTH-06).
- Runtime firewall guard at every export; firewall lint/grep clean.
- On-device read/sync/background/battery → Phase 70 HUMAN-UAT (scaffold + note, not silent drop).
</success_criteria>

<output>
Create `.planning/phases/55-healthkit-two-tunnel-firewall/55-03-SUMMARY.md` when done.
Note in SUMMARY the Phase 70 device-gated items: real permission grant, real reads, background BGAppRefreshTask, battery-state behavior, dietaryProtein plugin gap.
</output>
