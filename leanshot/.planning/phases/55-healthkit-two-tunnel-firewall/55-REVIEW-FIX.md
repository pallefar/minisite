---
phase: 55-healthkit-two-tunnel-firewall
fixed_at: 2026-05-25T15:38:00Z
review_path: leanshot/.planning/phases/55-healthkit-two-tunnel-firewall/55-REVIEW.md
iteration: 1
findings_in_scope: 12
fixed: 11
skipped: 0
status: all_fixed
---

# Phase 55: Code Review Fix Report

**Fixed at:** 2026-05-25T15:38:00Z
**Source review:** leanshot/.planning/phases/55-healthkit-two-tunnel-firewall/55-REVIEW.md
**Iteration:** 1

**Summary:**
- Findings in scope: 12 (7 Critical + 5 Warning)
- Fixed: 11 (all; WR-04 was addressed as part of CR-02)
- Skipped: 0

---

## Fixed Issues

### CR-01: FIREWALL Layer 2 redesign — assertNoHealthData boundary guard

**Files modified:** `leanshot/src/lib/native/healthAssert.ts`, `leanshot/src/lib/native/healthAssert.test.ts`, `leanshot/src/lib/native/ads.ts`
**Commit:** 88da6760
**Applied fix:**

Redesigned Layer 2 into two distinct functions:

- `assertHealthTunnel(_ctx)` is now a documented no-op marker. Runtime callstack detection is not feasible in a bundled SPA; unconditionally throwing broke all legitimate health reads in dev/test. The function is kept for documentation continuity and tracing hooks.
- `assertNoHealthData(value, ctx?)` is the real ad-boundary guard, added fresh. It throws in BOTH dev AND prod (never silently no-ops) when any health-shaped field name (bodyMass/weight/steps/sleep/heartRate/height/hk_source/calories etc.) is detected on a value being passed to ad-targeting code.
- `ads.ts` updated to import `assertNoHealthData` from `./healthAssert` and call it at the targeting entry point (`initAdNetwork`), demonstrating the guard pattern Phase 20 must follow.
- Test suite updated to 19 tests: Part A proves `assertHealthTunnel` no longer throws (normal health reads unaffected); Part B proves `assertNoHealthData` throws on health-shaped data and passes on clean data.

**Judgment call on placement:** CR-01 says to add the boundary guard at `ads.ts`'s "targeting/params path." Since `ads.ts` is a Phase 12 stub (no real targeting path yet), I added the guard call to `initAdNetwork()` with a Phase 20 comment instructing where to place it on the real implementation. This makes the guard present at the correct entry point without inventing a targeting path that doesn't exist yet.

---

### CR-02: Dynamic import bypass — Layer 1 + Layer 3 both extended

**Files modified:** `leanshot/eslint-rules/no-health-in-ad-context.cjs`, `leanshot/eslint-rules/__tests__/no-health-in-ad-context.test.cjs`, `leanshot/scripts/check-no-health-in-ad-context.sh`
**Commit:** fb73de99
**Applied fix:**

- ESLint rule: added `ImportExpression` visitor (catches `import('...health...')`) and `CallExpression` visitor (catches `require('...health...')`).
- Grep script: extended pattern to also match `import('...')` and `require('...')` of native/health; also converted the `for f in $FILES` loop to `while IFS= read -r f` (fixing WR-04 simultaneously).
- RuleTester: added Fixture 5 (dynamic import → FAILS) and Fixture 6 (require → FAILS). All 6 fixtures pass.
- Negative grep test confirmed: a marketing directory file with `import('../native/health')` is now caught with exit 1.

---

### CR-03: Purge RPC now clears HealthKit-imported height from profiles

**Files modified:** `supabase/migrations/20280301000004_p55_profiles_hk_height_source.sql` (new), `leanshot/src/lib/native/health.ts`
**Commit:** 29bd03cd
**Applied fix:**

Added `healthkit_height_source boolean` column to `profiles` via a forward-dated migration (20280301000004). The column is nullable; `true` means height was imported from HealthKit; null/false means user-entered.

`syncNow()` now sets `healthkit_height_source = true` when writing HK height. `purge_healthkit_imports` RPC updated in the same migration: NULLs out both `height` and `healthkit_height_source` WHERE `healthkit_height_source IS TRUE` for the requesting user — preserving manually-entered height for users who entered it themselves before connecting HealthKit.

---

### CR-04: Consent modal toast is truthful — sync actually fires on connect

**Files modified:** `leanshot/src/components/healthkit/HealthKitConsentModal.tsx`, `leanshot/src/components/healthkit/HealthKitSettingsSection.tsx`, `leanshot/src/components/healthkit/__tests__/HealthKitConsentModal.test.tsx`
**Commit:** 7d411297
**Applied fix:**

- Toast changed from `'Apple Health connected. Syncing your data...'` to `'Apple Health connected. Starting initial sync…'` (the sync now actually starts).
- `HealthKitSettingsSection.handleConnected()` now calls `void handleSyncNow()` immediately after setting `hkState('connected')`, triggering a 30-day initial import in the background.
- Consent modal test updated to match new toast text (21/21 pass).

---

### CR-05: Privacy manifest audit enforces NSPrivacyCollectedDataTypeHealth presence

**Files modified:** `leanshot/scripts/audit-privacy-manifest.mjs`
**Commit:** 0f9701a6
**Applied fix:**

After the `collectedDicts` for-loop, added a post-loop check: if `@capgo/capacitor-health` is installed and no `NSPrivacyCollectedDataTypeHealth` block was found in the manifest, push an error and exit 1. Previously the loop found nothing to validate and silently exited 0. Confirmed: script passes with the existing manifest (health type already declared) and would fail if the block were removed.

---

### CR-06: @capgo/capacitor-health added to PLUGIN_TO_REQUIRED_CATEGORIES

**Files modified:** `leanshot/scripts/audit-privacy-manifest.mjs`
**Commit:** 0f9701a6 (same commit as CR-05)
**Applied fix:**

Added `'@capgo/capacitor-health': []` to `PLUGIN_TO_REQUIRED_CATEGORIES`. Empty array is correct: HealthKit framework uses no required-reason APIs (verified against plugin v8.5.2 source). The inventory cross-check now knows the plugin has been reviewed and tracks it for future upgrades.

---

### CR-07: log_phi_access always runs (try/finally) + upsert errors logged

**Files modified:** `leanshot/src/lib/native/health.ts`
**Commit:** 424b24c6
**Applied fix:**

Wrapped the entire read+upsert block in `try { ... } finally { ... }` so `log_phi_access` always executes even if a DB write throws a network error. The audit-log itself is wrapped in a separate `try/catch` so an audit-log failure cannot crash the sync.

Each upsert (`weights`, `sleep`, `workouts`, `calories`) now destructures `{error}` and logs it without incrementing the success counter if non-null. This fixes silent false-positive counts.

**Note:** Requires human verification of the try/finally logic — this is a control-flow change. The test suite (27/27) mocks supabase so cannot exercise real throw paths.

---

### WR-01: log_phi_access field list includes workouts.rpe + workouts.notes

**Files modified:** `leanshot/src/lib/native/health.ts`
**Commit:** 424b24c6 (same commit as CR-07)
**Applied fix:**

Added `'workouts.rpe'` (heart rate BPM stored as rpe field) and `'workouts.notes'` (caloric expenditure as text) to the `p_accessed_fields` array in `log_phi_access`. Both are PHI that `syncNow` writes to the DB; both were previously absent from the HIPAA audit trail.

---

### WR-02: upsert_healthkit_state sets last_synced_at = now() on sync

**Files modified:** `supabase/migrations/20280301000005_p55_upsert_hk_state_last_synced.sql` (new)
**Commit:** 5bef6eb1
**Applied fix:**

Forward-dated migration replaces `upsert_healthkit_state` with an updated ON CONFLICT block that sets `last_synced_at = now()` when `healthkit_enabled` is true (a sync occurred), and leaves it unchanged when disabling (revoke path). Phase 70 background sync can now use the DB timestamp as a gating anchor.

---

### WR-03: healthSampleId docstring corrected — not RFC 4122 UUID v5

**Files modified:** `leanshot/src/lib/native/health.ts`
**Commit:** a07c15b3
**Applied fix:**

Updated the function docstring to accurately describe the custom XOR+rotate algorithm. Explicitly states this is NOT RFC 4122 §4.3 compliant, explains the collision profile, and documents when NOT to use it. No code changes; dedupe behavior is identical.

---

### WR-04: Shell script word-splitting fixed — paths with spaces now safe

**Files modified:** `leanshot/scripts/check-no-health-in-ad-context.sh`
**Commit:** fb73de99 (addressed as part of CR-02)
**Applied fix:**

The `for f in $FILES` loop was replaced with `while IFS= read -r f; do ... done <<< "$FILES"` as part of the CR-02 dynamic-import fix. All file path references within the loop already used quoted `"$f"`. Word-splitting on paths with spaces is now eliminated.

---

### WR-05: Dietary protein removed from consent disclosure

**Files modified:** `leanshot/src/components/healthkit/HealthKitConsentModal.tsx`, `leanshot/src/components/healthkit/__tests__/HealthKitConsentModal.test.tsx`
**Commit:** 36d321ee
**Applied fix:**

Removed the `{ Icon: Beef, label: 'Dietary protein — imported to your nutrition log' }` entry from `DATA_TYPES`. `dietaryProtein` is absent from the `requestHealthKitAuthorization` read list and `readDietaryProtein()` always returns `[]`. Disclosing data you don't collect is a HIPAA consent accuracy violation and App Store §5.1.3 risk. Removed the `Beef` import (unused). Consent test updated: now checks 6 disclosed types and asserts dietary protein is absent (21/21 pass).

---

## Skipped Issues

None — all 12 in-scope findings were fixed.

---

## Verification Results

All verification checks passed after the final fix:

- `npx tsc -p tsconfig.app.json --noEmit` — exit 0 (clean)
- `node --test eslint-rules/__tests__/no-health-in-ad-context.test.cjs` — 6/6 pass (2 new dynamic-import cases)
- `npx vitest run --config vite.config.ts [4 health test files]` — 83/83 pass
- `bash scripts/check-no-health-in-ad-context.sh src` — exit 0 on clean src
- Dynamic import negative test: grep gate catches marketing file with `import('../native/health')` — exit 1
- `node scripts/audit-privacy-manifest.mjs` — PASS, exit 0

---

_Fixed: 2026-05-25T15:38:00Z_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
