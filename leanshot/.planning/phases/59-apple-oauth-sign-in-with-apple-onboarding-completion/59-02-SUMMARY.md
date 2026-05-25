---
phase: 59-apple-oauth-sign-in-with-apple-onboarding-completion
plan: "02"
subsystem: auth-native
tags: [apple-sign-in, native-ios, capacitor, auth, tdd]
dependency_graph:
  requires: [59-01]
  provides: [signInWithAppleNative, apple-sign-in-bridge, ios-entitlement]
  affects: [src/lib/auth.ts, apps/ios/App/App/App.entitlements]
tech_stack:
  added:
    - "@capacitor-community/apple-sign-in@7.1.0"
  patterns:
    - "vi.mock hoisting for native plugin mocks (no vitest-mobile.config.ts alias needed)"
    - "platform-gate before native call (detectPlatform() !== 'ios' short-circuit)"
    - "signInWithIdToken exchange: Apple identityToken → GoTrue server-side verification"
key_files:
  created:
    - leanshot/src/lib/native/apple-sign-in.ts
    - leanshot/src/lib/native/apple-sign-in.test.ts
    - leanshot/src/lib/native/__mocks__/capacitor-community-apple-sign-in.ts
  modified:
    - leanshot/package.json
    - leanshot/package-lock.json
    - leanshot/apps/ios/App/App/App.entitlements
    - leanshot/src/lib/auth.ts
    - leanshot/src/lib/auth.test.ts
decisions:
  - "Used inline vi.mock hoisting (not vitest-mobile.config.ts alias) so tests run under vite.config.ts as planned; avoids a second config file for one module"
  - "identityToken guard checks falsy (empty string) not undefined — the TS type says string (non-optional) but a web shim may return ''; defensive guard is safer"
  - "Skipped 'npx cap sync ios' — iOS Xcode capability toggle is a Phase 70 on-device/vendor step; entitlement file edit is sufficient for this plan"
metrics:
  duration_minutes: 15
  completed_date: "2026-05-25"
  tasks_completed: 3
  files_changed: 8
---

# Phase 59 Plan 02: Native iOS Sign-in-with-Apple Bridge Summary

JWT auth via Apple identityToken exchanged through `supabase.auth.signInWithIdToken({ provider:'apple', token })` behind `isAppleEnabled() && detectPlatform()==='ios'` gate; web PKCE path untouched; `com.apple.developer.applesignin` entitlement added.

## Tasks Completed

| Task | Description | Commit | Result |
|------|-------------|--------|--------|
| 1 | Re-verify @capacitor-community/apple-sign-in legitimacy + install + entitlement | be5f4792 | Package verified (no postinstall); 3 pkgs added; entitlement added (plutil OK) |
| 2 | signInWithAppleNative() bridge + mock + 4 TDD tests | 3d4eaf91 | RED then GREEN; 4/4 pass; tsc clean |
| 3 | Platform-aware Apple entry point in auth.ts | 731f3e44 | RED then GREEN; 22/22 pass; tsc clean |

## What Was Built

### Package Legitimacy Re-verification (Task 1)

Re-confirmed `@capacitor-community/apple-sign-in@7.1.0` via `registry.npmjs.org` JSON API:
- latest: 7.1.0, repo: github.com/capacitor-community/apple-sign-in (official Capacitor Community org)
- No install/postinstall/preinstall scripts (only build-time: prepublishOnly)
- Maintainers: jcesarmobile, maxlynch, mhartington (canonical Ionic team)
- peerDeps: `@capacitor/core >= 7.0.0` — compatible with project's `^8.3.4`
- Disposition: [ASSUMED]→APPROVED. Installed without --legacy-peer-deps (no @sentry/capacitor conflict on this install).

### iOS Entitlement (Task 1)

Added to `apps/ios/App/App/App.entitlements`:
```xml
<key>com.apple.developer.applesignin</key>
<array><string>Default</string></array>
```
Existing `com.apple.developer.associated-domains` and `keychain-access-groups` intact. `plutil -lint` passes.

**Note:** `npx cap sync ios` intentionally skipped. The Xcode capability toggle (signing + capabilities tab in Xcode) and any Swift/plugin registration are Phase 70 on-device vendor steps. The entitlement file edit is sufficient for the native bridge plan.

### signInWithAppleNative() Bridge (Task 2)

`src/lib/native/apple-sign-in.ts` exports `signInWithAppleNative(): Promise<{ error: { message: string } | null }>`:
- `detectPlatform() !== 'ios'` → `{ error: { message: 'native_apple_ios_only' } }` (web/android/capacitor-web short-circuit)
- `SignInWithApple.authorize(...)` with clientId, empty redirectURI, scopes, fresh nonce+state via `crypto.randomUUID()` (T-59-05 replay mitigation)
- Falsy `identityToken` → `{ error: { message: 'apple_no_identity_token' } }`
- Valid token → `supabase.auth.signInWithIdToken({ provider: 'apple', token })` — GoTrue verifies JWT signature + exp server-side (T-59-04)
- authorize() throws → `{ error: { message: err.message || 'apple_native_failed' } }`
- Does NOT read `result.response.email` (T-59-06 / AUTH-09)

Mock `__mocks__/capacitor-community-apple-sign-in.ts` follows the capgo-native-biometric convention. Tests use inline `vi.mock` hoisting (not vitest-mobile.config.ts alias) to run under `vite.config.ts`.

### Platform-aware Apple Entry Point (Task 3)

`signInWithOAuthProvider('apple')` in `src/lib/auth.ts` now:
1. **Gate 1** (unchanged): `!isAppleEnabled()` → `apple_disabled` short-circuit BEFORE any platform check
2. **Gate 2** (new, Phase 59-02): `detectPlatform() === 'ios'` → `return signInWithAppleNative()`
3. **Fallthrough**: google + non-iOS apple → `supabase.auth.signInWithOAuth` web PKCE (unchanged)

Four new test cases cover all platform-fork branches. 22/22 total auth.test.ts tests pass.

## Private-Relay Zero-Code Finding (AUTH-09)

**Verified:** `handle_new_user()` trigger (migration `20261101000001_profiles_is_staff.sql`) contains:
```sql
insert into public.profiles (id) values (new.id) on conflict do nothing;
```
The `profiles` table has columns `(id, is_staff, created_at)` — **no email column**. Apple's private-relay email (`xyz@privaterelay.appleid.com`) lands in `auth.users.email` only. No profile-side code reads or stores it. AUTH-09 requires zero code changes. This plan adds nothing email-dependent.

## Cap Sync Deferral (Phase 70)

`npx cap sync ios` was intentionally NOT run. The Capacitor iOS sync (registering the plugin with Capacitor's plugin registry in the Xcode project) and Xcode signing + capabilities tab toggle are required for live on-device testing but are out of scope for this plan. Phase 70 owns on-device verification.

## Deviations from Plan

None — plan executed exactly as written. The one implementation detail worth noting: the TypeScript type for `identityToken` in `SignInWithAppleResponse` is `string` (not `string | undefined`), so the plan's `result.response?.identityToken` optional chain is technically not needed by TS. Kept a falsy check (`!identityToken`) as a runtime guard against web-platform shims returning empty strings.

## Known Stubs

None — all paths are wired. The native dialog (`SignInWithApple.authorize`) calls the real plugin on iOS; `signInWithIdToken` calls the real Supabase client. The flag gate (`isAppleEnabled() === false` by default) prevents accidental activation until Phase 70 sets `VITE_AUTH_APPLE_ENABLED=true`.

## Threat Flags

No new threat surface beyond what the plan's `<threat_model>` already enumerates. All mitigations implemented:
- T-59-04: identityToken passed to `signInWithIdToken` (server-side JWT verification)
- T-59-05: fresh `nonce: crypto.randomUUID()` per authorize() call
- T-59-06: no email read/store
- T-59-07: both `isAppleEnabled()` + `detectPlatform()==='ios'` must hold
- T-59-SC: package re-verified at execute-time before install

## Self-Check: PASSED

| Item | Status |
|------|--------|
| src/lib/native/apple-sign-in.ts | FOUND |
| src/lib/native/apple-sign-in.test.ts | FOUND |
| src/lib/native/__mocks__/capacitor-community-apple-sign-in.ts | FOUND |
| apps/ios/App/App/App.entitlements (com.apple.developer.applesignin) | FOUND |
| package.json (@capacitor-community/apple-sign-in) | FOUND |
| commit be5f4792 (Task 1) | FOUND |
| commit 3d4eaf91 (Task 2) | FOUND |
| commit 731f3e44 (Task 3) | FOUND |
