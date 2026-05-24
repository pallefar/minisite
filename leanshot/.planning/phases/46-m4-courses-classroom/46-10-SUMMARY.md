---
phase: 46
plan: 10
subsystem: courses
tags: [courses, cert-verify, public-route, hmac, no-auth, course-04]
requires: [46-01, 46-03, 46-07, 46-08]
provides:
  - "/verify/<cert_id>?t=<hmac> public SPA route"
  - "compareCertToken helper (constant-time, no secret)"
affects:
  - "src/App.tsx (top-of-render pathname pre-check)"
tech_added: []
patterns:
  - "Pre-mount pathname pre-check (analog: /share, /legal hash routes; /cancel-deletion path route)"
  - "Constant-time string compare for HMAC verification without secret exposure"
key_files:
  created:
    - leanshot/src/components/course/CertVerifyPage.tsx
  modified:
    - leanshot/src/App.tsx
    - leanshot/src/lib/course/cert-verify-token.ts
    - leanshot/src/lib/course/cert-verify-token.test.ts
decisions:
  - "Secret-sharing path (b): CERT_VERIFICATION_SECRET stays server-side; browser fetches DB canonical token + constant-time compare"
  - "Pre-check at top of render (not in selectView) to bypass Zustand-persisted-user auto-route trap"
  - "Lands in course-player chunk (path-singular src/components/course/) — acceptable since /verify/* visitors only download this chunk"
  - "No new Edge Function needed (rejected option (a) and the alternative cert-verify Fn proposal)"
metrics:
  duration_minutes: 12
  tasks_completed: 2
  files_created: 1
  files_modified: 3
  commits: 3
  tests_added: 6
  tests_total: 12
completed_date: 2026-05-24
---

# Phase 46 Plan 10: Public `/verify/<cert_id>` route Summary

One-liner: Public no-auth SPA branch at `/verify/<id>?t=<hmac>` that constant-time-compares the URL token against `certificates.verification_token` (loaded via anon SELECT under Plan 46-01 RLS) — secret never reaches the browser.

## What shipped

| File                                                | Status   | LOC | Purpose                                                               |
| --------------------------------------------------- | -------- | --- | --------------------------------------------------------------------- |
| `src/components/course/CertVerifyPage.tsx`          | new      | 210 | Public no-auth verify SPA surface (loading / verified / not_found)    |
| `src/App.tsx`                                       | modified | +24 | Lazy import + top-of-render `pathname.startsWith('/verify/')` branch  |
| `src/lib/course/cert-verify-token.ts`               | modified | +34 | `compareCertToken(urlToken, dbToken)` constant-time helper            |
| `src/lib/course/cert-verify-token.test.ts`          | modified | +43 | 6 new tests for compareCertToken (round-trip parity with mintCertToken) |

## Commits

| Hash        | Type | Message                                                                 |
| ----------- | ---- | ----------------------------------------------------------------------- |
| `9fdf50c8`  | test | test(46-10): add failing tests for compareCertToken helper              |
| `1c0779c4`  | feat | feat(46-10): implement compareCertToken (constant-time, no secret)      |
| `efec5dd6`  | feat | feat(46-10): CertVerifyPage + App.tsx pathname pre-check (/verify/<id>) |

TDD gate sequence (test → feat → feat) satisfied for Task 1.

## Verification

- `npx tsc -p tsconfig.app.json --noEmit` → **clean**
- `vitest run src/lib/course/cert-verify-token.test.ts` → **12/12 passing** (6 existing + 6 new)
- `eslint src/components/course/CertVerifyPage.tsx` → **clean**
- All four automated greps in the plan `<verify>` block → **pass**
  - `test -f src/components/course/CertVerifyPage.tsx`
  - `grep compareCertToken src/components/course/CertVerifyPage.tsx`
  - `grep startsWith\('/verify/'\) src/App.tsx`
  - `grep noindex src/components/course/CertVerifyPage.tsx`

## Decisions Made

### D-46-10-A: Secret-sharing path (b) implemented

The executor brief flagged two paths for HMAC parity between Edge Fn (Plan 46-07)
and browser:
- (a) `vercel env add CERT_VERIFICATION_SECRET production` + read in browser bundle
- (b) Browser fetches DB-stored canonical token + constant-time compare

**Chose (b).** Reasoning:
- (a) exposes the secret to every browser bundle download — any user can extract
  the secret from devtools and mint arbitrary certificates for any user/course.
- (b) keeps the secret server-side. The Edge Fn (46-07) minted the canonical
  token and wrote it to `certificates.verification_token`; RLS (46-01) allows
  anon SELECT only when that column is non-null. The browser is purely a
  byte-comparator. No new Edge Fn surface needed.
- T-46-03 (timing-oracle defeat) handled by XOR-accumulator compare in
  `compareCertToken` (same primitive as the existing `constantTimeEqual` used
  by `verifyCertToken`).

### D-46-10-B: Pre-check placement at top-of-render, not in `selectView`

The codebase has both patterns:
- `selectView` returns a `View` enum value, then a render branch matches → used
  for `/cancel-deletion`, `/clinic/*`, `/admin/*`.
- Top-of-render pathname check → not used until now.

The plan explicitly specified the top-of-render variant. Reasoning to follow it:
1. The verify surface needs to render REGARDLESS of Zustand-persisted user.
   With `selectView`, a `'verify'` branch would be evaluated AFTER `view` is
   computed, and the auto-route to dashboard for a logged-in `user` would have
   already happened via React state init in `useState<View>(() => selectViewLogged(...))`
   — except that the verify branch would short-circuit it. Either pattern
   works, but the top-of-render literal pathname check is mechanically simpler
   and matches the plan word-for-word.
2. The verify page is a leaf surface (like /share, /legal) — no SPA navigation
   in/out. The full-reload assumption is acceptable.
3. Pre-existing hooks at the top of `App()` continue to be called (rules-of-hooks
   preserved); only the render output is short-circuited.

### D-46-10-C: Lazy chunk = course-player

Per `vite.config.ts:227`, anything under `src/components/course/` lands in the
`course-player` chunk. The CertVerifyPage adds ~6 KB raw to that chunk. /verify/*
visitors only download `course-player` (not the dashboard graph), so this is
acceptable. Plan 46-08 chunk gate validated this chunk's overall budget.

### D-46-10-D: No vercel.json modification

The plan's Step C suggested optional server-side noindex header for `/verify/*`,
then immediately self-vetoed because `vercel.json` rewrites all paths to
`/index.html` (per `reference_vercel_json_no_env_interpolation` — vercel.json is
platform config, not a request-time interceptor). Dynamic `<meta>` injection in
`useEffect` is sufficient.

## Deviations from Plan

**None substantive.** Two minor adjustments:

1. **TDD shape for Task 2 (Rule 3 — minor blocking adjustment):** The plan
   tagged Task 2 `tdd="true"`, but its `<verify>` block only specifies tsc +
   greps (no unit test). Since Task 2 is integration glue (component + App
   wiring) and Plan 46-11 owns the Playwright @phase46 tests, no isolated
   unit test exists to RED-GREEN. Verified structurally via the plan's own
   `<verify><automated>` grep+tsc block. Task 1 (compareCertToken) was a
   proper TDD cycle (RED commit `9fdf50c8` → GREEN commit `1c0779c4`).

2. **Lint import-order in CertVerifyPage.tsx (Rule 1 — bug):** Initial draft
   placed `react` import + project imports in two groups separated by a blank
   line; project `import-x/order` config requires them collapsed into one
   group. Auto-fixed inline before commit.

## Deferred Issues

**Out of scope per scope-boundary policy (pre-existing project state):**

- `npm test` orchestration: the top-level `vitest.config.ts` declares
  `projects: [{ name: 'phase38-eval', ... }]` but the comment on lines 24–25
  claims a default project also runs the `src/**` includes. With vitest v4,
  setting `projects:[...]` overrides the default — so `npm run test:unit`
  matches 0 files. Worked around in this plan by running with an inline
  `vitest-46-10-tmp.config.ts` (deleted after use). This affects the entire
  repo's unit-test orchestration, not anything 46-10 introduced.
- 8 pre-existing `import-x/order` errors in `src/App.tsx` (unrelated to my
  edits — present on HEAD before 46-10).

## Threat Flags

No new threat surface introduced. The plan's `<threat_model>` covers T-46-03
which is fully mitigated by the constant-time compare and the "Certificate
not found" non-leaky error state.

## Plan 46-11 prerequisites

Plan 46-11's Playwright @phase46 walks against this route need:

1. **Deterministic seeded cert:** insert a `certificates` row with a known
   `user_id`, `course_id`, `issued_at`, and a `verification_token` minted from
   those four fields via `mintCertToken(...)` in test setup (use the
   browser-side helper since the Playwright test runner can call `crypto.subtle`).
2. **Positive walk:** navigate to `/verify/<cert_id>?t=<correct_token>` →
   expect `[data-testid='cert-verify-page']` present, then the `Verified by
   LeanShot` badge text.
3. **Negative walk:** navigate to `/verify/<cert_id>?t=BAD_TOKEN` →
   expect `Certificate not found` heading.
4. **Profiles/courses fallback:** if seeded `profiles` or `courses` row is
   absent the page still shows "A learner" / "this course" defaults — Plan
   46-11 may want to assert the happy-path values explicitly.

## Self-Check: PASSED

- `leanshot/src/components/course/CertVerifyPage.tsx` → FOUND
- `leanshot/src/App.tsx` → FOUND (modified)
- `leanshot/src/lib/course/cert-verify-token.ts` → FOUND (modified)
- `leanshot/src/lib/course/cert-verify-token.test.ts` → FOUND (modified)
- Commit `9fdf50c8` → FOUND in `git log`
- Commit `1c0779c4` → FOUND in `git log`
- Commit `efec5dd6` → FOUND in `git log`
- tsc clean, vitest 12/12, eslint clean on new file.

## Known Stubs

None. The verify page renders with real data resolved through real RPCs/RLS.
The 'A learner' / 'this course' fallback strings only appear if the optimistic
profiles/courses lookup fails — they are explicit fallbacks (not stubs that
prevent the plan goal).
