---
phase: 55-healthkit-two-tunnel-firewall
reviewed: 2026-05-25T00:00:00Z
depth: deep
files_reviewed: 10
files_reviewed_list:
  - leanshot/src/lib/native/health.ts
  - leanshot/eslint-rules/no-health-in-ad-context.cjs
  - leanshot/src/lib/native/healthAssert.ts
  - leanshot/scripts/check-no-health-in-ad-context.sh
  - leanshot/src/components/healthkit/HealthKitConsentModal.tsx
  - leanshot/src/components/healthkit/HealthKitSettingsSection.tsx
  - leanshot/src/components/dashboard/settings/SettingsPage.tsx
  - supabase/migrations/20280301000001_p55_hk_source_columns.sql
  - supabase/migrations/20280301000002_p55_healthkit_sync_state.sql
  - supabase/migrations/20280301000003_p55_healthkit_rpcs.sql
  - leanshot/scripts/audit-privacy-manifest.mjs
findings:
  critical: 7
  warning: 5
  info: 0
  total: 12
status: fixed
---

# Phase 55: Code Review Report

**Reviewed:** 2026-05-25T00:00:00Z
**Depth:** deep
**Files Reviewed:** 11
**Status:** issues_found

## Summary

Phase 55 ships the HealthKit read-only import pipeline, the three-layer two-tunnel firewall (HEALTH-08), consent modal, settings controls, and DB migrations. The overall architecture is sound: RLS on `healthkit_sync_state`, SECDEF RPCs with `auth.uid()` guards, named dollar-tags, forward-dated migrations, and idempotent column additions.

However, the review found seven critical issues and five warnings that require fixes before this phase ships. The most severe is **CR-01**: `assertHealthTunnel` is fundamentally inverted — it throws unconditionally in DEV regardless of caller context, which means all HealthKit functions crash in dev mode and invalidates Layer 2 as a firewall mechanism entirely. Two firewall bypass gaps (dynamic imports uncovered by Layer 1 and Layer 3) are confirmed. The purge RPC does not clean up HealthKit-imported height from `profiles`. The privacy manifest audit script has a silent pass when `NSPrivacyCollectedDataTypeHealth` is absent entirely.

---

## Critical Issues

### CR-01: `assertHealthTunnel` throws unconditionally in DEV — not an ad-context guard

**File:** `leanshot/src/lib/native/healthAssert.ts:68–78`

**Issue:** `assertHealthTunnel()` is documented as "prevents HealthKit / PHI data from ever reaching ad-targeting surfaces at runtime." But the function performs **no check of who the caller is**. In DEV/test environments (`LOUD = true`) it unconditionally throws the error message regardless of whether the calling file is an ad-context surface. This means:
- `HealthKitConsentModal.tsx` calling `requestHealthKitAuthorization()` will throw in dev.
- `HealthKitSettingsSection.tsx` calling `isEnabled()`, `syncNow()`, `revokeAccess()`, `purgeImportedData()` will all throw in dev.
- Even simply loading the Settings page (which calls `isEnabled()`) will throw.

Layer 2 is supposed to be defense-in-depth for the case where an ad-context file bypasses Layer 1. Instead it is a blanket throw that breaks the entire legitimate code path in dev and provides zero actual ad-context filtering in production (it only `console.error`-logs there, which an ad-context caller would silently ignore).

**Fix:** `assertHealthTunnel` must detect whether the caller is in an ad-context module, not whether it is in DEV. In a Vite SPA the call stack at runtime does not carry module paths, so the correct approach is either:
1. Remove Layer 2 entirely (Layers 1 and 3 provide the statutory enforcement; the runtime approach is architecturally unworkable in a bundled SPA), or
2. Flip the guard: make `assertHealthTunnel` a no-op callable from legitimate health code, and instead place ad-context function stubs that `throw` when called from ad surfaces (the reverse direction).

Minimal immediate fix to stop breaking dev — make the function a no-op until a proper ad-context callstack detection strategy is designed:
```typescript
// healthAssert.ts — temporary stop-gap (replace with proper ad-context detection)
export function assertHealthTunnel(_callerContext: string): void {
  // Layer 1 (ESLint) and Layer 3 (CI grep) are the primary enforcement gates.
  // Runtime call-stack ad-context detection is not feasible in a bundled SPA.
  // This function intentionally does nothing here; see HEALTH-08 design doc.
}
```

---

### CR-02: Dynamic import bypass — Layer 1 (ESLint) and Layer 3 (grep) both miss `import()` expressions

**Files:**
- `leanshot/eslint-rules/no-health-in-ad-context.cjs:94` (Layer 1)
- `leanshot/scripts/check-no-health-in-ad-context.sh:98` (Layer 3)

**Issue:** The comment on the ESLint rule (line 12 of healthAssert.ts) explicitly acknowledges "a dynamic import" as a bypass vector but does not address it in either enforcement layer.

Layer 1 hooks only on `ImportDeclaration` (static `import ... from '...'`). A dynamic `import('@/lib/native/health')` in an ad-context file is an `ImportExpression` node and is **not visited** by the rule.

Layer 3 greps for `from ['"].*native/health` which only matches static import syntax. `import('@/lib/native/health')` or `const h = await import('./native/health')` produces no `from` keyword and silently passes the grep gate.

Both gates claim they address dynamic imports but neither does.

**Fix for Layer 1** — add an `ImportExpression` visitor:
```javascript
// In no-health-in-ad-context.cjs create() return:
ImportExpression(node) {
  const importPath =
    node.source && node.source.type === 'Literal' ? node.source.value : null;
  if (importPath && HEALTH_IMPORT.test(importPath)) {
    context.report({
      node,
      messageId: 'crossImport',
      data: { importer: filename },
    });
  }
},
```

**Fix for Layer 3** — extend the grep pattern to also match dynamic import calls:
```bash
if echo "$STRIPPED" | grep -qE "from ['\"].*native/health|from ['\"]@/lib/native/health|import\(['\"].*native/health|import\(['\"]@/lib/native/health"; then
```

---

### CR-03: Purge RPC does not clean up HealthKit-imported height from `profiles`

**Files:**
- `supabase/migrations/20280301000003_p55_healthkit_rpcs.sql:38–49` (purge RPC body)
- `leanshot/src/lib/native/health.ts:335–343` (height write path)

**Issue:** `syncNow()` writes HealthKit-imported height directly to `profiles.height` (line 340 of health.ts). There is no `hk_source` column on `profiles`. The `purge_healthkit_imports` RPC deletes from `weights`, `sleep`, `workouts`, and `meals` with `hk_source = 'apple_health'`, but **never touches `profiles.height`**.

When a user invokes "Delete imported Apple Health data" (HEALTH-07), their body height imported from HealthKit remains on their profile. This is a data-purge completeness failure — the user's right to remove imported PHI is not fully honored. Under GDPR/HIPAA right-to-erasure this is a compliance gap.

**Fix:** Either:
1. Add a `hk_source` column to `profiles` (same nullable text pattern as other tables) and include it in the purge RPC, or
2. Add an explicit `UPDATE public.profiles SET height = NULL WHERE id = p_user_id` to `purge_healthkit_imports`, protected by the existing `auth.uid() = p_user_id` guard.

```sql
-- In purge_healthkit_imports, after the existing DELETEs:
update public.profiles
  set height = null
  where id = p_user_id;
```

---

### CR-04: Consent modal toast claims "Syncing your data..." but no sync occurs

**File:** `leanshot/src/components/healthkit/HealthKitConsentModal.tsx:70`

**Issue:** After `requestHealthKitAuthorization()` returns `granted = true`, the modal shows:
```
'Apple Health connected. Syncing your data...'
```
But neither `HealthKitConsentModal` nor the `onConnected` callback in `HealthKitSettingsSection` calls `syncNow()`. `handleConnected()` (SettingsSection line 135) only sets `setConsentOpen(false)` and `setHkState('connected')`. No sync is dispatched.

The user is told their data is being synced when it is not. This is a false-progress message that will result in user confusion and support requests when health data does not appear. It is also a UX trust issue for a HIPAA-critical feature.

**Fix:** Either trigger an initial sync after connect, or correct the toast message to not imply sync is in progress:
```typescript
// Option A: trigger initial sync
toast('Apple Health connected.', 'success');
onConnected?.();
// (HealthKitSettingsSection.handleConnected should call handleSyncNow() after setHkState)

// Option B: correct the message
toast('Apple Health connected. Tap "Sync now" to import your data.', 'success');
```

---

### CR-05: `audit-privacy-manifest.mjs` does not enforce that `NSPrivacyCollectedDataTypeHealth` is declared when `@capgo/capacitor-health` is installed

**File:** `leanshot/scripts/audit-privacy-manifest.mjs:282–308`

**Issue:** The script validates the contents of `NSPrivacyCollectedDataTypeHealth` entries if they appear in the manifest, but it never checks that such an entry **must** exist when `@capgo/capacitor-health` is installed. If the entire `NSPrivacyCollectedDataTypeHealth` block is absent from `PrivacyInfo.xcprivacy`, the for-loop at line 283 finds no matching block, the inner `if` at line 285 is never entered, and the script exits 0 — silently passing the gate.

Apple requires that any data type collected be declared. Phase 55 ships HealthKit collection, so the absence of this declaration would cause App Store rejection.

**Fix:** After the loop, check that the health data type was found when the plugin is installed:
```javascript
// After line 308, add:
const installedHealthPlugin = installedDeps.has('@capgo/capacitor-health');
const healthTypeDeclared = Array.from(collectedDicts).some((block) =>
  getString(block, 'NSPrivacyCollectedDataType') === 'NSPrivacyCollectedDataTypeHealth',
);
if (installedHealthPlugin && !healthTypeDeclared) {
  errors.push(
    'Privacy manifest missing NSPrivacyCollectedDataTypeHealth declaration — required because @capgo/capacitor-health is installed and collects health data.',
  );
}
```

---

### CR-06: `audit-privacy-manifest.mjs` — `@capgo/capacitor-health` absent from `PLUGIN_TO_REQUIRED_CATEGORIES` map

**File:** `leanshot/scripts/audit-privacy-manifest.mjs:43–80`

**Issue:** `@capgo/capacitor-health` is in `package.json` (confirmed at line 60) but is **not listed in `PLUGIN_TO_REQUIRED_CATEGORIES`** at all. The inventory cross-check at lines 234–248 only validates plugins that appear in the map. Since `@capgo/capacitor-health` is absent from the map, no required-reason API categories are checked for it, and the script prints no warning that an installed plugin is unreviewed.

Depending on the plugin's internal implementation (e.g., if it uses `NSUserDefaults` to cache auth state, or reads file timestamps), it may require required-reason API declarations that this script will silently not enforce.

**Fix:** Add the plugin to the map. At minimum declare it with an empty array so the cross-check knows it has been reviewed:
```javascript
// In PLUGIN_TO_REQUIRED_CATEGORIES:
'@capgo/capacitor-health': [
  // HealthKit framework does not itself use required-reason APIs.
  // Verified against @capgo/capacitor-health v8.5.2 source.
  // Re-check on plugin upgrade.
],
```
If the plugin does use any required-reason APIs internally, add them here.

---

### CR-07: `log_phi_access` not reached if any `syncNow` DB write throws; PHI access goes unlogged

**File:** `leanshot/src/lib/native/health.ts:198–358`

**Issue:** `syncNow()` calls `supabase.auth.getUser()` and then a sequence of `await supabase.from(...).upsert(...)` calls without try/catch. If the Supabase client throws a network error or the upsert rejects (rather than returning `{error}`), the function will propagate the exception and never reach line 346 where `log_phi_access` is called. PHI (weight, sleep, heart rate, calorie, height) was read from HealthKit but the HIPAA audit trail is never written.

Furthermore, all the individual upsert calls at lines 225, 258, 287, 317 do not destructure the `{error}` response from Supabase. Supabase JS v2 does not throw on DB errors; it returns `{data, error}`. If `error` is non-null (e.g. RLS violation, schema mismatch), the write silently fails and `summary.weight++` still increments — giving a false success count.

**Fix:** Wrap the sync body in try/finally so `log_phi_access` always runs after PHI is read, regardless of write failures:
```typescript
export async function syncNow(start: Date, end: Date): Promise<SyncSummary> {
  assertHealthTunnel('syncNow');
  // ... platform check ...
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return summary;
  const userId = user.id;

  try {
    // ... all weight/sleep/heartRate/calories/height upserts ...
  } finally {
    // HIPAA audit trail: always log PHI access even if writes partially fail
    await supabase.rpc('log_phi_access', {
      p_accessed_user_id: userId,
      p_accessed_fields: [
        'weights.weight', 'sleep.hours',
        'workouts.name', 'workouts.rpe', 'workouts.notes',
        'profiles.height',
      ],
      p_reason: 'healthkit_sync',
    }).catch(() => { /* audit-log failures must not crash the sync */ });
  }
  // ...
}
```

Also destructure `{error}` from each upsert and at minimum log it:
```typescript
const { error: weightErr } = await supabase.from('weights').upsert({ ... }, { onConflict: 'weight_id' });
if (weightErr) console.error('[health] weight upsert failed', weightErr);
```

---

## Warnings

### WR-01: `log_phi_access` field list omits `workouts.rpe` (heart rate) and `workouts.notes` (calories)

**File:** `leanshot/src/lib/native/health.ts:347–350`

**Issue:** The PHI access log at line 347 declares:
```typescript
p_accessed_fields: ['weights.weight', 'sleep.hours', 'workouts.name', 'profiles.height'],
```
But `syncNow` also writes:
- `rpe: avgHr` (average heart rate in BPM) to `workouts.rpe` — PHI
- `notes: \`${totalCal} kcal\`` (caloric expenditure as text) to `workouts.notes` — PHI

Neither field appears in the audit trail. Under HIPAA accounting of disclosures, the field-level list should be complete.

**Fix:** Add the missing fields:
```typescript
p_accessed_fields: [
  'weights.weight', 'sleep.hours',
  'workouts.name', 'workouts.rpe', 'workouts.notes',
  'profiles.height',
],
```

---

### WR-02: `upsert_healthkit_state` RPC never sets `last_synced_at` — "Last synced" always shows "Never" from DB

**File:** `supabase/migrations/20280301000003_p55_healthkit_rpcs.sql:84–100`

**Issue:** `syncNow()` calls `upsert_healthkit_state(p_enabled=true, p_sync_interval='6h')` after a successful sync (line 353). But the RPC's `ON CONFLICT DO UPDATE` block (lines 94–99) only sets `healthkit_enabled` and `revoked_at` — it never updates `last_synced_at`. The column exists in the table schema (migration 55-02 line 15) but is never written.

The "Last synced" label in `HealthKitSettingsSection` (line 219: `Last synced {lastSyncLabel}`) uses local React state initialized to `'Never'` and set to `'Just now'` after a manual sync — never reading the DB value. This means after an app restart the display always shows "Never" and Phase 70 background sync (which would need a DB timestamp to gate re-syncs) has no anchor.

**Fix:** Add `last_synced_at` to the upsert when `p_enabled` is true and a sync has just occurred. Simplest: add a `p_last_synced_at timestamptz default null` parameter, or use `now()` when enabling:
```sql
on conflict (user_id) do update
  set healthkit_enabled = excluded.healthkit_enabled,
      sync_interval     = excluded.sync_interval,
      last_synced_at    = case
                            when excluded.healthkit_enabled then now()
                            else public.healthkit_sync_state.last_synced_at
                          end,
      revoked_at        = case
                            when excluded.healthkit_enabled then null
                            else now()
                          end
```

---

### WR-03: `healthSampleId` is documented as "UUID v5 (SHA-1)" but uses XOR+rotate — not RFC 4122 §4.3 compliant

**File:** `leanshot/src/lib/native/health.ts:62–98`

**Issue:** The function docstring and inline comments claim this implements "RFC 4122 §4.3 UUID v5 (SHA-1 namespace + name)". The actual implementation uses a custom XOR/rotate loop (lines 78–85) — no SHA-1, no HMAC, no SubtleCrypto. The result is a deterministic 16-byte value formatted as a UUID string but it is NOT a UUID v5. The collision resistance of the XOR+rotate construction is substantially weaker than SHA-1 on short inputs.

For the dedupe use-case (idempotent upsert on conflict) the function still works correctly as long as `(userId, date, metric, sourceId)` uniquely identifies a sample — same inputs, same output. But:
1. The misleading documentation risks developers trusting UUID-v5 collision properties that don't exist.
2. Short `sourceId` values (e.g. `'apple_health'` for all samples from the same device) combined with XOR-cyclical mixing could produce collisions for different `(userId, date)` pairs that share the same XOR accumulation.

**Fix:** Either use WebCrypto SubtleCrypto for a real SHA-1-based UUID v5 (async), or update the docstring to accurately describe the custom algorithm and its collision profile without claiming RFC 4122 §4.3 compliance:
```typescript
/**
 * Deterministic 16-byte identifier formatted as a UUID-shaped string.
 * NOT RFC 4122 UUID v5 — uses a custom XOR+rotate mixing function for
 * synchronous, dependency-free deterministic ID generation.
 * Suitable for dedupe via ON CONFLICT; do NOT use where UUID v5 interop
 * with external systems is required.
 */
```

---

### WR-04: Shell script `for f in $FILES` — unquoted variable causes word-splitting on paths with spaces

**File:** `leanshot/scripts/check-no-health-in-ad-context.sh:96`

**Issue:** The `FILES` variable is populated via `find` and iterated as:
```bash
for f in $FILES; do
```
Word splitting on the unquoted `$FILES` breaks if any matched path contains a space or newline. While ad-context source files are unlikely to have spaces today, `set -euo pipefail` is on (line 41) but does not prevent word-splitting. The script should use a `while read` loop instead.

**Fix:**
```bash
# Replace lines 96-100:
while IFS= read -r f; do
  [ -z "$f" ] && continue
  STRIPPED=$(perl -0pe 's{/\*.*?\*/}{}gs; s{//[^\n]*}{}g' "$f" 2>/dev/null || cat "$f")
  if echo "$STRIPPED" | grep -qE "from ['\"].*native/health|from ['\"]@/lib/native/health"; then
    HITS="${HITS}${f}"$'\n'
  fi
done <<< "$FILES"
```

---

### WR-05: Consent modal discloses "Dietary protein" as data read from Apple Health — but it is never requested or read

**File:** `leanshot/src/components/healthkit/HealthKitConsentModal.tsx:44–46`; `leanshot/src/lib/native/health.ts:138, 172–177`

**Issue:** `DATA_TYPES` in the consent modal (line 44) lists:
```tsx
{ Icon: Beef, label: 'Dietary protein — imported to your nutrition log' }
```
But:
1. `requestHealthKitAuthorization()` (line 138 of health.ts) requests `['weight', 'steps', 'sleep', 'heartRate', 'calories', 'height']` — `dietaryProtein` is **absent**.
2. `readDietaryProtein()` always returns `[]` (line 174) with a comment: "Return empty to prevent silent data loss."
3. `syncNow()` never calls `readDietaryProtein()`.

The user reads a disclosure saying their dietary protein will be imported, consents, and nothing happens. This is a misrepresentation in a HIPAA-critical consent flow. Apple reviewer scrutiny of consent screens is high; a false data-type disclosure is a §5.1.3 / App Store review risk.

**Fix:** Remove the dietary protein entry from `DATA_TYPES` until Phase 70 implements the real read path:
```tsx
// Remove from DATA_TYPES:
// { Icon: Beef, label: 'Dietary protein — imported to your nutrition log' },
```
Add it back (along with the matching `requestHealthKitAuthorization` update) when Phase 70 ships.

---

_Reviewed: 2026-05-25T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep_
