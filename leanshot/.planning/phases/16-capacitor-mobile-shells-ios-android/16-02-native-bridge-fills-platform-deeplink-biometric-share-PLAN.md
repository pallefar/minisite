---
phase: 16-capacitor-mobile-shells-ios-android
plan: 02
type: execute
wave: 1
depends_on: ["16-00"]
# Note: 16-02 also requires 16-01's npm install to have committed first (intra-wave ordering, not a wave-level dep).
# The executor's plan-ID order within Wave 1 handles this: 16-01 → 16-02 → 16-03 by ID; 16-02 imports from
# @capacitor/* + @capgo/* which 16-01 installs. This depends_on lists only 16-00 to keep `wave = max(deps)+1`
# arithmetic consistent (plan-checker iter-1 BL-1 fix 2026-05-15).
files_modified:
  - src/lib/native/platform.ts
  - src/lib/native/deeplink.ts
  - src/lib/native/biometric.ts
  - src/lib/native/share.ts
  - src/lib/native/platform.test.ts
  - src/lib/native/deeplink.test.ts
  - src/lib/native/biometric.test.ts
  - src/lib/native/share.test.ts
  - src/components/BiometricGate.tsx
  - src/components/BiometricGate.test.tsx
  - src/App.tsx
autonomous: true
requirements:
  - MOBILE-03
  - MOBILE-06
  - MOBILE-07
  - MOBILE-10
tags: [capacitor, native-bridge, deeplink, biometric, share, ios, android]

must_haves:
  truths:
    - "On iOS/Android, calling detectPlatform() returns 'ios' or 'android' (not 'web')."
    - "Tapping a Universal Link like https://leanshot.app/clinic/foo opens the installed app and routes to the /clinic/foo view (pathname dispatch)."
    - "Tapping a Universal Link to https://leanshot.app/auth/verify-email?token=… opens the app and routes to the #/auth/verify-email?token=… hash route (hash dispatch)."
    - "On first cold boot after biometric is enabled, BiometricGate intercepts before app content paints, calls NativeBiometric.verifyIdentity, and gates the app on success."
    - "Calling nativeShare({title,text,url}) on iOS/Android opens the OS share sheet (UIActivityViewController / Intent.ACTION_SEND); on web it falls back to navigator.share or clipboard."
    - "Phase 12 ESLint firewall passes unchanged — health.ts→ads/analytics/affiliate/ads/marketing/stripe zones still blocked; new biometric.ts and share.ts add ZERO new firewall zones."
    - "All four native-bridge fills have per-file unit tests passing in the vitest-mobile config with @capacitor/* and @capgo/* mocked."
    - "BiometricGate CTA labels are noun-qualified per UI-SPEC Surface 2: 'Use Face ID' / 'Use Fingerprint' / 'Use Password' / 'Unlock App' / 'Keep Biometrics' / 'Disable Biometrics' — NO bare 'Cancel'/'Disable'/'Unlock'."
  artifacts:
    - path: src/lib/native/platform.ts
      provides: "detectPlatform() returns 'web'|'ios'|'android'|'capacitor-web' via Capacitor.getPlatform()"
      contains: "import { Capacitor } from '@capacitor/core'"
    - path: src/lib/native/deeplink.ts
      provides: "installDeepLinkHandler() — App.addListener('appUrlOpen') with PATHNAME_PREFIXES + HASH_PREFIXES dispatcher per RESEARCH Pattern 2"
      contains: "App.addListener('appUrlOpen'"
    - path: src/lib/native/biometric.ts
      provides: "checkBiometric(), authenticateWithBiometric(reason), setBiometricCredentials/getBiometricCredentials wrappers around @capgo/capacitor-native-biometric"
      contains: "@capgo/capacitor-native-biometric"
    - path: src/lib/native/share.ts
      provides: "nativeShare({title,text,url}) — @capacitor/share on native, navigator.share fallback on web"
      contains: "@capacitor/share"
    - path: src/components/BiometricGate.tsx
      provides: "Full-screen overlay (UI-SPEC Surface 2b) that gates app content until biometric (or password fallback) succeeds; CTAs per UI-SPEC copywriting table"
      contains: "authenticateWithBiometric"
    - path: src/lib/native/platform.test.ts
      provides: "Unit tests for detectPlatform() with mocked Capacitor.getPlatform"
    - path: src/lib/native/deeplink.test.ts
      provides: "Unit tests dispatching all 4 D-11 deep-link categories (auth, share, clinic, marketing) through installDeepLinkHandler"
    - path: src/lib/native/biometric.test.ts
      provides: "Unit tests for checkBiometric() + authenticateWithBiometric() with mocked NativeBiometric"
    - path: src/lib/native/share.test.ts
      provides: "Unit tests for nativeShare() — native path (mocked Share.share) and web fallback (mocked navigator.share)"
    - path: src/components/BiometricGate.test.tsx
      provides: "Component test asserting CTA noun-qualified labels render, biometric prompt invoked on mount, password fallback after 3 failures"
  key_links:
    - from: "src/App.tsx"
      to: "src/lib/native/deeplink.ts::installDeepLinkHandler"
      via: "import + call inside top-level boot useEffect, BEFORE first auth event arrives"
      pattern: "installDeepLinkHandler\\(\\)"
    - from: "src/App.tsx"
      to: "src/components/BiometricGate.tsx::BiometricGate"
      via: "conditional render wrapping <AppShell> when user.biometricEnabled === true AND not yet unlocked this session"
      pattern: "<BiometricGate"
    - from: "src/components/BiometricGate.tsx"
      to: "src/lib/native/biometric.ts::authenticateWithBiometric"
      via: "useEffect on mount + Use Face ID / Use Fingerprint button onClick"
      pattern: "authenticateWithBiometric\\("
    - from: "src/lib/native/deeplink.ts"
      to: "@capacitor/app::App.addListener"
      via: "module top-level inside installDeepLinkHandler()"
      pattern: "App\\.addListener\\('appUrlOpen'"
    - from: "src/lib/native/share.ts"
      to: "@capacitor/share::Share.share"
      via: "called when detectPlatform() !== 'web'"
      pattern: "Share\\.share\\("
    - from: "src/lib/native/biometric.ts"
      to: "@capgo/capacitor-native-biometric::NativeBiometric"
      via: "isAvailable / verifyIdentity calls"
      pattern: "NativeBiometric\\.(isAvailable|verifyIdentity)"
---

<objective>
Replace the four Phase 12 throw-stubs in `src/lib/native/` with real Capacitor 8 implementations and add a `<BiometricGate>` UI component so the LeanShot SPA, when wrapped by Phase 16's iOS+Android shells, actually:

1. Detects whether it is running natively (powering every D-13 / D-24 platform fork downstream — IAP, clinic-owner gating, Stripe portal in-app browser).
2. Receives Universal Links / App Links and dispatches them into LeanShot's hybrid hash + pathname router per RESEARCH Pattern 2 (MOBILE-06 client half).
3. Authenticates the user via Face ID / Touch ID / Android Biometric, with password fallback after failures, and gates app content behind that on cold start when enabled (MOBILE-07, CONTEXT D-06).
4. Opens the native OS share sheet for dose-log / share-card / doctor-report Share buttons (MOBILE-10).

The Phase 12 ESLint two-tunnel firewall MUST remain unchanged — neither `biometric.ts` nor `share.ts` introduce new zones, and the four native files must not import from each other in ways that breach existing health→ad-eligible boundaries.

Purpose: Without these fills every native feature in Phase 16 (paywall fork in 16-05, Stripe-portal in-app browser in surface 5, OOM-mitigated photo gallery deep links, RC tier-flip propagation) silently breaks because `detectPlatform()` returns `'web'` and the throw-stubs throw at runtime.

Output: 4 implemented bridge files + 4 per-file unit-test specs + 1 React component + 1 component test + a small wiring patch in `src/App.tsx` (deeplink install on boot + conditional BiometricGate wrap).
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/ROADMAP.md
@.planning/STATE.md
@.planning/phases/16-capacitor-mobile-shells-ios-android/16-CONTEXT.md
@.planning/phases/16-capacitor-mobile-shells-ios-android/16-RESEARCH.md
@.planning/phases/16-capacitor-mobile-shells-ios-android/16-PATTERNS.md
@.planning/phases/16-capacitor-mobile-shells-ios-android/16-UI-SPEC.md

# Existing stubs replaced by this plan (Phase 12 D-01 invariants — read THEN overwrite):
@leanshot/src/lib/native/platform.ts
@leanshot/src/lib/native/deeplink.ts
@leanshot/src/lib/native/iap.ts
@leanshot/src/lib/native/health.ts
@leanshot/src/lib/native/push.ts
@leanshot/src/lib/native/ads.ts

# Firewall (must remain unchanged):
@leanshot/eslint.config.js

# Wiring host:
@leanshot/src/App.tsx

# Analog patterns referenced by RESEARCH/PATTERNS:
@leanshot/src/lib/clinic-realtime.ts
@leanshot/src/components/dashboard/settings/DeleteAccountModal.tsx
@leanshot/src/components/ui/Button.tsx
@leanshot/src/components/ui/Modal.tsx
@leanshot/src/components/ui/Sheet.tsx

<interfaces>
<!-- Contracts that exist BEFORE this plan runs (assumed in place from 16-00 + 16-01) -->

From .planning/phases/16-capacitor-mobile-shells-ios-android/16-CONTEXT.md:
- D-06 — Biometric plugin = `@capgo/capacitor-native-biometric` (NOT @aparajita, NOT Capacitor team's official one).
- D-07 — Plugin set installed by 16-01 includes `@capacitor/app@8.x`, `@capacitor/share@8.0.1`, `@capacitor/core@8.x`, `@capgo/capacitor-native-biometric@8.4.5`.
- D-11 — Deep-link categories all open in-app when installed: auth (`/signin|/signup|/reset-password|/verify-email`), share (`/share/{token}`), clinic (`/clinic/{slug}|/clinic-invite/{token}`), marketing (`/pricing|/|/faq|/r/*`).

From 16-RESEARCH.md §Pattern 2 (the canonical deeplink dispatcher):
```typescript
import { App, type URLOpenListenerEvent } from '@capacitor/app';

const PATHNAME_PREFIXES = ['/clinic', '/pricing', '/faq', '/r/', '/share/'];
const HASH_PREFIXES = ['/auth/', '/legal/'];

export function installDeepLinkHandler(): void {
  App.addListener('appUrlOpen', (event: URLOpenListenerEvent) => {
    try {
      const u = new URL(event.url);
      const path = u.pathname;
      if (PATHNAME_PREFIXES.some((p) => path === p || path.startsWith(p))) {
        window.history.pushState({}, '', path + u.search);
        window.dispatchEvent(new PopStateEvent('popstate'));
        return;
      }
      for (const hp of HASH_PREFIXES) {
        if (path.startsWith(hp)) {
          window.location.hash = '#' + path + u.search;
          return;
        }
      }
      window.history.pushState({}, '', '/');
    } catch {
      /* malformed URL; ignore */
    }
  });
}
```

From src/lib/native/platform.ts (current stub):
```typescript
export type Platform = 'web' | 'ios' | 'android' | 'capacitor-web';
export function detectPlatform(): Platform { return 'web'; }
```
- This `Platform` type signature MUST be preserved verbatim — 16-05 (IAP fork), 16-06 (webhook), and every downstream platform-conditional render depend on it.

From src/lib/native/deeplink.ts (current stub):
```typescript
export type DeepLinkRoute = 'share' | 'affiliate' | 'app';
export function handleDeepLink(_url: string): never { throw new Error('Phase 12 stub …'); }
```
- The `DeepLinkRoute` type is unused elsewhere — safe to remove and replace with `installDeepLinkHandler(): void` per RESEARCH Pattern 2.
- `handleDeepLink` has zero call sites outside the stub — safe to delete.

From eslint.config.js (firewall zones — DO NOT MODIFY):
- Zone 1: `./src/lib/native/ads*.ts` cannot import `./src/lib/native/health.ts` (uses glob because target is a file).
- Zones 2a–6: `./src/lib/analytics`, `./src/lib/affiliate`, `./src/lib/ads`, `./src/lib/marketing`, `./src/lib/stripe` cannot import `./src/lib/native/health.ts`.
- New files in `src/lib/native/` (biometric.ts, share.ts) MUST NOT add new zone targets — they are firewall-neutral per RESEARCH §"ESLint flat config" line 753 and PATTERNS §"ESLint Firewall — Adding New Native Files".

From `@capgo/capacitor-native-biometric` README (Pattern 5):
- `NativeBiometric.isAvailable(): Promise<{ isAvailable: boolean; biometryType: BiometryType }>` — types: FACE_ID, TOUCH_ID, FINGERPRINT, FACE_AUTHENTICATION, IRIS_AUTHENTICATION, MULTIPLE, NONE.
- `NativeBiometric.verifyIdentity({ reason, title, subtitle, description }): Promise<void>` — throws on cancel/failure.

From `@capacitor/share` README:
- `Share.share({ title, text, url, dialogTitle? }): Promise<{ activityType?: string }>` — throws if user cancels share sheet.

From `@capacitor/app` README:
- `App.addListener('appUrlOpen', (event: URLOpenListenerEvent) => void): Promise<PluginListenerHandle>` — event.url is the absolute URL that opened the app.

From src/App.tsx (wiring host — read context around line 320-470):
- `function App()` runs top-level useEffects for view recompute (line 349) and onAuthStateChange (line 373). The deeplink install belongs in a NEW useEffect that runs ONCE on mount, before recompute fires.
- `useStore((s) => s.user)` and `useStore((s) => s.signedIn?.user)` give the current user; the BiometricGate wrapping condition reads `signedIn.user.id` and a NEW boolean slice `biometricEnabled` (this plan does NOT add the slice — it reads what 16-05 / a later plan will set; FOR NOW gate on a local `localStorage.getItem('leanshot_biometric_enabled') === '1'` boolean so this plan stays self-contained, and document the slice migration as a follow-up note in the SUMMARY).
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Fill platform.ts + write its mocked unit test</name>
  <read_first>
    - leanshot/src/lib/native/platform.ts (current stub, lines 1-9)
    - leanshot/.planning/phases/16-capacitor-mobile-shells-ios-android/16-RESEARCH.md lines 295-306 (Pattern 1)
    - leanshot/.planning/phases/16-capacitor-mobile-shells-ios-android/16-PATTERNS.md lines 40-72 (platform.ts pattern + firewall invariant)
    - leanshot/eslint.config.js lines 106-161 (firewall zones — confirm no new entry needed)
  </read_first>
  <behavior>
    - `detectPlatform()` returns `'ios'` when `Capacitor.getPlatform()` returns `'ios'`.
    - `detectPlatform()` returns `'android'` when `Capacitor.getPlatform()` returns `'android'`.
    - `detectPlatform()` returns `'capacitor-web'` when `Capacitor.getPlatform()` returns `'web'` AND `Capacitor.isNativePlatform()` returns `true` (e.g., `npx cap serve`).
    - `detectPlatform()` returns `'web'` when `Capacitor.getPlatform()` returns `'web'` AND `Capacitor.isNativePlatform()` returns `false`.
    - The exported `Platform` type union remains `'web' | 'ios' | 'android' | 'capacitor-web'` (preserved verbatim from the Phase 12 stub).
  </behavior>
  <action>
    Overwrite `src/lib/native/platform.ts` per RESEARCH Pattern 1 (lines 295-306): import `Capacitor` from `@capacitor/core`, branch on `Capacitor.getPlatform()`, fall back to `Capacitor.isNativePlatform() ? 'capacitor-web' : 'web'`. Preserve the `Platform` type union exactly. Keep the Phase 12 firewall header comment (the `DO NOT import from ./health` line) — replace only the body. Per D-06 RESEARCH §"ESLint flat config" line 753 and PATTERNS Block A note, `@capacitor/*` imports inside `src/lib/native/*.ts` are intentional fills and require ZERO new firewall zones.

    Then create `src/lib/native/platform.test.ts` running under the `vitest-mobile.config.ts` config scaffolded by Plan 16-00 (`environment: 'node'`, includes `src/lib/native/**/*.test.ts`). Use `vi.mock('@capacitor/core', ...)` with `Capacitor.getPlatform` and `Capacitor.isNativePlatform` as `vi.fn()`. Cover all four return values listed in <behavior>. Use `vi.resetModules()` between cases so `detectPlatform`'s capture of the mocked `Capacitor` re-reads. Do NOT import `@capacitor/core` at module top of the test — import dynamically per case after configuring the mock.
  </action>
  <verify>
    <automated>cd leanshot &amp;&amp; npx vitest run --config vitest-mobile.config.ts src/lib/native/platform.test.ts</automated>
  </verify>
  <done>
    `platform.test.ts` runs all four cases green under `vitest-mobile.config.ts`; `platform.ts` exports unchanged `Platform` type; `npm run lint -- src/lib/native/platform.ts` produces zero errors and zero new firewall warnings; ripgrep `'import.*@capacitor/core'` shows the import lives only in `platform.ts` (other native files must NOT import `Capacitor` directly — they import `detectPlatform` from `./platform`).
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Fill deeplink.ts with PATHNAME + HASH dispatcher + write 4-category test</name>
  <read_first>
    - leanshot/src/lib/native/deeplink.ts (current stub)
    - leanshot/.planning/phases/16-capacitor-mobile-shells-ios-android/16-RESEARCH.md lines 308-351 (Pattern 2 verbatim) and lines 580-660 (Pitfall §"hash routes double-#")
    - leanshot/.planning/phases/16-capacitor-mobile-shells-ios-android/16-PATTERNS.md lines 77-125 (deeplink analog + memory-hint)
    - leanshot/src/lib/clinic-realtime.ts lines 83-104 (event-listener-install lifecycle analog)
    - $HOME memory note `reference_supabase_auth_traps.md` (double-`#` trap behind hash-routes)
  </read_first>
  <behavior>
    - Calling `installDeepLinkHandler()` registers exactly one `'appUrlOpen'` listener on `App` (no duplicate registrations on a second call within the same JS context — internal idempotency flag).
    - URL `https://leanshot.app/clinic/acme-clinic` → calls `window.history.pushState({}, '', '/clinic/acme-clinic')` then dispatches a `popstate` event.
    - URL `https://leanshot.app/share/abc123?ref=email` → pushState `/share/abc123?ref=email` + popstate (PATHNAME path, NOT hash — Phase 8 SharePage handles both; Phase 16 standardizes on pathname per RESEARCH §Pitfall "hash routes double-#").
    - URL `https://leanshot.app/auth/verify-email?token=xyz` → sets `window.location.hash = '#/auth/verify-email?token=xyz'` (HASH path).
    - URL `https://leanshot.app/legal/privacy` → sets `window.location.hash = '#/legal/privacy'` (HASH path).
    - URL `https://leanshot.app/pricing` → pushState `/pricing` + popstate (marketing PATHNAME).
    - URL `https://leanshot.app/` → pushState `/` + popstate (marketing root via fallback OR explicit / match).
    - Malformed URL (`new URL()` throws) → handler swallows silently (no throw bubbles out).
  </behavior>
  <action>
    Overwrite `src/lib/native/deeplink.ts` with RESEARCH Pattern 2 verbatim (lines 314-350), with these locked details:
    - `const PATHNAME_PREFIXES = ['/clinic', '/pricing', '/faq', '/r/', '/share/'];`
    - `const HASH_PREFIXES = ['/auth/', '/legal/'];`
    - Export named function `installDeepLinkHandler(): void`.
    - Add module-level `let _installed = false;` idempotency guard so a second call returns early without re-registering — required because `src/App.tsx` may double-invoke in React StrictMode dev. The guard MUST set `_installed = true` AFTER `App.addListener` returns its handle (await the promise) so a synchronous double-call within one tick still de-dupes.
    - Replace the `DeepLinkRoute` type and `handleDeepLink` stub export — they have zero call sites (verified by grep before deleting); preserve the Phase 12 firewall header comment.
    - Import: `import { App, type URLOpenListenerEvent } from '@capacitor/app';` — this import is intentional and firewall-neutral per PATTERNS Block A note.
    - Do NOT add `/auth/` / `/legal/` to PATHNAME_PREFIXES. Do NOT add `/share/` to HASH_PREFIXES (per RESEARCH §"`#`-prefix in AASA paths" — Universal Links never carry fragments; SharePage now consumes pathname).

    Then create `src/lib/native/deeplink.test.ts`:
    - `vi.mock('@capacitor/app', () => ({ App: { addListener: vi.fn() } }))`.
    - Capture the handler the implementation registers (`App.addListener.mock.calls[0][1]`).
    - Spy/replace `window.history.pushState`, `window.location.hash`, and `window.dispatchEvent` so each of the 8 cases above can be asserted in isolation. Each case feeds the handler a `{ url: '<absolute URL>' }` object and asserts the resulting pushState path or hash value.
    - Add one test for the idempotency guard: call `installDeepLinkHandler()` twice and assert `App.addListener` was called exactly once.
    - Add one test for the malformed-URL path (`{ url: 'not-a-url' }`): no throw, no pushState, no hash change.
  </action>
  <verify>
    <automated>cd leanshot &amp;&amp; npx vitest run --config vitest-mobile.config.ts src/lib/native/deeplink.test.ts</automated>
  </verify>
  <done>
    All 10 test cases (4 D-11 categories × 2 sub-cases each + idempotency + malformed-URL) pass green; `grep -n "handleDeepLink\\|DeepLinkRoute" src/ -r` returns zero hits (stub identifiers fully removed); `npm run lint -- src/lib/native/deeplink.ts` is clean; the Phase 12 firewall header comment is preserved verbatim.
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 3: Create biometric.ts + share.ts (new files) + their unit tests</name>
  <read_first>
    - leanshot/src/lib/native/iap.ts (Phase 12 stub shape convention — header comment style)
    - leanshot/src/lib/native/platform.ts (after Task 1 — for the `detectPlatform()` import)
    - leanshot/.planning/phases/16-capacitor-mobile-shells-ios-android/16-RESEARCH.md lines 454-478 (Pattern 5 biometric) and §"Pattern" share fallback referenced lines 192-205
    - leanshot/.planning/phases/16-capacitor-mobile-shells-ios-android/16-PATTERNS.md lines 162-205 (biometric + share fill patterns)
    - leanshot/.planning/phases/16-capacitor-mobile-shells-ios-android/16-CONTEXT.md decision D-06 (Capgo plugin) and D-07 (`@capacitor/share` 8.0.1 installed by 16-01)
  </read_first>
  <behavior>
    biometric.ts:
    - `checkBiometric()` resolves to one of `'available' | 'unavailable' | 'permission-denied'` — calls `NativeBiometric.isAvailable()`; maps `isAvailable: false` to `'unavailable'`; maps a thrown error containing `'permission'` (case-insensitive) to `'permission-denied'`; any other throw → `'unavailable'`.
    - `authenticateWithBiometric(reason: string): Promise<boolean>` — calls `NativeBiometric.verifyIdentity({ reason, title: 'Unlock LeanShot', subtitle: 'Use Face ID / Touch ID to open the app', description: 'Falls back to your account password if biometrics fail' })`; resolves `true` on success, `false` on any throw (cancel / failure / unavailable).
    - On `detectPlatform() === 'web'` or `'capacitor-web'`, `checkBiometric()` short-circuits to `'unavailable'` and `authenticateWithBiometric()` short-circuits to `false` without touching `NativeBiometric`.

    share.ts:
    - `nativeShare({title, text, url})` on `detectPlatform() === 'ios' | 'android'` calls `Share.share({ title, text, url })` and resolves.
    - On web with `navigator.share` available: calls `navigator.share({title,text,url})` and resolves.
    - On web without `navigator.share`: falls back to `navigator.clipboard.writeText(url)` and resolves (user gets a copied link).
    - Any error from `Share.share` or `navigator.share` (including user-cancel which @capacitor/share throws on) is caught and converted to a resolved `void` — share is fire-and-forget per UI-SPEC Surface 3.
  </behavior>
  <action>
    Create `src/lib/native/biometric.ts`:
    - Header comment: `// Phase 16 fill — Biometric unlock bridge (MOBILE-07, CONTEXT D-06). Firewall zone: shared / no restriction (PATTERNS §"ESLint Firewall — Adding New Native Files" — no new zone needed; this file is not in the Phase 12 D-02 6-zone target set).`
    - Imports: `import { NativeBiometric } from '@capgo/capacitor-native-biometric';` and `import { detectPlatform } from './platform';`.
    - Export `type BiometricAvailability = 'available' | 'unavailable' | 'permission-denied';`.
    - Export the two async functions described in <behavior>. Use the four-property verifyIdentity call from RESEARCH Pattern 5 verbatim (reason / title / subtitle / description strings as quoted above).

    Create `src/lib/native/share.ts`:
    - Header comment: `// Phase 16 fill — Native share sheet bridge (MOBILE-10, CONTEXT D-07 plugin set). Firewall zone: shared / no restriction.`
    - Imports: `import { Share } from '@capacitor/share';` and `import { detectPlatform } from './platform';`.
    - Export `async function nativeShare(opts: { title: string; text: string; url: string }): Promise<void>` per the <behavior> spec — try/catch around both the native and web branches.

    Create `src/lib/native/biometric.test.ts`:
    - `vi.mock('@capgo/capacitor-native-biometric', () => ({ NativeBiometric: { isAvailable: vi.fn(), verifyIdentity: vi.fn() } }))`.
    - `vi.mock('./platform', () => ({ detectPlatform: vi.fn() }))`.
    - Cases: ios+available, ios+unavailable, ios+throw-permission, ios+throw-other, web (short-circuits to unavailable without calling NativeBiometric), authenticateWithBiometric ios+success, ios+cancel-throws.

    Create `src/lib/native/share.test.ts`:
    - `vi.mock('@capacitor/share', () => ({ Share: { share: vi.fn() } }))`.
    - `vi.mock('./platform', () => ({ detectPlatform: vi.fn() }))`.
    - Stub `navigator.share` and `navigator.clipboard.writeText` per case via `Object.defineProperty` on `globalThis.navigator`.
    - Cases: ios → Share.share called; android → Share.share called; web with navigator.share → navigator.share called, Share.share NOT called; web without navigator.share → clipboard.writeText called; native throw → resolves without rethrow.
  </action>
  <verify>
    <automated>cd leanshot &amp;&amp; npx vitest run --config vitest-mobile.config.ts src/lib/native/biometric.test.ts src/lib/native/share.test.ts</automated>
  </verify>
  <done>
    All biometric.test.ts cases (≥6) and share.test.ts cases (≥5) green; `npm run lint -- src/lib/native/biometric.ts src/lib/native/share.ts` clean; `grep -n "^.*target:.*biometric\\|^.*target:.*share" leanshot/eslint.config.js` returns zero hits (no new firewall zones added — confirms PATTERNS §"ESLint Firewall — Adding New Native Files" invariant).
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 4: Build BiometricGate component per UI-SPEC Surface 2b</name>
  <read_first>
    - leanshot/.planning/phases/16-capacitor-mobile-shells-ios-android/16-UI-SPEC.md §"Surface 2 — Biometric Unlock UX" (sub-surfaces 2a/2b/2c) and §"Copywriting Contract" (biometric rows)
    - leanshot/.planning/phases/16-capacitor-mobile-shells-ios-android/16-PATTERNS.md lines 251-285 (BiometricGate analog + DeleteAccountModal pattern)
    - leanshot/src/components/dashboard/settings/DeleteAccountModal.tsx (modal + async + error pattern)
    - leanshot/src/components/ui/Button.tsx (Button variants: primary, ghost, destructive; ButtonSize; `aria-busy` prop)
    - leanshot/src/components/ui/Modal.tsx (Modal primitive — role=dialog, aria-modal=true)
    - leanshot/src/lib/native/biometric.ts (after Task 3 — for the `authenticateWithBiometric` import)
    - leanshot/src/lib/native/platform.ts (after Task 1 — for `detectPlatform()`)
  </read_first>
  <behavior>
    - The component, when mounted, immediately calls `authenticateWithBiometric('Unlock LeanShot')` (mirroring UI-SPEC Surface 2b "Immediately triggers OS biometric prompt on render"). On success → calls the `onUnlock` callback. On failure → reveals the manual "Use Face ID" / "Use Fingerprint" button (label depends on `detectPlatform()`).
    - After 3 consecutive failed biometric attempts → switches to password fallback state (Sub-surface 2c) with an auto-focused password input and a "Unlock App" button (NOT bare "Unlock").
    - Password fallback uses LeanShot's existing Supabase password auth — for this plan, surface the `onPasswordSubmit(password)` prop and let App.tsx wire to actual supabase-js sign-in in a follow-up; assert the callback is invoked with the entered value.
    - CTA labels exactly match UI-SPEC §"Copywriting Contract":
      - iOS biometric trigger: "Use Face ID"
      - Android biometric trigger: "Use Fingerprint"
      - Password fallback link: "Use Password"
      - Password fallback submit: "Unlock App"
      - (BiometricGate does NOT render disable-biometric inline confirmation — that lives in Settings (Sub-surface 2d) which is out of this plan's scope; the "Keep Biometrics"/"Disable Biometrics" labels are documented here for the SettingsPage executor that owns Surface 2d later.)
    - Component is bounded by `role="dialog" aria-modal="true"` so screen readers treat it as a blocking surface.
    - Visual: full-screen overlay, centered logo (reuses existing `HeroOrbital` or wordmark — pick whichever is exported from `src/illustrations/`), heading "Unlock LeanShot" at `--text-xl` weight 700, CTAs use existing `<Button variant="primary">` primitive.
  </behavior>
  <action>
    Create `src/components/BiometricGate.tsx`:
    - Props: `interface BiometricGateProps { onUnlock: () => void; onPasswordSubmit: (password: string) => Promise<void>; }`.
    - State: `attemptCount` (number, 0-3), `mode` (`'biometric' | 'password'`), `password` (string), `loading` (boolean), `error` (string | null).
    - On mount (`useEffect` with `[]` dep): call `authenticateWithBiometric('Unlock LeanShot')`. If true → call `onUnlock()`. If false → increment attempt count and reveal the manual button. If `attemptCount >= 3` after a failure → set `mode = 'password'`.
    - Render: full-screen `fixed inset-0 z-[100]` with `--color-bg` background; centered column with logo (48px) + heading + state-conditional body.
    - Biometric mode renders the OS-trigger Button (label per `detectPlatform()` — `'Use Face ID'` for `'ios'`, `'Use Fingerprint'` for `'android'`, the iOS label as the default for `'capacitor-web'` / `'web'`) plus the `'Use Password'` text-link that flips `mode` to `'password'`.
    - Password mode renders an auto-focused `<input type="password">` (re-use the existing `<Input />` primitive from `src/components/ui/Input.tsx` with `label="Password"`, `autoFocus`), the `'Unlock App'` Button (loading state via `aria-busy={loading}`), and an inline `--color-danger` error message when `error !== null`.
    - All copy strings drawn verbatim from UI-SPEC §"Copywriting Contract" rows for biometric.
    - No new firewall zones; ESLint must still pass.

    Create `src/components/BiometricGate.test.tsx`:
    - `vi.mock('@/lib/native/biometric', () => ({ authenticateWithBiometric: vi.fn() }))` and `vi.mock('@/lib/native/platform', () => ({ detectPlatform: vi.fn() }))`.
    - Use `@testing-library/react` (already a project dep — confirm before running). Cases:
      1. iOS + auto-success → `onUnlock` called once on mount.
      2. iOS + 3 consecutive failures → password input visible, `'Unlock App'` button visible.
      3. Android → manual button label reads `'Use Fingerprint'` after first failure.
      4. CTA labels include `'Use Face ID'` (iOS), `'Use Password'`, `'Unlock App'` — NOT bare `'Unlock'`/`'Cancel'`/`'Submit'`.
      5. Password submit invokes `onPasswordSubmit` with the entered string.
      6. role="dialog" + aria-modal="true" present on the root container (a11y invariant).
  </action>
  <verify>
    <automated>cd leanshot &amp;&amp; npx vitest run --config vitest-mobile.config.ts src/components/BiometricGate.test.tsx</automated>
  </verify>
  <done>
    All 6 component-test cases pass; `grep -nE "'(Cancel|Disable|Unlock|Submit|OK|Save|Click Here)'" src/components/BiometricGate.tsx` returns zero hits (bare unqualified labels banned per UI-SPEC); `grep -nE "'Use Face ID'|'Use Fingerprint'|'Use Password'|'Unlock App'" src/components/BiometricGate.tsx | wc -l` returns ≥ 4 (all four required labels present verbatim); `npm run lint -- src/components/BiometricGate.tsx src/components/BiometricGate.test.tsx` clean.
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 5: Wire installDeepLinkHandler + BiometricGate into src/App.tsx</name>
  <read_first>
    - leanshot/src/App.tsx lines 1-200 (imports + lazy-load block — establish where to add new imports)
    - leanshot/src/App.tsx lines 320-360 (App() top — useStore selectors + view useEffect)
    - leanshot/src/App.tsx lines 370-470 (onAuthStateChange useEffect — DO NOT modify; only ADD a NEW useEffect above it for deeplink install)
    - leanshot/src/lib/native/deeplink.ts (after Task 2)
    - leanshot/src/components/BiometricGate.tsx (after Task 4)
    - $HOME memory note `feedback_parallel_executor_git_isolation.md` (this plan and 16-04 both touch repository-shared App.tsx surface area; per outline 16-04 confines edits to src/main.tsx — this task owns App.tsx for Wave 1, no conflict)
  </read_first>
  <behavior>
    - On `App()` first mount, `installDeepLinkHandler()` is called exactly once. Subsequent re-renders / StrictMode double-mount do NOT register a second listener (handled by the idempotency guard in Task 2).
    - When `localStorage.getItem('leanshot_biometric_enabled') === '1'` AND the user has not yet unlocked this JS session (tracked by a `useState` `biometricUnlocked` boolean initialized to `false`), the `<App />`'s normal render output is replaced by `<BiometricGate onUnlock={() => setBiometricUnlocked(true)} onPasswordSubmit={…} />`. After `onUnlock` fires, the gate disappears and the rest of the app renders (next render: marketing / onboarding / dashboard per existing `selectView`).
    - When biometric is NOT enabled, BiometricGate is never rendered and the existing app render flow is unchanged.
    - `onPasswordSubmit` calls the existing Supabase `signInWithPassword` flow — for this plan, expose a stub that throws `Error('password fallback not yet wired — see follow-up')` so the executor downstream knows where to hook in. Document in the SUMMARY.
  </behavior>
  <action>
    Edit `src/App.tsx` (single-writer rule — this is the only Wave 1 plan touching App.tsx):

    1. Add imports at the top alongside the existing `@/lib/native` imports:
       ```ts
       import { installDeepLinkHandler } from '@/lib/native/deeplink';
       ```
       and a lazy-import for BiometricGate (it must NOT be eagerly imported — it ships in the index chunk only when biometric is enabled, but per UI-SPEC the gate must render BEFORE first paint of dashboard content. Use direct (non-lazy) import for BiometricGate to avoid a flash-of-app-content; the component is small (<3 kB gz expected) and stays inside the existing 50 kB index budget. Verify with the bundle-budget script in the verify step.):
       ```ts
       import { BiometricGate } from '@/components/BiometricGate';
       ```

    2. Inside `function App() { … }` (around line 320), add a single new `useEffect(() => { void installDeepLinkHandler(); }, [])` above the existing view-recompute effect. Comment: `// Phase 16 Plan 16-02 — install Universal Link / App Link dispatcher (MOBILE-06 client half). Idempotency guard inside installDeepLinkHandler protects against StrictMode double-mount.`

    3. Add state hook: `const [biometricUnlocked, setBiometricUnlocked] = useState(false);` and a derived gate boolean:
       ```ts
       const biometricGateActive =
         !biometricUnlocked &&
         typeof window !== 'undefined' &&
         (() => { try { return window.localStorage.getItem('leanshot_biometric_enabled') === '1'; } catch { return false; } })();
       ```

    4. Wrap the final JSX return in an early-return: if `biometricGateActive`, return only `<BiometricGate onUnlock={() => setBiometricUnlocked(true)} onPasswordSubmit={async (_pw) => { throw new Error('password fallback not yet wired — see Phase 16 follow-up'); }} />`. Otherwise, render the existing tree unchanged.

    5. Do NOT modify the existing onAuthStateChange useEffect, lazy-component imports, or `selectView` / `selectViewLogged` logic — those are out of scope per the single-writer wave coordination rule.

    Also amend `src/App.test.tsx` if one exists for this file, OR add a focused integration assertion inside `src/components/BiometricGate.test.tsx` already created in Task 4 that mounts `<App />` (with mocked deeplink + biometric modules) and asserts `installDeepLinkHandler` was called exactly once on mount. Re-use the existing `vi.mock` setup. If no `App.test.tsx` exists, do NOT create one for this plan — the unit-test coverage for deeplink/biometric/share already proves the contracts; the wiring is verified by lint + grep.
  </action>
  <verify>
    <automated>cd leanshot &amp;&amp; npm run typecheck &amp;&amp; npm run lint -- src/App.tsx src/components/BiometricGate.tsx src/lib/native/ &amp;&amp; npx vitest run --config vitest-mobile.config.ts src/lib/native src/components/BiometricGate.test.tsx &amp;&amp; bash scripts/assert-bundle-budget.sh</automated>
  </verify>
  <done>
    `npm run typecheck` clean; `npm run lint` on the changed files passes with zero firewall violations; bundle-budget script reports index gz still ≤ 50 kB (BiometricGate fits inside the existing budget); `grep -c "installDeepLinkHandler" src/App.tsx` returns ≥ 1; ESLint reports zero new `import-x/no-restricted-paths` violations and the Phase 12 zones list in `eslint.config.js` is byte-identical to its pre-plan state (`git diff leanshot/eslint.config.js` is empty).
  </done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| OS → WKWebView/Android WebView | The native shell delivers `appUrlOpen` events containing arbitrary URLs the OS believes match our app's AASA/assetlinks. Untrusted scheme handling could route attacker-controlled URLs into privileged routes. |
| User device sensor → app | Face ID / fingerprint result is asserted by the OS but the app must not treat success as "user identity proof beyond a possession factor" — it is a possession factor on top of an existing password-authenticated session. |
| Web origin → native plugin | `@capacitor/share` accepts a URL that ends up in the OS share sheet. A malicious in-page script could trigger sharing of an attacker URL, but the user gets the OS confirmation chrome before any action — low impact. |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-16-02-01 | Spoofing | Universal Link dispatch (deeplink.ts) | mitigate | URL parsing uses `new URL(event.url)` which throws on malformed input; only `u.pathname` is matched against allowlisted prefix arrays; query string is forwarded verbatim but never used for routing decisions. AASA/assetlinks (Plan 16-03) restrict which hosts can deliver these events to begin with. |
| T-16-02-02 | Tampering | PATHNAME_PREFIXES allowlist | mitigate | The prefix arrays are module-level `const` and not user-influenced. Any new deep-link target requires a code change reviewed by the planner. No JSON config that could be overridden at runtime. |
| T-16-02-03 | Information Disclosure | BiometricGate password input | mitigate | `<input type="password">` (no value logging), no Sentry capture of input contents, error message text is fixed ("Incorrect password. Try again.") and contains no input. |
| T-16-02-04 | Information Disclosure | Share.share URL leak | accept | URLs shared via OS share sheet are user-initiated; chrome confirms recipient. No PHI/PII routed through this path (only doctor-report URLs which are user-authored share tokens). |
| T-16-02-05 | Repudiation | Deep-link audit trail | accept | No regulatory requirement for client-side deep-link auditing in v1.2. Sentry captures errors only, not link traversal. |
| T-16-02-06 | DoS | Repeated biometric prompt | mitigate | After 3 consecutive failures BiometricGate switches to password fallback (Sub-surface 2c). OS-level rate-limiting (Face ID lockout after 5 OS-failures) protects the underlying sensor. |
| T-16-02-07 | Elevation of Privilege | Stolen device + cached session | mitigate | BiometricGate gates app-content render until biometric (or password) succeeds when enabled. Per CONTEXT D-06 the password fallback uses Supabase Auth — the existing session JWT remains required server-side regardless. (Hook wiring deferred to SUMMARY follow-up.) |
| T-16-02-08 | Tampering | Idempotency guard bypass | accept | The `_installed` module flag is JS-scoped; an attacker with JS execution already has full app access. Idempotency exists for StrictMode hygiene, not security. |
| T-16-02-09 | Information Disclosure | URL search string forwarding | mitigate | search string is appended only to pathname pushState (no eval, no innerHTML). Hash route writes encode via `'#' + path + u.search` (string concat, no template injection vectors). |
</threat_model>

<verification>
**Plan-level invariants (run all from `leanshot/` working directory):**

1. **All 4 native fills + component tests green:**
   ```bash
   npx vitest run --config vitest-mobile.config.ts \
     src/lib/native/platform.test.ts \
     src/lib/native/deeplink.test.ts \
     src/lib/native/biometric.test.ts \
     src/lib/native/share.test.ts \
     src/components/BiometricGate.test.tsx
   ```

2. **Stub identifiers gone:**
   ```bash
   ! grep -rn "handleDeepLink\|DeepLinkRoute\|Phase 12 D-01 stub — platform" src/
   ```
   (must return non-zero exit / no matches; the stubs are fully replaced.)

3. **Phase 12 firewall unchanged:**
   ```bash
   git diff --stat eslint.config.js
   ```
   Must show `eslint.config.js` NOT in the diff (zero modifications).

4. **No new ESLint violations:**
   ```bash
   npm run lint
   ```
   Must exit 0 across the whole repo. Pre-existing import-x/order errors documented in memory note `project_lint_debt_import_x_order.md` are NOT a regression and may remain — but the count must not increase.

5. **Bundle budget preserved:**
   ```bash
   npm run build && bash scripts/assert-bundle-budget.sh
   ```
   Index gz still ≤ 50 kB; `capacitor-bridge` chunk (created in 16-01) still ≤ 15 kB gz.

6. **Phase 12 firewall still rejects health→ads (regression check):**
   ```bash
   # Touch a temporary file to verify zone 1 still fires:
   git stash && echo "import { readBiomarker } from './health';" >> src/lib/native/ads.ts && \
     npm run lint -- src/lib/native/ads.ts; ECODE=$?; git checkout src/lib/native/ads.ts && git stash pop || true
   ```
   `$ECODE` must be non-zero (lint blocked the import) — proves the firewall still works after our fills.

7. **CTA copy contract — noun-qualified labels only:**
   ```bash
   ! grep -nE "'(Cancel|Disable|Unlock|Submit|OK|Save|Click Here)'" src/components/BiometricGate.tsx
   ```
   Must return non-zero / no matches.

8. **App.tsx single-writer rule preserved:**
   ```bash
   git diff --stat src/App.tsx
   ```
   Diff should show ONLY: new `installDeepLinkHandler` import, new `BiometricGate` import, one new `useEffect` for the deeplink install, one new `useState` + `biometricGateActive` derivation, and the early-return wrap. No edits to the onAuthStateChange useEffect, lazy chunks, or `selectView`.

9. **App.tsx wiring grep:**
   ```bash
   grep -nE "installDeepLinkHandler\\(\\)|<BiometricGate " src/App.tsx | wc -l
   ```
   Must return ≥ 2.
</verification>

<success_criteria>
- [ ] `src/lib/native/platform.ts` — `detectPlatform()` real implementation returns ios/android/capacitor-web/web per `Capacitor.getPlatform()` + `isNativePlatform()`; `Platform` type union byte-identical to the Phase 12 stub export.
- [ ] `src/lib/native/deeplink.ts` — `installDeepLinkHandler()` registers exactly one `App.addListener('appUrlOpen', …)`; PATHNAME_PREFIXES = `['/clinic', '/pricing', '/faq', '/r/', '/share/']`; HASH_PREFIXES = `['/auth/', '/legal/']`; idempotency guard prevents double-registration in StrictMode.
- [ ] `src/lib/native/biometric.ts` — NEW file, calls `@capgo/capacitor-native-biometric` via `NativeBiometric.isAvailable` and `verifyIdentity`; web short-circuits return `'unavailable'` / `false`.
- [ ] `src/lib/native/share.ts` — NEW file, calls `@capacitor/share`'s `Share.share` on native, falls back to `navigator.share` then clipboard on web; always resolves (no rethrow).
- [ ] `src/components/BiometricGate.tsx` — NEW file, full-screen overlay per UI-SPEC Surface 2b; CTA labels = `'Use Face ID'` (iOS) / `'Use Fingerprint'` (Android) / `'Use Password'` / `'Unlock App'`; 3-failure password fallback; role="dialog" aria-modal="true" present.
- [ ] All 5 new unit/component test files green under `vitest-mobile.config.ts` (≥ 25 distinct test cases combined).
- [ ] `src/App.tsx` wires `installDeepLinkHandler()` in a NEW top-mount useEffect and conditionally renders `<BiometricGate>` when `localStorage['leanshot_biometric_enabled'] === '1'` and not yet unlocked this session.
- [ ] `eslint.config.js` byte-identical to pre-plan version (`git diff` empty for that file).
- [ ] `npm run typecheck` + `npm run lint` + `npm run build` + `scripts/assert-bundle-budget.sh` all green.
- [ ] No bare CTA labels (`'Cancel'`/`'Disable'`/`'Unlock'`/`'Submit'`/`'OK'`/`'Save'`) anywhere in `src/components/BiometricGate.tsx`.
- [ ] Phase 12 firewall regression check (Verification step 6) still fails when health→ads import is artificially introduced.
</success_criteria>

<output>
After completion, create `.planning/phases/16-capacitor-mobile-shells-ios-android/16-02-native-bridge-fills-platform-deeplink-biometric-share-SUMMARY.md` capturing:

- File-by-file diff summary (platform.ts / deeplink.ts / biometric.ts / share.ts / BiometricGate.tsx / App.tsx / 5 test files).
- Confirmation that `eslint.config.js` was NOT modified (Phase 12 firewall preserved).
- The `leanshot_biometric_enabled` localStorage flag is a temporary hook — note that a future plan (likely 16-05 or a deferred follow-up) should migrate it to a proper Zustand slice on `signedIn.user.biometricEnabled` and wire `BiometricGate.onPasswordSubmit` to the real Supabase `signInWithPassword` call.
- Bundle-size delta: index gz before/after; capacitor-bridge gz before/after; share.ts + biometric.ts sizes individually.
- Bullet list of all 4 D-11 deep-link categories with their resolved routing (PATHNAME vs HASH) for downstream plans (16-03 AASA + 16-10 UAT) to cross-check.
- Carry-over follow-ups: (a) Supabase password sign-in wiring inside BiometricGate.onPasswordSubmit; (b) Surface 2d Settings toggle row (not in this plan's scope — likely an existing SettingsPage modification slated for a downstream phase).
</output>
