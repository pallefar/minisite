---
phase: 13-design-system-v2-rollout
plan: 04
subsystem: auth
tags: ["design-system", "auth", "split-screen", "phase-13", "DS-04"]
requires: ["13-01", "13-02", "13-03"]
provides: ["DS-04", "split-screen-auth-shell"]
affects: ["src/components/auth/*"]
tech-stack:
  added: []
  patterns:
    - "Split-screen marketing-style auth shell — hero LEFT (1.1fr) / form RIGHT (1fr) at ≥ 768 px, single column < 768 px"
    - "Decorative aside contract: aria-hidden=true + hidden md:flex for marketing-only panels that vanish below the breakpoint"
    - "chat1.md landmine 4 lock: outer h-screen overflow-hidden + both panels 100vh + only form panel overflow-y-auto"
    - "Pill v2 segmented PillGroup as the canonical tab-switcher pattern for in-place hash sub-routes"
key-files:
  created:
    - "src/components/auth/AuthHero.tsx"
    - "src/components/auth/AuthFormShell.tsx"
    - "src/components/auth/AuthView.test.tsx"
    - "e2e/auth-split-screen.spec.ts"
  modified:
    - "src/components/auth/AuthView.tsx"
decisions:
  - "Hero-LEFT / form-RIGHT per design bundle, NOT ROADMAP SC #5 text (which has form-LEFT / hero-RIGHT) — 13-CONTEXT.md success_criteria_carry flagged this as a ROADMAP typo; bundle wins."
  - "768 px breakpoint per D-17 (not the design-bundle's 980 px CSS literal) — D-17 wins."
  - "Back-to-LeanShot escape-hatch placed in AuthFormShell (option B), not absolute-positioned over the hero (option A) — keeps the form column self-contained at all viewport sizes."
  - "Sub-form components NOT touched (D-01 + Phase 5 boundary) — this plan is layout-only."
metrics:
  duration: "~25 min"
  completed: "2026-05-13"
---

# Phase 13 Plan 13-04: Split-screen AuthView Summary

**One-liner:** Restyled the existing `'auth'` view to the design-bundle split-screen layout (hero-LEFT, form-RIGHT at ≥ 768 px, stacked < 768 px) in place — zero routing change, zero auth-logic change, Pill v2 segmented switcher consumed for the Sign in / Sign up tabs and `<LoginHero />` consumed for the hero column.

## What Shipped

### `src/components/auth/AuthView.tsx` (mutated, layout-only)
- Outer container is now `<div className="auth-root h-screen overflow-hidden grid grid-cols-1 md:grid-cols-[1.1fr_1fr] bg-[var(--color-bg)] text-[var(--color-text)]">`.
- Mounts `<AuthHero />` + `<AuthFormShell sub={sub} />`.
- `parseSub()`, `useState<AuthSub>`, `useEffect` `hashchange` listener all preserved verbatim from Phase 5.
- Exports `AuthSub` type so `AuthFormShell` can re-import it (single source of truth).
- The legacy `<nav>` + Zap-wordmark `<button>` was moved into `AuthFormShell` (option B per PLAN); `clearHashAndExit` lives there now.

### `src/components/auth/AuthHero.tsx` (net-new)
- `<aside aria-hidden="true" className="hidden md:flex relative h-screen overflow-hidden p-12 flex-col bg-[linear-gradient(135deg,var(--color-hero-bg)_0%,var(--color-hero-bg-2)_50%,var(--color-hero-bg-3)_100%)] text-white">`.
- Renders `<LoginHero />` (consumed from 13-03) as a decorative absolute-positioned illustration behind the content layer.
- Brand wordmark top (visual only — escape-hatch lives in AuthFormShell since this aside is `aria-hidden`).
- Eyebrow ("Clinical GLP-1 tracking") + headline `<h1>` with `<span className="font-display font-light italic …">One place.</span>` Fraunces accent + sub-copy.
- Trust strip with `lucide-react` Lock / Shield / Check icons.
- Glassmorphic testimonial card `<figure className="absolute right-12 bottom-12 … bg-white/[0.08] backdrop-blur-[14px]">` pinned bottom-right.

### `src/components/auth/AuthFormShell.tsx` (net-new)
- `<main id="auth-form" className="h-screen overflow-y-auto px-6 py-10 md:px-12 md:py-10 bg-[var(--color-surface)] flex flex-col">`.
- Inner container `w-full max-w-[380px] mx-auto my-auto`.
- "Back to LeanShot home" Zap button at the top with verbatim Phase 5 focus-visible ring tokens (per PATTERNS §E).
- `<PillGroup segmented>` with two `<Pill>` children "Sign in" / "Sign up", rendered ONLY when `sub ∈ {'signin','signup'}` (omitted for forgot/verify/verify-sent/set-new-password to avoid header collisions).
- Clicking the inactive pill sets `window.location.hash = '#/auth/(signin|signup)'`; AuthView's `hashchange` listener re-renders with the new sub.
- The 6-row sub-form mount table is preserved verbatim — `SignInForm`, `SignUpForm`, `ForgotPasswordForm`, `SetNewPasswordForm`, `VerifyEmailLanding`, `PostSignupSent`.

### `src/components/auth/AuthView.test.tsx` (net-new, 9 tests)
1. Outer container has `h-screen`, `overflow-hidden`, `grid`, `md:grid-cols-[1.1fr_1fr]`.
2. Hero `<aside hidden md:flex aria-hidden="true">` mounts with `LoginHero`.
3. Form `<main id="auth-form">` has `overflow-y-auto`.
4. Hashchange listener re-renders correct sub-form.
5. Segmented Pill switcher present for signin/signup.
6. Clicking "Sign up" pill pushes `#/auth/signup` and renders SignUpForm.
7. Segmented switcher NOT rendered for forgot/verify/verify-sent/set-new-password.
8. All 6 sub-routes mount their correct sub-form.
9. Hero `<aside>` has `aria-hidden="true"`, form `<main>` does NOT.

### `e2e/auth-split-screen.spec.ts` (net-new, 4 tests, 6.8s wall)
1. ≥ 768 px: hero LEFT, form RIGHT, both ≈ 800 px tall (±2 px), form `overflow-y: auto`, hero wider than form.
2. < 768 px: hero `display:none`, form full width.
3. Segmented click routes `#/auth/signin` → `#/auth/signup`.
4. Routing-invariant: `#/auth/signin` renders `<main#auth-form>` with no redirect.

## Pre-flight Verification Results (Task 1)

- ✅ **Auth view path:** `src/components/auth/AuthView.tsx` mounted by `src/App.tsx:59` `const AuthView = lazy(() => import('@/components/auth/AuthView'));`.
- ✅ **Pill v2 segmented API:** `<PillGroup segmented>` wraps `<Pill active={…} onClick={…}>` children. PillGroup renders `role="tablist"` when `segmented` is true; adjacent pills share borders via the `[&>button:not(:first-child)]:-ml-px` rule (see `src/components/ui/Pill.tsx:71-94`).
- ✅ **LoginHero signature:** `export function LoginHero({ className, staticOnly }: { className?: string; staticOnly?: boolean }): JSX.Element` at `src/illustrations/LoginHero.tsx:29`. Mirrors HeroOrbital's `staticOnly` pattern; uses `useReducedMotion()` internally; `aria-hidden` on the SVG.

## Untouched (byte-identical pre/post-plan)

`git diff f293215..HEAD --stat -- src/App.tsx src/components/auth/SignInForm.tsx src/components/auth/SignUpForm.tsx src/components/auth/ForgotPasswordForm.tsx src/components/auth/SetNewPasswordForm.tsx src/components/auth/VerifyEmailLanding.tsx src/components/auth/PostSignupSent.tsx` → **0 changes** across all 7 protected files.

- `src/App.tsx` — D-08 enforced (no new `View` ID, `selectView()` unchanged, lazy import unchanged).
- 6 sub-form files — Phase 5 D-01 boundary respected.

## Bundle Delta

Post-plan build (from `npm run build`):
- `dist/assets/index-R1twOZAI.js` → **13.62 kB gz** (working ceiling 24.5 kB, absolute ceiling 50 kB — well within).
- `dist/assets/AuthView-DbD-MTd6.js` → 6.08 kB gz (auth route already lazy-loaded; AuthHero + AuthFormShell + Pill imports bundled into this chunk).
- `scripts/assert-bundle-budget.sh` → ✅ jspdf bundle topology OK.
- `scripts/assert-clinic-bundle-budget.sh` → ✅ index chunk OK; clinic bundle topology OK.

LoginHero is consumed from the existing 13-03 illustration tree (no new dependency). The split-screen restyle is layout-only — no new packages, no new external script/style/image sources, zero hex literals introduced (`grep -E "#[0-9A-Fa-f]{3,8}\b" src/components/auth/AuthView.tsx src/components/auth/AuthHero.tsx src/components/auth/AuthFormShell.tsx` → 0 matches).

## Test Results

- **Vitest:** `npx vitest run src/components/auth/AuthView.test.tsx` → **9/9 pass** (740 ms).
- **Playwright:** `npx playwright test e2e/auth-split-screen.spec.ts` → **4/4 pass** (6.8 s).
- **Typecheck:** `npm run typecheck` → 0 errors.
- **Lint (auth files only):** `npx eslint src/components/auth/AuthView.tsx src/components/auth/AuthHero.tsx src/components/auth/AuthFormShell.tsx src/components/auth/AuthView.test.tsx` → 0 errors after the `import-x/order` reshuffle.

## Deviations from Plan

None. Plan executed exactly as written. All three dependency checks in Task 1 passed first try; the GREEN implementation passed all 9 unit tests + 4 Playwright tests on the first commit; lint required a trivial import-order reshuffle (type import first, then sibling alphabetical) which was applied before the GREEN commit.

The two notes flagged in the plan's `notes:` frontmatter are confirmed executed as specified:
- Hero-LEFT / form-RIGHT per the design bundle (NOT the ROADMAP SC #5 text).
- 768 px breakpoint per D-17 (NOT the bundle's 980 px CSS literal).

## Commits

| Hash | Type | Subject |
|------|------|---------|
| `758f38d` | test | Add failing tests for split-screen AuthView + AuthFormShell |
| `d56e0a9` | feat | Split-screen AuthView with AuthHero + AuthFormShell (DS-04) |
| `3ee0d1a` | test | Playwright responsive smoke for auth split-screen (DS-04) |

## Success Criteria Verification

| SC | Status | Evidence |
|----|--------|----------|
| DS-04 split-screen login | ✅ | `AuthView` outer grid `md:grid-cols-[1.1fr_1fr]`; `AuthHero` mounted LEFT; `AuthFormShell` mounted RIGHT |
| D-08 no routing change | ✅ | `git diff f293215 -- src/App.tsx` empty; no new `View` ID |
| Phase 5 sub-forms untouched | ✅ | `git diff` over all 6 sub-form files empty |
| Pill v2 segmented consumed | ✅ | `AuthFormShell.tsx` line 67-74 uses `<PillGroup segmented>` |
| LoginHero consumed | ✅ | `AuthHero.tsx` line 29 imports + renders `<LoginHero />` |
| D-17 768 px breakpoint | ✅ | Tailwind `md:` prefix (= 768 px) on all responsive classes |
| chat1.md landmine 4 | ✅ | Outer `h-screen overflow-hidden`; both panels `h-screen`; only form has `overflow-y-auto` |
| No hex literals | ✅ | grep returns 0 matches across the 3 plan-owned files |
| No bundle regression | ✅ | index 13.62 kB gz (ceiling 50 kB); both budget scripts pass |
| Vitest + Playwright green | ✅ | 9/9 vitest, 4/4 playwright |

## Self-Check: PASSED

- ✅ `src/components/auth/AuthHero.tsx` FOUND
- ✅ `src/components/auth/AuthFormShell.tsx` FOUND
- ✅ `src/components/auth/AuthView.test.tsx` FOUND
- ✅ `e2e/auth-split-screen.spec.ts` FOUND
- ✅ Commit `758f38d` (RED) FOUND in `git log --oneline`
- ✅ Commit `d56e0a9` (GREEN) FOUND in `git log --oneline`
- ✅ Commit `3ee0d1a` (Playwright) FOUND in `git log --oneline`
- ✅ `src/App.tsx` byte-identical to base (D-08)
- ✅ 6 sub-form files byte-identical to base (Phase 5 boundary)
