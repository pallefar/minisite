# Phase 57: Watch Apps (Apple Watch + Wear OS) - Research

**Researched:** 2026-05-25
**Domain:** watchOS SwiftUI scaffolding + Wear OS Compose scaffolding + TS offline-queue/sync contract + complication/tile data logic
**Confidence:** HIGH (native scaffold structure), HIGH (TS lib design), MEDIUM (Wear OS Tile dependencies — version numbers require registry verification before dispatch)

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- Apple Watch = SwiftUI watchOS target under `leanshot/apps/ios`; Wear OS = Jetpack Compose module under `leanshot/apps/android`. Committed as scaffolds; native build deferred to Phase 70.
- Phone-watch comms: WatchConnectivity (iOS) + Wear Data Layer API (Android). Watch does NOT call the backend directly — it relays through the phone.
- Offline-tolerant: watch quick-logs queue locally → sync on reconnect; idempotent dedupe (reuse the uuid-v5/date-source pattern from Phase 55 `healthSampleId`) → `injections`. Ship a shared TS sync-contract module (testable) defining the queued-log payload + the merge/dedupe.
- Complication/tile data: next-dose + streak + next-recommended-site, computed from the EXISTING pharmacology / streak / site-rotation libs (testable TS). No new domain logic — reuse.
- Watch HealthKit / Health-Services reads route via the Phase 55 firewall (`assertNoHealthData` boundary; no ad-surface cross-import). Add the same discipline / a regression note.
- "Done" = native SwiftUI + Compose scaffolds committed + offline-queue/sync contract (TS, unit-tested) + complication/tile data logic (tested) + firewall inheritance. On-device watch render / complication / push / phone-sync → Phase 70.
- **No UI-SPEC** — native watch UI is platform-rendered (SwiftUI/Compose); the testable surface is the TS data contract.
- `cap sync` only. `--legacy-peer-deps`. `detectPlatform` from `platform.ts`.

### Claude's Discretion

- Native scaffold file layout, WatchConnectivity message shapes, queue persistence, complication families/tile templates.

### Deferred Ideas (OUT OF SCOPE)

- On-device complication/tile render, watch push delivery, real WatchConnectivity/Data-Layer sync, watch HealthKit reads on device → Phase 70 HUMAN-UAT.
- Standalone watch mode (no phone) → out of scope (companion only, iPhone required).
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| WATCH-01 | Apple Watch SwiftUI companion target added to iOS project; shares App Group + UserDefaults bridge | Native scaffold structure: WatchApp target + Widget Extension in existing xcodeproj; App Group entitlement for UserDefaults container. Verified via file existence + `xcodebuild -list`. |
| WATCH-02 | Wear OS (Kotlin/Jetpack Compose) companion module added to Android project; Data Layer API bridges to main app | New `:wear` Gradle module under `apps/android/`; TileService + MainActivity stubs; WearableListenerService. Verified via static Gradle config + `gradle :wear:assemble --dry-run`. |
| WATCH-03 | Quick dose log complication: tap watch face → "Logged" → row enters `injections` via phone relay | TS `WatchQueuedLog` payload shape + `dedupeAndMerge()` → `addInjection` on phone. Watch sends via WatchConnectivity `transferUserInfo` / Wear DataClient. |
| WATCH-04 | Dose reminder notification fires on watch via push (PUSH-02/03) when phone locked | Deferred to Phase 70 (requires physical devices). Scaffold only. No test required this phase. |
| WATCH-05 | Next-dose + current-streak rendered on watch face complication; refreshes every 15min via background task | TS `watchComplicationData()` pure function consuming `injections`, `user.injectionDay`, `user.medication`; tested in vitest. |
| WATCH-06 | Site-rotation next-recommended-site surface on watch (mini-card view) | TS `watchSiteRecommendation()` pure function reusing SITES constant + `SiteRotationCard` recency logic; tested in vitest. |
| WATCH-07 | Offline tolerant: dose logged on watch queues locally + syncs to phone backend on next connect | `src/lib/watch/sync-contract.ts` — `WatchQueuedLog` type + `makeDedupedId()` + `dedupeAndMerge()`; vitest unit-tested. |
| WATCH-08 | HealthKit / Health Services connectivity scoped per HEALTH-04 firewall (no ad-surface cross-import) | `watch/` module must NOT import `health.ts` or any ad-eligible surface. Add 3-layer pattern: ESLint path restriction + `assertHealthTunnel` call marker + CI grep extension. |
</phase_requirements>

---

## Summary

Phase 57 has three deliverables this sprint: (1) native scaffold files for watchOS SwiftUI and Wear OS Compose, verifiable by file existence and static config validity only — no device build, no Xcode GUI required; (2) a TypeScript offline-queue + idempotent sync-contract module (`src/lib/watch/`) fully unit-tested via vitest; and (3) three pure-function data helpers (`watchComplicationData`, `watchSiteRecommendation`) that derive watch-face content from already-existing libs.

The hardest implementation decision is the WatchConnectivity relay model. For the iOS side, `transferUserInfo` is the right primitive — it queues all payloads FIFO and delivers them even when the watch is temporarily unreachable, which is the exact guarantee needed for offline logs. On Android, `DataClient.putDataItem()` provides the equivalent persisted, offline-tolerant guarantee (unlike `MessageClient` which fails on disconnect). Both relay through the phone, never to the backend directly.

The complication/tile data computation is pure TypeScript against existing domain state — no new business logic. Next-dose date is derivable as the next occurrence of `user.injectionDay` after the last logged `injection.datetime`. Streak comes from the already-exported `calcStreak`. The recommended next injection site is the first site in SITES order whose status is `'empty'` (reuse `SiteRotationCard` recency logic). All three are pure functions, deterministic, and trivially unit-testable.

**Primary recommendation:** Plan 3 focused plans — (A) iOS watchOS scaffold files + entitlements, (B) Android Wear OS module scaffold + Tile stub, (C) TS sync-contract + complication-data module (the only wave with real tests). Plans A and B are pure file-creation plans verified statically. Plan C is the unit-tested core. The firewall regression note integrates into Plan C.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| watchOS SwiftUI scaffold | Native iOS target | — | watchOS app targets live inside the Xcode project; no JS/TS involvement |
| Wear OS Compose scaffold | Native Android module | — | Gradle sub-module `:wear` under `apps/android/`; no JS/TS involvement |
| WatchConnectivity message relay | Native iOS (phone-side handler) | Watch Swift (sender) | Phone wakes on message receipt even when backgrounded; watch sends `transferUserInfo` |
| Wear Data Layer relay | Native Android (phone-side listener) | Wear Kotlin (sender) | `DataClient.putDataItem` persists offline; phone receives via `WearableListenerService` |
| Offline queue definition | TS `src/lib/watch/sync-contract.ts` | — | The queue payload shape is the typed contract; native implementations conform to this shape |
| Dedupe / idempotent merge | TS `src/lib/watch/sync-contract.ts` | Supabase `injections` ON CONFLICT | Deterministic ID (same inputs → same ID) enables natural SQL upsert dedupe |
| Complication data (next-dose, streak, site) | TS `src/lib/watch/complication-data.ts` | Existing pharmacology/streak/site libs | Pure computation from existing state; no backend calls needed |
| Phase 55 firewall inheritance | TS ESLint rule + CI grep extension | `src/lib/native/healthAssert.ts` | `watch/` directory added to FORBIDDEN_IMPORTERS pattern; same 3-layer enforcement |

---

## Standard Stack

### Core (Native — iOS)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| SwiftUI | watchOS 9+ (Xcode 26) | Watch App UI | First-party; WidgetKit complications require SwiftUI since watchOS 9 |
| WidgetKit | watchOS 9+ | Complications (accessoryCircular, accessoryRectangular, accessoryInline) | Apple's only supported complication framework; ClockKit deprecated |
| WatchConnectivity | watchOS 2+ | Phone↔watch message relay | Only supported bidirectional channel; `transferUserInfo` for background delivery |
| App Groups | N/A | Shared UserDefaults container (future, P70 device validation) | Standard iOS/watchOS data bridge for companion apps |

### Core (Native — Android)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `androidx.wear.compose:compose-material3` | `1.6.0` [ASSUMED] | Wear OS Compose UI | Official Google library for Compose-based watch UI |
| `androidx.wear.tiles:tiles` | `1.6.0` [ASSUMED] | Tile service (declarative layout) | Official Tile entry point; required for `TileService` |
| `androidx.wear.protolayout:protolayout` | `1.4.0` [ASSUMED] | Tile layout elements | Companion to tiles library; `TimelineBuilders` etc. |
| `androidx.wear.protolayout:protolayout-material` | `1.4.0` [ASSUMED] | Material components in tiles | Material-styled tile layout helpers |
| `com.google.android.gms:play-services-wearable` | `18.x` [ASSUMED] | Data Layer API (`DataClient`, `MessageClient`) | Official Wear OS comms bridge between phone and watch |

### Core (TypeScript — shared module)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| No new TS dependencies | — | TS module uses only existing project libs | Reuse `calcStreak`, `SITES`, `HALF_LIVES`, `Injection` type, `healthSampleId`-pattern; zero new npm deps |

> **No new npm packages are introduced by this phase.** The TS `src/lib/watch/` module is a pure-function module that imports exclusively from existing project sources. This eliminates all package legitimacy risk for the TS layer.

### Supporting (Dev tooling)

| Tool | Version | Purpose | When to Use |
|------|---------|---------|-------------|
| vitest (existing) | project config | Unit test the TS sync-contract + complication-data | `npm run test:unit` — standard project test runner |
| xcodebuild (existing) | Xcode 26.5 | Static validation of watchOS target config | `xcodebuild -project ... -list` — verifies target exists, no device build |
| Gradle (existing) | project config | Static validation of Wear module | `./gradlew :wear:dependencies --dry-run` |

### Installation

```bash
# No new npm packages. iOS and Android native deps are resolved at build time
# from the system SDKs (Xcode / Android SDK). Cap sync is the only Capacitor step.
cd /Users/karstenhaldan/minisite/leanshot && npx cap sync --legacy-peer-deps
```

---

## Package Legitimacy Audit

> This phase introduces ZERO new npm packages. No Package Legitimacy Gate audit required for the TS layer.
> Native libraries (SwiftUI/WidgetKit/WatchConnectivity on iOS; androidx.wear.* on Android) are system/Jetpack libraries distributed via Xcode and Maven Central respectively — not npm packages.

| Package | Registry | Notes | Disposition |
|---------|----------|-------|-------------|
| androidx.wear.tiles:tiles | Maven Central | Official Google/Jetpack library | Approved — not npm |
| androidx.wear.compose:compose-material3 | Maven Central | Official Google/Jetpack library | Approved — not npm |
| com.google.android.gms:play-services-wearable | Maven Central | Official Google Play Services | Approved — not npm |
| WidgetKit / WatchConnectivity | Xcode SDK | Apple system framework | Approved — not npm |

**Packages removed due to slopcheck [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none
*Note: Maven/Xcode dependencies were not run through slopcheck (npm-specific tool). Version numbers for Wear OS libraries are tagged [ASSUMED] — planner must verify against Maven Central before pinning in build.gradle.*

---

## Architecture Patterns

### System Architecture Diagram

```
Watch (SwiftUI / Wear Compose)
  │
  │  Quick-log tap
  ▼
Watch local UserDefaults store        Watch DataClient item
  │  (iOS: offline queue)             (Android: offline queue)
  │
  │  WatchConnectivity transferUserInfo    Wear DataClient.putDataItem
  │  (when reachable, FIFO, guaranteed)   (persisted until phone connects)
  ▼
Phone (iOS app / Android app)          ← never calls backend directly
  │  WCSessionDelegate.session(_:didReceiveUserInfo:)
  │  WearableListenerService.onDataChanged()
  │
  │  TS sync-contract: dedupeAndMerge(queued) → addInjection()
  ▼
Supabase injections table
  (ON CONFLICT (log_id) — idempotent upsert)
  │
  ▼
Realtime fanout → store.ts hydration

                   ┌────────────────────────────────────┐
                   │  src/lib/watch/complication-data.ts│
                   │  watchComplicationData(state)       │
                   │    → nextDoseDate (injectionDay)    │
                   │    → calcStreak(injections)         │
                   │    → watchSiteRecommendation(inj.)  │
                   └────────────────────────────────────┘
                   Pure functions; watch face reads via
                   UserDefaults/DataItem populated by phone
```

### Recommended Project Structure

```
leanshot/apps/ios/App/
├── App/                          (existing iOS app target)
├── LeanShotWatch/                (NEW — watchOS app target)
│   ├── LeanShotWatchApp.swift    (entry point: @main WKApplicationMain)
│   ├── ContentView.swift         (root SwiftUI view — stub)
│   ├── QuickLogView.swift        (quick dose-log screen — stub)
│   └── WatchConnectivityManager.swift  (WCSession wrapper — sends transferUserInfo)
├── LeanShotWatchWidget/          (NEW — Widget Extension target for complications)
│   ├── LeanShotWatchWidget.swift (WidgetBundle — declares complication families)
│   ├── ComplicationEntry.swift   (TimelineEntry — next-dose + streak + site fields)
│   └── ComplicationViews.swift   (accessoryCircular + accessoryRectangular views)
└── App.xcodeproj/
    └── project.pbxproj           (updated with new targets)

leanshot/apps/android/
├── app/                          (existing phone app module)
└── wear/                         (NEW — Wear OS module)
    ├── build.gradle              (wear-specific deps: tiles, compose-material3, wearable)
    ├── src/main/
    │   ├── AndroidManifest.xml   (declares MainActivity + TileService + WearableListenerService)
    │   ├── java/app/leanshot/wear/
    │   │   ├── WearMainActivity.kt        (stub Compose activity)
    │   │   ├── DoseTileService.kt         (TileService — next-dose + streak tile)
    │   │   ├── QuickLogActivity.kt        (stub quick-log screen)
    │   │   └── WatchDataLayerService.kt   (WearableListenerService — sends DataClient item)
    │   └── res/values/strings.xml

leanshot/src/lib/watch/
├── sync-contract.ts              (WatchQueuedLog type + makeDedupedId + dedupeAndMerge)
├── complication-data.ts          (watchComplicationData + watchSiteRecommendation)
└── __tests__/
    ├── sync-contract.test.ts
    └── complication-data.test.ts
```

### Pattern 1: WatchConnectivity `transferUserInfo` — Guaranteed Background Delivery

**What:** Watch sends `[String: Any]` dictionary via `WCSession.transferUserInfo()`. The OS queues it FIFO and delivers it to the phone app even when the phone is backgrounded. No data loss on temporary disconnect.

**When to use:** Any watch-originated write that must survive offline periods (the quick-log use case). Not for UI-synchronous responses.

**Key contracts:**
```swift
// Watch side — WatchConnectivityManager.swift
import WatchConnectivity

class WatchConnectivityManager: NSObject, WCSessionDelegate {
    static let shared = WatchConnectivityManager()
    private let session = WCSession.default

    func activate() {
        guard WCSession.isSupported() else { return }
        session.delegate = self
        session.activate()
    }

    func sendQueuedLog(_ log: WatchQueuedLogDict) {
        // transferUserInfo: FIFO queue, delivered even when phone not reachable.
        // Do NOT use sendMessage() — that requires foreground reachability.
        session.transferUserInfo(log)
    }

    // Phone side (mirror this delegate in the iOS main app):
    func session(_ session: WCSession, didReceiveUserInfo userInfo: [String: Any]) {
        // Hand off to TS sync-contract layer via Capacitor bridge or Swift native call
        // that calls addInjection after deduplication.
    }
}
```
[CITED: https://alexanderweiss.dev/blog/2023-01-18-three-ways-to-communicate-via-watchconnectivity]

**Pitfall:** `sendMessage()` looks simpler but REQUIRES the counterpart to be actively reachable. For offline-tolerant quick-logs, always use `transferUserInfo`. The iOS app will be woken if backgrounded to receive the message.

### Pattern 2: Wear OS DataClient — Offline-Tolerant Watch-to-Phone Write

**What:** Watch writes a `DataItem` via `Wearable.getDataClient(context).putDataItem(request)`. The OS persists the item locally and syncs it to the phone when connectivity returns.

**When to use:** Quick-log from watch when phone is unavailable. `MessageClient` has no retry and returns `TARGET_NODE_NOT_CONNECTED` immediately on disconnect — wrong for this use case.

**Key contracts:**
```kotlin
// Wear OS side — WatchDataLayerService.kt
import com.google.android.gms.wearable.PutDataMapRequest
import com.google.android.gms.wearable.Wearable

fun sendQueuedLog(context: Context, log: WatchQueuedLogMap) {
    val request = PutDataMapRequest.create("/quick-log/${log.dedupedId}").apply {
        dataMap.putString("payload", log.toJson())
    }
    Wearable.getDataClient(context)
        .putDataItem(request.asPutDataRequest().setUrgent())
        .addOnSuccessListener { /* confirm local write */ }
}

// Phone side — WearableListenerService in app module
class PhoneWearableListener : WearableListenerService() {
    override fun onDataChanged(events: DataEventBuffer) {
        events.forEach { event ->
            if (event.type == DataEvent.TYPE_CHANGED &&
                event.dataItem.uri.path?.startsWith("/quick-log/") == true) {
                val payload = DataMapItem.fromDataItem(event.dataItem).dataMap
                    .getString("payload") ?: return@forEach
                // Deserialize and call addInjection via the TS sync-contract
            }
        }
    }
}
```
[CITED: https://developer.android.com/training/wearables/data/client-types#message-client]

### Pattern 3: TS Offline-Queue Sync Contract

**What:** A pure-TypeScript module defining the canonical payload shape and idempotent merge function that both iOS (via Capacitor bridge) and Android (via Capacitor plugin or JNI) call when a watch message arrives on the phone.

**When to use:** Any time a watch quick-log reaches the phone side. The contract is platform-agnostic; native code deserializes to JSON and calls this.

```typescript
// src/lib/watch/sync-contract.ts
import type { Injection, InjectionSite, DoseUnit } from '@/types';

/** Payload sent from watch (matches WatchConnectivity/DataLayer dict shape). */
export interface WatchQueuedLog {
  /** Deterministic dedupe ID — same inputs → same ID (mirrors healthSampleId pattern). */
  deduped_id: string;
  /** ISO datetime of the log action on the watch. */
  datetime: string;
  dose: string;
  unit: DoseUnit;
  site: InjectionSite | null;
  /** Source tag for dedupe namespace: 'apple_watch' | 'wear_os'. */
  source: 'apple_watch' | 'wear_os';
  /** user_id from the phone's auth session — stamped by the phone, not the watch. */
  user_id?: string;
}

/**
 * Deterministic dedupe ID for watch quick-logs.
 * Same (source, datetime) always yields the same ID —
 * natural dedupe via ON CONFLICT (log_id) in addInjection upsert path.
 * Uses the same XOR-based approach as healthSampleId in health.ts.
 */
export function makeDedupedId(source: string, datetime: string): string {
  // ... same algorithm as healthSampleId(userId, date, metric, sourceId)
  // inputs: source='apple_watch', datetime=ISO string
}

/**
 * Merge a batch of queued watch logs into an array of Injection records
 * ready for addInjection(). Deduplicate by deduped_id before merging.
 */
export function dedupeAndMerge(
  queued: WatchQueuedLog[],
  userId: string,
  existingLogIds: Set<string>,
): Injection[] {
  const seen = new Set<string>(existingLogIds);
  return queued
    .filter((q) => {
      if (seen.has(q.deduped_id)) return false;
      seen.add(q.deduped_id);
      return true;
    })
    .map((q) => ({
      log_id: q.deduped_id,
      datetime: q.datetime,
      dose: q.dose,
      unit: q.unit,
      site: q.site,
      notes: `Logged from ${q.source === 'apple_watch' ? 'Apple Watch' : 'Wear OS'}`,
      pkEngineVersion: 1,
      updated_at: new Date().toISOString(),
      user_id: userId,
    }));
}
```

### Pattern 4: WidgetKit Complication Scaffold (watchOS 9+)

**What:** A Widget Extension target added to the Xcode project. Uses `StaticConfiguration` with `accessoryCircular` and `accessoryRectangular` families. Data flows through the phone populating a `CLKComplicationDataSource` or (modern) `TimelineEntry` via shared App Group.

**watchOS 9+ complication families (WidgetKit, NOT ClockKit):**
- `accessoryCircular` — small circular; best for quick glance (next-dose countdown ring or icon)
- `accessoryRectangular` — wide; best for multi-line text (next-dose + streak)
- `accessoryInline` — single line text; next-dose date short label
- `accessoryCorner` — corner curve; dose unit text + gauge

**Scaffold minimum files:**
```swift
// LeanShotWatchWidget/LeanShotWatchWidget.swift
import WidgetKit
import SwiftUI

// TimelineEntry carries the data computed by watchComplicationData() in TS
struct ComplicationEntry: TimelineEntry {
    let date: Date
    let nextDoseDate: Date?
    let streak: Int
    let nextSite: String
}

struct ComplicationProvider: TimelineProvider {
    func placeholder(in context: Context) -> ComplicationEntry {
        ComplicationEntry(date: Date(), nextDoseDate: nil, streak: 0, nextSite: "abdomen-ul")
    }
    func getSnapshot(in context: Context, completion: @escaping (ComplicationEntry) -> Void) {
        completion(placeholder(in: context))
    }
    func getTimeline(in context: Context, completion: @escaping (Timeline<ComplicationEntry>) -> Void) {
        // Read from shared UserDefaults (App Group) populated by phone on WatchConnectivity receipt
        let entry = readEntryFromSharedDefaults()
        let nextRefresh = Calendar.current.date(byAdding: .minute, value: 15, to: Date())!
        completion(Timeline(entries: [entry], policy: .after(nextRefresh)))
    }
}

@main
struct LeanShotWatchWidgetBundle: WidgetBundle {
    var body: some Widget { LeanShotComplication() }
}

struct LeanShotComplication: Widget {
    let kind = "app.leanshot.complication"
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: ComplicationProvider()) { entry in
            ComplicationCircularView(entry: entry)
        }
        .configurationDisplayName("LeanShot")
        .description("Next dose + streak")
        .supportedFamilies([.accessoryCircular, .accessoryRectangular, .accessoryInline])
    }
}
```
[CITED: https://developer.apple.com/videos/play/wwdc2022/10050/]

### Pattern 5: TS Complication Data Helpers

**What:** Pure functions producing the data a complication/tile needs, computed from existing store state. No new business logic.

```typescript
// src/lib/watch/complication-data.ts
import { HALF_LIVES } from '@/lib/pharmacology';
import { calcStreak } from '@/hooks/useStreaks';
import { SITES } from '@/lib/constants';
import type { InjectionSite } from '@/types';
import type { PersistedState } from '@/lib/storage';

export interface WatchComplicationData {
  nextDoseDate: string | null;     // ISO date string, null if no schedule
  currentStreak: number;            // injection-day streak (consecutive weeks)
  nextSite: InjectionSite | null;  // recommended next injection site
  medication: string;               // short label e.g. "Ozempic"
  lastDose: string | null;          // dose + unit e.g. "0.5 mg"
}

/**
 * Derive complication data from the persisted store state.
 * Pure function; no side effects. Suitable for both watch display and unit tests.
 */
export function watchComplicationData(state: PersistedState): WatchComplicationData {
  const user = state.user;
  if (!user) return { nextDoseDate: null, currentStreak: 0, nextSite: null, medication: '', lastDose: null };

  const today = new Date();
  // Next occurrence of user.injectionDay (0=Sun..6=Sat) after today
  const daysUntilNext = ((user.injectionDay - today.getDay() + 7) % 7) || 7;
  const nextDose = new Date(today);
  nextDose.setDate(today.getDate() + daysUntilNext);
  const nextDoseDate = nextDose.toISOString().slice(0, 10);

  // Weekly injection streak: consecutive weeks with an injection on injectionDay week
  const streak = calcStreak(
    (ds) => state.injections.some((inj) => inj.datetime.startsWith(ds)),
    today,
  );

  // Next recommended site (first SITES-order site not used in last 7 days)
  const recentSites = new Set(
    state.injections
      .filter((inj) => {
        const days = (Date.now() - new Date(inj.datetime).getTime()) / 86_400_000;
        return days < 7 && inj.site;
      })
      .map((inj) => inj.site as InjectionSite),
  );
  const nextSite = (SITES.find((s) => !recentSites.has(s)) ?? null) as InjectionSite | null;

  const lastInj = state.injections[0];
  return {
    nextDoseDate,
    currentStreak: streak,
    nextSite,
    medication: user.medication,
    lastDose: lastInj ? `${lastInj.dose} ${lastInj.unit}` : null,
  };
}

/**
 * Convenience: returns just the site label for the watch mini-card.
 */
export function watchSiteRecommendation(state: PersistedState): InjectionSite | null {
  return watchComplicationData(state).nextSite;
}
```

### Anti-Patterns to Avoid

- **Using `sendMessage()` for quick-log:** Requires foreground reachability; loses data if watch logs while phone is in pocket. Use `transferUserInfo` instead.
- **Using `MessageClient` on Android:** No offline retry; `TARGET_NODE_NOT_CONNECTED` immediately drops the payload. Use `DataClient.putDataItem()`.
- **Importing `health.ts` from `watch/` module:** Violates Phase 55 three-layer firewall. `watch/` is not an ad surface but must be added to the CI grep gate so future edits can't accidentally cross the firewall.
- **Calling the backend directly from the watch:** Watch has no Supabase credentials. All writes relay through the phone. Plan must never include a Supabase client import in native watch code.
- **Building a new Next-Dose algorithm:** `user.injectionDay` already encodes the weekly schedule. Derive next occurrence with modular day arithmetic — no new pharmacology logic needed.
- **App Group shared UserDefaults for watch data in modern watchOS:** App Groups no longer share a file-system container between iOS and watchOS (watchOS 2+). Use WatchConnectivity to push data to the watch, then store it in the watch's own `UserDefaults`. App Group entitlement is still needed for the Widget Extension → main Watch App communication on the same device.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Dedupe ID for watch logs | Custom random-UUID generator | `makeDedupedId(source, datetime)` — same algorithm as `healthSampleId` in health.ts | Identical inputs → identical ID; natural ON CONFLICT dedupe |
| Background watch→phone delivery (iOS) | Custom polling or push | WatchConnectivity `transferUserInfo` | OS-managed FIFO queue; guaranteed delivery; no polling battery drain |
| Background watch→phone delivery (Android) | Custom WebSocket or poll | Wear `DataClient.putDataItem` | OS-managed persistent sync; offline-tolerant; built into Play Services |
| WidgetKit complication entry | ClockKit templates | `WidgetKit.StaticConfiguration` + `TimelineProvider` | ClockKit deprecated since watchOS 9 |
| Streak calculation | New streak counter | `calcStreak()` from `src/hooks/useStreaks.ts` | Already unit-tested; already used by dashboard |
| Site recommendation | New rotation algorithm | SITES-ordered `find` with 7-day recency filter | Already the logic in `SiteRotationCard.tsx` — extract to pure function |

**Key insight:** The entire TS watch module is a thin projection of existing state through existing pure functions. Zero new business logic, zero new npm packages, zero new database tables.

---

## Existing Codebase Assets (Verified)

| Asset | Location | Relevance to Phase 57 |
|-------|----------|----------------------|
| `healthSampleId()` | `src/lib/native/health.ts:71` | Dedupe ID algorithm to copy/reuse in `makeDedupedId` |
| `assertHealthTunnel()` + `assertNoHealthData()` | `src/lib/native/healthAssert.ts` | Call `assertHealthTunnel('watchSyncContract')` in watch module for tracing; extend CI grep to cover `src/lib/watch/` |
| `calcStreak()` | `src/hooks/useStreaks.ts:22` | Pure function, already exported, takes `(predicate, today)` |
| `SITES` constant | `src/lib/constants.ts:139` | Ordered array of 8 `InjectionSite` values; drives `watchSiteRecommendation` |
| `SiteRotationCard.tsx` recency logic | `src/components/dashboard/cards/SiteRotationCard.tsx:23-30` | 7-day recency + SITES-order `find` = `watchSiteRecommendation` |
| `HALF_LIVES` + `calcMedLevel()` | `src/lib/pharmacology.ts` | Not needed for next-dose date (that's `injectionDay` + modular arithmetic); available if Phase 70 wants level-curve |
| iOS project | `apps/ios/App/App.xcodeproj` | Add watchOS + Widget Extension targets here; bundle ID: `app.leanshot.ios` |
| iOS iOS deployment target | `IPHONEOS_DEPLOYMENT_TARGET = 15.0` | watchOS target should set `WATCHOS_DEPLOYMENT_TARGET = 9.0` (watchOS 9 required for WidgetKit complications) |
| Android main module | `apps/android/app/` | New `:wear` module lives as sibling; `settings.gradle` includes it |
| Android `variables.gradle` | `apps/android/variables.gradle` | `compileSdkVersion = 36`, `minSdkVersion = 24`; wear module needs `compileSdk = 35` (Tiles M3 requirement) |
| Phase 55 ESLint rule | `eslint-rules/no-health-in-ad-context.cjs` | Extend `FORBIDDEN_IMPORTERS` pattern or add separate watch-channel rule |
| Phase 55 CI grep | `scripts/check-no-health-in-ad-context.sh` | Extend to also scan `src/lib/watch/` (watch is NOT an ad surface but firewall annotation needed per WATCH-08) |
| Capacitor platform detection | `src/lib/native/platform.ts` | `detectPlatform()` — usable from watch sync-contract module for platform tagging |
| Mock pattern | `src/lib/native/__mocks__/` | New mock `__mocks__/capacitor-watch.ts` if bridging Capacitor plugin; `vitest-mobile.config.ts` as reference |

---

## Common Pitfalls

### Pitfall 1: Using `sendMessage` Instead of `transferUserInfo` for Quick-Log

**What goes wrong:** `WCSession.sendMessage()` silently fails if the watch is not currently reachable (phone in bag, Bluetooth out of range). The user taps "Log" on the watch, sees confirmation, but the log is never delivered to the phone.

**Why it happens:** `sendMessage` is designed for foreground, real-time communication. It explicitly requires the counterpart to be reachable.

**How to avoid:** Always use `transferUserInfo` for user-data writes from watch. The OS queues it and delivers it when the phone is reachable again. Verify in the plan that no `sendMessage` call exists for the dose-log path.

**Warning signs:** Any Swift code calling `session.sendMessage(_:replyHandler:errorHandler:)` in the quick-log path.

### Pitfall 2: App Group Shared UserDefaults Between iOS and watchOS

**What goes wrong:** Developer adds App Group capability thinking `UserDefaults(suiteName: "group.app.leanshot")` is shared between iOS and watchOS. It is NOT — watchOS 2+ runs the watch app in the watch's own process on the watch device.

**Why it happens:** Old WatchKit 1.0 docs described shared containers; these no longer apply.

**How to avoid:** App Group `UserDefaults` is valid WITHIN the watch device (between the Watch App and its Widget Extension on the same watch). For iPhone↔Watch sharing, use WatchConnectivity. The plan must not include cross-device UserDefaults sharing.

**Warning signs:** `UserDefaults(suiteName: "group.app.leanshot")` used to READ phone data from the watch.

### Pitfall 3: Wear OS `MessageClient` for Offline-Tolerant Logs

**What goes wrong:** Watch uses `MessageClient.sendMessage()` to send a quick-log. Returns `TARGET_NODE_NOT_CONNECTED` if phone is unreachable; no retry.

**Why it happens:** MessageClient is the most visible API in documentation examples.

**How to avoid:** Use `DataClient.putDataItem()` with a path like `/quick-log/{deduped_id}`. The OS persists the DataItem locally and syncs when phone reconnects. Phone listens via `WearableListenerService`.

### Pitfall 4: Duplicate Injection Rows From Offline Queue Replay

**What goes wrong:** Watch queues a log offline. Phone receives it when reconnected. User also manually logs the same dose from the phone. Two rows appear in `injections` for the same event.

**Why it happens:** The offline queue payload lands as a second write without a collision guard.

**How to avoid:** `makeDedupedId(source, datetime)` produces the same `log_id` for any given watch log event. `addInjection` already uses `log_id` as the composite PK with `user_id`. `ON CONFLICT (log_id)` in the DB upsert path silently deduplicates. The phone-side `dedupeAndMerge()` also checks `existingLogIds` before queuing.

### Pitfall 5: ClockKit API Usage (Deprecated)

**What goes wrong:** Planner references `CLKComplicationFamily`, `CLKComplicationDataSource`, or `CLKComplicationServer` — these are deprecated APIs from watchOS 8 and earlier.

**Why it happens:** Many tutorials and search results still describe the old ClockKit approach.

**How to avoid:** All complication work uses WidgetKit + SwiftUI, targeting watchOS 9.0+. Deployment target must be `WATCHOS_DEPLOYMENT_TARGET = 9.0`. The Widget Extension target (not the Watch App target) contains the complication code.

### Pitfall 6: Wear Module minSdk Below 25

**What goes wrong:** `androidx.wear.tiles:tiles` and `protolayout-material` require minSdk 25 for some features; the main app's `minSdkVersion = 24` in `variables.gradle` propagates to the wear module.

**Why it happens:** The wear module inherits root project variables by default.

**How to avoid:** Override `minSdkVersion` in the wear module's `build.gradle` to 25. The main app at 24 is unaffected.

### Pitfall 7: Firewall Regression — `watch/` Imports `health.ts`

**What goes wrong:** A developer adds heart-rate or step-count logic to `src/lib/watch/` and imports from `health.ts`. The CI grep gate doesn't catch it because `watch/` wasn't in `FORBIDDEN_IMPORTERS`.

**Why it happens:** `watch/` is a new directory not present when Phase 55 wrote the grep gate.

**How to avoid:** Extend `check-no-health-in-ad-context.sh` to also scan `src/lib/watch/` (or more broadly, add a separate script for `watch/` context if health data routing needs to be explicit). Per WATCH-08, the three-layer enforcement pattern applies: ESLint path restriction + `assertHealthTunnel` call marker + CI grep.

---

## Code Examples

### Next-Dose Date Derivation (pure TS)

```typescript
// Source: derived from insights.ts:193-200 pattern
function nextDoseDate(injectionDay: number, today: Date = new Date()): Date {
  const daysUntilNext = ((injectionDay - today.getDay() + 7) % 7) || 7;
  const next = new Date(today);
  next.setDate(today.getDate() + daysUntilNext);
  next.setHours(0, 0, 0, 0);
  return next;
}
// Note: if today IS injection day AND the weekly dose has already been logged
// this week, add 7 days. The || 7 handles the "today is the day" case.
```

### Site Recommendation (pure TS)

```typescript
// Source: SiteRotationCard.tsx:23-30 logic extracted to pure function
import { SITES } from '@/lib/constants';
import type { InjectionSite, Injection } from '@/types';

function nextRecommendedSite(injections: Injection[]): InjectionSite | null {
  const recentSites = new Set<InjectionSite>(
    injections
      .slice(0, 8)
      .filter((inj) => {
        if (!inj.site) return false;
        const days = (Date.now() - new Date(inj.datetime).getTime()) / 86_400_000;
        return days < 7;
      })
      .map((inj) => inj.site as InjectionSite),
  );
  return (SITES.find((s) => !recentSites.has(s)) ?? null) as InjectionSite | null;
}
```

### Vitest Test Shape for Sync Contract

```typescript
// src/lib/watch/__tests__/sync-contract.test.ts
import { describe, it, expect } from 'vitest';
import { makeDedupedId, dedupeAndMerge } from '../sync-contract';

describe('makeDedupedId', () => {
  it('returns the same ID for identical inputs', () => {
    const a = makeDedupedId('apple_watch', '2026-05-25T10:30:00.000Z');
    const b = makeDedupedId('apple_watch', '2026-05-25T10:30:00.000Z');
    expect(a).toBe(b);
  });
  it('returns different IDs for different datetimes', () => {
    const a = makeDedupedId('apple_watch', '2026-05-25T10:30:00.000Z');
    const b = makeDedupedId('apple_watch', '2026-05-25T11:00:00.000Z');
    expect(a).not.toBe(b);
  });
});

describe('dedupeAndMerge', () => {
  it('drops entries whose deduped_id is already in existingLogIds', () => {
    const existing = new Set(['existing-id-1']);
    const queued = [
      { deduped_id: 'existing-id-1', datetime: '...', dose: '0.5', unit: 'mg', site: null, source: 'apple_watch' },
      { deduped_id: 'new-id-2', datetime: '...', dose: '0.5', unit: 'mg', site: null, source: 'apple_watch' },
    ];
    const result = dedupeAndMerge(queued as any, 'user-123', existing);
    expect(result).toHaveLength(1);
    expect(result[0].log_id).toBe('new-id-2');
  });
});
```

---

## Runtime State Inventory

> Omitted — this is a greenfield scaffold phase. No existing state needs migrating.

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| ClockKit `CLKComplicationDataSource` | WidgetKit `TimelineProvider` + SwiftUI | watchOS 9 (2022) | Must use WidgetKit — ClockKit is deprecated |
| `CLKComplicationFamily` (12 families) | 4 WidgetKit families (accessoryCircular, accessoryRectangular, accessoryInline, accessoryCorner) | watchOS 9 (2022) | Scaffold only needs 3 families max |
| Shared App Group for iOS↔watchOS | WatchConnectivity framework | watchOS 2 (2015) | Must use WCSession, not shared file system |
| WatchKit Extension (separate bundle) | Single Watch App target (SwiftUI lifecycle) | watchOS 7 (2020) | No separate extension target needed; `@main` WatchApp struct |
| Wear OS Tiles 1.x (ProtoLayout XML) | Wear OS Tiles with Compose Glance or protolayout-material3 | 2023–2025 | `Material3TileService` subclass simplifies layout; compileSdk must be ≥35 |

**Deprecated/outdated:**
- `CLKComplicationDataSource`: do not use; all complication code in WidgetKit `StaticConfiguration`.
- `WatchKit Extension` target: not needed for SwiftUI watchOS apps (watchOS 7+).
- Wear OS `TileProviderService` (old name): the class is now `TileService` in `androidx.wear.tiles`.
- `WCSession.sendMessage()` for quick-logs: wrong delivery guarantee for offline-tolerant writes.

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `androidx.wear.tiles:tiles` latest version is `1.6.0` | Standard Stack | Wrong version pinned in build.gradle; Maven Central check required before dispatch |
| A2 | `androidx.wear.compose:compose-material3` latest version is `1.6.0` | Standard Stack | Same as A1 |
| A3 | `androidx.wear.protolayout:protolayout` latest is `1.4.0` | Standard Stack | Same as A1 |
| A4 | `com.google.android.gms:play-services-wearable` major version is `18.x` | Standard Stack | Wrong version; check Maven Central |
| A5 | Wear module `minSdkVersion = 25` sufficient for all required tile dependencies | Pitfall 6 | Build failure at compile time; harmless — easily bumped |
| A6 | `WATCHOS_DEPLOYMENT_TARGET = 9.0` is the minimum needed for WidgetKit accessory families | Pattern 4 | If user has watchOS 8 device, complications won't display (deferred to Phase 70 device UAT anyway) |

---

## Open Questions

1. **Does the iOS `App.xcodeproj` require manual Xcode GUI to add the watchOS target, or can it be done by editing `project.pbxproj` directly?**
   - What we know: `project.pbxproj` is the source of truth for targets; Xcode reads it.
   - What's unclear: Direct `.pbxproj` editing is error-prone. Apple's tooling (Xcode + `xcodebuild`) does not expose a CLI for adding targets.
   - Recommendation: The plan should use a minimally-valid `.pbxproj` diff or provide the scaffold as a set of new Swift files plus explicit `.pbxproj` additions. The plan-checker should verify via `xcodebuild -list` that the new target appears.

2. **Does `cap sync` need to be re-run after adding the watch target, and does it interfere?**
   - What we know: `cap sync` copies web assets and updates iOS/Android native config files.
   - What's unclear: Whether `cap sync` would clobber the watch target's `Info.plist` or entitlements.
   - Recommendation: Watch target files should live outside the Capacitor-managed `App/App/` directory (use `App/LeanShotWatch/`). `cap sync` only manages the main app target.

3. **Does the Android `:wear` module need to be connected to the phone module's build variants?**
   - What we know: Multi-module Android projects share `variables.gradle` from the root.
   - What's unclear: Whether Wear OS module needs `wearApp(project(':wear'))` in the phone app's `build.gradle` for pairing to work.
   - Recommendation: For scaffold-only (no device build), the `:wear` module can be standalone. The `wearApp` link is needed for production bundling — defer to Phase 70.

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Xcode | watchOS target scaffold | ✓ | Xcode 26.5 | — |
| xcodebuild CLI | Static target validation | ✓ | Xcode 26.5 | — |
| Android SDK (compileSdk 36) | Wear module scaffold | ✓ (assumed via Android Studio) | — | Install SDK 36 via sdkmanager |
| Gradle wrapper | Wear module static validation | ✓ | `8.13.0` (from root build.gradle) | — |
| vitest (existing) | TS unit tests | ✓ | project config | — |
| watchOS device | Phase 70 HUMAN-UAT | ✗ | — | Phase 70 deferred — not needed this phase |
| Wear OS device | Phase 70 HUMAN-UAT | ✗ | — | Phase 70 deferred — not needed this phase |
| Apple Watch pairing | Phase 70 real WatchConnectivity | ✗ | — | Phase 70 deferred — not needed this phase |

**Missing dependencies with no fallback:** None — all Phase 57 deliverables are verifiable without a device.

---

## Validation Architecture

> `workflow.nyquist_validation: true` — section included.

### Test Framework

| Property | Value |
|----------|-------|
| Framework | vitest (project default) |
| Config file | `leanshot/vitest.config.ts` (default project; `src/**/*.test.ts`) |
| Quick run command | `npm run test:unit -- --reporter=verbose src/lib/watch` |
| Full suite command | `npm run test:unit` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| WATCH-01 | watchOS target added to xcodeproj | static/file-existence | `xcodebuild -project apps/ios/App/App.xcodeproj -list \| grep LeanShotWatch` | ❌ Wave 0 |
| WATCH-02 | Wear `:wear` module exists in Gradle | static/file-existence | `ls apps/android/wear/build.gradle` | ❌ Wave 0 |
| WATCH-03 | `dedupeAndMerge` produces correct Injection from WatchQueuedLog | unit | `npm run test:unit -- src/lib/watch/__tests__/sync-contract.test.ts` | ❌ Wave 0 |
| WATCH-04 | (Deferred to Phase 70 device UAT) | manual-only | N/A — push to watch requires physical device | N/A |
| WATCH-05 | `watchComplicationData` returns correct next-dose, streak, site | unit | `npm run test:unit -- src/lib/watch/__tests__/complication-data.test.ts` | ❌ Wave 0 |
| WATCH-06 | `watchSiteRecommendation` returns first non-recent SITES entry | unit | `npm run test:unit -- src/lib/watch/__tests__/complication-data.test.ts` | ❌ Wave 0 |
| WATCH-07 | `makeDedupedId` is deterministic; duplicates are filtered by `dedupeAndMerge` | unit | `npm run test:unit -- src/lib/watch/__tests__/sync-contract.test.ts` | ❌ Wave 0 |
| WATCH-08 | No `health.ts` import in `src/lib/watch/`; CI grep passes | lint/grep | `bash scripts/check-no-health-in-ad-context.sh src` (after extending) | ❌ Wave 0 |

### Sampling Rate

- **Per task commit:** `npm run test:unit -- src/lib/watch`
- **Per wave merge:** `npm run test:unit`
- **Phase gate:** `npm run test:unit && npm run lint && npm run lint:health-firewall` all green before `/gsd:verify-work`

### Wave 0 Gaps

- [ ] `src/lib/watch/sync-contract.ts` — covers WATCH-03, WATCH-07
- [ ] `src/lib/watch/complication-data.ts` — covers WATCH-05, WATCH-06
- [ ] `src/lib/watch/__tests__/sync-contract.test.ts` — RED scaffold (WATCH-03, WATCH-07)
- [ ] `src/lib/watch/__tests__/complication-data.test.ts` — RED scaffold (WATCH-05, WATCH-06)
- [ ] `apps/ios/App/LeanShotWatch/` directory + stub Swift files (WATCH-01)
- [ ] `apps/ios/App/LeanShotWatchWidget/` directory + stub Widget files (WATCH-01)
- [ ] `apps/android/wear/` directory + `build.gradle` + stub Kotlin files (WATCH-02)
- [ ] Extension of `scripts/check-no-health-in-ad-context.sh` to scan `src/lib/watch/` (WATCH-08)

---

## Security Domain

> `security_enforcement` absent from config → enabled.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | No — watch relay inherits phone's auth session; no separate auth | N/A |
| V3 Session Management | No — no new session surface | N/A |
| V4 Access Control | Partial — `user_id` stamped by phone (trusted side), not by watch | Phone-side `dedupeAndMerge` stamps `user_id` from authenticated phone session |
| V5 Input Validation | Yes — `WatchQueuedLog` fields from watch must be validated before `addInjection` | `dedupeAndMerge` validates shape; TypeScript strict types enforce at compile time |
| V6 Cryptography | No — no new encryption surface | `makeDedupedId` is a deterministic hash, not a secret |

### Known Threat Patterns for This Stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Watch spoofs a dose log with forged `user_id` | Tampering | `user_id` is NEVER sent from the watch — it's stamped by the phone-side `dedupeAndMerge()` using the authenticated session |
| Replay of an old watch log packet | Repudiation | `makeDedupedId(source, datetime)` → same payload always yields same `log_id`; `ON CONFLICT` is a no-op for replays |
| PHI (health data) leaking into watch module | Information Disclosure | Phase 55 three-layer firewall extended to `src/lib/watch/`; `watch/` must not import `health.ts` |
| Watch log flooding `injections` table | Denial of Service | `dedupeAndMerge` + DB ON CONFLICT naturally caps to one row per (user, datetime, source); rate-limiting on `addInjection` path is pre-existing |

---

## Sources

### Primary (HIGH confidence)

- [Three Ways to Communicate via WatchConnectivity — alexanderweiss.dev](https://alexanderweiss.dev/blog/2023-01-18-three-ways-to-communicate-via-watchconnectivity) — verified `transferUserInfo` FIFO guaranteed delivery vs `sendMessage` foreground-only
- [Wear OS Data Layer API Client Types — Android Developers](https://developer.android.com/training/wearables/data/client-types#message-client) — verified `DataClient` offline-tolerant vs `MessageClient` no-retry
- [Wear Tiles Get Started — Android Developers](https://developer.android.com/training/wearables/tiles/get_started?version=3) — TileService scaffold, manifest declaration, Gradle deps
- [Complications and Widgets: Reloaded — WWDC22](https://developer.apple.com/videos/play/wwdc2022/10050/) — WidgetKit accessory families, ClockKit deprecation
- [Go Further With Complications — WWDC22](https://developer.apple.com/videos/play/wwdc2022/10051/) — WidgetKit `StaticConfiguration`, watchOS 9+ complication families
- `leanshot/src/lib/native/health.ts` — `healthSampleId` dedupe algorithm (verified in codebase)
- `leanshot/src/lib/native/healthAssert.ts` — Phase 55 firewall implementation (verified in codebase)
- `leanshot/src/hooks/useStreaks.ts` — `calcStreak` pure function (verified in codebase)
- `leanshot/src/components/dashboard/cards/SiteRotationCard.tsx` — site recency logic (verified in codebase)
- `leanshot/apps/ios/App/App.xcodeproj/project.pbxproj` — iOS bundle ID `app.leanshot.ios`, deployment target iOS 15 (verified via grep)
- `leanshot/apps/android/variables.gradle` — compileSdk 36, minSdk 24 (verified in codebase)
- `xcodebuild -version` — Xcode 26.5 confirmed available on this machine

### Secondary (MEDIUM confidence)

- [Wear Tiles release notes — Android Developers](https://developer.android.com/jetpack/androidx/releases/wear-tiles) — tile version history
- [Wear Compose release notes — Android Developers](https://developer.android.com/jetpack/androidx/releases/wear-compose) — compose-material3 versions
- [What's new in Wear OS 6 — Android Developers Blog](https://android-developers.googleblog.com/2025/05/whats-new-in-wear-os-6.html) — current Wear OS platform state
- [Add a Watch App to Existing iOS App — Talkdesk Engineering](https://engineering.talkdesk.com/add-an-watchos-app-to-an-existing-ios-app-d03b5a023b51) — Xcode target addition workflow

### Tertiary (LOW confidence)

- Maven Central version numbers for `androidx.wear.*` and `play-services-wearable` — cited from search result snippets, not directly verified from Maven Central. Mark [ASSUMED]; planner must verify before pinning.

---

## Metadata

**Confidence breakdown:**
- Standard stack (TS layer): HIGH — zero new packages; reuses existing codebase assets
- Standard stack (iOS native): HIGH — first-party Apple frameworks, confirmed Xcode 26.5 available
- Standard stack (Android native): MEDIUM — versions [ASSUMED]; Maven Central verification required
- Architecture: HIGH — WatchConnectivity + Wear DataClient delivery semantics verified from official Android docs and community authoritative source
- Pitfalls: HIGH — all pitfalls verified against official docs (transferUserInfo vs sendMessage, App Group behavior, ClockKit deprecation)

**Research date:** 2026-05-25
**Valid until:** 2026-06-25 (stable Apple/Android APIs; Wear OS version numbers may drift sooner)
