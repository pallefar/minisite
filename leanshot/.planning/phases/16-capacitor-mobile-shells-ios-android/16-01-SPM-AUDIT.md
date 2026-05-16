# Phase 16 Plan 16-01 — SPM Audit (Swift Package Manager vs CocoaPods)

## Audit Metadata

- **Date:** 2026-05-16
- **Executor:** agent-ab8b25bac92dc193a (gsd-executor)
- **Capacitor CLI version pinned:** `@capacitor/cli@^8.3.4` (verified via `npm view @capacitor/cli@8.3.4 version` → `8.3.4`)
- **Method:** `npm view <pkg>@<version> dist.tarball` + `curl ... | tar -tzf -` to enumerate each package's published tarball contents. SPM availability = presence of a top-level `Package.swift` file (Swift Package Manager manifest). CocoaPods availability = presence of a `.podspec` file. Both files coexist in all modern Capacitor 8 plugins — the SPM-vs-Pods choice is exercised at `cap add ios` time via the `--pods` flag.
- **Raw audit log:** `/tmp/spm-audit-tarballs.log` (locally generated; ephemeral but reproducible by re-running the audit script below).

## DISPOSITION: SPM (default for `npx cap add ios`)

Every iOS-shipping plugin in the 14-plugin set (D-07) PLUS the 2 third-party iOS plugins (RevenueCat + Capgo biometric) PLUS Sentry-Capacitor ship a `Package.swift` at their npm-package root. `npx cap add ios` (Capacitor 8.x default) consumes these via Swift Package Manager. **No CocoaPods fallback required.** No CHECKPOINT REACHED return marker emitted; Task 2 proceeds autonomously with Fork A (SPM).

## Inventory Table (17 rows)

| Package | Pinned Version | SPM Support | Evidence (Tarball Contents) | Citation | Disposition |
|---------|---------------|-------------|------------------------------|----------|-------------|
| `@capacitor/core` | `^8.3.4` | YES (runtime bridge — SPM consumed via `@capacitor/ios`) | npm tarball ships JS bridge only; native code lives in `@capacitor/ios` | https://github.com/ionic-team/capacitor | SPM via `@capacitor/ios` |
| `@capacitor/cli` (dev) | `^8.3.4` | N/A (Node CLI; no iOS-native code) | npm tarball — `dist/` JS only | https://github.com/ionic-team/capacitor | N/A — dev scaffolding |
| `@capacitor/ios` (dev) | `^8.3.4` | YES (ships `Capacitor.podspec` + SPM template for host app) | `package/Capacitor.podspec` + `package/CapacitorCordova.podspec` + `Capacitor/Capacitor/*.swift` (bridge sources). SPM scaffolding emitted into the host Xcode project at `cap add ios` time. | https://github.com/ionic-team/capacitor | SPM (default in v8) |
| `@capacitor/android` (dev) | `^8.3.4` | N/A (Android only) | n/a | https://github.com/ionic-team/capacitor | N/A — Android |
| `@capacitor/app` | `^8.1.0` | YES | `package/Package.swift` + `package/CapacitorApp.podspec` | https://github.com/ionic-team/capacitor-plugins/tree/main/app | SPM |
| `@capacitor/preferences` | `^8.0.1` | YES | `package/Package.swift` + `package/CapacitorPreferences.podspec` | https://github.com/ionic-team/capacitor-plugins/tree/main/preferences | SPM |
| `@capacitor/share` | `^8.0.1` | YES | `package/Package.swift` + `package/CapacitorShare.podspec` | https://github.com/ionic-team/capacitor-plugins/tree/main/share | SPM |
| `@capacitor/splash-screen` | `^8.0.1` | YES | `package/Package.swift` + `package/CapacitorSplashScreen.podspec` | https://github.com/ionic-team/capacitor-plugins/tree/main/splash-screen | SPM |
| `@capacitor/status-bar` | `^8.0.2` | YES | `package/Package.swift` + `package/CapacitorStatusBar.podspec` | https://github.com/ionic-team/capacitor-plugins/tree/main/status-bar | SPM |
| `@capacitor/haptics` | `^8.0.2` | YES | `package/Package.swift` + `package/CapacitorHaptics.podspec` | https://github.com/ionic-team/capacitor-haptics | SPM |
| `@capacitor/browser` | `^8.0.3` | YES | `package/Package.swift` + `package/CapacitorBrowser.podspec` | https://github.com/ionic-team/capacitor-plugins/tree/main/browser | SPM |
| `@capacitor/keyboard` | `^8.0.3` | YES | `package/Package.swift` + `package/CapacitorKeyboard.podspec` | https://github.com/ionic-team/capacitor-keyboard | SPM |
| `@capacitor/network` | `^8.0.1` | YES | `package/Package.swift` + `package/CapacitorNetwork.podspec` | https://github.com/ionic-team/capacitor-plugins/tree/main/network | SPM |
| `@capacitor/filesystem` | `^8.1.2` | YES | `package/Package.swift` + `package/CapacitorFilesystem.podspec` | https://github.com/ionic-team/capacitor-filesystem | SPM |
| `@capacitor/clipboard` | `^8.0.1` | YES | `package/Package.swift` + `package/CapacitorClipboard.podspec` | https://github.com/ionic-team/capacitor-plugins/tree/main/clipboard | SPM |
| `@revenuecat/purchases-capacitor` | `^13.1.1` | YES | `package/Package.swift` + `package/RevenuecatPurchasesCapacitor.podspec`. Maintainer = `RevenueCat` GitHub org (NOT a typosquat). | https://github.com/RevenueCat/purchases-capacitor | SPM |
| `@capgo/capacitor-native-biometric` | `^8.4.5` | YES | `package/Package.swift` + `package/CapgoCapacitorNativeBiometric.podspec`. Maintainer = `Cap-go` GitHub org (matches Phase 18's `@capgo/capacitor-health` family per D-06). | https://github.com/Cap-go/capacitor-native-biometric | SPM |
| `@sentry/capacitor` | `^4.0.0` | YES | `package/Package.swift` + `package/SentryCapacitor.podspec`. Maintainer = `getsentry` GitHub org. | https://github.com/getsentry/sentry-capacitor | SPM |
| `react-virtuoso` | `^4.18.7` | N/A — pure JS, no native module | n/a | https://github.com/petyosi/react-virtuoso | N/A |

**Total iOS-shipping plugins audited: 16** (14 from D-07 + RevenueCat + Capgo biometric + Sentry Capacitor — the D-07 enumeration already counts Sentry separately from `@sentry/react` web). All ship SPM. **Zero CocoaPods-only plugins.**

## CocoaPods Fallback Path (always documented, even when SPM-clean)

Although this audit cleared SPM at the 2026-05-16 snapshot, future plugin upgrades may introduce a CocoaPods-only dependency. If a re-audit (see protocol below) flags any iOS-shipping plugin as `Package.swift`-absent:

1. **Halt downstream merge** — emit `## CHECKPOINT REACHED: SPM audit failed for {plugin-list}` from the next plan that touches the affected dependency.
2. **Re-scaffold iOS shell with Pods:** `npx cap add ios --pods` (Fork B in the Plan 16-01 task description). This generates `leanshot/apps/ios/App/Podfile` instead of `Package.swift`.
3. **Run CocoaPods install:** `cd leanshot/apps/ios/App && pod install --repo-update`. Requires `pod` (CocoaPods gem) installed locally — `gem install cocoapods`. The current execution environment does NOT have CocoaPods (`which pod` → not found), so any Fork-B fallback in the future will need a pre-step to install it via Homebrew or RubyGems.
4. **Commit `Podfile` + `Podfile.lock`** (lockfile-pinned to mitigate T-16-01-01/T-16-01-02 typosquat risk). Append `apps/ios/App/Pods/` to `leanshot/.gitignore` (Pods directory regenerated from lockfile on every fresh checkout).
5. **iOS deployment target propagation:** Edit `apps/ios/App/Podfile`'s `platform :ios, '15.0'` line. Without this, CocoaPods sets the default platform from the highest pod's `s.ios.deployment_target`, which may regress to 13.0+ for older pods and silently violate the R1-locked iOS 15.0 minimum.
6. **CI runner:** GitHub Actions macOS runners have CocoaPods preinstalled. Local-only impact.
7. **fastlane impact (Wave 3):** `fastlane gym` auto-detects Workspace-vs-Project — `cap add ios --pods` produces `App.xcworkspace`. The Plan 16-09 fastlane lanes (`Gymfile`) must declare `workspace "App.xcworkspace"` rather than `project "App.xcodeproj"` under Fork B.

## Re-verification Protocol

When ANY of the audited packages bumps minor or major version (i.e., the `^X.Y.Z` constraint resolves to a different `X.Y` pair on `npm install`), re-run this audit for the changed row(s):

```bash
# For each changed package:
PKG="@capacitor/<name>@<new-version>"
TARBALL=$(npm view "$PKG" dist.tarball | tr -d '"')
curl -sL "$TARBALL" | tar -tzf - | grep -E '(Package\.swift|\.podspec)$'
# YES Package.swift → still SPM-clean. Update the inventory table version + tarball date.
# NO Package.swift (but YES .podspec) → SPM regression. Trigger Fork B (CocoaPods).
```

Trigger conditions for full re-audit (not just per-package):
- Capacitor major version bump (8 → 9): re-run for all rows.
- Migration from `@capacitor/ios@8` → `@capacitor/ios@9`: re-run because the host SPM template generator changes between majors.
- A new plugin added to D-07: audit the new row only.

## Audit Script (reproducible)

```bash
#!/usr/bin/env bash
# Run from anywhere with `npm` + `curl` + `tar` on PATH.
set -euo pipefail
PINNED=(
  "@capacitor/core@8.3.4"
  "@capacitor/app@8.1.0"
  "@capacitor/preferences@8.0.1"
  "@capacitor/share@8.0.1"
  "@capacitor/splash-screen@8.0.1"
  "@capacitor/status-bar@8.0.2"
  "@capacitor/haptics@8.0.2"
  "@capacitor/browser@8.0.3"
  "@capacitor/keyboard@8.0.3"
  "@capacitor/network@8.0.1"
  "@capacitor/filesystem@8.1.2"
  "@capacitor/clipboard@8.0.1"
  "@revenuecat/purchases-capacitor@13.1.1"
  "@capgo/capacitor-native-biometric@8.4.5"
  "@sentry/capacitor@4.0.0"
)
for pkg in "${PINNED[@]}"; do
  TARBALL=$(npm view "$pkg" dist.tarball | tr -d '"')
  CONTENTS=$(curl -sL "$TARBALL" | tar -tzf -)
  HAS_PSWIFT=$(echo "$CONTENTS" | grep -E '/Package\.swift$' | head -1 || true)
  HAS_PODSPEC=$(echo "$CONTENTS" | grep -E '\.podspec$' | head -1 || true)
  echo "$pkg | SPM=$([ -n "$HAS_PSWIFT" ] && echo Y || echo N) | Pods=$([ -n "$HAS_PODSPEC" ] && echo Y || echo N)"
done
```

## Handoff to Task 2

- **Fork A (SPM default)** — proceed with `npx cap add ios` (no `--pods` flag).
- Versions in Task 2's `npm install` commands MUST match the pinned versions in the inventory table above (`^MAJOR.MINOR.PATCH` floor with the exact same `MAJOR.MINOR.PATCH` as audited).
- No `Podfile` will be generated; do NOT add `Podfile.lock` to commit set.
- `.gitignore` still receives `apps/ios/App/Pods/` (defense-in-depth — in case Fork B is needed later, the ignore is already in place).
