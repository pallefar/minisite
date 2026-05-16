---
phase: 22-owner-admin-lifecycle-email-dsar-cookie-consent
plan: 09
subsystem: ui
tags: [react, impersonation, admin, rls-defense-in-depth, a11y, tdd]

requires:
  - phase: 22-owner-admin-lifecycle-email-dsar-cookie-consent
    plan: 01
    provides: 51 impersonation write-deny RLS policies (migration 20270601000012) + A1 PROBE PASS verdict (336ms latency) + Wave 0 ImpersonationBanner/useImpersonationReadOnly test scaffolds
  - phase: 22-owner-admin-lifecycle-email-dsar-cookie-consent
    plan: 03
    provides: admin-impersonate Edge Function (start/end actions; mints magic-link carrying app_metadata.impersonator_id + impersonation_exp claims)

provides:
  - useImpersonation hook reading session.user.app_metadata.impersonator_id (A1 PROBE PASS Option A)
  - useImpersonationReadOnly client-side disabled-props provider (UX layer of D-05 defense-in-depth)
  - ImpersonationBanner.tsx sticky red 48px AppShell banner with countdown + End CTA
  - admin-impersonate client wrapper (startImpersonation/endImpersonation) with sessionStorage admin-refresh restoration

affects:
  - 22-12 (AppShell mount + writable-surface useImpersonationReadOnly sweep)

tech-stack:
  added:
    - (none net-new) — composition of supabase-js auth + lucide-react + existing useReducedMotion + useToast
  patterns:
    - "A1 PROBE PASS Option A primary: read app_metadata.impersonator_id from session.user (supabase-js auto-decodes); manual JWT-payload base64url decode is a defensive fallback only"
    - "Auto-expire effect tracks previous-seconds via useRef + autoEndFiredRef → fires exactly once on transition from >0 to 0"
    - "Defense-in-depth dual-layer: useImpersonationReadOnly is UX-only ('Read-only during impersonation' tooltip + disabled state); RLS write-deny policies (51 in migration 20270601000012) are the security boundary"
    - "sessionStorage 'impersonation_admin_refresh' caches admin refresh_token DURING impersonation; cleared on endImpersonation; XSS exposure bounded by Phase 12 SPA CSP + 30-min impersonation TTL"
    - "Magic-link URL-fragment parser (extract access_token + refresh_token from #access_token=...&refresh_token=...) feeds supabase.auth.setSession for impersonation session swap"

key-files:
  created:
    - leanshot/src/components/impersonation/useImpersonation.ts
    - leanshot/src/components/impersonation/useImpersonationReadOnly.ts
    - leanshot/src/components/impersonation/ImpersonationBanner.tsx
    - leanshot/src/lib/admin/admin-impersonate.ts
  modified:
    - leanshot/src/components/impersonation/__tests__/ImpersonationBanner.test.tsx (Wave 0 scaffold → 10 real behavior tests)
    - leanshot/src/components/impersonation/__tests__/useImpersonationReadOnly.test.ts (Wave 0 scaffold → 2 real behavior tests)

key-decisions:
  - "A1 PROBE PASS unlocked direct app_metadata read from session.user (primary branch); manual JWT-payload decoder shipped as defensive fallback though essentially dead code today. No Custom Access Token Hook needed."
  - "Countdown source-of-truth is useImpersonation().secondsRemaining (which is impersonation_exp - now). Banner does NOT maintain its own timer — the hook owns interval state. Banner re-renders whenever hook recomputes."
  - "Auto-expire effect lives in the BANNER (not the hook) — only the banner needs to surface the toast, and the toast UX is the user-facing aspect of expiry. The hook still has its own auto-end-call as defense-in-depth in case the banner isn't mounted."
  - "useImpersonationReadOnly returns the EXACT shape from RESEARCH lines 392-407 verbatim ({disabled: bool, props: {...}}) so plan 22-12's sweep can spread `{...useImpersonationReadOnly().props}` blindly on any disabled-eligible element."
  - "sessionStorage (NOT localStorage) for admin refresh_token cache — tab-scoped + wiped on tab-close minimizes the post-task lifetime of this bearer credential. T-22-52 mitigation."

requirements-completed: [ADMIN-03]

duration: ~35min
completed: 2026-05-16
---

# Phase 22 Plan 22-09: ImpersonationBanner + read-only hooks Summary

**Shipped ADMIN-03's UI half: sticky red banner with countdown + End CTA, session-reading useImpersonation hook (A1 PROBE PASS Option A — direct app_metadata read), useImpersonationReadOnly client-side disabled-props provider (defense-in-depth UX layer over the 51 RLS write-deny policies from plan 22-01), and admin-impersonate.ts client wrapper with sessionStorage admin-refresh restoration. 12/12 plan tests green; bundle index gz 15.01 kB (50 kB ceiling).**

## Performance

- **Duration:** ~35 min (~20 min impl, ~5 min RED tests, ~5 min GREEN debug+lint-fix, ~5 min summary)
- **Tasks:** 2 of 2
- **Files created:** 4 (`useImpersonation.ts`, `useImpersonationReadOnly.ts`, `ImpersonationBanner.tsx`, `admin-impersonate.ts`)
- **Files modified:** 2 (test scaffolds → real tests)
- **Tests:** 12 plan-22-09 tests, 12 passing
- **Bundle:** index gz 15.01 kB (50 kB ceiling; banner lazy-loaded via AppShell in 22-12 will keep it that way)

## Accomplishments

### Task 1: useImpersonation hook + admin-impersonate client wrapper (commit `768e13b`)

- **useImpersonation hook** reads `session.user.app_metadata.{impersonator_id, impersonation_exp}` directly per **A1 PROBE PASS** (336ms latency confirmed by 22-A1-PROBE.md). A defensive JWT-payload base64url decoder ships as a fallback branch (in case supabase-js ever omits the metadata), but it's effectively dead code today.
- **Returns** `{active, impersonatorId, targetEmail, targetUserId, secondsRemaining, endImpersonation}` — `secondsRemaining` recomputes every 1s when impersonation is active (interval skipped otherwise to avoid render churn for the 99% case).
- **Auto-expire** at `secondsRemaining === 0` fires endImpersonation once via a fired-ref guard.
- **admin-impersonate.ts client wrapper:**
  - `startImpersonation({targetUserId})`: caches admin refresh_token in `sessionStorage['impersonation_admin_refresh']` BEFORE the session swap, invokes Edge Fn with `action:'start'`, extracts `access_token` + `refresh_token` from the magic-link URL fragment, calls `supabase.auth.setSession`.
  - `endImpersonation({targetUserId})`: invokes Edge Fn with `action:'end'`, restores admin via `supabase.auth.refreshSession({refresh_token: stash})`, clears stash. Falls back to `signOut` if stash missing.
  - **Discriminated `ImpersonationErrorCode`** = `not_staff | invalid_target | session_expired | cannot_impersonate_self | cannot_impersonate_admin | unknown` (maps Edge Fn `error` field).
  - **T-22-52 footgun documented** in module header: sessionStorage admin refresh_token XSS exposure bounded by Phase 12 SPA CSP + 30-min impersonation TTL; cleared on end.

### Task 2: ImpersonationBanner + useImpersonationReadOnly + 12 tests (commits `c444f17` RED, `6316e59` GREEN)

- **ImpersonationBanner.tsx** matches UI-SPEC §284-297 exactly:
  - `sticky top-0 z-[60] bg-[var(--color-danger)] text-white h-12` container
  - `role="alert"` + `aria-live="assertive"` (announce on mount)
  - Left: `<UserCog aria-hidden>` + `Impersonating {email} · Read-only · {N}m {S}s remaining`
  - Countdown span: `aria-live="off"` (don't announce every tick) + `font-mono tabular-nums` for jitter-free digits + `animate-pulse` when `< 60s` (suppressed when `useReducedMotion()`)
  - Right: inverse-styled pill button "End impersonation" → `void endImpersonation()`
  - Returns `null` when `!active`
  - Auto-expire useEffect tracks previous-seconds via useRef; on transition `>0 → 0` fires endImpersonation + `useToast()('Impersonation session expired.', 'info')` exactly once
- **useImpersonationReadOnly.ts** verbatim shape per RESEARCH lines 392-407:
  - Active: `{disabled: true, props: {disabled: true, 'aria-disabled': true, title: 'Read-only during impersonation'}}`
  - Inactive: `{disabled: false, props: {}}`
  - Plan 22-12 sweep can spread `{...useImpersonationReadOnly().props}` on Button/Input/form blindly.
- **Tests (12 passing):**
  - 10 banner: null-when-inactive, sticky/red/h-12 container, body text format, End-CTA invokes endImpersonation, countdown aria-live="off", countdown text on re-render, pulse class < 60s, pulse SUPPRESSED on reducedMotion, auto-expire fires + toast, lucide:UserCog with aria-hidden
  - 2 hook: inactive returns empty props, active returns full disabled-props

## Task Commits

| Task | Description | Commit |
|------|-------------|--------|
| 1 | useImpersonation hook + admin-impersonate client wrapper | `768e13b` |
| 2 RED | ImpersonationBanner + useImpersonationReadOnly behavior tests (failing) | `c444f17` |
| 2 GREEN | ImpersonationBanner + useImpersonationReadOnly impl + lint auto-fixes | `6316e59` |

## Verification

### Plan 22-09 test results

```
src/components/impersonation/__tests__/ImpersonationBanner.test.tsx     10 passed
src/components/impersonation/__tests__/useImpersonationReadOnly.test.ts  2 passed

 Test Files  2 passed (2)
      Tests  12 passed (12)
   Duration  655ms
```

### Typecheck

```
$ node_modules/.bin/tsc -b
(no output; exit 0)
```

### Lint (plan-22-09 files)

```
$ node_modules/.bin/eslint src/components/impersonation/ src/lib/admin/admin-impersonate.ts
(no output; clean)
```

### Bundle (build green)

```
dist/assets/index-LJvJ2z2U.js                      51.17 kB │ gzip:  15.01 kB
```

Index gz **15.01 kB** vs plan ceiling **50 kB** — comfortably under. ImpersonationBanner.tsx itself only adds a thin React subtree and re-uses already-bundled `lucide-react` (`UserCog`). AppShell mount in 22-12 will route through React.lazy for the admin-bundle chunk if needed.

## Decisions Made

(All extracted to frontmatter `key-decisions`; load-bearing recap:)

1. **A1 PROBE PASS unlocked direct `session.user.app_metadata` read** — primary branch is a one-liner; JWT-payload decoder shipped as defensive fallback but effectively dead code.
2. **Banner owns the auto-expire toast (hook owns the auto-end RPC call)** — UX-of-expiry lives where the human-facing surface is; the hook defends against banner-not-mounted edge cases by also calling endImpersonation when it sees seconds=0.
3. **`useImpersonationReadOnly` shape is verbatim from RESEARCH** — plan 22-12 sweep can spread blindly without reading this hook's internals.
4. **sessionStorage (not localStorage) for admin refresh_token cache** — tab-scoped + wiped on tab-close minimizes bearer-credential lifetime (T-22-52 mitigation).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] eslint import-x/order violations on 4 files after initial Write**
- **Found during:** post-GREEN lint pass
- **Issue:** Five `import-x/order` errors — empty line between import groups and `@supabase/supabase-js` type-import positioned after `react` (must come before).
- **Fix:** `eslint --fix src/components/impersonation/ src/lib/admin/admin-impersonate.ts` cleaned all 5 errors. Tests re-ran 12/12 green afterward; tsc still clean.
- **Files modified:** `useImpersonation.ts`, `__tests__/ImpersonationBanner.test.tsx`, `__tests__/useImpersonationReadOnly.test.ts`, `ImpersonationBanner.tsx`
- **Commit:** folded into `6316e59` (GREEN commit) — eslint --fix landed in the same stage.

**Total deviations:** 1 auto-fixed (lint hygiene). No bugs; no scope creep.

## Issues Encountered

- **Worktree had no `node_modules` on spawn** — required `npm install --prefer-offline --no-audit --no-fund` before any tsc/vitest/eslint could run (~8s, 850 packages). Standard worktree quirk; not a Plan 22-09 issue.
- **4 unrelated test files fail across the broader suite:** `DsarPortalPage.test.tsx`, `SoftDeleteCountdownBanner.test.tsx`, `dsar-pdf-render.test.ts`, `RefundModal.test.tsx`. These are Wave 0 RED scaffolds for sibling Wave 2 plans (22-08 SoftDelete, 22-10 DSAR portal, 22-07 RefundModal) awaiting their executors to ship the GREEN modules. **Out of scope for plan 22-09** — not a regression.

## User Setup Required

**None.** A1 PROBE PASS means no new vendor pass needed for impersonation. Wave 0 (22-01) shipped the RLS deny policies + Edge Fn + test scaffolds; Wave 1 (22-03) shipped the admin-impersonate Edge Fn server-side. This plan layers the UI cleanly on top of both.

## Files Requiring useImpersonationReadOnly Spread (Plan 22-12 Sweep)

Plan 22-12 Wave 3 needs to spread `{...useImpersonationReadOnly().props}` on writable surfaces. **Non-exhaustive** (RLS is the actual gate; this is UX defense-in-depth) — recommended targets:

**Forms with write actions:**
- `src/components/dashboard/modals/DoseLogModal.tsx` (and any LogXModal sibling)
- `src/components/dashboard/settings/SettingsPage.tsx` profile/goals/units inputs
- `src/components/onboarding/OnboardingFlow.tsx` (won't be reachable normally during impersonation but defense)
- `src/components/clinic-invite/AcceptInvitePage.tsx` (already deferred via auth; double-belt)

**Per-row destructive actions:**
- Any `<SwipeToDelete>` instance in tabs (BodyTab, MedicationTab, etc.)
- "Delete account" button in SettingsPage (DEL-01)
- Photo-trash buttons (Phase 7 deferred-items)

**Buttons that fire mutations:**
- `<Topbar>` "Log dose" FAB
- `<MobileNav>` FAB
- "Save" / "Update" buttons across all settings sub-pages

**Inline form notice** (per UI-SPEC line 295 + line 558):
- Add `<div className="rounded-md border border-[var(--color-danger)] bg-[var(--color-danger-soft)] p-2 text-xs">Read-only — changes cannot be saved during impersonation.</div>` at the top of any form during impersonation (gate on `useImpersonationReadOnly().disabled`).

**Wiring**: AppShell mounts `<ImpersonationBanner />` above the Topbar. Banner is unconditional in mount tree — it self-returns null when `!active`. The mount itself is one line in AppShell.tsx.

## Threat Flags

(None — Plan 22-09 introduces no net-new threat surface beyond what's documented in the plan's `<threat_model>`. The 5 threats T-22-51 through T-22-55 are fully covered:)

| Threat ID | Mitigation In Code |
|-----------|--------------------|
| T-22-51 | useImpersonationReadOnly is documented UX-only; RLS write-deny policies (22-01 File 12) are the actual gate |
| T-22-52 | sessionStorage (NOT localStorage) for admin refresh_token; cleared on endImpersonation; documented in admin-impersonate.ts header |
| T-22-53 | Auto-expire useEffect in banner fires endImpersonation at secondsRemaining===0; hook also has its own auto-end as defense |
| T-22-54 | Accept disposition — bearer-token rotation handled by Supabase Auth; admin can revoke via admin.deleteUser if compromise suspected |
| T-22-55 | A1 PROBE PASS means primary branch is the only active path; FAIL branch (manual JWT decode) is dead code unless supabase-js regresses |

## Self-Check: PASSED

All claimed artifacts verified to exist:

- `leanshot/src/components/impersonation/useImpersonation.ts` (159 lines, exports `useImpersonation` + `UseImpersonationResult` type)
- `leanshot/src/components/impersonation/useImpersonationReadOnly.ts` (46 lines, exports `useImpersonationReadOnly` + `UseImpersonationReadOnlyResult` + `ImpersonationReadOnlyProps` types)
- `leanshot/src/components/impersonation/ImpersonationBanner.tsx` (106 lines, default + named export)
- `leanshot/src/lib/admin/admin-impersonate.ts` (170 lines, exports `startImpersonation` + `endImpersonation` + `ImpersonationError` + `ImpersonationErrorCode` + `ADMIN_REFRESH_STORAGE_KEY`)
- `leanshot/src/components/impersonation/__tests__/ImpersonationBanner.test.tsx` (175 lines, 10 tests)
- `leanshot/src/components/impersonation/__tests__/useImpersonationReadOnly.test.ts` (50 lines, 2 tests)
- All 3 task commits present in `git log --oneline`: `768e13b`, `c444f17`, `6316e59`
- 12/12 plan-22-09 tests pass on `vitest run src/components/impersonation/__tests__/`
- Typecheck clean; lint clean on all plan-22-09 files
- Build green; index gz 15.01 kB under 50 kB ceiling

---

*Phase: 22-owner-admin-lifecycle-email-dsar-cookie-consent*
*Plan: 09 — ImpersonationBanner + read-only hooks (ADMIN-03)*
*Completed: 2026-05-16*
