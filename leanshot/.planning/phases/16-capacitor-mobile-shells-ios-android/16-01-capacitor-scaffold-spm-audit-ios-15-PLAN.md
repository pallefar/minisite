---
phase: 16
plan: 01
type: execute
wave: 1
depends_on: ["16-00"]
files_modified:
  - leanshot/capacitor.config.ts
  - leanshot/package.json
  - leanshot/package-lock.json
  - leanshot/vite.config.ts
  - leanshot/.gitignore
  - leanshot/apps/ios/App/App.xcodeproj/project.pbxproj
  - leanshot/apps/ios/App/App/Info.plist
  - leanshot/apps/android/app/build.gradle
  - leanshot/apps/android/app/src/main/AndroidManifest.xml
  - leanshot/.planning/phases/16-capacitor-mobile-shells-ios-android/16-01-SPM-AUDIT.md
autonomous: false  # CocoaPods-fallback fork in Task 1 needs human confirmation if SPM audit fails
requirements: [MOBILE-01, MOBILE-02, MOBILE-08]
tags: [capacitor, ios, android, spm, scaffold, bundle-budget]

must_haves:
  truths:
    - "`npx cap doctor` passes for iOS + Android without warnings."
    - "All 14 plugins from CONTEXT D-07 + `@capgo/capacitor-native-biometric` + `@revenuecat/purchases-capacitor` + `@sentry/capacitor` resolve via the iOS dependency manager chosen by the audit (SPM by default; CocoaPods only if any plugin lacks SPM)."
    - "`react-virtuoso@4.18.7` is installed and importable from `src/`."
    - "`leanshot/apps/ios/` xcconfig has `IPHONEOS_DEPLOYMENT_TARGET = 15.0` (R1 correction over CONTEXT D-05's `14.0`)."
    - "`leanshot/apps/android/app/build.gradle` has `minSdkVersion 24`, `targetSdkVersion 36`."
    - "iOS bundle id resolves to `app.leanshot.ios`; Android applicationId resolves to `app.leanshot.android` (D-10 PERMANENT)."
    - "A `capacitor-bridge` chunk emits when `@capacitor/*` is statically imported; the existing CI ceiling at `scripts/assert-clinic-bundle-budget.sh:155` (`CAPACITOR_BRIDGE_CEILING=15000`) measures it instead of skipping."
    - "16-01-SPM-AUDIT.md documents the SPM-vs-CocoaPods disposition for each of the 14 plugins + 3 net-new packages, with version-pinned evidence."
  artifacts:
    - path: "leanshot/capacitor.config.ts"
      provides: "Capacitor root config: appName=LeanShot, webDir=dist, ios.scheme=app.leanshot.ios, android.allowMixedContent=false, server.allowNavigation=['leanshot.app','app.leanshot.app']"
      contains: "import type { CapacitorConfig }"
    - path: "leanshot/apps/ios/App/App.xcodeproj/project.pbxproj"
      provides: "iOS native project with bundle id app.leanshot.ios and IPHONEOS_DEPLOYMENT_TARGET=15.0"
    - path: "leanshot/apps/android/app/build.gradle"
      provides: "Android native module pinned to minSdkVersion 24, targetSdkVersion 36, applicationId app.leanshot.android"
    - path: "leanshot/.planning/phases/16-capacitor-mobile-shells-ios-android/16-01-SPM-AUDIT.md"
      provides: "Per-plugin SPM availability evidence + fallback disposition"
      min_lines: 50
    - path: "leanshot/.gitignore"
      provides: ".gitignore entries for apps/ios/App/Pods, apps/ios/App/build, apps/android/.gradle, apps/android/build, apps/android/app/build, DerivedData"
  key_links:
    - from: "leanshot/vite.config.ts"
      to: "node_modules/@capacitor/*, node_modules/@revenuecat/purchases-capacitor, node_modules/@capgo/capacitor-native-biometric, node_modules/@sentry/capacitor"
      via: "manualChunks regex routing to capacitor-bridge"
      pattern: "node_modules\\\\/(@capacitor|@revenuecat\\\\/purchases-capacitor|@capgo\\\\/capacitor-native-biometric|@sentry\\\\/capacitor)"
    - from: "leanshot/scripts/assert-clinic-bundle-budget.sh:278"
      to: "leanshot/dist/assets/capacitor-bridge-*.js"
      via: "check_chunk_ceiling glob"
      pattern: "capacitor-bridge-\\*\\.js"
    - from: "leanshot/capacitor.config.ts"
      to: "leanshot/dist"
      via: "webDir property"
      pattern: "webDir:\\s*['\"]dist['\"]"
---

<objective>
Scaffold the Capacitor 8 iOS + Android shells, install the full plugin set, audit Swift Package Manager support for every iOS-native dependency, lock iOS 15.0 / Android 24+ minimums, and route the Capacitor bridge into its own bundle chunk so the existing 15 kB gz ceiling (`scripts/assert-clinic-bundle-budget.sh:155`) measures real cost from this commit forward.

Purpose: This is the structural foundation every other Phase 16 plan builds on. 16-02 fills the native bridge; 16-04 wires Sentry on top; 16-05/06 wire RevenueCat. If SPM audit slips, the entire iOS pipeline downstream is on shaky ground.

Output:
- `leanshot/capacitor.config.ts` at the leanshot project root (NOT repo root — see Critical: working directory).
- `leanshot/apps/ios/` + `leanshot/apps/android/` native projects.
- Pinned 14-plugin set + `@capgo/capacitor-native-biometric@^8.4.5` + `@revenuecat/purchases-capacitor@^13.1.1` + `@sentry/capacitor@^4.0.0` + `react-virtuoso@^4.18.7` in `package.json` + `package-lock.json`.
- SPM audit document with evidence per dependency.
- `capacitor-bridge` chunk wired into `vite.config.ts` manualChunks.
- iOS / Android xcconfig + Gradle pinned to true Capacitor 8 minimums (R1 correction).
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@leanshot/.planning/phases/16-capacitor-mobile-shells-ios-android/16-CONTEXT.md
@leanshot/.planning/phases/16-capacitor-mobile-shells-ios-android/16-RESEARCH.md
@leanshot/.planning/phases/16-capacitor-mobile-shells-ios-android/16-PATTERNS.md
@leanshot/.planning/phases/16-capacitor-mobile-shells-ios-android/16-PLAN-OUTLINE.md
@leanshot/vite.config.ts
@leanshot/scripts/assert-clinic-bundle-budget.sh
@leanshot/package.json
@leanshot/.gitignore

<critical_facts>
1. **Working directory is `leanshot/`, not the repo root.** Every `npm`, `npx`, `vite`, `tsc` call below MUST run from `/Users/karstenhaldan/minisite/leanshot`. The `.github/workflows/ci.yml` `defaults.run.working-directory: leanshot` is the project convention. `capacitor.config.ts` lives at `leanshot/capacitor.config.ts`, NOT `/Users/karstenhaldan/minisite/capacitor.config.ts`.

2. **CONTEXT D-05 says "iOS 14+"; this is wrong.** Capacitor 8 mandates iOS 15.0 minimum (verified by RESEARCH §"Standard Stack" + capacitorjs.com/docs/updating/8-0). Lock `IPHONEOS_DEPLOYMENT_TARGET = 15.0` per R1. CONTEXT D-08's iPhone 12 target is iOS 15+ capable, so no users are excluded. RESEARCH also locks Android `minSdkVersion 24`, `targetSdkVersion 36`, Xcode 26.0+, Node 22+.

3. **Bundle IDs split per-platform PERMANENTLY (D-10).** iOS = `app.leanshot.ios`, Android = `app.leanshot.android`. NOT a single shared `app.leanshot`. `npx cap init` writes a single appId; the per-platform override happens via the `ios.scheme` and Android `applicationId` settings + a single edit to the generated `project.pbxproj` (`PRODUCT_BUNDLE_IDENTIFIER`).

4. **`capacitor-bridge` chunk ceiling already exists** at `leanshot/scripts/assert-clinic-bundle-budget.sh:155` (`CAPACITOR_BRIDGE_CEILING=15000`) and the check at line 278 (`check_chunk_ceiling 'capacitor-bridge-*.js' "$CAPACITOR_BRIDGE_CEILING" 'capacitor-bridge'`). Today it logs `wave-0 skip` because no chunk matches the glob. After this plan installs `@capacitor/core` and routes it via `manualChunks`, the chunk WILL emit and the ceiling will start enforcing. Stay UNDER 15000 bytes gz at first measure or downstream plans cannot ship.

5. **Hash-hyphen bug is already fixed** (Plan 10-11). Vite hashes containing `-` won't break the `capacitor-bridge-*.js` glob — the fix is upstream of this plan. Do not regress.

6. **`@capacitor/core` is a runtime dep, `@capacitor/cli` is dev.** Same for `@capacitor/ios` + `@capacitor/android` — those are dev (Vite never bundles them; they're scaffolding tooling).

7. **`.gitignore` rule:** Commit `leanshot/apps/ios/` and `leanshot/apps/android/` source dirs, but ignore the build/derived dirs. Pattern: `apps/ios/App/Pods/`, `apps/ios/App/build/`, `apps/ios/App/Pods.xcodeproj/`, `apps/android/.gradle/`, `apps/android/build/`, `apps/android/app/build/`, `apps/ios/DerivedData/`, `**/xcuserdata/`. If the SPM audit forces CocoaPods (Task 1 fork-B), the `Podfile.lock` MUST be committed but `Pods/` ignored. Append to `leanshot/.gitignore`; do NOT replace existing entries.

8. **Wave-0 prerequisites (from 16-00) MUST exist before Task 0 starts:** `leanshot/vitest-mobile.config.ts`, `leanshot/src/lib/native/__mocks__/*.ts`. If any are missing, HALT and emit `## CHECKPOINT REACHED: Wave 0 incomplete — 16-00 has not landed`.
</critical_facts>
</context>

<interfaces>
<!-- Identifiers downstream plans (16-02..16-06) will consume. Define them here so executors know the contracts. -->

`leanshot/capacitor.config.ts` — single default export:

```
import type { CapacitorConfig } from '@capacitor/cli';
const config: CapacitorConfig = {
  appId: 'app.leanshot',           // base appId (overridden per-platform via project files)
  appName: 'LeanShot',
  webDir: 'dist',
  bundledWebRuntime: false,
  server: {
    allowNavigation: ['leanshot.app', 'app.leanshot.app'],
  },
  ios: {
    scheme: 'app.leanshot.ios',    // D-10 PERMANENT
    contentInset: 'always',
  },
  android: {
    allowMixedContent: false,
    captureInput: true,
    webContentsDebuggingEnabled: false,
  },
};
export default config;
```

iOS bundle id in `project.pbxproj` (search-and-replace target):
- BEFORE (cap-add default): `PRODUCT_BUNDLE_IDENTIFIER = app.leanshot;`
- AFTER (D-10): `PRODUCT_BUNDLE_IDENTIFIER = app.leanshot.ios;`

iOS xcconfig deployment target (search-and-replace target):
- BEFORE: `IPHONEOS_DEPLOYMENT_TARGET = 14.0;` (Capacitor 7 default if any leak) or `13.0`/`15.0` (Cap-8 default)
- AFTER (R1): `IPHONEOS_DEPLOYMENT_TARGET = 15.0;` everywhere it appears.

Android `applicationId` in `leanshot/apps/android/app/build.gradle` (search-and-replace target):
- BEFORE: `applicationId "app.leanshot"`
- AFTER (D-10): `applicationId "app.leanshot.android"`
- Also confirm: `minSdkVersion 24`, `targetSdkVersion 36`, `compileSdkVersion 36`.

`leanshot/vite.config.ts` — new branch inside the existing `manualChunks` function, placed inside the `if (id.includes('node_modules'))` block, BEFORE the `vendor-telemetry` rule so `@sentry/capacitor` lands in `capacitor-bridge` and `@sentry/react` stays in `vendor-telemetry`:

```
if (/node_modules\/(@capacitor\/[^/]+|@revenuecat\/purchases-capacitor|@capgo\/capacitor-native-biometric|@sentry\/capacitor)(\/|$)/.test(id)) {
  return 'capacitor-bridge';
}
```

The existing `vendor-telemetry` regex at `vite.config.ts:165` already anchors to `@sentry/react|@sentry/core|@sentry/browser|@sentry-internal/browser-utils|posthog-js` — `@sentry/capacitor` is NOT in that list, so it will fall through correctly to `capacitor-bridge` once the new rule is placed above it. Do NOT modify the `vendor-telemetry` regex.
</interfaces>

<tasks>

<task type="auto">
  <name>Task 1: SPM compatibility audit for all 14 plugins + 3 net-new packages</name>
  <files>
    leanshot/.planning/phases/16-capacitor-mobile-shells-ios-android/16-01-SPM-AUDIT.md
  </files>
  <read_first>
    - `leanshot/.planning/phases/16-capacitor-mobile-shells-ios-android/16-RESEARCH.md` §"Pitfall 7: Cap-8 SPM Default Trips Up CocoaPods Plugins" (lines 699-703) and §"Standard Stack — Core" (lines 117-141) for the exact 18-entry inventory + pinned versions
    - `leanshot/.planning/phases/16-capacitor-mobile-shells-ios-android/16-CONTEXT.md` §D-07 for the canonical 14-plugin enumeration
  </read_first>
  <action>
    Produce the audit document at the path above. For each of the 17 iOS-native dependencies below, record SPM availability evidence via npm + GitHub README/Package.swift inspection (use `npm view <pkg> repository.url` then WebFetch the resulting GitHub URL + check for `Package.swift` at the package root). Pin every version to a `^MAJOR.MINOR.PATCH` floor matching RESEARCH §"Standard Stack — Core" table.

    Inventory (16 iOS-shipping plugins + 1 plain JS):
    Core (11 from D-07): `@capacitor/core@^8.3.4`, `@capacitor/cli@^8.3.4` (dev), `@capacitor/ios@^8.3.4` (dev), `@capacitor/android@^8.3.4` (dev), `@capacitor/app@^8.1.0`, `@capacitor/preferences@^8.0.1`, `@capacitor/share@^8.0.1`, `@capacitor/splash-screen@^8.0.1`, `@capacitor/status-bar@^8.0.2`, `@capacitor/haptics@^8.0.2`, `@capacitor/browser@^8.0.3`.
    QoL (2): `@capacitor/keyboard@^8.0.3`, `@capacitor/network@^8.0.1`.
    Future-ready (2): `@capacitor/filesystem@^8.1.2`, `@capacitor/clipboard@^8.0.1`.
    IAP (1): `@revenuecat/purchases-capacitor@^13.1.1`.
    Biometric (1): `@capgo/capacitor-native-biometric@^8.4.5`.
    Sentry (1, iOS-native via plugin): `@sentry/capacitor@^4.0.0`.
    Plain JS (no native): `react-virtuoso@^4.18.7` — list but mark "N/A — pure JS, no native module".

    For each entry the audit row must record: package name, pinned version, SPM-yes/no (with evidence URL), CocoaPods-fallback-needed-if-no, GitHub README citation line, and a one-line disposition.

    If EVERY iOS-shipping entry is SPM-compatible: set the audit header to `## DISPOSITION: SPM (default for `npx cap add ios`)` and the audit is autonomous-pass.

    If ANY iOS-shipping entry is CocoaPods-only: set the header to `## DISPOSITION: CocoaPods fallback required for {list-of-plugins}` and follow the explicit CocoaPods fallback path documented at the bottom of the audit file. The fallback path is also enumerated below in Task 2 (Fork B). Document the fallback choice + the offending plugin + maintainer URL + last-commit timestamp in the audit.

    **CocoaPods fallback path (mandatory documented record):** If the audit flags any plugin as Pods-only, Task 2 forks to use `npx cap add ios --pods` instead of the SPM default and generates a `Podfile` at `leanshot/apps/ios/App/Podfile`. The `Podfile.lock` MUST be committed. `Pods/` MUST be `.gitignore`d. All other plan tasks proceed unchanged. Per `feedback_planner_iter1_anti_patterns.md`: the fallback decision is a CHECKPOINT — if the audit returns ANY CocoaPods-only plugin, emit `## CHECKPOINT REACHED: SPM audit failed for {plugins}` and wait for user confirmation before proceeding to Task 2 with Fork B. If the audit is fully clean, proceed autonomously to Task 2 with Fork A (SPM default).

    Audit doc structure (minimum sections, ≥50 lines):
    1. Audit metadata (date, executor agent ID, Capacitor CLI version verified via `npx --yes @capacitor/cli@8 --version`).
    2. Inventory table (17 rows; cols: package, pinned-version, SPM-yes/no, evidence-URL, citation, disposition).
    3. Disposition header.
    4. CocoaPods fallback path (always documented even when SPM clean — for future regression).
    5. Re-verification protocol for plugin-upgrade events (1 line each: when a plugin's minor version bumps, re-run the audit for that row).
  </action>
  <verify>
    <automated>test -f leanshot/.planning/phases/16-capacitor-mobile-shells-ios-android/16-01-SPM-AUDIT.md &amp;&amp; [ "$(wc -l &lt; leanshot/.planning/phases/16-capacitor-mobile-shells-ios-android/16-01-SPM-AUDIT.md)" -ge 50 ] &amp;&amp; grep -E '^## DISPOSITION: (SPM|CocoaPods fallback required)' leanshot/.planning/phases/16-capacitor-mobile-shells-ios-android/16-01-SPM-AUDIT.md &amp;&amp; grep -c '@capacitor/' leanshot/.planning/phases/16-capacitor-mobile-shells-ios-android/16-01-SPM-AUDIT.md | awk '{if($1&lt;13){exit 1}}'</automated>
  </verify>
  <done>16-01-SPM-AUDIT.md exists at the specified path with ≥50 lines, declares an explicit DISPOSITION header, enumerates all 13 `@capacitor/*` packages plus the 3 third-party plugins, cites SPM evidence URLs per row, and documents the CocoaPods fallback path. If disposition is "CocoaPods fallback required", the executor MUST have emitted a CHECKPOINT REACHED return marker before Task 2 starts.</done>
</task>

<task type="auto">
  <name>Task 2: Install plugin set + scaffold native projects with the audit-chosen iOS dependency manager</name>
  <files>
    leanshot/package.json
    leanshot/package-lock.json
    leanshot/capacitor.config.ts
    leanshot/apps/ios/**
    leanshot/apps/android/**
    leanshot/.gitignore
  </files>
  <read_first>
    - The audit DISPOSITION header from Task 1.
    - `leanshot/.planning/phases/16-capacitor-mobile-shells-ios-android/16-RESEARCH.md` §"Installation (Wave 1)" (lines 159-183) for the canonical `npm i` command and the `npx cap init` invocation.
    - `leanshot/.planning/phases/16-capacitor-mobile-shells-ios-android/16-PATTERNS.md` §`capacitor.config.ts` (lines 414-444) for the config-file shape including `server.allowNavigation`.
    - `leanshot/.gitignore` — append, do not replace.
  </read_first>
  <action>
    All commands run from `/Users/karstenhaldan/minisite/leanshot/`.

    Step 1 — Install pinned versions per the inventory in Task 1's audit. Use exact `^MAJOR.MINOR.PATCH` from RESEARCH §"Standard Stack — Core":
    - Runtime deps: `@capacitor/core@^8.3.4`, `@capacitor/app@^8.1.0`, `@capacitor/preferences@^8.0.1`, `@capacitor/share@^8.0.1`, `@capacitor/splash-screen@^8.0.1`, `@capacitor/status-bar@^8.0.2`, `@capacitor/haptics@^8.0.2`, `@capacitor/browser@^8.0.3`, `@capacitor/keyboard@^8.0.3`, `@capacitor/network@^8.0.1`, `@capacitor/filesystem@^8.1.2`, `@capacitor/clipboard@^8.0.1`, `@revenuecat/purchases-capacitor@^13.1.1`, `@capgo/capacitor-native-biometric@^8.4.5`, `@sentry/capacitor@^4.0.0`, `react-virtuoso@^4.18.7`.
    - Dev deps: `@capacitor/cli@^8.3.4`, `@capacitor/ios@^8.3.4`, `@capacitor/android@^8.3.4`.

    Use `npm install --save <runtime-list>` then `npm install --save-dev <dev-list>`. Commit `package.json` + `package-lock.json` together.

    Step 2 — Run `npx cap init "LeanShot" "app.leanshot" --web-dir=dist`. The init writes a default `capacitor.config.ts`; OVERWRITE it with the exact shape from `<interfaces>` above (D-09 `server.allowNavigation` for both leanshot.app + app.leanshot.app; D-12 `bundledWebRuntime: false` because we run bundled-only at P16; Capgo Live Updates deferred per R5).

    Step 3 — Fork A (audit clean, SPM): run `npx cap add ios && npx cap add android`. Cap 8 defaults to SPM for iOS; this generates `leanshot/apps/ios/App/Package.swift`.

    Step 3 — Fork B (audit flagged CocoaPods needed): run `npx cap add ios --pods && npx cap add android`. This generates `leanshot/apps/ios/App/Podfile` instead of `Package.swift`. Run `cd leanshot/apps/ios/App && pod install --repo-update` from inside the iOS dir. Commit `Podfile` + `Podfile.lock`; do NOT commit `Pods/`.

    Step 4 — Lock iOS 15.0 deployment target (R1). Open `leanshot/apps/ios/App/App.xcodeproj/project.pbxproj` and replace every occurrence of `IPHONEOS_DEPLOYMENT_TARGET = <any>;` with `IPHONEOS_DEPLOYMENT_TARGET = 15.0;`. Use `sed` (BSD-safe on macOS — but per MEMORY's BSD-sed `\(group\)` quirk, this is a literal-string replacement with no groups, so BSD-sed is fine). If Fork B (Pods), also update `leanshot/apps/ios/App/Podfile`'s `platform :ios, '15.0'` line.

    Step 5 — Lock iOS bundle id to D-10. In `project.pbxproj`, replace every `PRODUCT_BUNDLE_IDENTIFIER = app.leanshot;` with `PRODUCT_BUNDLE_IDENTIFIER = app.leanshot.ios;` (this typically appears 3 times: Debug, Release, and the App target). Verify with `grep -c 'app.leanshot.ios' leanshot/apps/ios/App/App.xcodeproj/project.pbxproj` returns ≥3.

    Step 6 — Lock Android targets + applicationId. In `leanshot/apps/android/app/build.gradle`: set `applicationId "app.leanshot.android"`, `minSdkVersion 24`, `targetSdkVersion 36`, `compileSdkVersion 36`. The cap-add Android template uses Capacitor's `variables.gradle` for SDK versions — if the values come from `variables.gradle`, update `leanshot/apps/android/variables.gradle` instead.

    Step 7 — Run `npx cap sync ios && npx cap sync android`. This must succeed with no plugin-missing errors. Output: confirmation that all 16 native-shipping plugins are registered.

    Step 8 — Append to `leanshot/.gitignore` (do NOT replace):
    ```
    # Phase 16 — Capacitor native projects
    apps/ios/App/Pods/
    apps/ios/App/build/
    apps/ios/App/Pods.xcodeproj/
    apps/ios/DerivedData/
    apps/android/.gradle/
    apps/android/build/
    apps/android/app/build/
    **/xcuserdata/
    **/*.xcworkspace/xcuserdata/
    ```

    Step 9 — Run `npx cap doctor` and capture output. Must report iOS + Android present and no missing plugins.

    Per `feedback_parallel_executor_git_isolation.md`: when committing, use `git commit -- <pathspec>` listing only the files in this plan's `files_modified` to avoid sweeping sibling-plan changes. (This plan is Wave 1, parallel with 16-02 and 16-03 — file-isolation matters even though `files_modified` lists are disjoint.)
  </action>
  <verify>
    <automated>cd leanshot &amp;&amp; test -f capacitor.config.ts &amp;&amp; test -d apps/ios/App &amp;&amp; test -d apps/android/app &amp;&amp; grep -q "appId: 'app.leanshot'" capacitor.config.ts &amp;&amp; grep -q "scheme: 'app.leanshot.ios'" capacitor.config.ts &amp;&amp; grep -q "leanshot.app" capacitor.config.ts &amp;&amp; grep -qE 'PRODUCT_BUNDLE_IDENTIFIER = app\.leanshot\.ios' apps/ios/App/App.xcodeproj/project.pbxproj &amp;&amp; ! grep -qE 'PRODUCT_BUNDLE_IDENTIFIER = app\.leanshot;' apps/ios/App/App.xcodeproj/project.pbxproj &amp;&amp; grep -qE 'IPHONEOS_DEPLOYMENT_TARGET = 15\.0' apps/ios/App/App.xcodeproj/project.pbxproj &amp;&amp; ! grep -qE 'IPHONEOS_DEPLOYMENT_TARGET = (12|13|14)\.0' apps/ios/App/App.xcodeproj/project.pbxproj &amp;&amp; (grep -q 'applicationId "app.leanshot.android"' apps/android/app/build.gradle || grep -q 'applicationId "app.leanshot.android"' apps/android/variables.gradle 2&gt;/dev/null) &amp;&amp; node -e "const p=require('./package.json'); const need=['@capacitor/core','@capacitor/app','@capacitor/preferences','@capacitor/share','@capacitor/splash-screen','@capacitor/status-bar','@capacitor/haptics','@capacitor/browser','@capacitor/keyboard','@capacitor/network','@capacitor/filesystem','@capacitor/clipboard','@revenuecat/purchases-capacitor','@capgo/capacitor-native-biometric','@sentry/capacitor','react-virtuoso']; const miss=need.filter(n=&gt;!p.dependencies[n]); if(miss.length){console.error('MISSING:',miss);process.exit(1)}" &amp;&amp; node -e "const p=require('./package.json'); const need=['@capacitor/cli','@capacitor/ios','@capacitor/android']; const miss=need.filter(n=&gt;!p.devDependencies[n]); if(miss.length){console.error('MISSING dev:',miss);process.exit(1)}" &amp;&amp; grep -v '^#' .gitignore | grep -q 'apps/ios/App/Pods'</automated>
  </verify>
  <done>`leanshot/capacitor.config.ts` matches the `<interfaces>` shape (appId, webDir=dist, scheme=app.leanshot.ios, server.allowNavigation has both hosts). `leanshot/apps/ios/` + `leanshot/apps/android/` exist and contain xcodeproj/Gradle wiring. iOS PRODUCT_BUNDLE_IDENTIFIER is `app.leanshot.ios` everywhere; legacy `app.leanshot;` has zero occurrences. iOS deployment target is `15.0` everywhere; no 12/13/14 leakage. Android `applicationId` is `app.leanshot.android`. All 16 runtime plugins + 3 dev scaffolding packages are pinned in `package.json` per RESEARCH versions. `.gitignore` has the new build-artifact entries (filtered with `grep -v '^#'` to satisfy the BSD-grep-counts-comments rule).</done>
</task>

<task type="auto" tdd="true">
  <name>Task 3: Wire capacitor-bridge chunk in vite.config.ts manualChunks + verify ceiling activation</name>
  <files>
    leanshot/vite.config.ts
    leanshot/src/lib/native/__capacitor-import-probe.ts
  </files>
  <read_first>
    - `leanshot/vite.config.ts` lines 50-200 — the existing manualChunks function shape, with anchor regexes for `vendor-supabase`, `vendor-react`, `vendor-motion`, `vendor-charts`, `vendor-icons`, `vendor-dnd-kit`, `vendor-telemetry`. The new `capacitor-bridge` rule MUST go inside `if (id.includes('node_modules'))` and BEFORE the `vendor-telemetry` rule.
    - `leanshot/scripts/assert-clinic-bundle-budget.sh` lines 149-160 (the `CAPACITOR_BRIDGE_CEILING=15000` defn) and line 278 (the `check_chunk_ceiling 'capacitor-bridge-*.js'` invocation). The ceiling and check ALREADY EXIST; this task only makes the chunk emit.
    - `leanshot/eslint.config.js` — confirm the `import-x/no-restricted-paths` firewall has no rule blocking `@capacitor/*` from `src/lib/native/*`. RESEARCH confirms the firewall is uni-directional (health → ad-eligible only); Capacitor imports inside `src/lib/native/` are allowed.
  </read_first>
  <behavior>
    - When `npm run build` runs, the output `leanshot/dist/assets/` contains exactly one file matching `capacitor-bridge-*.js`.
    - The `capacitor-bridge-*.js.gz` size (computed via `gzip -c | wc -c`) is &lt; 15000 bytes at this commit (today: `@capacitor/core` ≈ 12 kB gz + one small probe wrapper).
    - `bash leanshot/scripts/assert-clinic-bundle-budget.sh` exits 0 with a `capacitor-bridge: PASS` line and NO `wave-0 skip` line for the capacitor-bridge entry.
    - When `vendor-telemetry` is also emitted (it is — `@sentry/react` is statically imported via `main.tsx`), `@sentry/capacitor` does NOT leak into `vendor-telemetry`. Verifiable by `grep -l 'sentry-capacitor' leanshot/dist/assets/vendor-telemetry-*.js` returning empty AND `grep -l 'sentry-capacitor' leanshot/dist/assets/capacitor-bridge-*.js` returning a match.
  </behavior>
  <action>
    Step 1 — Create a TINY static-import probe at `leanshot/src/lib/native/__capacitor-import-probe.ts`. Purpose: force `@capacitor/core` into the static graph at Wave 1 time so the `capacitor-bridge` chunk emits and gets measured. Without this, the chunk only materializes after 16-02 wires `Capacitor.getPlatform()` into `platform.ts` — meaning the bundle-budget gate runs blind for one full wave.

    Probe contents (directive prose; concrete identifiers):
    - Imports `Capacitor` from `@capacitor/core` and re-exports it as `__capacitorImportProbe`.
    - JSDoc header explains it exists only to anchor the manualChunks regex at Wave 1; 16-02 replaces this probe with real `detectPlatform()` body and removes the probe file.
    - Add one line in `leanshot/src/main.tsx` near the top: `import './lib/native/__capacitor-import-probe';` (side-effect import). 16-02 task 1 removes this line as part of its `platform.ts` fill.

    Step 2 — Add the new manualChunks branch to `leanshot/vite.config.ts`. Place it inside `if (id.includes('node_modules'))` and BEFORE the `vendor-telemetry` rule (which is currently at lines 164-170 per the file read). Pattern matches `@capacitor/*` (any submodule), `@revenuecat/purchases-capacitor`, `@capgo/capacitor-native-biometric`, `@sentry/capacitor`. Use the anchored regex from `<interfaces>` above. Add a comment block citing this plan (`Phase 16 Plan 16-01 — capacitor-bridge chunk`) and listing the four package families covered.

    Step 3 — Run `cd leanshot && npm run build`. Confirm the build succeeds with no TS errors and `dist/assets/capacitor-bridge-*.js` appears in the output.

    Step 4 — Run `cd leanshot && bash scripts/assert-clinic-bundle-budget.sh`. Capture output. Confirm:
    - One line matches `capacitor-bridge: PASS` (or equivalent — the script's pass-line format).
    - NO line matches `wave-0 skip` for capacitor-bridge.
    - The index chunk ceiling check still passes (sanity — adding `@capacitor/core` to a fresh static graph must NOT spill into the index chunk).

    Step 5 — Confirm `@sentry/capacitor` (when present in node_modules — Task 2 installed it) routes to `capacitor-bridge`, NOT `vendor-telemetry`. Run: `gzcat leanshot/dist/assets/vendor-telemetry-*.js.map 2>/dev/null | grep -c 'sentry-capacitor' || echo 0` — should print 0. (The probe alone doesn't statically import `@sentry/capacitor`, so this is a forward-compatibility check; if 16-04 later wires sentry-capacitor and it lands in the wrong chunk, that is a regression caught by 16-04 task verification, not this task. This check just baselines.)

    Per the `feedback_planner_iter1_anti_patterns.md` rule on grep gates: every grep-c gate below filters `grep -v '^#'` first so header prose can't self-invalidate.
  </action>
  <verify>
    <automated>cd leanshot &amp;&amp; grep -v '^#' vite.config.ts | grep -qE "return 'capacitor-bridge'" &amp;&amp; grep -v '^#' vite.config.ts | grep -qE 'node_modules\\\\\/\(@capacitor\\\\\/' &amp;&amp; test -f src/lib/native/__capacitor-import-probe.ts &amp;&amp; grep -q "from '@capacitor/core'" src/lib/native/__capacitor-import-probe.ts &amp;&amp; grep -q "__capacitor-import-probe" src/main.tsx &amp;&amp; npm run build 2&gt;&amp;1 | tail -40 &amp;&amp; ls dist/assets/capacitor-bridge-*.js 1&gt;/dev/null 2&gt;&amp;1 &amp;&amp; bash scripts/assert-clinic-bundle-budget.sh 2&gt;&amp;1 | tee /tmp/16-01-budget.log &amp;&amp; ! grep -qi 'wave-0 skip.*capacitor-bridge' /tmp/16-01-budget.log &amp;&amp; grep -qiE 'capacitor-bridge.*(PASS|OK|✓)' /tmp/16-01-budget.log</automated>
  </verify>
  <done>`leanshot/vite.config.ts` has a new manualChunks branch routing `@capacitor/*` + `@revenuecat/purchases-capacitor` + `@capgo/capacitor-native-biometric` + `@sentry/capacitor` to `capacitor-bridge`, placed before the `vendor-telemetry` rule. `leanshot/src/lib/native/__capacitor-import-probe.ts` exists and is side-effect-imported from `main.tsx` (16-02 removes both). `npm run build` produces `dist/assets/capacitor-bridge-*.js`. `bash scripts/assert-clinic-bundle-budget.sh` exits 0, prints a pass-line for capacitor-bridge, and does NOT print `wave-0 skip` for that entry. The chunk is &lt; 15000 bytes gz at this commit (ceiling enforced going forward).</done>
</task>

</tasks>

<threat_model>

## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| node_modules → bundled JS | npm registry packages execute at runtime in the WKWebView/WebView. A malicious version pin (typosquat) of `@revenuecat/purchases-capacitor` or `@capgo/capacitor-native-biometric` would gain access to the StoreKit / biometric APIs respectively. |
| Capacitor.config.ts → app shell | `server.allowNavigation` defines which HTTPS origins the WebView may navigate to. Misconfiguration = arbitrary remote origins can run as the app. |
| `IPHONEOS_DEPLOYMENT_TARGET` regression | Lowering below 15.0 silently disables required-reason API enforcement on older iOS, breaking PrivacyInfo audit assumptions in 16-07. |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-16-01-01 | T (Tampering) | `@revenuecat/purchases-capacitor` install path | mitigate | Pin exact `^13.1.1` version in `package.json`; `package-lock.json` integrity hash protects against typosquat-during-install. Audit doc Task 1 cites the GitHub repo URL as the canonical source-of-truth for the package identity. |
| T-16-01-02 | T | `@capgo/capacitor-native-biometric` install path | mitigate | Same as T-16-01-01: pinned `^8.4.5` + lockfile integrity. The audit explicitly verifies the GitHub maintainer is `Cap-go` org (not a typosquat `@capgojs/...`). |
| T-16-01-03 | I (Info disclosure) | `capacitor.config.ts` server.allowNavigation | mitigate | Whitelist only `leanshot.app` and `app.leanshot.app`. NO wildcards. Any deep link not in the whitelist drops to the Capacitor default block. 16-02 deeplink.ts is the active routing layer; this config is the passive deny-by-default. |
| T-16-01-04 | E (Elevation of privilege) | iOS deployment target regression | mitigate | The `IPHONEOS_DEPLOYMENT_TARGET = 15.0` lock is verified by the automated gate. The negative grep (no 12/13/14 leakage) catches a downstream wave that might `cap migrate`-roll-back the target. |
| T-16-01-05 | R (Repudiation) | SPM audit drift on plugin minor-version bumps | accept | The audit doc itself includes a "re-verification protocol" section; the operational cost of re-running on every plugin minor is low (the audit doc is a markdown table). Not a runtime threat. |
| T-16-01-06 | D (DoS) | Capacitor-bridge chunk size regression | mitigate | The 15 kB gz ceiling at `scripts/assert-clinic-bundle-budget.sh:155` enforces this every CI run from this commit forward. Plan 16-02 will add ~3 kB of bridge wrappers; if total exceeds 15 kB, 16-02 must split or trim BEFORE merging. |
| T-16-01-07 | S (Spoofing) | iOS bundle id `app.leanshot.ios` vs base `app.leanshot` collision | mitigate | The negative-grep verification (`! grep PRODUCT_BUNDLE_IDENTIFIER = app.leanshot;`) catches any leftover base id that would let a malicious sibling app spoof Universal-Link routing. D-10 is PERMANENT so any future drift triggers regression. |

</threat_model>

<verification>

End-of-plan integration check (executor runs before commit):

1. `cd leanshot && npx cap doctor` — both iOS + Android present, no missing plugins.
2. `cd leanshot && npm run build` — succeeds with zero TS errors, emits `capacitor-bridge-*.js`.
3. `cd leanshot && bash scripts/assert-clinic-bundle-budget.sh` — exits 0; capacitor-bridge ceiling now measured.
4. `cd leanshot && npm run typecheck` — zero errors (the probe file must typecheck).
5. `cd leanshot && npm run lint` — zero NEW errors. (Pre-existing 84 errors are baseline per MEMORY `project_lint_debt_import_x_order.md`; this plan must not increase the count.)
6. `git diff --name-only HEAD` matches the `files_modified` frontmatter exactly — no sibling-plan files swept (per `feedback_parallel_executor_git_isolation.md`).
7. The audit doc disposition matches Task 2's fork choice (SPM = Fork A, CocoaPods = Fork B).

</verification>

<success_criteria>

- `leanshot/capacitor.config.ts` exists with the exact shape from `<interfaces>` (appId + appName + webDir + ios.scheme + server.allowNavigation for both hosts).
- `leanshot/apps/ios/` + `leanshot/apps/android/` are committed (source dirs only; build artifacts gitignored).
- 16 runtime plugin packages + 3 dev scaffolding packages pinned at the RESEARCH-locked versions.
- iOS `PRODUCT_BUNDLE_IDENTIFIER = app.leanshot.ios` everywhere; zero `app.leanshot;` leakage (negative grep gate).
- iOS `IPHONEOS_DEPLOYMENT_TARGET = 15.0` everywhere; zero 12/13/14 leakage (negative grep gate, R1 enforcement).
- Android applicationId = `app.leanshot.android`; minSdk 24; targetSdk 36.
- 16-01-SPM-AUDIT.md documents per-package SPM disposition with citations.
- `capacitor-bridge` chunk emits in `dist/assets/`; the existing 15 kB gz ceiling now actively enforces (no `wave-0 skip`).
- All three `_done` automated verifications pass.
- Either: audit DISPOSITION = SPM and execution proceeded autonomously, OR audit DISPOSITION = CocoaPods fallback and the executor emitted a CHECKPOINT REACHED return marker with the offending plugin list before Task 2.

</success_criteria>

<output>
After completion, write `.planning/phases/16-capacitor-mobile-shells-ios-android/16-01-SUMMARY.md` using `@$HOME/.claude/get-shit-done/templates/summary.md`. Required sections:
- Disposition: SPM | CocoaPods (from Task 1).
- Versions pinned (table of 19 package + version).
- Bundle measurement: `capacitor-bridge-*.js` gz size at this commit (forward baseline for 16-02..16-06).
- Probe-removal handoff to 16-02 (file path: `leanshot/src/lib/native/__capacitor-import-probe.ts` + import line in `leanshot/src/main.tsx`).
- Carry-overs to 16-02..16-06 (none expected if both forks complete cleanly).
</output>
