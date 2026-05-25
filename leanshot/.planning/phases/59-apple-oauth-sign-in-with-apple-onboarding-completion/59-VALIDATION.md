---
phase: 59
slug: apple-oauth-sign-in-with-apple-onboarding-completion
status: ready
nyquist_compliant: true
wave_0_complete: true
created: 2026-05-26
---

# Phase 59 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest (unit/component) + existing auth.test.ts; Lighthouse CI (`npm run lighthouse:onboard`) |
| **Config file** | `leanshot/vite.config.ts` (use `npx vitest run --config vite.config.ts <path>`) |
| **Quick run** | `npx vitest run --config vite.config.ts src/lib/auth.test.ts src/components/auth/ src/components/onboarding/ConsumerOnboardingRenderer.test.tsx src/lib/native/apple-sign-in.test.ts src/lib/onboarding/anon-merge.test.ts` |
| **TS typecheck** | `npx tsc -p tsconfig.app.json --noEmit` |
| **i18n gate** | `bash scripts/check-locale-coverage.sh` (new auth button labels must keep en↔es parity) |
| **Estimated runtime** | ~45s |

---

## Sampling Rate

- **After every task commit:** tsc on changed area + relevant vitest + locale gate (if catalogs touched)
- **After every plan wave:** full vitest + locale gate + tsc
- **Before verify:** auth + onboarding + native tests green; locale parity green; lighthouse script `node --check` OK
- **Max feedback latency:** ~45s

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 59-01-T1 | 01 | 1 | AUTH-08 | T-59-01 | HIG wordmark key at en↔es parity (no missing-key drift) | locale-gate | `bash scripts/check-locale-coverage.sh` | en/es onboarding.json ✅ | ⬜ pending |
| 59-01-T2 | 01 | 1 | AUTH-07, AUTH-08 | T-59-01/02/03 | Apple button gated behind isAppleEnabled(); type=button never submits creds; promote/anon modes excluded | unit+tsc | `npx vitest run --config vite.config.ts src/components/auth/ && npx tsc -p tsconfig.app.json --noEmit` | SignInForm/SignUpForm ✅ | ⬜ pending |
| 59-01-T3 | 01 | 1 | AUTH-08 | T-59-03 | gate visibility proven both states; click invokes web OAuth path | unit | `npx vitest run --config vite.config.ts src/components/auth/__tests__/SignInForm.test.tsx src/components/auth/__tests__/SignUpForm.test.tsx` | SignInForm.test.tsx NEW | ⬜ pending |
| 59-02-T1 | 02 | 2 | AUTH-07 | T-59-SC | package legitimacy human-verified before install ([ASSUMED]→approved) | human-gate | npmjs.com verification (blocking-human) | n/a | ⬜ pending |
| 59-02-T2 | 02 | 2 | AUTH-07 | T-59-SC | entitlement added without clobbering existing capabilities | grep+plutil | `grep -q com.apple.developer.applesignin ../apps/ios/App/App/App.entitlements` | package.json + App.entitlements | ⬜ pending |
| 59-02-T3 | 02 | 2 | AUTH-07, AUTH-09 | T-59-04/05/06 | identityToken exchanged via signInWithIdToken (server-verified); no email assumption; non-iOS short-circuit | unit+tsc | `npx vitest run --config vite.config.ts src/lib/native/apple-sign-in.test.ts && npx tsc -p tsconfig.app.json --noEmit` | apple-sign-in.ts NEW | ⬜ pending |
| 59-02-T4 | 02 | 2 | AUTH-07 | T-59-07 | native path reachable only when isAppleEnabled() && ios; web path unchanged | unit+tsc | `npx vitest run --config vite.config.ts src/lib/auth.test.ts && npx tsc -p tsconfig.app.json --noEmit` | auth.ts | ⬜ pending |
| 59-03-T1 | 03 | 3 | AUTH-11 | T-59-10 | getFeatureFlag genuinely read; undefined/throw → safe control fallback | unit+tsc | `npx vitest run --config vite.config.ts src/components/onboarding/ConsumerOnboardingRenderer.test.tsx && npx tsc -p tsconfig.app.json --noEmit` | ConsumerOnboardingRenderer.tsx | ⬜ pending |
| 59-03-T2 | 03 | 3 | AUTH-10 | T-59-08 | merge helper scoped to caller's session token only (no user-id param) | unit+tsc | `npx vitest run --config vite.config.ts src/lib/onboarding/anon-merge.test.ts` | anon-merge.ts NEW | ⬜ pending |
| 59-03-T3 | 03 | 3 | AUTH-10 | T-59-09 | merge fires on OAuth callback; best-effort (failure never blocks redirect) | unit+node-check | `npx vitest run --config vite.config.ts src/components/auth/AuthCallbackView.test.tsx && node --check scripts/lighthouse-onboarding.mjs` | AuthCallbackView.tsx | ⬜ pending |

---

## Wave 0 Requirements

- [x] vitest + auth.test.ts + ConsumerOnboardingRenderer.test.tsx + SignUpForm.test.tsx already exist — existing infra covers most unit/component surface
- [x] New test files created within their owning tasks (TDD-first): SignInForm.test.tsx (59-01-T3), apple-sign-in.test.ts (59-02-T3), anon-merge.test.ts (59-03-T2)
- [x] `@capacitor-community/apple-sign-in` install gated behind a blocking-human legitimacy checkpoint (59-02-T1); native path flag+platform-gated (isAppleEnabled + detectPlatform==='ios')

---

## Manual-Only Verifications (DEFERRED to Phase 70 — vendor/device, established v1.4 contract)

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Live Apple OAuth provider config + flag-flip ON + on-device sign-in | AUTH-07/08/09 | Needs Apple Services ID + .p8 + Supabase secrets (vendor-pending) + physical iOS device | Defer to Phase 70 |
| Apple private-relay live signup E2E | AUTH-09 | Needs real Apple ID | Defer to Phase 70 (code path verified to require no profile change) |
| Mobile Lighthouse ≥90 on-device | ONBOARD-10 | Needs device/CI measurement | Defer to Phase 70 (script confirmed runnable via `node --check` this phase) |
| PostHog Experiments LIVE traffic-split + ship-winner | AUTH-11/ONBOARD | Needs VENDOR-09 Personal API key | Defer to Phase 70 (variant reading wired + mock-tested now) |
| Superadmin admin-walkthrough fixture seeding (34-08 HITL) | AUTH-10/ONBOARD-06/07 | Needs superadmin role row in live/staging | Defer to Phase 70 |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies (T1 of 59-02 is the only human gate — package legitimacy, paired with automated grep verify in T2)
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] No watch-mode flags
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** ready
