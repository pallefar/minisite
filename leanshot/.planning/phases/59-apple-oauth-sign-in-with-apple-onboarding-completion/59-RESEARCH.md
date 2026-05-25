# Phase 59: Apple OAuth + Onboarding Completion — Research

**Researched:** 2026-05-26
**Domain:** OAuth / Identity (Apple Sign-In, Supabase Auth), Capacitor native bridges, PostHog Experiments, onboarding activation, i18n
**Confidence:** HIGH (core web path, existing codebase); MEDIUM (native Capacitor Apple Sign-In — no existing entitlement or plugin in the repo)

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- Reuse Phase 34 `isAppleEnabled()` gate + `AuthCallbackView` — do NOT rebuild. Surface the "Sign in with Apple" button on login, signup, AND onboarding goal-step, behind the gate.
- Use `supabase.auth.signInWithOAuth({ provider: 'apple' })` (web) + the Capacitor native Sign-in-with-Apple path for the mobile shell where applicable; the existing callback handler completes the session.
- Apple private-relay email MUST create a profile + reach the activation event WITHOUT requiring an explicit email entry. Anonymous-to-authenticated merge: reuse any existing merge helper.
- Finish 5 partial Phase-34 ONBOARD reqs: activation-walkthrough fixtures, admin step builder, anonymous-to-authenticated merge, Mobile Lighthouse re-verify, PostHog Experiments traffic split + ship-winner wiring. Reuse existing onboarding components.
- PostHog Experiments wiring should be code-complete + testable with mocks; live ship-winner verification defers to Phase 70 (VENDOR-09 key).

### Claude's Discretion
- Exact button component/placement styling within branding rules; private-relay profile field handling; merge-helper reuse vs extension; fixture shapes; PostHog experiment key naming.

### Deferred Ideas (OUT OF SCOPE)
- Live Apple OAuth provider config + flag-flip + on-device sign-in + private-relay live E2E → Phase 70.
- Mobile Lighthouse ≥90 on-device measurement + PostHog live ship-winner → Phase 70.
- Google / other OAuth providers → out of scope (Apple-only this phase).
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| AUTH-07 | Apple OAuth provider configured in Supabase Auth Dashboard (VENDOR-01 pending) — Phase 59 ships code-complete; live config defers to P70 | `signInWithOAuthProvider('apple')` call-site already present in `ConsumerOnboardingRenderer`; `AuthCallbackView` handles callback |
| AUTH-08 | "Sign in with Apple" button on login + signup + onboarding surfaces; ≥44px tap target; native Apple branding compliance | Button exists in `ConsumerOnboardingRenderer` (onboarding surface); MISSING in `SignInForm` + `SignUpForm`; branding rules documented below |
| AUTH-09 | Apple private-relay email handled correctly; profile created without explicit email | `handle_new_user()` trigger creates profile from `auth.users.id` (no email dependency); private-relay lands as `email` field in Supabase user object but all profile lookups use `id` |
| AUTH-10 | ONBOARD-05/06/07/10/11 finished — activation walkthrough fixtures, admin step builder fixtures, Mobile Lighthouse re-verify | Activation event fully wired (record-activation Fn + fireActivation hooks). Gaps: admin fixture seeding (superadmin row); Lighthouse run blocked on vendor config. Admin step builder `OnboardingBuilderModule` already ships; needs fixture data to run HITL walkthrough |
| AUTH-11 | PostHog Experiments wiring for onboarding A/B re-verified with PostHog Personal API key (VENDOR-09) | `OnboardingABPanel` + `ship-winner-flag` Fn already wired; vendor_unconfigured degradation path already exists; Phase 59 task: add mock-testable experiment variant reading in `ConsumerOnboardingRenderer` |
</phase_requirements>

---

## Summary

Phase 59 is predominantly a code-completion and fixture phase — not a greenfield build. The heavy lifting was done in Phase 34: `isAppleEnabled()` gate exists in `src/lib/auth.ts`, `signInWithOAuthProvider('apple')` is fully implemented, `AuthCallbackView` handles the PKCE callback, and `ConsumerOnboardingRenderer` already has a gated Apple button on the onboarding auth step. The `merge-anon-session` Edge Function handles anon-to-authenticated merge with race safety. The `record-activation` Edge Function fires the activation event server-side.

**What is genuinely missing and needs to be built in Phase 59:**

1. The "Sign in with Apple" button on `SignInForm` and `SignUpForm` (only `ConsumerOnboardingRenderer` has it now). These two auth surfaces have no `useTranslation` wiring at all — adding the Apple button must also add i18n wiring for the new button label (the `onboarding:consumer.auth.continue_apple` key already exists in both en/es catalogs and can be reused).

2. A native Capacitor Apple Sign-In bridge for the iOS shell (`apps/ios`). The `@capacitor-community/apple-sign-in` plugin (v7.1.0, exists since 2020, 20 versions, github.com/capacitor-community/apple-sign-in) is the standard solution. The iOS entitlements file (`App.entitlements`) does NOT yet include `com.apple.developer.applesignin` capability. The native flow calls `SignInWithApple.authorize()` → extracts `identityToken` → calls `supabase.auth.signInWithIdToken({ provider: 'apple', token: identityToken })` (no OAuth redirect needed). This must be gated behind `detectPlatform() === 'ios'` inside the same `isAppleEnabled()` guard.

3. Admin fixture seeding: a superadmin `auth.users` + `profiles.admin_role='superadmin'` row in the local dev/staging environment so the admin onboarding-builder HITL walkthrough (34-08 carry-over) can be completed. This is data-only; no schema changes.

4. The PostHog experiment variant reading in `ConsumerOnboardingRenderer` needs to be explicitly wired so the A/B variant is read on mount and controls which onboarding step sequence is used. Currently the `steps` variable always returns `DEFAULT_STEPS` regardless of PostHog flag state (lines 136-139 of `ConsumerOnboardingRenderer.tsx` return `DEFAULT_STEPS` in both branches of the conditional).

5. Mobile Lighthouse measurement: `npm run lighthouse:onboard` script already exists; the plan needs a task that runs it and asserts ≥90 (deferred run to post-vendor-config in P70, but the test infrastructure must be verified as runnable).

**Primary recommendation:** Ship the Apple button on SignInForm + SignUpForm first (highest user-visible impact, no new deps). Then the native Capacitor bridge (adds `@capacitor-community/apple-sign-in`, entitlement, Swift plugin bridge). Then the PostHog experiment variant wiring in `ConsumerOnboardingRenderer`. Finally, admin fixture seeding to unblock the 34-08 HITL carry-over.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Apple OAuth (web) | API / Backend (Supabase Auth + PKCE) | Browser / Client (button, redirect) | OAuth flows must complete server-side; client initiates but does not hold credentials |
| Apple Sign-In (native iOS) | Native shell (Capacitor plugin) | API / Backend (signInWithIdToken) | Native credential mint happens in iOS framework; Supabase exchanges the identity token |
| Private-relay email handling | Database / Storage (trigger + profiles table) | — | `handle_new_user()` trigger creates profile from `id` only — email field is nullable in profiles |
| Anon-to-auth merge | API / Backend (merge-anon-session Edge Fn) | Browser / Client (ConsumerOnboardingRenderer useEffect) | Race-safe merge requires server-side advisory lock |
| PostHog experiment variant | Browser / Client (posthog-js getFeatureFlag) | API / Backend (ship-winner-flag Fn) | Variant reading is client-side; winner promotion is server-gated admin action |
| Activation event | API / Backend (record-activation Edge Fn) | Browser / Client (fireActivation hook) | Server-only event per D-05; client fires the Edge Fn, never emits directly |
| i18n button labels | Browser / Client (react-i18next + locale JSON) | — | Static strings in public/locales; check-locale-coverage.sh enforces coverage |

---

## Standard Stack

### Core (all already installed)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@supabase/supabase-js` | 2.106.2 [VERIFIED: npm registry] | `signInWithOAuth` + `signInWithIdToken` + `exchangeCodeForSession` | Project canonical auth client |
| `posthog-js` | 1.376.0 [VERIFIED: npm registry] | `posthog.getFeatureFlag(key)` for experiment variant reading | Already initialized in `src/lib/analytics.ts` |
| `@capacitor/core` | 8.3.4 [VERIFIED: npm registry] | `detectPlatform()` guard for native code paths | Platform detection bridge in `src/lib/native/platform.ts` |

### New Dependency Required
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `@capacitor-community/apple-sign-in` | 7.1.0 [VERIFIED: npm registry] | Native Sign-In with Apple on iOS (`SignInWithApple.authorize()`) | Installed only for native iOS path; web uses `supabase.auth.signInWithOAuth` |

**Installation:**
```bash
npm install @capacitor-community/apple-sign-in
npx cap sync ios
```

After sync, the plugin auto-registers its Swift plugin via Capacitor's plugin discovery. The entitlement must be manually added to `apps/ios/App/App/App.entitlements`.

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `@capacitor-community/apple-sign-in` | Supabase web OAuth in a Capacitor webview | Web OAuth in a webview does not meet Apple HIG requirement for native apps; Apple may reject apps that use webview for Sign in with Apple on iOS. Native plugin is the correct approach. |
| `supabase.auth.signInWithIdToken` | Custom JWT verification | Supabase handles the Apple JWT verification against Apple's public keys; do not hand-roll |

---

## Package Legitimacy Audit

| Package | Registry | Age | Versions | Source Repo | slopcheck | Disposition |
|---------|----------|-----|----------|-------------|-----------|-------------|
| `@capacitor-community/apple-sign-in` | npm | 5.9 yrs (2020-06-16) | 20 | github.com/capacitor-community/apple-sign-in | slopcheck unavailable — [ASSUMED] | Approved (verified on npm, official Capacitor Community org, no postinstall scripts, 5.9 yr history) |
| `posthog-js` | npm | Already installed | — | github.com/PostHog/posthog-js | slopcheck unavailable — [ASSUMED] | Approved (official PostHog SDK, already in production) |
| `@supabase/supabase-js` | npm | Already installed | — | github.com/supabase/supabase-js | slopcheck unavailable — [ASSUMED] | Approved (official Supabase SDK, already in production) |

**Packages removed due to slopcheck [SLOP] verdict:** none

**Packages flagged as suspicious [SUS]:** none

*slopcheck was unavailable at research time. `@capacitor-community/apple-sign-in` is cross-verified: exists on npm with 5.9-year history, 20 versions, official Capacitor Community GitHub organization, no postinstall scripts. Safe to approve.*

---

## Architecture Patterns

### System Architecture Diagram

```
iOS Shell (Capacitor)              Web Browser
       |                                |
SignInWithApple.authorize()     supabase.auth.signInWithOAuth
  (native Apple dialog)            { provider: 'apple' }
       |                                |
identityToken (JWT from Apple)   redirect → /auth/callback
       |                                |
supabase.auth.signInWithIdToken  AuthCallbackView.exchangeCodeForSession
  { provider:'apple', token }          |
       |                       _________|
       |_______________________|
                    |
            GoTrue mints session
                    |
           handle_new_user() trigger
        → INSERT INTO profiles(id) ON CONFLICT DO NOTHING
                    |
         AuthCallbackView checks profiles.completed_onboarding_at
                    |
           → '#/dashboard' OR '#/onboarding'
                    |
     (if onboarding) ConsumerOnboardingRenderer
        useEffect detects signedInUserId transition
                    |
        merge-anon-session Edge Fn
        (consumes _ls_anon cookie, advisory lock, best-effort profile update)
```

### Recommended Project Structure

No new directories needed. Files modified:
```
src/
├── components/auth/
│   ├── SignInForm.tsx          # ADD Apple OAuth button (gated)
│   └── SignUpForm.tsx          # ADD Apple OAuth button (gated)
├── components/onboarding/
│   └── ConsumerOnboardingRenderer.tsx  # Wire PostHog experiment variant
├── lib/auth.ts                 # ADD signInWithAppleNative() for iOS path
└── lib/native/apple-sign-in.ts # NEW: thin wrapper over @capacitor-community/apple-sign-in

apps/ios/App/App/
└── App.entitlements            # ADD com.apple.developer.applesignin entitlement

public/locales/en/             # ADD auth.* keys IF SignInForm/SignUpForm get their own namespace
public/locales/es/             # SAME
```

### Pattern 1: Web Apple OAuth (existing, call-site extension needed)

The `signInWithOAuthProvider('apple')` function in `src/lib/auth.ts` is fully implemented and feature-gated. The only missing call-sites are `SignInForm` and `SignUpForm`. The pattern from `ConsumerOnboardingRenderer` is the reference:

```tsx
// Source: src/components/onboarding/ConsumerOnboardingRenderer.tsx (lines 170-175)
const onOAuth = async (provider: 'google' | 'apple'): Promise<void> => {
  setSubmitting(true);
  setAuthMessage(null);
  const { error } = await signInWithOAuthProvider(provider);
  setSubmitting(false);
  if (error) setAuthMessage(error.message);
};

// Render (lines 326-335):
{isAppleEnabled() && (
  <Button
    variant="ghost"
    onClick={() => void onOAuth('apple')}
    disabled={submitting}
    className="min-h-[44px] w-full"
  >
    {t('onboarding:consumer.auth.continue_apple')}
  </Button>
)}
```

**Key facts about `SignInForm` and `SignUpForm`:** Neither currently uses `useTranslation`. Both have inline English strings. Adding the Apple button MUST add i18n wiring; use the `onboarding:consumer.auth.continue_apple` key that already exists in both en/es locales rather than creating a new auth namespace (to avoid new keys that need ES translation).

### Pattern 2: Native iOS Apple Sign-In

```tsx
// Source: [ASSUMED] @capacitor-community/apple-sign-in API, verified package exists at 7.1.0
// src/lib/native/apple-sign-in.ts
import { SignInWithApple } from '@capacitor-community/apple-sign-in';
import { supabase } from '@/lib/supabase';
import { detectPlatform } from '@/lib/native/platform';

export async function signInWithAppleNative(): Promise<{ error: { message: string } | null }> {
  if (detectPlatform() !== 'ios') {
    return { error: { message: 'native_apple_ios_only' } };
  }
  try {
    const result = await SignInWithApple.authorize({
      clientId: 'app.leanshot.ios',   // Bundle ID for native apps
      redirectURI: '',                  // Not used for native
      scopes: 'email name',            // Request email + name on first sign-in
      state: crypto.randomUUID(),
      nonce: crypto.randomUUID(),
    });
    const identityToken = result.response?.identityToken;
    if (!identityToken) return { error: { message: 'apple_no_identity_token' } };
    const { error } = await supabase.auth.signInWithIdToken({
      provider: 'apple',
      token: identityToken,
    });
    return { error: error ? { message: error.message } : null };
  } catch (err) {
    return { error: { message: (err as Error).message ?? 'apple_native_failed' } };
  }
}
```

**iOS Entitlement required** (in `apps/ios/App/App/App.entitlements`):
```xml
<key>com.apple.developer.applesignin</key>
<array>
  <string>Default</string>
</array>
```

**Critical:** Apple does NOT provide the user's real email on subsequent sign-ins — only on the FIRST sign-in. The `result.response.email` may be null or a private relay address. The profile creation must handle this (see Pitfall 1).

### Pattern 3: PostHog Experiment Variant Reading

The `ConsumerOnboardingRenderer` currently ignores the PostHog flag value (both branches of `useMemo` return `DEFAULT_STEPS`). Wire it properly:

```tsx
// Source: posthog-js API [ASSUMED — posthog-js 1.376.x, verified installed]
// In ConsumerOnboardingRenderer, replace the steps useMemo:
import posthog from 'posthog-js';

const steps: StepId[] = useMemo(() => {
  // Experiment flag: 'onboarding_flow_variant'
  // Control: DEFAULT_STEPS (existing)
  // Treatment: could reorder goal/auth or add a social-proof step
  try {
    const variant = posthog.getFeatureFlag('onboarding_flow_variant');
    if (variant === 'treatment_a') return ['intro', 'social', 'goal', 'auth', 'ready'];
  } catch {
    // posthog not yet initialized — fall through to default
  }
  return DEFAULT_STEPS;
}, []); // no deps needed — flag value is stable post-init
```

**Note:** `posthog.getFeatureFlag(key)` returns the variant string or `undefined` if the flag doesn't exist/isn't loaded. It is synchronous after `posthog.onFeatureFlags()` resolves. In tests, mock `posthog.getFeatureFlag` to return a specific variant. The actual flag key name is Claude's Discretion — `'onboarding_flow_variant'` is the suggested name.

### Anti-Patterns to Avoid

- **Calling `auth.linkIdentity()` for Apple OAuth on web:** The existing codebase explicitly guards against this (see auth.ts comment on Critical Gotchas #5). Use `signInWithOAuth` (web) or `signInWithIdToken` (native).
- **Hardcoding Apple private-relay email as a profile field:** The profiles table has no `email` column (per `reference_profiles_email_vs_auth_users_email` memory). Never attempt to read `profiles.email`; use `auth.users.email` via a JOIN if needed.
- **Assuming `result.response.email` is populated on re-sign-in (native):** Apple only provides email on first authorization. Store nothing; read from `auth.users.email` if needed.
- **Adding `isAppleEnabled()` check at the button as a boolean JSX condition without a re-render trigger:** The `isAppleEnabled()` function reads `localStorage` which is not reactive. It's called at render time, which is sufficient — do not wrap in `useState`/`useEffect` unless the gate needs to respond to live localStorage changes (it doesn't; the flag is set at deploy time).
- **Emitting `activation_completed` from the client:** The event is `server_only` (D-05). Only `record-activation` Edge Fn emits it. `fireActivation()` in `src/lib/onboarding/activation-hooks.ts` calls the Edge Fn — do not bypass.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Apple identity token verification | Custom JWT verification against Apple public keys | `supabase.auth.signInWithIdToken({ provider: 'apple', token })` | Apple key rotation, nonce verification, expiry — all handled by GoTrue |
| Native Apple Sign-In dialog | WKWebView presenting Apple auth page | `@capacitor-community/apple-sign-in` `SignInWithApple.authorize()` | Apple HIG requires native `ASAuthorizationAppleIDProvider` on iOS |
| Anon-to-auth merge | Client-side localStorage copying | `merge-anon-session` Edge Fn (already ships) | Race-safety requires `pg_advisory_xact_lock`; two-device scenario handled |
| Activation event deduplication | Client-side `localStorage` flag | `record-activation` Edge Fn (already ships) | The Fn uses a DB advisory lock + `activated_at IS NULL` guard — client can't replicate this safely |
| PostHog flag/experiment management | Custom A/B split table | PostHog Experiments + `ship-winner-flag` Edge Fn (already ships) | Statistical significance, variant traffic splitting, and winner promotion are all in PostHog |

**Key insight:** Phase 34 shipped all the backend machinery. Phase 59's value is wiring existing machinery to the two missing call-sites (SignInForm, SignUpForm) and completing fixture + variant-reading gaps.

---

## Focus Question Answers

### Q1: Capacitor native Sign-in-with-Apple approach

**Answer:** `@capacitor-community/apple-sign-in` is the correct approach. The web OAuth path (`supabase.auth.signInWithOAuth`) does NOT satisfy Apple's App Store requirement for native iOS apps — Apple mandates `ASAuthorizationAppleIDProvider` (the native dialog), not a webview. The plugin is NOT yet a dependency in `package.json` (only `@capacitor-community/admob` is installed). It must be added. The native path is gated behind `detectPlatform() === 'ios'` inside the `isAppleEnabled()` guard. The bridge calls `supabase.auth.signInWithIdToken({ provider: 'apple', token: identityToken })` — Supabase v2 supports this natively. [VERIFIED: npm registry — package exists at 7.1.0, 5.9 yr history, no postinstall scripts]

**iOS entitlement gap:** `App.entitlements` currently has `associated-domains` and `keychain-access-groups` but NOT `com.apple.developer.applesignin`. This entitlement must be added or Xcode will reject the build.

### Q2: Web Sign-in-with-Apple — existing path is complete

**Answer:** `supabase.auth.signInWithOAuth({ provider: 'apple' })` is already wired in `signInWithOAuthProvider()` in `src/lib/auth.ts`. `AuthCallbackView` handles the PKCE callback via `exchangeCodeForSession(window.location.href)` and routes to `#/dashboard` or `#/onboarding`. This is fully functional pending the Supabase Apple provider config (Phase 70 vendor step).

**Apple HIG button requirements (AUTH-08):** [ASSUMED — from Apple HIG documentation knowledge, not verified via live URL in this session]
- Minimum tap target: ≥44pt (already enforced by `min-h-[44px]` on all auth buttons in this codebase)
- Apple logo: must use the official Sign in with Apple button logo (the black Apple logo). Options: (a) use CSS + SVG Apple logo from Apple's Sign in with Apple button assets, (b) use the SF Symbol `apple.logo` via a native bridge on iOS. For web, Apple provides a JavaScript library (`appleid.cdn-apple.com/appleauth/static/jsapi/appleid/1/en_US/appleid.auth.js`) but Supabase OAuth makes it unnecessary — the Supabase-provided button styling is sufficient if it meets size requirements.
- Color variants: black button on white/light backgrounds; white button with black border on dark backgrounds. LeanShot's design system uses CSS tokens, so the button should adapt to `data-theme` via `var(--color-surface)` / `var(--color-text)`.
- The wordmark must read "Sign in with Apple" (exact Apple-specified string) — the existing locale key `"continue_apple": "Continue with Apple"` does NOT match Apple's required wordmark. This is a potential HIG violation. The exact required text is "Sign in with Apple" not "Continue with Apple". [ASSUMED — Apple HIG requirement; recommend planner flags this for decision]

### Q3: Apple private-relay email handling

**Answer:** The `handle_new_user()` trigger (in `supabase/migrations/20261101000001_profiles_is_staff.sql`) creates the profile row on `auth.users INSERT` with only `id` — no email dependency whatsoever: `INSERT INTO public.profiles (id) VALUES (new.id) ON CONFLICT DO NOTHING`. The profile is thus created correctly for any auth method including private-relay. [VERIFIED: codebase grep — migration confirmed]

When Apple provides a private-relay email (`username@privaterelay.appleid.com`), Supabase stores it in `auth.users.email`. The `profiles` table has no `email` column (per `reference_profiles_email_vs_auth_users_email` — `profiles` only has `id`, `is_staff`, `created_at`, `completed_onboarding_at`, `primary_goal`, `locale`, `timezone`, `admin_role`, etc.). No code change is needed for profile creation to work with private-relay emails.

**Activation event:** `record-activation` requires only a valid JWT (user must be authenticated). It reads `profiles.created_at` to compute `days_since_signup` and uses `profiles.id` as the key. No email is consulted. Private-relay users activate identically to regular users. [VERIFIED: codebase — `supabase/functions/record-activation/index.ts` confirmed]

**RLS implications:** All RLS policies use `auth.uid()` not email. No migration needed for private-relay support.

### Q4: Anonymous-to-authenticated merge

**Answer:** The merge helper is fully built. `ConsumerOnboardingRenderer` already fires it (lines 182-233): when `signedInUserId` transitions from `null` to a UUID, it reads the `_ls_anon` cookie, calls `merge-anon-session` Edge Fn with `{ cookie_ids: [cookie], anon_distinct_id: posthog.get_distinct_id() }`, and calls `clearAnonCookie()` in the `finally` block. [VERIFIED: codebase — ConsumerOnboardingRenderer.tsx lines 180-233]

The merge also works for Apple OAuth: `AuthCallbackView` exchanges the code → session → redirects to `#/onboarding` if `completed_onboarding_at IS NULL`. `ConsumerOnboardingRenderer` mounts, detects the signed-in user, fires the merge. No additional wiring needed for Apple specifically.

**Gap:** For users who sign in with Apple directly via `SignInForm` or `SignUpForm` (not via the onboarding surface), the merge `useEffect` in `ConsumerOnboardingRenderer` will not fire because those forms don't render `ConsumerOnboardingRenderer`. If the user had an anon session before signing in from the login page, the merge is missed. This is a pre-existing limitation for Google OAuth too. Resolution options: (a) fire the merge in `AuthCallbackView` after successful session exchange, or (b) document as known limitation. Recommend option (a) — add best-effort merge call in `AuthCallbackView` after the profile check, consistent with D-08.

### Q5: PostHog Experiments wiring

**Existing infrastructure (fully built in Phase 34):**
- `OnboardingABPanel` (admin) — lists PostHog experiments tagged "onboarding", shows rollout %, lets superadmin ship winner
- `ship-winner-flag` Edge Fn — calls PostHog API to set flag to 100% rollout for a variant; requires `POSTHOG_PERSONAL_API_KEY` (VENDOR-09, deferred to P70)
- `onboarding-funnel-query` Edge Fn — fetches experiment list from PostHog; requires same key
- Both Fns return `{ error: 'vendor_unconfigured', service: 'posthog' }` gracefully when the key is unset

**Gap (Phase 59 deliverable):** `ConsumerOnboardingRenderer` reads `DEFAULT_STEPS` unconditionally — the PostHog flag is not actually consulted (the `useMemo` at lines 136-139 returns `DEFAULT_STEPS` in both branches). Phase 59 must wire `posthog.getFeatureFlag('onboarding_flow_variant')` (or whichever key is used) into the `steps` computation.

**Mock-testable pattern:** In Vitest, mock `posthog-js` at the module level:
```tsx
// In test file
vi.mock('posthog-js', () => ({
  default: {
    getFeatureFlag: vi.fn().mockReturnValue('treatment_a'),
    get_distinct_id: vi.fn().mockReturnValue('test-distinct-id'),
  },
}));
```
This is consistent with the existing `ConsumerOnboardingRenderer.test.tsx` which already uses `vi.mock` for `@/lib/supabase`.

**Live ship-winner verification** requires `POSTHOG_PERSONAL_API_KEY` and `POSTHOG_PROJECT_ID` set as Supabase Function Secrets — defer to Phase 70 per CONTEXT.md locked decisions.

### Q6: ONBOARD-05/06/07/10/11 — current state

The v1.3 REQUIREMENTS.md marks all five as `[x] Complete`. The Phase 34 CARRY-OVER.md reveals the actual status: they are code-complete but two HITL validations were deferred.

| Requirement | Code Status | Validation Status |
|-------------|-------------|-------------------|
| ONBOARD-05: Activation event fires after first real action | Complete — `record-activation` Fn + `fireActivation` hooks + `activation_completed` event | Automated-verify-only (fixtures missing for admin walkthrough) |
| ONBOARD-06: Activation event instrumented in TAXO registry + measured per cohort | Complete — `activation_completed` in `src/lib/analytics/events.ts` at line 105; `record-activation` captures via PostHog server-side | PostHog key needed for live verification |
| ONBOARD-07: Admin drag-and-drop step builder | Complete — `OnboardingBuilderModule` ships with `SortableTreePanel` | HITL walkthrough deferred (needs superadmin fixture row) |
| ONBOARD-10: Mobile Lighthouse ≥90 | Script exists (`npm run lighthouse:onboard`) | Run not yet completed — carries from 34-10 Task 4 |
| ONBOARD-11: Anon-to-auth merge race safety | Complete — `merge-anon-session` with advisory lock | Automated tests pass; HITL on two-device race deferred to milestone UAT |

**Phase 59 deliverable for AUTH-10:** (a) Seed a superadmin fixture row so the 34-08 HITL walkthrough can complete. This is a one-time `INSERT INTO auth.users ... + profiles.admin_role='superadmin'` via Supabase CLI. (b) Run `npm run lighthouse:onboard` and assert ≥90. If ≥90: close ONBOARD-10. If <90: document score and defer optimization to Phase 70. (c) These two items are now the ONLY remaining gaps for AUTH-10.

### Q7: i18n — current state and new keys needed

**Existing keys:** `onboarding:consumer.auth.continue_apple` exists in both `public/locales/en/onboarding.json` and `public/locales/es/onboarding.json` (verified via file read — ES: `"Continuar con Apple"`). [VERIFIED: codebase]

**Gap:** `SignInForm` and `SignUpForm` are NOT currently using `useTranslation`. Their strings are inline English. When adding the Apple button, the plan must decide:
- Option A: Add `useTranslation(['onboarding'])` to both forms and reuse `onboarding:consumer.auth.continue_apple`. This avoids new locale keys.
- Option B: Create a new `auth` namespace (`public/locales/en/auth.json` + ES equivalent). This requires new keys and ES translation.

**Recommendation (Claude's Discretion):** Option A. Reuse the existing `onboarding:consumer.auth.continue_apple` key — it reads "Continue with Apple" / "Continuar con Apple". While "Sign in with Apple" is Apple's required wordmark per HIG, "Continue with Apple" has been accepted by Apple in practice for apps that use it as a flow continuation (not the primary app launch). The plan-checker should flag this for human decision. If HIG compliance requires exact wordmark, add `auth:sign_in_with_apple` key to both locales.

**check-locale-coverage.sh enforcement:** The script diffs EN and ES leaf key paths using `jq paths(scalars)`. Any new key added to EN must have an ES translation or CI fails. The plan must either (a) add both EN+ES simultaneously or (b) document that the script will fail until ES is added.

---

## Common Pitfalls

### Pitfall 1: Apple private-relay email causes auth.users uniqueness violations on re-sign-in
**What goes wrong:** If a user signs in with Apple using private relay, then signs in again on a different device, Apple may generate a *different* private-relay email for the second sign-in. Supabase GoTrue will see a new email and may create a duplicate user or throw a uniqueness error.
**Why it happens:** Apple guarantees unique `user` sub (the Apple user ID / `sub` claim), but the private-relay email is app-scoped and can vary across devices.
**How to avoid:** Supabase Auth uses the Apple `sub` claim (not the email) as the primary identity for Apple OAuth users. As long as Supabase is configured with the correct Services ID, the `sub` links correctly. The `profiles.id` is always `auth.users.id` (the GoTrue-assigned UUID), not the Apple sub directly.
**Warning signs:** 400 or 409 errors from GoTrue during the `signInWithOAuth` callback; "User already registered" with a different UUID.

### Pitfall 2: Native Apple Sign-In not providing email on re-sign-in
**What goes wrong:** `result.response.email` is null on all sign-ins after the first. Code that assumes email is always present breaks silently.
**Why it happens:** Apple only delivers the user's email once — on initial authorization. Subsequent `SignInWithApple.authorize()` calls return `email: null`.
**How to avoid:** Never rely on `result.response.email` in the native flow. Read `auth.users.email` from Supabase after session is established if email is needed. For the LeanShot profile, only `id` is required.

### Pitfall 3: Entitlement missing blocks iOS build silently
**What goes wrong:** The Capacitor sync succeeds, the app compiles, but Sign in with Apple fails at runtime with `ASAuthorizationError.domain`.
**Why it happens:** `com.apple.developer.applesignin` entitlement is missing from `App.entitlements`. Apple's provisioning profile must also include the capability.
**How to avoid:** Add the entitlement to `App.entitlements` AND enable the capability in Xcode → Signing & Capabilities → "Sign in with Apple". The CI build (Fastlane + match) must use a provisioning profile that includes this capability (Phase 70 vendor step).
**Warning signs:** `Error Domain=com.apple.AuthenticationServices.AuthorizationError Code=1000` at runtime.

### Pitfall 4: PostHog `getFeatureFlag` returns undefined before flags are loaded
**What goes wrong:** On first render, `posthog.getFeatureFlag('onboarding_flow_variant')` returns `undefined` because flag bootstrapping hasn't completed yet. The default branch (DEFAULT_STEPS) is used for all users, defeating the A/B split.
**Why it happens:** PostHog flags are loaded asynchronously. `posthog.onFeatureFlags(callback)` fires when they're ready.
**How to avoid:** The `ConsumerOnboardingRenderer` is mounted after user interaction (the user navigated to onboarding), so flags should be loaded by then. Additionally, wrap `getFeatureFlag` in a try/catch (already present in Pattern 3 above). For tests, mock the return value. For production, flag `undefined` falls through to `DEFAULT_STEPS` which is the safe default (control group).

### Pitfall 5: SignInForm/SignUpForm use inline English strings — adding the Apple button without i18n wiring fails CI
**What goes wrong:** `eslint-plugin-i18next` (installed in `package.json`) may flag raw English strings in JSX. The `check-locale-coverage.sh` script fails if a new EN key has no ES counterpart.
**Why it happens:** Both forms pre-date the i18n wiring and use inline strings. Adding a new button that uses `t()` requires `useTranslation` which isn't imported.
**How to avoid:** Import `useTranslation` at the top of `SignInForm` and `SignUpForm` when adding the Apple button. Reuse the existing `onboarding:consumer.auth.continue_apple` key to avoid adding new locale entries.

### Pitfall 6: `@capacitor-community/apple-sign-in` v7 API requires Capacitor 6+
**What goes wrong:** Importing the plugin in a Capacitor 5 project causes a runtime bridge mismatch.
**Why it happens:** Plugin v7 was released in October 2025 for Capacitor 7+; v6 of the plugin aligns with Capacitor 6.
**How to avoid:** The project uses `@capacitor/core: ^8.3.4` (Capacitor 8). Plugin v7.1.0 targets Capacitor 7+ per the plugin's semver convention. Verify compatibility at install time. [ASSUMED — versioning convention, not verified against plugin's exact peerDependencies at research time]

### Pitfall 7: `import.meta.main` guard on Deno.serve (pre-existing)
**What goes wrong:** `deno test supabase/functions/record-activation` triggers the HTTP server, causing test abort.
**Why it happens:** Per `reference_deno_test_top_level_serve_trap` memory — project Edge Fns use `Deno.serve()` not guarded by `import.meta.main`.
**How to avoid:** Use `$HOME/.deno/bin/deno test --no-check path/to/__tests__/` per `reference_deno_binary_path`. Do not run `deno test` on the full functions directory.

---

## Code Examples

### Verified: Web OAuth button in ConsumerOnboardingRenderer (existing reference)
```tsx
// Source: src/components/onboarding/ConsumerOnboardingRenderer.tsx lines 326-335
{isAppleEnabled() && (
  <Button
    variant="ghost"
    onClick={() => void onOAuth('apple')}
    disabled={submitting}
    className="min-h-[44px] w-full"
  >
    {t('onboarding:consumer.auth.continue_apple')}
  </Button>
)}
```

### Verified: signInWithOAuthProvider in auth.ts (existing, works for web)
```ts
// Source: src/lib/auth.ts lines 106-119
export async function signInWithOAuthProvider(
  provider: 'google' | 'apple',
): Promise<{ error: { message: string } | null }> {
  if (provider === 'apple' && !isAppleEnabled()) {
    return { error: { message: 'apple_disabled' } };
  }
  const { error } = await supabase.auth.signInWithOAuth({
    provider,
    options: {
      redirectTo: `${window.location.origin}/auth/callback`,
    },
  });
  return { error: error ? { message: error.message } : null };
}
```

### Verified: handle_new_user trigger (profile created from id only)
```sql
-- Source: supabase/migrations/20261101000001_profiles_is_staff.sql
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer
set search_path = public, pg_catalog
as $$
begin
  insert into public.profiles (id) values (new.id) on conflict do nothing;
  return new;
end;
$$;
```
This trigger fires for all auth methods including Apple. `email` is not touched.

### Verified: merge-anon-session call-site in ConsumerOnboardingRenderer (existing)
```tsx
// Source: src/components/onboarding/ConsumerOnboardingRenderer.tsx lines 182-233
const mergeFiredRef = useRef(false);
useEffect(() => {
  if (!signedInUserId) return;
  if (mergeFiredRef.current) return;
  const cookie = readAnonCookie();
  if (!cookie) return;
  mergeFiredRef.current = true;
  void (async () => {
    const access = (await supabase.auth.getSession()).data.session?.access_token;
    let distinctId: string | undefined;
    try { distinctId = posthog.get_distinct_id(); } catch { distinctId = undefined; }
    try {
      const res = await fetch(`${getSupabaseUrl()}/functions/v1/merge-anon-session`, {
        method: 'POST',
        headers: { ... Authorization: access ? `Bearer ${access}` : `Bearer ${getAnonKey()}` },
        body: JSON.stringify({ cookie_ids: [cookie], anon_distinct_id: distinctId }),
      });
      // ...draft replay
    } finally {
      clearAnonCookie();
    }
  })();
}, [signedInUserId]);
```

---

## Runtime State Inventory

> Not a rename/refactor/migration phase. No runtime state changes are required by Phase 59.

However, note the following for execution planning:

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | `profiles` rows for existing users — no change needed; trigger handles all new auth methods | None |
| Live service config | Apple provider in Supabase Auth Dashboard — NOT configured; flag kept OFF | Phase 70 vendor step |
| Live service config | `POSTHOG_PERSONAL_API_KEY` + `POSTHOG_PROJECT_ID` — NOT set as Supabase Function Secrets | Phase 70 vendor step (VENDOR-09) |
| OS-registered state | iOS Capacitor entitlement `com.apple.developer.applesignin` — NOT in `App.entitlements` | Code edit (add XML entry) |
| Build artifacts | `@capacitor-community/apple-sign-in` not yet in `node_modules` | `npm install` + `npx cap sync ios` |

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | npm install, vitest | ✓ | v22.18.0 | — |
| npm | package installs | ✓ | bundled | — |
| Deno | Edge Fn tests | Assumed ✓ | `$HOME/.deno/bin/deno` | — |
| Supabase CLI | db push, functions deploy | ✓ | v2.98.2 | — |
| Playwright | e2e tests | ✓ | ^1.59.1 | — |
| Vitest | unit tests | ✓ | ^4.1.5 | — |
| Lighthouse CLI (`@lhci/cli`) | `npm run lighthouse:onboard` | ✓ | ^0.15.1 | — |
| `@capacitor-community/apple-sign-in` | Native iOS Apple Sign-In | ✗ (not installed) | 7.1.0 available | None — must install |
| Apple Developer Portal | entitlement provisioning | N/A (human-only) | — | Phase 70 |
| Supabase Apple Auth provider | live Apple OAuth | N/A (VENDOR-01 pending) | — | Flag stays OFF; code ships ready |
| PostHog Personal API key | ship-winner-flag | N/A (VENDOR-09 pending) | — | vendor_unconfigured degraded mode |
| Physical iOS device | on-device Apple Sign-In test | N/A | — | Defer to Phase 70 UAT |

**Missing dependencies with no fallback:**
- `@capacitor-community/apple-sign-in` must be installed for native iOS support. No fallback for this specific code path (but the web path works without it, and the gate ensures no production impact).

**Missing dependencies with fallback:**
- Apple Auth provider, PostHog key — both have graceful degradation paths already implemented.

---

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 4.1.5 + jsdom + @testing-library/react |
| Config file | `leanshot/vitest.config.ts` (has `projects:` block — per `reference_vitest_4_projects_config_masks_default` memory, plain `npm test` may collect 0 tests; use `npx vitest run --config vite.config.ts` or `npm run test:unit`) |
| Quick run command | `npx vitest run src/components/auth/ src/components/onboarding/ConsumerOnboardingRenderer.test.tsx` |
| Full suite command | `npm run test:unit` |

**Per `reference_vitest_4_projects_config_masks_default` memory:** `leanshot/vitest.config.ts` has a `projects:` block that masks the default test config. Use `npx vitest run` (not `npm test`) for unit tests to avoid 0-test collection.

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| AUTH-08 | Apple button renders when `isAppleEnabled()=true` in SignInForm | unit | `npx vitest run src/components/auth/__tests__/SignUpForm.test.tsx` | Partial — `SignUpForm.test.tsx` exists; need Apple variant |
| AUTH-08 | Apple button absent when `isAppleEnabled()=false` | unit | same | Same |
| AUTH-08 | Apple button renders in ConsumerOnboardingRenderer when gated | unit | `npx vitest run src/components/onboarding/ConsumerOnboardingRenderer.test.tsx` | ✅ exists, likely has Apple gate tests from P34 |
| AUTH-09 | Profile created for private-relay email (trigger test) | manual/E2E | N/A — requires live Supabase | Manual at Phase 70 |
| AUTH-10 | Activation event fires after first action | unit | `npx vitest run src/lib/onboarding/` | ✅ activation-hooks already tested |
| AUTH-10 | Admin step builder renders Builder tab | unit | `npx vitest run src/components/admin/onboarding-builder/OnboardingBuilderModule.test.tsx` | ✅ exists |
| AUTH-10 | Lighthouse ≥90 on onboarding route | Lighthouse | `npm run lighthouse:onboard` | ✅ script exists |
| AUTH-11 | OnboardingABPanel shows vendor_unconfigured state | unit | `npx vitest run src/components/admin/onboarding-builder/OnboardingABPanel.test.tsx` | ✅ exists |
| AUTH-11 | PostHog experiment variant routes to treatment steps | unit | `npx vitest run src/components/onboarding/ConsumerOnboardingRenderer.test.tsx` | ❌ Wave 0 gap |
| AUTH-11 | PostHog variant defaults to control when flag undefined | unit | same | ❌ Wave 0 gap |

### Wave 0 Gaps
- [ ] `src/components/onboarding/ConsumerOnboardingRenderer.test.tsx` — add test: "renders treatment_a steps when PostHog flag returns 'treatment_a'"
- [ ] `src/components/onboarding/ConsumerOnboardingRenderer.test.tsx` — add test: "falls back to DEFAULT_STEPS when PostHog getFeatureFlag returns undefined"
- [ ] `src/components/auth/SignInForm.test.tsx` — NEW FILE: test Apple button visibility under `isAppleEnabled()` gate (SignInForm has no test file, only SignUpForm does)
- [ ] `src/lib/native/apple-sign-in.test.ts` — NEW FILE: unit test for `signInWithAppleNative()` (non-iOS platform returns `native_apple_ios_only` error)

### Sampling Rate
- **Per task commit:** `npx vitest run src/components/auth/ src/components/onboarding/ConsumerOnboardingRenderer.test.tsx`
- **Per wave merge:** `npm run test:unit && npm run lint && npm run typecheck`
- **Phase gate:** Full suite green + `npm run i18n:check` (locale coverage) before `/gsd:verify-work`

---

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes | Supabase Auth + PKCE (web); `signInWithIdToken` with Apple-verified JWT (native) |
| V3 Session Management | yes | Supabase GoTrue sessions; `scope: 'local'` signOut (existing pattern) |
| V4 Access Control | yes | `isAppleEnabled()` gate prevents unauthorized Apple OAuth invocation; `isAppleEnabled()` returns false by default |
| V5 Input Validation | yes | `identityToken` from Apple plugin passed directly to Supabase — no user-editable input in the auth flow itself |
| V6 Cryptography | no | No custom crypto needed; GoTrue verifies Apple JWT signature against Apple public keys |

### Known Threat Patterns for Apple OAuth Stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Replay of old Apple identity token | Tampering | GoTrue validates `exp` claim and `nonce`; `signInWithIdToken` rejects expired tokens |
| Malformed `identityToken` from native plugin | Tampering | Supabase GoTrue JWT parsing rejects non-Apple-signed JWTs |
| `apple_disabled` error surfaced as auth flow | Information Disclosure | Return value `{ error: { message: 'apple_disabled' } }` — no Supabase call is made; no information about GoTrue config leaks |
| Private-relay email used to enumerate accounts | Spoofing | Profile lookup is by `auth.uid()`, never by email; email not stored in `profiles` |

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `@capacitor-community/apple-sign-in` v7.1.0 is compatible with `@capacitor/core` v8.3.4 | Standard Stack / Pattern 2 | If incompatible, will need v6.x or a different bridge; low risk (Capacitor Community follows semver closely) |
| A2 | Apple HIG requires exact wordmark "Sign in with Apple" (not "Continue with Apple") | Focus Q2 / Pitfall 5 | If Apple accepts "Continue with Apple", the existing locale key needs no change; if they don't, locale keys must be updated |
| A3 | `posthog.getFeatureFlag('onboarding_flow_variant')` returns `undefined` before flags load (not blocking) | Pattern 3 / Pitfall 4 | If PostHog flags block initialization, could show wrong variant on first render |
| A4 | `@capacitor-community/apple-sign-in` `SignInWithApple.authorize()` returns `response.identityToken` (not `response.id_token`) | Pattern 2 | If field name differs, native bridge fails with a null token; verify against plugin's TypeScript types at install time |

---

## Open Questions

1. **Apple HIG wordmark compliance**
   - What we know: Apple's official HIG states the button should read "Sign in with Apple". The existing locale key reads "Continue with Apple" / "Continuar con Apple".
   - What's unclear: Whether Apple App Review enforces the exact wordmark on a non-native web button in a Capacitor webview.
   - Recommendation: Planner should add a task to decide: keep existing key OR add `auth:sign_in_with_apple` + `auth:iniciar_sesion_con_apple` to both locale files. For the native iOS path (native dialog from `@capacitor-community/apple-sign-in`), Apple renders its own button — no wordmark choice needed there.

2. **Merge trigger scope for SignInForm / SignUpForm Apple sign-in**
   - What we know: `ConsumerOnboardingRenderer.useEffect` fires merge when `signedInUserId` transitions. If user hits `SignInForm` (not onboarding) with an anon cookie, merge is missed.
   - What's unclear: Is this an acceptable gap for Phase 59? (The CONTEXT.md mentions merge in the onboarding surface context specifically.)
   - Recommendation: Add a best-effort merge call in `AuthCallbackView` (after session exchange, before routing) using the same `merge-anon-session` pattern. Low-risk, high-value.

3. **Lighthouse run timing**
   - What we know: `npm run lighthouse:onboard` runs against `http://localhost:5173/onboard`. Phase 59 must verify ≥90.
   - What's unclear: Whether the current codebase (post-Phase 58 i18n bundle additions) still achieves ≥90.
   - Recommendation: Run the Lighthouse check early in Phase 59 execution. If it fails, investigate bundle size (i18next HTTP backend lazy-loads locales, which is good for FCP/LCP).

---

## Sources

### Primary (HIGH confidence)
- Codebase: `src/lib/auth.ts` — `isAppleEnabled()`, `signInWithOAuthProvider()` implementation verified
- Codebase: `src/components/auth/AuthCallbackView.tsx` — PKCE callback handler verified
- Codebase: `src/components/onboarding/ConsumerOnboardingRenderer.tsx` — existing Apple button, merge useEffect verified
- Codebase: `supabase/migrations/20261101000001_profiles_is_staff.sql` — `handle_new_user()` trigger creates profile from `id` only, verified
- Codebase: `supabase/functions/record-activation/index.ts` — activation event architecture verified
- Codebase: `supabase/functions/merge-anon-session/index.ts` — merge architecture verified
- Codebase: `public/locales/en/onboarding.json` + `public/locales/es/onboarding.json` — `continue_apple` key verified in both
- npm registry: `@capacitor-community/apple-sign-in@7.1.0` — package verified, no postinstall scripts, 5.9 yr history
- npm registry: `posthog-js@1.376.0`, `@supabase/supabase-js@2.106.2` — versions verified

### Secondary (MEDIUM confidence)
- `leanshot/.planning/milestones/v1.3-phases/34-m2-onboarding-overhaul-activation-event/34-CARRY-OVER.md` — confirmed which Phase 34 items remain deferred
- `leanshot/.planning/phases/59-apple-oauth-sign-in-with-apple-onboarding-completion/59-CONTEXT.md` — scope constraints and locked decisions

### Tertiary (LOW / ASSUMED confidence)
- Apple HIG wordmark requirement ("Sign in with Apple" exact string) — [ASSUMED] from training knowledge; should be verified against Apple's Human Interface Guidelines
- `@capacitor-community/apple-sign-in` TypeScript API shape (`SignInWithApple.authorize()` params + `response.identityToken` field name) — [ASSUMED] from plugin's npm description and category knowledge; verify against plugin's TypeScript definitions at install time

---

## Metadata

**Confidence breakdown:**
- Standard Stack (web path): HIGH — all verified in codebase
- Standard Stack (native path): MEDIUM — package verified on npm, API shape assumed from training
- Architecture: HIGH — fully reconstructed from codebase read
- Pitfalls: HIGH (Apple-specific) / MEDIUM (HIG wordmark, Capacitor version compatibility)
- ONBOARD-05..11 state: HIGH — CARRY-OVER.md + codebase read confirmed exactly what's missing

**Research date:** 2026-05-26
**Valid until:** 2026-06-25 (stable — Supabase Auth and Capacitor APIs change slowly; PostHog JS is minor-patched frequently but API surface is stable)
