---
phase: 59-apple-oauth-sign-in-with-apple-onboarding-completion
plan: "01"
subsystem: auth
tags: [apple-oauth, i18n, sign-in-form, sign-up-form, onboarding, hig]
dependency_graph:
  requires: []
  provides:
    - consumer.auth.sign_in_apple i18n key in en+es onboarding catalogs
    - Gated Apple OAuth button on SignInForm (behind isAppleEnabled() && !isPromote)
    - Gated Apple OAuth button on SignUpForm (behind isAppleEnabled() && !isAnon)
    - useTranslation wiring on SignInForm and SignUpForm
    - HIG wordmark adopted in ConsumerOnboardingRenderer (sign_in_apple replaces continue_apple)
    - Apple gate unit tests for SignInForm (new) and SignUpForm (extended)
  affects:
    - leanshot/public/locales/en/onboarding.json
    - leanshot/public/locales/es/onboarding.json
    - leanshot/src/components/auth/SignInForm.tsx
    - leanshot/src/components/auth/SignUpForm.tsx
    - leanshot/src/components/onboarding/ConsumerOnboardingRenderer.tsx
    - leanshot/src/components/auth/__tests__/SignInForm.test.tsx
    - leanshot/src/components/auth/__tests__/SignUpForm.test.tsx
tech_stack:
  added: []
  patterns:
    - isAppleEnabled() gate at render time (non-reactive, consistent with onboarding surface)
    - onApple() handler mirrors ConsumerOnboardingRenderer.onOAuth pattern
    - useTranslation(['onboarding']) imported from react-i18next
    - Test mocks use mutable let isAppleEnabledFlag pattern from ConsumerOnboardingRenderer.test.tsx
key_files:
  created:
    - leanshot/src/components/auth/__tests__/SignInForm.test.tsx
  modified:
    - leanshot/public/locales/en/onboarding.json
    - leanshot/public/locales/es/onboarding.json
    - leanshot/src/components/auth/SignInForm.tsx
    - leanshot/src/components/auth/SignUpForm.tsx
    - leanshot/src/components/onboarding/ConsumerOnboardingRenderer.tsx
    - leanshot/src/components/auth/__tests__/SignUpForm.test.tsx
decisions:
  - D-01: Used HIG-mandated "Sign in with Apple" (not "Continue with Apple") per plan spec
  - D-02: Apple button gated on !isPromote in SignInForm (credential-completion mode excludes OAuth)
  - D-03: Apple button gated on !isAnon in SignUpForm (anon-promotion mode excludes fresh OAuth)
  - D-04: Did not add new i18n namespace; reused onboarding:consumer.auth.sign_in_apple to keep ES surface zero-drift
  - D-05: test-setup.ts already initializes i18next with real EN locale; no vi.mock('react-i18next') needed in new tests
metrics:
  duration: ~18 minutes
  completed: "2026-05-26"
  tasks_completed: 3
  tasks_total: 3
  files_created: 1
  files_modified: 6
---

# Phase 59 Plan 01: Apple OAuth Sign-In Button on Auth Forms Summary

**One-liner:** HIG-compliant "Sign in with Apple" button wired to PKCE OAuth path on SignInForm + SignUpForm via isAppleEnabled() gate, with matching en+es i18n and unit tests.

## Tasks Completed

| Task | Name | Commit | Key Files |
|------|------|--------|-----------|
| 1 | Add HIG sign_in_apple key to en+es + adopt in onboarding | 46a180db | en/onboarding.json, es/onboarding.json, ConsumerOnboardingRenderer.tsx |
| 2 | Add gated Apple OAuth button + useTranslation to SignInForm + SignUpForm | 6a4d57c2 | SignInForm.tsx, SignUpForm.tsx |
| 3 | Unit tests for Apple-button gate on SignInForm (new) + SignUpForm (extend) | c6b4e716 | __tests__/SignInForm.test.tsx, __tests__/SignUpForm.test.tsx |

## What Was Built

**i18n (Task 1):**
- Added `consumer.auth.sign_in_apple` leaf key to both `public/locales/en/onboarding.json` ("Sign in with Apple") and `public/locales/es/onboarding.json` ("Iniciar sesión con Apple")
- Kept the existing `continue_apple` key untouched (other surfaces may reference it)
- Updated `ConsumerOnboardingRenderer.tsx` Apple button from `continue_apple` → `sign_in_apple` to align the onboarding surface with login/signup
- `check-locale-coverage.sh` passes: 175/175 keys in both locales at full parity

**Auth forms (Task 2):**
- `SignInForm.tsx`: added `useTranslation(['onboarding'])`, `isAppleEnabled` + `signInWithOAuthProvider` imports, `onApple()` handler, gated button (`isAppleEnabled() && !isPromote`)
- `SignUpForm.tsx`: same pattern, gated button on `isAppleEnabled() && !isAnon`
- Both buttons: `type="button"` (never submits email/password form), `min-h-[44px]` tap target, `variant="ghost"`, label from `t('onboarding:consumer.auth.sign_in_apple')`
- `tsc -p tsconfig.app.json --noEmit` clean

**Tests (Task 3):**
- Created `src/components/auth/__tests__/SignInForm.test.tsx` with 4 tests: hidden when disabled, visible when enabled, click calls `signInWithOAuthProvider('apple')`, absent in promote mode
- Extended `src/components/auth/__tests__/SignUpForm.test.tsx` with `isAppleEnabledFlag` toggle + `signInWithOAuthProvider` mock; added 4 parallel Apple gate tests including anon-mode guard
- All 26 tests pass across 4 auth test files (9 pre-existing SignUpForm + 4 new SignInForm + 4 new SignUpForm Apple + 9 other auth tests)

## Verification Results

- `bash scripts/check-locale-coverage.sh` → PASS (all 8 namespaces at parity, onboarding: 175/175)
- `npx tsc -p tsconfig.app.json --noEmit` → PASS (clean, no errors)
- `npx vitest run --config vite.config.ts src/components/auth/` → PASS (26/26 tests, 4 files)

## Decisions Made

| Decision | Choice | Rationale |
|----------|--------|-----------|
| i18n namespace | Reuse `onboarding:consumer.auth` | Avoids new ES translation surface; auth forms only need this one new key |
| Promote-mode guard | `!isPromote` on SignInForm | Credential-completion flow should not divert to fresh OAuth identity |
| Anon-mode guard | `!isAnon` on SignUpForm | Anon-promotion flow attaches email to existing UID; OAuth redirect would create new identity |
| Mock pattern | `let isAppleEnabledFlag` (not vi.spyOn) | Consistent with ConsumerOnboardingRenderer.test.tsx; allows per-test toggle without module reset |
| react-i18next mock | None — use global test-setup.ts | test-setup.ts already initializes i18next with real EN catalogs since Phase 58 |

## Deviations from Plan

None — plan executed exactly as written. The `test-setup.ts` global i18next initialization (added in Phase 58) made the react-i18next mock unnecessary in the new test files, simplifying Task 3 slightly versus the plan's alternative mock suggestion.

## Known Stubs

None. The Apple button renders the full HIG wordmark from the real locale catalog and wires to the real `signInWithOAuthProvider('apple')` PKCE path. The button is gated behind `isAppleEnabled()` which returns false until the provider is configured (Phase 70 scope).

## Threat Flags

No new threat surface introduced. The Apple OAuth redirect remains hardcoded to `${window.location.origin}/auth/callback` inside `signInWithOAuthProvider` (Phase 34 implementation, unchanged). The promote/anon guards (T-59-03) are in place.

## Self-Check: PASSED

- `leanshot/public/locales/en/onboarding.json` — FOUND
- `leanshot/public/locales/es/onboarding.json` — FOUND
- `leanshot/src/components/auth/SignInForm.tsx` — FOUND
- `leanshot/src/components/auth/SignUpForm.tsx` — FOUND
- `leanshot/src/components/auth/__tests__/SignInForm.test.tsx` — FOUND
- `leanshot/src/components/auth/__tests__/SignUpForm.test.tsx` — FOUND
- `leanshot/src/components/onboarding/ConsumerOnboardingRenderer.tsx` — FOUND
- Commit `46a180db` — FOUND (Task 1)
- Commit `6a4d57c2` — FOUND (Task 2)
- Commit `c6b4e716` — FOUND (Task 3)
