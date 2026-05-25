# Phase 57: Watch Apps (Apple Watch + Wear OS) - Context

**Gathered:** 2026-05-25
**Status:** Ready for planning
**Mode:** Smart discuss (autonomous) — 3 grey areas accepted as recommended

<domain>
## Phase Boundary
Companion watch apps (Apple Watch SwiftUI + Wear OS Compose) surfacing quick dose-log + next-dose complication/tile + streak + site-rotation recommendation, with an offline-tolerant queue that syncs to the phone backend on reconnect. Inherits the Phase 55 HealthKit two-tunnel firewall scope.

**Net-new:** watchOS SwiftUI target (in leanshot/apps/ios) + Wear OS Compose module (in leanshot/apps/android), both committed as SCAFFOLDS; WatchConnectivity (iOS) + Wear Data Layer (Android) phone↔watch bridge; a shared TS offline-queue + sync contract (quick-log → injections, idempotent dedupe); complication/tile data logic (next-dose + streak + next-recommended-site) computed from EXISTING libs.

Per D-08: on-device watch render, complication/tile, watch push delivery, and real phone↔watch sync require physical devices + Apple/Play → defer to Phase 70. Build native scaffolds (file-existence/structure verified, no device build) + the TS offline-queue/sync/complication-data logic (unit-tested) now.
</domain>

<decisions>
## Implementation Decisions
### Native watch frameworks
- Apple Watch = SwiftUI watchOS target under leanshot/apps/ios; Wear OS = Jetpack Compose module under leanshot/apps/android. Committed as scaffolds; native build → P70. `cap sync` only.
- Phone↔watch comms: WatchConnectivity (iOS) + Wear Data Layer API (Android). Watch does NOT call the backend directly — it relays through the phone.

### Offline queue + sync + complication/tile data
- Offline-tolerant: watch quick-logs queue locally → sync on reconnect; idempotent dedupe (reuse the uuid-v5/date-source pattern) → `injections`. Ship a shared TS sync-contract module (testable) defining the queued-log payload + the merge/dedupe.
- Complication/tile data: next-dose + streak + next-recommended-site, computed from the EXISTING pharmacology / streak / site-rotation libs (testable TS). No new domain logic — reuse.

### Firewall + defer + UI
- Watch HealthKit / Health-Services reads (heart rate, activity) route via the Phase 55 firewall (assertNoHealthData boundary; no ad-surface cross-import). Add the same discipline / a regression note.
- "Done" = native SwiftUI + Compose scaffolds committed + offline-queue/sync contract (TS, unit-tested) + complication/tile data logic (tested) + firewall inheritance. On-device watch render / complication / push / phone-sync → Phase 70.
- **No UI-SPEC** — native watch UI is platform-rendered (SwiftUI/Compose); the testable surface is the TS data contract.

### Claude's Discretion
- Native scaffold file layout, WatchConnectivity message shapes, queue persistence, complication families/tile templates.
</decisions>

<code_context>
## Existing Code Insights
### Reusable Assets
- leanshot/apps/ios (SPM) + leanshot/apps/android (Gradle) native projects (from P16/P53) — add watch targets here.
- Existing libs: pharmacology (next-dose), streak (useStreaks), site-rotation recommendation, store.ts addInjection — the watch complication/sync reuses these.
- Phase 55 firewall: src/lib/native/healthAssert.ts (assertNoHealthData) + eslint rule + CI grep.
- Capacitor: cap sync only; --legacy-peer-deps; detectPlatform from platform.ts.

### Established Patterns
- Idempotent dedupe (uuid-v5 by date/source) from Phase 55 health import.
- Native build defers to CI/P70 (no local Xcode/Android Studio device build); verify scaffolds via file existence + config validity + tsc + vitest for the TS contract.

### Integration Points
- watchOS target + Wear module in apps/; TS sync-contract + complication-data under src/lib/ (watch/).
</code_context>

<specifics>
## Specific Ideas
- Apple Dev cert + watch provisioning + physical Apple Watch / Wear device are pending → on-device at P70.
- Quick-log on watch must NOT lose data offline (queue + idempotent sync is the patient-trust requirement).
</specifics>

<deferred>
## Deferred Ideas
- On-device complication/tile render, watch push delivery, real WatchConnectivity/Data-Layer sync, watch HealthKit reads on device → Phase 70 HUMAN-UAT.
- Standalone watch mode (no phone) → out of scope (companion only) per PROJECT v1.5+.
</deferred>
