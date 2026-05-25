# Phase 59: Apple OAuth (Sign-in-with-Apple) + Onboarding Completion - Context

**Gathered:** 2026-05-26
**Status:** Ready for planning
**Mode:** Smart discuss (autonomous) — constrained scope (App-Store-mandated + established vendor-defer contract); no genuine grey area requiring user input

<domain>
## Phase Boundary

Two bundled deliverables:
1. **Sign-in-with-Apple** (App Store requirement when any third-party login exists). Phase 34 already built a flag-gated prod path: `isAppleEnabled()` gate in `src/lib/auth.ts` (Phase 34-04, ONBOARD-02), an `AuthCallbackView.tsx` OAuth callback handler, and a planned goal-step OAuth button row (34-06). The flag is OFF pending Apple Services ID + `.p8` + Supabase `auth.apple` secrets. Phase 59 finishes the WIRING: surface the "Sign in with Apple" button on login + signup + onboarding surfaces, wire the `supabase.auth.signInWithOAuth({ provider: 'apple' })` call-site, handle Apple private-relay email → profile creation + activation, and anonymous-to-authenticated merge.
2. **Onboarding completion** — finish v1.3 Phase 34's 5 partial ONBOARD requirements: activation-walkthrough fixtures, admin step builder, Mobile Lighthouse re-verify, anonymous→authenticated merge, PostHog Experiments traffic-split + ship-winner wiring.

**Net deliverable now:** code-complete Apple OAuth (button + call-site + private-relay + merge, behind `isAppleEnabled()` so it's safe with the flag off) + onboarding-completion code/fixtures + PostHog Experiments wiring code. LIVE verification that needs vendor provisioning / devices DEFERS to Phase 70.
</domain>

<decisions>
## Implementation Decisions

### Apple OAuth
- Reuse the existing Phase 34 `isAppleEnabled()` gate + `AuthCallbackView` — do NOT rebuild. Surface the "Sign in with Apple" button on login, signup, AND onboarding goal-step (per success criterion 2), behind the gate so it renders only when enabled (or in a dev-override). Native Apple branding compliance (≥44px tap target, official wordmark/logo, correct color).
- Use `supabase.auth.signInWithOAuth({ provider: 'apple' })` (web) + the Capacitor native Sign-in-with-Apple path for the mobile shell where applicable; the existing callback handler completes the session.
- Apple private-relay email (`@privaterelay.appleid.com`) MUST create a profile + reach the activation event WITHOUT requiring an explicit email entry. Anonymous-to-authenticated merge: an anon local session that signs in with Apple merges its local data into the authenticated profile (reuse any existing merge helper).

### Onboarding completion (ONBOARD-05/06/07/10/11)
- Finish the 5 partial Phase-34 ONBOARD reqs: activation-walkthrough fixtures, admin step builder, anonymous→authenticated merge, Mobile Lighthouse re-verify, PostHog Experiments traffic split + ship-winner wiring. Reuse existing onboarding components (`OnboardingFlow`, `ConsumerOnboardingRenderer`, `FirstActionSurface`, admin step-builder).

### Defer to Phase 70 (vendor/device — established v1.4 contract)
- Live Apple OAuth provider config in the Supabase Auth dashboard + redirect-URL whitelisting + flag flip ON (needs Apple Services ID + `.p8` + Supabase secrets — VENDOR-pending).
- Live private-relay signup E2E on a real Apple ID; native Apple button on a physical iOS device.
- Mobile Lighthouse ≥90 measured on device/CI; PostHog Experiments LIVE traffic-split + ship-winner re-verify (needs VENDOR-09 Personal API key).

### Claude's Discretion
- Exact button component/placement styling within branding rules; private-relay profile field handling; merge-helper reuse vs extension; fixture shapes; PostHog experiment key naming.
</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/lib/auth.ts` — `isAppleEnabled()` gate (Phase 34-04), `signInWithMagicLink`, password auth; the Apple OAuth prod path is built but flag-gated.
- `src/components/auth/AuthCallbackView.tsx` — OAuth callback/session completion.
- `src/components/onboarding/*` — OnboardingFlow, ConsumerOnboardingRenderer, FirstActionSurface, admin step builder (ConsumerOnboardingRenderer drives DEFAULT_STEPS).
- PostHog Experiments: existing A/B infra from v1.1/v1.2 (reuse OnboardingABPanel patterns per memory:planner_prompt_explicit_reuse_targets).

### Established Patterns
- Feature-gate via `isAppleEnabled()` (env flag + localStorage override). Anonymous Zustand session (`leanshot_v4`) → authenticated merge.
- i18n: login/signup/onboarding strings are now keyed (Phase 58) — any NEW button label must be keyed too (en+es) to keep `check-locale-coverage.sh` green.

### Integration Points
- Login/signup surfaces + onboarding goal-step (button); AuthCallbackView (callback); profile creation (private-relay); anon-merge on sign-in.
</code_context>

<specifics>
## Specific Ideas
- The "Sign in with Apple" button label + any new auth strings MUST be added to the i18n catalogs (en+es) since Phase 58 keyed these surfaces — do not introduce inline English.
- Keep the flag OFF by default (safe); the prod flip is a Phase 70 vendor step.
- PostHog Experiments wiring should be code-complete + testable with mocks; live ship-winner verification defers to P70 (VENDOR-09 key).

</specifics>

<deferred>
## Deferred Ideas
- Live Apple provider config + flag-flip + on-device sign-in + private-relay live E2E → Phase 70.
- Mobile Lighthouse ≥90 on-device measurement + PostHog live ship-winner → Phase 70.
- Google / other OAuth providers → out of scope (Apple-only this phase).
</deferred>
