// Phase 16 Plan 16-01 — Capacitor root config.
//
// Bundle-IDs are split per-platform (D-10 PERMANENT):
//   iOS     → app.leanshot.ios     (set in apps/ios/App/App.xcodeproj/project.pbxproj PRODUCT_BUNDLE_IDENTIFIER)
//   Android → app.leanshot.android (set in apps/android/app/build.gradle applicationId)
//
// The `appId` below is the BASE id used by `npx cap init` and cap migration
// tooling. Per-platform overrides happen in the native project files generated
// by `cap add ios` / `cap add android` and edited by Plan 16-01 Task 2 Steps 5-6.
//
// `ios.path` + `android.path` (R1 deviation from default `ios/` + `android/`):
//   Phase 16 directory layout puts native shells under `leanshot/apps/<platform>/`
//   per Plan 16-01 frontmatter `files_modified`. Capacitor CLI honors these
//   paths during `cap add` / `cap sync` / `cap doctor`.
//
// `server.allowNavigation` (D-09 + D-11) — whitelist BOTH the marketing host
// (`leanshot.app`) and the app host (`app.leanshot.app`). NO wildcards. Any
// other origin drops to Capacitor's deny-by-default. Deep-link routing is the
// active layer (Plan 16-02 deeplink.ts); this is the passive deny-by-default.
//
// `bundledWebRuntime: false` (D-12) — we run bundled-only at P16; Capgo Live
// Updates is deferred via the `@capgo/capacitor-updater` install but NOT
// initialized in Phase 16 per D-12. Monetization paths (auth, pricing, IAP)
// ALWAYS use bundled assets per Apple §4.7 + §3.1.1.
//
// `ios.scheme` left at Capacitor default `App` — NOTE: the Plan 16-01
// `<interfaces>` block specified `ios.scheme: 'app.leanshot.ios'` but the
// Capacitor 8 CLI documents `ios.scheme` as the Xcode BUILD-SCHEME name
// (default `App`), NOT a bundle-id selector. Setting it to a reverse-DNS
// string would break `cap build ios` (no matching Xcode scheme). Bundle-id
// enforcement lives in Step 5's `PRODUCT_BUNDLE_IDENTIFIER` edit. Deviation
// logged in SUMMARY under "Rule 1 — auto-fix bug in plan-interfaces block".
//
// `ios.contentInset: 'always'` — keeps the WebView under the status bar
// without auto-resizing (matches the SPA's own safe-area handling).
//
// `android.allowMixedContent: false` + `webContentsDebuggingEnabled: false`
// — production-safe defaults; Plan 16-09 fastlane flips
// `webContentsDebuggingEnabled` for dev builds via a separate config layer.
import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'app.leanshot',
  appName: 'LeanShot',
  webDir: 'dist',
  bundledWebRuntime: false,
  server: {
    allowNavigation: ['leanshot.app', 'app.leanshot.app'],
  },
  ios: {
    path: 'apps/ios',
    // Xcode build-scheme name. Default Capacitor template ships scheme 'App'.
    // The reverse-DNS identifier `scheme: 'app.leanshot.ios'` (Plan 16-01
    // <interfaces> reference) is the iOS PRODUCT_BUNDLE_IDENTIFIER set in
    // project.pbxproj at Step 5 — NOT an Xcode scheme name. Keeping scheme
    // here at 'App' so `cap build ios` resolves the actual Xcode scheme.
    scheme: 'App',
    contentInset: 'always',
  },
  android: {
    path: 'apps/android',
    allowMixedContent: false,
    captureInput: true,
    webContentsDebuggingEnabled: false,
  },
};

export default config;
