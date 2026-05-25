# Phase 57: Watch Apps (Apple Watch + Wear OS) - Pattern Map

**Mapped:** 2026-05-25
**Files analyzed:** 11 new/modified files
**Analogs found:** 9 / 11

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/lib/watch/sync-contract.ts` | utility | transform + CRUD | `src/lib/native/health.ts` (healthSampleId + addInjection flow) | role-match (dedupe ID + Injection shape) |
| `src/lib/watch/complication-data.ts` | utility | transform | `src/lib/insights.ts` + `src/hooks/useStreaks.ts` | role-match (pure PersistedState → derived output) |
| `src/lib/watch/__tests__/sync-contract.test.ts` | test | transform | `src/hooks/useStreaks.test.ts` + `src/lib/native/health.test.ts` | role-match |
| `src/lib/watch/__tests__/complication-data.test.ts` | test | transform | `src/hooks/useStreaks.test.ts` | role-match |
| `apps/ios/App/LeanShotWatch/LeanShotWatchApp.swift` | config | request-response | `apps/ios/App/App/AppDelegate.swift` | partial (same project, different lifecycle) |
| `apps/ios/App/LeanShotWatch/WatchConnectivityManager.swift` | service | event-driven | `src/lib/native/push.ts` (platform-guarded native bridge) | partial (native service bridge pattern) |
| `apps/ios/App/LeanShotWatchWidget/LeanShotWatchWidget.swift` | config | batch | `apps/ios/App/CapApp-SPM/Package.swift` (Swift target manifest) | partial (Swift file in same project) |
| `apps/android/wear/build.gradle` | config | N/A | `apps/android/app/build.gradle` | exact (sibling module, identical Gradle pattern) |
| `apps/android/wear/src/main/AndroidManifest.xml` | config | N/A | `apps/android/app/src/main/AndroidManifest.xml` | exact (sibling module) |
| `apps/android/wear/src/main/java/app/leanshot/wear/*.kt` | service | event-driven | `apps/android/app/build.gradle` + manifest (Kotlin stubs) | partial (no existing Kotlin files in repo) |
| `scripts/check-no-health-in-ad-context.sh` (MODIFIED) | config | N/A | itself — extend existing grep gate | exact (same file, additive extension) |

---

## Pattern Assignments

### `src/lib/watch/sync-contract.ts` (utility, transform + CRUD)

**Analogs:** `src/lib/native/health.ts` (healthSampleId algorithm), `src/lib/store.ts` (addInjection + log_id shape)

**Imports pattern** — copy from `src/lib/native/health.ts` lines 1–13:
```typescript
// DO NOT import from src/lib/native/health.ts, src/lib/analytics/*,
// src/lib/ads/*, src/lib/affiliate/* — firewall enforced by ESLint rule
// and CI grep gate (WATCH-08).
import type { Injection, InjectionSite, DoseUnit } from '@/types';
```

**Deterministic dedupe ID** — copy algorithm verbatim from `src/lib/native/health.ts` lines 71–107:
```typescript
// healthSampleId(userId, date, metric, sourceId) — the function to port.
// For watch, the signature becomes makeDedupedId(source, datetime).
// Input string: `${source}:${datetime}` (no userId — stamped phone-side).
// Same XOR-based mixing, same UUID-v5-shaped output, same DNS namespace bytes.
// REUSE the exact byte-mixing loop — do not invent a new algorithm.
export function makeDedupedId(source: string, datetime: string): string {
  const input = `${source}:${datetime}`;
  const bytes = new Uint8Array(16);
  const ns = [0x6b, 0xa7, 0xb8, 0x10, 0x9d, 0xad, 0x11, 0xd1, 0x80, 0xb4, 0x00, 0xc0, 0x4f, 0xd4, 0x30, 0xc8];
  for (let i = 0; i < 16; i++) bytes[i] = ns[i];
  for (let i = 0; i < input.length; i++) {
    const code = input.charCodeAt(i);
    bytes[i % 16] ^= (code & 0xff);
    bytes[(i + 1) % 16] ^= ((code >> 8) & 0xff);
    const carry = bytes[(i + 2) % 16];
    bytes[(i + 2) % 16] = (carry << 3 | carry >> 5) ^ bytes[i % 16];
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
  return [hex.slice(0,8), hex.slice(8,12), hex.slice(12,16), hex.slice(16,20), hex.slice(20,32)].join('-');
}
```

**Injection shape** — copy from `src/lib/store.ts` lines 963–968 (`addInjection` stamped shape):
```typescript
// Injection fields that dedupeAndMerge must produce — mirrors what addInjection stamps:
{
  log_id: q.deduped_id,      // composite PK with user_id on public.injections
  datetime: q.datetime,
  dose: q.dose,
  unit: q.unit,
  site: q.site,
  notes: `Logged from ${q.source === 'apple_watch' ? 'Apple Watch' : 'Wear OS'}`,
  pkEngineVersion: 1,        // current 1-compartment engine version
  updated_at: new Date().toISOString(),
  user_id: userId,           // stamped phone-side from authenticated session, NOT from watch
}
```

**Firewall header comment** — copy firewall disclaimer from `src/lib/native/health.ts` lines 1–6:
```typescript
// DO NOT import from src/lib/native/health.ts or any ad-eligible surface —
// enforced by ESLint no-health-in-ad-context rule (Layer 1) and
// scripts/check-no-health-in-ad-context.sh (Layer 3, extended in WATCH-08).
// assertHealthTunnel('watchSyncContract') is called here for Layer 2 tracing.
import { assertHealthTunnel } from '@/lib/native/healthAssert';
```

---

### `src/lib/watch/complication-data.ts` (utility, transform)

**Analogs:** `src/hooks/useStreaks.ts` (calcStreak usage), `src/components/dashboard/cards/SiteRotationCard.tsx` lines 23–30 (recency + SITES.find), `src/lib/insights.ts` (PersistedState → derived output pattern)

**Imports pattern** — combine from useStreaks.ts line 8 and SiteRotationCard.tsx lines 1–6:
```typescript
import { calcStreak } from '@/hooks/useStreaks';
import { SITES } from '@/lib/constants';
import type { InjectionSite } from '@/types';
import type { PersistedState } from '@/lib/storage';
// NOTE: do NOT import from @/lib/native/health — firewall violation (WATCH-08)
```

**calcStreak call pattern** — copy from `src/hooks/useStreaks.ts` lines 22–33 and line 45:
```typescript
// calcStreak(predicate, today) — predicate receives YYYY-MM-DD; returns count.
// Existing usage pattern from useStreaks.ts line 45:
const streak = calcStreak(
  (ds) => state.injections.some((inj) => inj.datetime.startsWith(ds)),
  today,
);
```

**Site recency + SITES.find pattern** — copy from `src/components/dashboard/cards/SiteRotationCard.tsx` lines 23–30:
```typescript
// Exact logic from SiteRotationCard.tsx — extract to pure function, keep identical math:
injections.slice(0, 8).forEach((inj) => {
  if (!inj.site) return;
  const days = (Date.now() - new Date(inj.datetime).getTime()) / 86_400_000;
  if (days < 7 && status[inj.site] === 'empty') status[inj.site] = 'recent';
  else if (days < 14 && status[inj.site] === 'empty') status[inj.site] = 'older';
});
const empty = SITES.find((s) => status[s] === 'empty');
// In the pure-function form: SITES.find((s) => !recentSites.has(s)) ?? null
```

**PersistedState snapshot input pattern** — matches `src/lib/insights.ts` pattern (takes a snapshot, returns plain data, no side effects). The function signature must be `(state: PersistedState): WatchComplicationData`.

---

### `src/lib/watch/__tests__/sync-contract.test.ts` (test, transform)

**Analog:** `src/hooks/useStreaks.test.ts` (pure-function vitest shape), `src/lib/native/health.test.ts` lines 1–60 (vi.mock setup pattern)

**Test file header + imports** — copy from `src/lib/native/health.test.ts` lines 1–14:
```typescript
/**
 * Phase 57 — sync-contract.test.ts
 * Coverage: WATCH-03, WATCH-07
 * Run: npm run test:unit -- src/lib/watch/__tests__/sync-contract.test.ts
 */
import { describe, it, expect } from 'vitest';
import { makeDedupedId, dedupeAndMerge } from '../sync-contract';
```

**Mock pattern for healthAssert** — copy from `src/lib/native/health.test.ts` lines 49–51:
```typescript
vi.mock('@/lib/native/healthAssert', () => ({
  assertHealthTunnel: vi.fn(),
}));
```

**Pure-function test shape** — copy from `src/hooks/useStreaks.test.ts`:
```typescript
describe('makeDedupedId', () => {
  it('returns the same ID for identical inputs', () => {
    const a = makeDedupedId('apple_watch', '2026-05-25T10:30:00.000Z');
    const b = makeDedupedId('apple_watch', '2026-05-25T10:30:00.000Z');
    expect(a).toBe(b);
  });
  it('returns different IDs for different datetimes', () => {
    expect(makeDedupedId('apple_watch', '2026-05-25T10:30:00.000Z'))
      .not.toBe(makeDedupedId('apple_watch', '2026-05-25T11:00:00.000Z'));
  });
});
```

---

### `src/lib/watch/__tests__/complication-data.test.ts` (test, transform)

**Analog:** `src/hooks/useStreaks.test.ts` (same pure-function vitest shape, today-injection fixture pattern)

**Test fixture pattern** — copy from `src/hooks/useStreaks.test.ts`:
```typescript
const today = new Date('2026-05-25T12:00:00Z');
// Build a PersistedState fixture with injections array for predicate tests.
// No mocks needed — all imports are pure TS with no side effects.
```

**Import pattern:**
```typescript
import { describe, it, expect } from 'vitest';
import { watchComplicationData, watchSiteRecommendation } from '../complication-data';
import type { PersistedState } from '@/lib/storage';
```

---

### `apps/ios/App/LeanShotWatch/LeanShotWatchApp.swift` (config, request-response)

**Analog:** `apps/ios/App/App/AppDelegate.swift` (project-level Swift file pattern)

**Swift file header pattern** — copy from `apps/ios/App/App/AppDelegate.swift` lines 1–2:
```swift
import UIKit
import Capacitor
// Watch equivalent:
import SwiftUI
import WatchConnectivity
```

**watchOS entry point shape** (no Capacitor `@UIApplicationMain`; use SwiftUI `@main`):
```swift
// LeanShotWatchApp.swift — watchOS 7+ SwiftUI lifecycle (NOT WKExtensionDelegate)
import SwiftUI

@main
struct LeanShotWatchApp: App {
    var body: some Scene {
        WindowGroup {
            ContentView()
        }
    }
}
```

**Bundle ID derivation:** iOS main app is `app.leanshot.ios` (from `apps/ios/App/App.xcodeproj`). Watch app bundle ID: `app.leanshot.ios.watchkitapp`. Widget Extension: `app.leanshot.ios.watchkitapp.widget`.

---

### `apps/ios/App/LeanShotWatch/WatchConnectivityManager.swift` (service, event-driven)

**Analog:** `src/lib/native/push.ts` (native bridge service with platform guard and event listener registration pattern)

**Platform guard pattern** — mirrors `src/lib/native/push.ts` lines 14–19 style (check capability before using):
```swift
func activate() {
    guard WCSession.isSupported() else { return }  // mirrors: if detectPlatform() !== 'ios' return
    session.delegate = self
    session.activate()
}
```

**Offline-tolerant send** — use `transferUserInfo`, not `sendMessage` (mirrors push.ts: always prefer the guaranteed-delivery path):
```swift
func sendQueuedLog(_ log: [String: Any]) {
    // transferUserInfo: FIFO queue, offline-tolerant — mirrors PushNotifications token registration
    // DO NOT use sendMessage() — requires foreground reachability (data loss risk)
    session.transferUserInfo(log)
}
```

---

### `apps/ios/App/LeanShotWatchWidget/LeanShotWatchWidget.swift` (config, batch)

**Analog:** `apps/ios/App/CapApp-SPM/Package.swift` (Swift target declaration in iOS project)

**Swift file conventions** — same project, same import style, same bundle ID prefix.

**WidgetKit scaffold shape** (WidgetKit only — NOT ClockKit):
```swift
import WidgetKit
import SwiftUI

struct ComplicationEntry: TimelineEntry {
    let date: Date
    let nextDoseDate: Date?
    let currentStreak: Int
    let nextSite: String?
}

@main
struct LeanShotWatchWidgetBundle: WidgetBundle {
    var body: some Widget { LeanShotComplication() }
}
```

---

### `apps/android/wear/build.gradle` (config, N/A)

**Analog:** `apps/android/app/build.gradle` — exact same Gradle plugin pattern, sibling module

**Module structure** — copy from `apps/android/app/build.gradle` lines 1–45, change plugin from `com.android.application` to `com.android.library` (or `com.android.application` if standalone) and add wear-specific dependencies:
```groovy
apply plugin: 'com.android.application'

android {
    namespace = "app.leanshot.wear"
    compileSdk = 35               // override: Tiles M3 requires compileSdk >= 35
    defaultConfig {
        applicationId "app.leanshot.wear"
        minSdkVersion 25          // override: tiles minSdk=25 (main app=24, unaffected)
        targetSdkVersion rootProject.ext.targetSdkVersion
        versionCode 1
        versionName "1.0"
    }
    // ... same buildTypes block as app/build.gradle
}

dependencies {
    implementation "androidx.wear.compose:compose-material3:1.6.0"    // [ASSUMED — verify Maven Central]
    implementation "androidx.wear.tiles:tiles:1.6.0"                  // [ASSUMED]
    implementation "androidx.wear.protolayout:protolayout:1.4.0"      // [ASSUMED]
    implementation "androidx.wear.protolayout:protolayout-material:1.4.0"  // [ASSUMED]
    implementation "com.google.android.gms:play-services-wearable:18.2.0"  // [ASSUMED]
}
```

**Root project variables** — `compileSdkVersion = 36` and `minSdkVersion = 24` are in `apps/android/build.gradle` `ext {}` block. The wear module MUST override both locally (wear-specific `compileSdk = 35`, `minSdkVersion = 25`).

**settings.gradle extension** — add `:wear` to `apps/android/settings.gradle` (currently: `include ':app'`):
```groovy
include ':app'
include ':wear'
// DO NOT add wearApp(project(':wear')) to app/build.gradle yet — defer to Phase 70
```

---

### `apps/android/wear/src/main/AndroidManifest.xml` (config, N/A)

**Analog:** `apps/android/app/src/main/AndroidManifest.xml`

**Package + namespace pattern** — copy from `apps/android/app/src/main/AndroidManifest.xml` lines 1–5, change package to `app.leanshot.wear`:
```xml
<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android">
    <uses-feature android:name="android.hardware.type.watch" />
    <application
        android:label="@string/app_name"
        android:theme="@style/Theme.Leanshot.Wear">
        <activity android:name=".WearMainActivity" android:exported="true">
            <intent-filter>
                <action android:name="android.intent.action.MAIN" />
                <category android:name="android.intent.category.LAUNCHER" />
            </intent-filter>
        </activity>
        <service android:name=".DoseTileService"
            android:exported="true"
            android:permission="com.google.android.wearable.permission.BIND_TILE_PROVIDER">
            <intent-filter>
                <action android:name="androidx.wear.tiles.action.BIND_TILE_PROVIDER" />
            </intent-filter>
        </service>
        <service android:name=".WatchDataLayerService"
            android:exported="true">
            <intent-filter>
                <action android:name="com.google.android.gms.wearable.DATA_CHANGED" />
            </intent-filter>
        </service>
    </application>
</manifest>
```

---

### `scripts/check-no-health-in-ad-context.sh` (MODIFIED — additive extension)

**This is the existing file** at `leanshot/scripts/check-no-health-in-ad-context.sh`. Read it in full before editing (do not re-invent). The only change needed is extending the `find` command's path patterns to also scan `src/lib/watch/`.

**Current FORBIDDEN pattern** (lines 73–90 of the existing script):
```bash
FILES=$(find "$SRC_ROOT" \
  \( \
    -path "*/ads/*" \
    -o -path "*/ad/*" \
    -o -path "*/marketing/*" \
    -o -path "*/analytics/*" \
    -o -path "*/affiliate/*" \
    -o -name "*.ad-eligible.ts" \
  \) \
  ...
```

**Extension needed** — add one line for watch context:
```bash
    -o -path "*/lib/watch/*" \
```

**Why:** `src/lib/watch/` is not an ad surface, but WATCH-08 requires that it cannot accidentally import `health.ts`. The same comment-stripped grep logic already handles the health import detection — only the file enumeration set needs extending.

---

## Shared Patterns

### Firewall Three-Layer Pattern (WATCH-08)
**Source:** `src/lib/native/healthAssert.ts` (Layer 2), `eslint-rules/no-health-in-ad-context.cjs` (Layer 1), `scripts/check-no-health-in-ad-context.sh` (Layer 3)
**Apply to:** `src/lib/watch/sync-contract.ts`, `src/lib/watch/complication-data.ts`

Layer 1 — ESLint `no-health-in-ad-context.cjs` uses `FORBIDDEN_IMPORTERS` regex. Extend to also match `src/lib/watch/`:
```javascript
const FORBIDDEN_IMPORTERS = /\/(ads?|marketing|analytics|affiliate|lib\/watch)\/|\.ad-eligible\.ts$/;
```

Layer 2 — call `assertHealthTunnel('watchSyncContract')` in `sync-contract.ts` public exports (no-op tracing marker; mirrors `health.ts` usage):
```typescript
import { assertHealthTunnel } from '@/lib/native/healthAssert';
// At top of every public export that could touch PHI-adjacent data:
assertHealthTunnel('watchSyncContract');
```

Layer 3 — extend `scripts/check-no-health-in-ad-context.sh` (see modification pattern above).

### Dedupe ID Algorithm
**Source:** `src/lib/native/health.ts` lines 71–107 (`healthSampleId`)
**Apply to:** `src/lib/watch/sync-contract.ts` (`makeDedupedId`)
Copy the XOR-based byte-mixing loop verbatim. Only change the input string composition (`source:datetime` instead of `userId:date:metric:sourceId`).

### Vitest Pure-Function Test Shape
**Source:** `src/hooks/useStreaks.test.ts`
**Apply to:** Both `src/lib/watch/__tests__/*.test.ts` files

```typescript
import { describe, it, expect } from 'vitest';
// No vi.mock() needed for pure-function modules with no side-effecting imports.
// Exception: mock healthAssert if sync-contract.ts calls assertHealthTunnel:
vi.mock('@/lib/native/healthAssert', () => ({ assertHealthTunnel: vi.fn() }));
```

Run command pattern (from `health.test.ts` line 11):
```bash
npm run test:unit -- src/lib/watch/__tests__/sync-contract.test.ts
```

### Injection Type Shape
**Source:** `src/lib/store.ts` lines 963–968 (`addInjection` stamped fields) + `src/types/index.ts`
**Apply to:** `src/lib/watch/sync-contract.ts` (`dedupeAndMerge` return type)
The output of `dedupeAndMerge()` must be `Injection[]` — same type consumed by `addInjection()` in the store.

### Android Gradle Module Pattern
**Source:** `apps/android/app/build.gradle`
**Apply to:** `apps/android/wear/build.gradle`
Same plugin, same variable references (`rootProject.ext.*`), same repository blocks. Override `compileSdk` and `minSdkVersion` locally in the wear module.

---

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `apps/android/wear/src/main/java/app/leanshot/wear/*.kt` | service | event-driven | No existing Kotlin source files in the repo. Nearest analog is Android manifest + build.gradle structure. Use RESEARCH.md Pattern 2 (DataClient/WearableListenerService scaffolds). |

---

## Metadata

**Analog search scope:** `src/lib/native/`, `src/hooks/`, `src/lib/`, `src/components/dashboard/cards/`, `apps/ios/App/`, `apps/android/`, `eslint-rules/`, `scripts/`
**Files scanned:** 14 analog files read in full or targeted sections
**Pattern extraction date:** 2026-05-25

**Key reuse targets (explicit for planner):**
- `healthSampleId` body in `src/lib/native/health.ts:71–107` → copy verbatim into `makeDedupedId` in sync-contract.ts
- `calcStreak` at `src/hooks/useStreaks.ts:22` → import and call from complication-data.ts
- `SITES` at `src/lib/constants.ts:139` → import and use in watchSiteRecommendation
- SiteRotationCard.tsx lines 23–30 → extract as pure function for watchSiteRecommendation
- `scripts/check-no-health-in-ad-context.sh` → additive extension, one `find` path clause
- `apps/android/app/build.gradle` → sibling copy for `apps/android/wear/build.gradle`
- `apps/android/settings.gradle` → add `include ':wear'` line
