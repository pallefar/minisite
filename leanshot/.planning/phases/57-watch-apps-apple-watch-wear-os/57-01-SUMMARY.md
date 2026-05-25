---
phase: 57-watch-apps-apple-watch-wear-os
plan: "01"
subsystem: ios-native
tags: [watchos, swiftui, widgetkit, watchconnectivity, scaffold]
dependency_graph:
  requires: []
  provides: [watchos-swiftui-target, widgetkit-complication-target, xcode-project-targets]
  affects: [leanshot/apps/ios/App/App.xcodeproj/project.pbxproj]
tech_stack:
  added: []
  patterns: [watchos-swiftui-app-lifecycle, widgetkit-staticconfiguration, watchconnectivity-transferuserinfo, pbxproj-native-target]
key_files:
  created:
    - leanshot/apps/ios/App/LeanShotWatch/LeanShotWatchApp.swift
    - leanshot/apps/ios/App/LeanShotWatch/ContentView.swift
    - leanshot/apps/ios/App/LeanShotWatch/QuickLogView.swift
    - leanshot/apps/ios/App/LeanShotWatch/WatchConnectivityManager.swift
    - leanshot/apps/ios/App/LeanShotWatchWidget/LeanShotWatchWidget.swift
    - leanshot/apps/ios/App/LeanShotWatchWidget/ComplicationEntry.swift
    - leanshot/apps/ios/App/LeanShotWatchWidget/ComplicationViews.swift
  modified:
    - leanshot/apps/ios/App/App.xcodeproj/project.pbxproj
decisions:
  - "Used plutil + PlistBuddy as structural validation for project.pbxproj since xcodebuild had a pre-existing IDESimulatorFoundation plug-in load issue (DVTDownloads symbol mismatch); xcodebuild -runFirstLaunch fixed the issue and xcodebuild -list exited 0"
  - "Comments referencing forbidden strings (sendMessage, URLSession, CLKComplication) were reworded to pass acceptance grep criteria without losing documentation intent"
  - "Stub dedupe ID included inline in QuickLogView.swift rather than importing TS sync-contract; full algorithm deferred to WatchConnectivity phone-side handler in Phase 70"
metrics:
  duration_minutes: 7
  completed_date: "2026-05-25"
  tasks_completed: 3
  files_created: 7
  files_modified: 1
requirements: [WATCH-01, WATCH-04]
---

# Phase 57 Plan 01: watchOS SwiftUI App + WidgetKit Complication Scaffold Summary

watchOS SwiftUI app target and WidgetKit complication extension target committed as native scaffolds inside the existing iOS Xcode project — WatchConnectivity `transferUserInfo` relay (offline-tolerant, no `sendMessage`), zero ClockKit, no backend imports in watch code.

## What Was Built

**Task 1 — watchOS SwiftUI app target source files (commit 680626ef)**

Four Swift files created at `apps/ios/App/LeanShotWatch/`:

- `LeanShotWatchApp.swift`: `@main struct LeanShotWatchApp: App` with `WindowGroup { ContentView() }`. Activates `WatchConnectivityManager.shared` in `init()`. watchOS 7+ SwiftUI lifecycle — no WKExtensionDelegate.
- `ContentView.swift`: Stub root view with a NavigationLink into `QuickLogView`.
- `QuickLogView.swift`: Stub quick-log screen. "Log" button constructs a `[String: Any]` payload (keys: `deduped_id`, `datetime`, `dose`, `unit`, `site`, `source: "apple_watch"`) and calls `WatchConnectivityManager.shared.sendQueuedLog(_:)`. No `user_id` in payload — stamped by phone-side `dedupeAndMerge()` (T-57-AUTH).
- `WatchConnectivityManager.swift`: `NSObject, WCSessionDelegate` singleton. `activate()` guards `WCSession.isSupported()` then sets delegate and activates. `sendQueuedLog(_:)` calls `session.transferUserInfo(log)` — the ONLY relay method (offline-tolerant FIFO queue). Zero backend framework imports. Zero `sendMessage` usage.

**Task 2 — WidgetKit complication extension source files (commit 5312f800)**

Three Swift files created at `apps/ios/App/LeanShotWatchWidget/`:

- `ComplicationEntry.swift`: `struct ComplicationEntry: TimelineEntry` with `date`, `nextDoseDate`, `currentStreak`, `nextSite` fields. Mirrors the TS `WatchComplicationData` interface from `src/lib/watch/complication-data.ts`.
- `LeanShotWatchWidget.swift`: `@main struct LeanShotWatchWidgetBundle: WidgetBundle` exposing `LeanShotComplication: Widget` built with `StaticConfiguration`. `TimelineProvider` with placeholder/getSnapshot/getTimeline (15-min `.after` refresh policy reading from App Group UserDefaults). `.supportedFamilies([.accessoryCircular, .accessoryRectangular, .accessoryInline])`. Zero ClockKit symbols.
- `ComplicationViews.swift`: Stub SwiftUI views `ComplicationCircularView` + `ComplicationRectangularView` + `ComplicationInlineView` rendering `entry.nextDoseDate` / `entry.currentStreak` / `entry.nextSite`.

**Task 3 — Register both targets in project.pbxproj (commit 36418bdc)**

`apps/ios/App/App.xcodeproj/project.pbxproj` updated with:
- `PBXFileReference` entries for all 7 Swift source files
- `PBXBuildFile` entries wiring files into their target source phases
- `PBXSourcesBuildPhase` + `PBXFrameworksBuildPhase` for each new target
- Two `PBXNativeTarget` entries: `LeanShotWatch` (productType `com.apple.product-type.application`) and `LeanShotWatchWidget` (productType `com.apple.product-type.app-extension`)
- `XCBuildConfiguration` (Debug+Release) for each target: `WATCHOS_DEPLOYMENT_TARGET = 9.0`, `SDKROOT = watchos`, correct `PRODUCT_BUNDLE_IDENTIFIER`
- `XCConfigurationList` for each target
- Both targets registered in `PBXProject.targets` array
- `PBXGroup` entries for `LeanShotWatch` and `LeanShotWatchWidget` directories
- No main iOS app dependency added (embedding link deferred to Phase 70 device build)

## Verification Results

```
xcodebuild -project apps/ios/App/App.xcodeproj -list 2>/dev/null

Information about project "App":
    Targets:
        App
        LeanShotWatch
        LeanShotWatchWidget
```

Exit code: 0. Both new targets appear. `WATCHOS_DEPLOYMENT_TARGET = 9.0` confirmed in project file. `plutil` validates the project plist is well-formed.

All acceptance criteria passed:
- `@main` in `LeanShotWatchApp.swift` — PASS
- `transferUserInfo` in `WatchConnectivityManager.swift` — PASS
- No `sendMessage` in watch sources — PASS
- No `supabase`/`URLSession` in watch sources — PASS
- `StaticConfiguration` + `WidgetBundle` + `accessoryCircular` in widget — PASS
- No `CLKComplication*` in widget sources — PASS
- `xcodebuild -list` shows both targets, exits 0 — PASS
- `WATCHOS_DEPLOYMENT_TARGET = 9.0` in project — PASS

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Forbidden strings in comments triggered acceptance grep failures**

- **Found during:** Task 1 verification
- **Issue:** Comments in `WatchConnectivityManager.swift` mentioned `sendMessage()` (as a "don't use this" reminder) and `URLSession`/`Supabase` (as "no backend" reminder). The acceptance criteria greps for their ABSENCE — including in comments — causing test failures.
- **Fix:** Reworded comments to convey the same prohibition without using the literal forbidden strings.
- **Files modified:** `WatchConnectivityManager.swift`, `QuickLogView.swift`
- **Commit:** 680626ef (same task commit)

**2. [Rule 1 - Bug] Comment mentioning `CLKComplication` in widget file**

- **Found during:** Task 2 verification
- **Issue:** A comment in `LeanShotWatchWidget.swift` read "ClockKit is deprecated — this file contains NO CLKComplication* symbols", which itself matched the `CLKComplication` grep.
- **Fix:** Reworded to "The deprecated ClockKit framework is NOT used anywhere in this target."
- **Files modified:** `LeanShotWatchWidget.swift`
- **Commit:** 5312f800 (same task commit)

**3. [Note] xcodebuild IDESimulatorFoundation plug-in load failure**

- **Found during:** Task 3 verification
- **Issue:** `xcodebuild -list` exited 70 with "A required plugin failed to load" (IDESimulatorFoundation / DVTDownloads symbol mismatch). This was a pre-existing system issue, not caused by project.pbxproj changes.
- **Fix:** Ran `xcodebuild -runFirstLaunch` which resolved the framework issue. Subsequent `xcodebuild -list` call exited 0 and showed both new targets.
- **Files modified:** None — system-level fix only
- **Impact:** xcodebuild now works normally; project.pbxproj was valid throughout (confirmed via `plutil -lint`)

## Known Stubs

These stubs are INTENTIONAL for the Phase 57 scaffold. All are explicitly deferred to Phase 70 per the plan's success criteria.

| Stub | File | Reason |
|------|------|--------|
| `QuickLogView.swift` hardcodes `dose: "0.5"`, `unit: "mg"`, `site: NSNull()` | `LeanShotWatch/QuickLogView.swift` | Dose-selection UI deferred to Phase 70 device build |
| `getTimeline` reads placeholder from empty UserDefaults | `LeanShotWatchWidget/LeanShotWatchWidget.swift` | App Group UserDefaults wiring (phone writes on WatchConnectivity receipt) deferred to Phase 70 |
| WCSessionDelegate `didReceiveUserInfo` is no-op | `LeanShotWatch/WatchConnectivityManager.swift` | Phone-originated complication data refresh wired in Phase 70 |
| `ComplicationCircularView` uses a `switch` on `WidgetFamily.accessoryCircular` | `LeanShotWatchWidget/ComplicationViews.swift` | ViewThatFits / family-based switching to be expanded in Phase 70 |

These stubs do NOT prevent the plan's goal from being achieved (scaffold + static verification). They will be resolved at Phase 70 device UAT.

## Threat Surface Scan

No new network endpoints, auth paths, or schema changes introduced. The watch files contain no Supabase imports, no URLSession calls, and no credential handling. The relay-only pattern (watch → phone via WatchConnectivity, never watch → backend) is enforced at the code level and verified by acceptance grep.

No new threat surface outside the plan's `<threat_model>`.

## Self-Check: PASSED

Created files verified:
- `leanshot/apps/ios/App/LeanShotWatch/LeanShotWatchApp.swift` — FOUND
- `leanshot/apps/ios/App/LeanShotWatch/ContentView.swift` — FOUND
- `leanshot/apps/ios/App/LeanShotWatch/QuickLogView.swift` — FOUND
- `leanshot/apps/ios/App/LeanShotWatch/WatchConnectivityManager.swift` — FOUND
- `leanshot/apps/ios/App/LeanShotWatchWidget/LeanShotWatchWidget.swift` — FOUND
- `leanshot/apps/ios/App/LeanShotWatchWidget/ComplicationEntry.swift` — FOUND
- `leanshot/apps/ios/App/LeanShotWatchWidget/ComplicationViews.swift` — FOUND

Commits verified in git log:
- `680626ef` feat(57-01): watchOS SwiftUI app target source files — FOUND
- `5312f800` feat(57-01): WidgetKit complication extension source files — FOUND
- `36418bdc` feat(57-01): register LeanShotWatch + LeanShotWatchWidget targets in project.pbxproj — FOUND
