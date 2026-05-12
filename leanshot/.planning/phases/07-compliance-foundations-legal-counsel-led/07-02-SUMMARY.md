---
phase: 07
plan: 02
subsystem: legal-hosting
tags: [compliance, wmhmda, footer, hash-routes, lazy-chunks]
requires: [07-01]
provides: [legal-page-hosting-surface, LegalFooter, LEGAL_LINKS]
affects: [src/App.tsx, src/components/marketing/Landing.tsx, src/components/layout/AppShell.tsx]
tech-stack:
  added: []
  patterns:
    - Hash-route view selector branch ('legal' with TOP priority — mirrors Phase 5 D-01 '#/auth/*' pattern)
    - React.lazy() per legal page → one Rollup chunk per page (4 chunks + 1 LegalLayout chunk, all <1KB)
    - Single source of truth (LEGAL_LINKS const) shared by Landing + AppShell + e2e spec — anti-link-rot
key-files:
  created:
    - leanshot/src/components/layout/LegalFooter.tsx
    - leanshot/src/components/legal/LegalLayout.tsx
    - leanshot/src/components/legal/PrivacyPolicy.tsx
    - leanshot/src/components/legal/ConsumerHealthData.tsx
    - leanshot/src/components/legal/TermsOfService.tsx
    - leanshot/src/components/legal/MedicalDisclaimer.tsx
    - leanshot/e2e/legal-pages.spec.ts
  modified:
    - leanshot/src/App.tsx (selectView 'legal' branch + selectLegalPage helper + 4 lazy imports + LegalNotFound fallback)
    - leanshot/src/components/marketing/Landing.tsx (plain-text <li> placeholders → <LegalFooter variant="marketing" />)
    - leanshot/src/components/layout/AppShell.tsx (added <LegalFooter variant="app" /> after MobileNav)
decisions:
  - Shape A (SPA hash routes) chosen over Shape B (Vercel rewrites + MD viewer) and Shape C (in-bundle MD + remark/rehype) — zero new infra + zero new bundle weight in entry graph.
  - HTML-comment TODO markers in JSX (`{/* ... */}`) do NOT survive to rendered HTML; switched to `<div data-todo="07-03|07-04" hidden />` so the e2e spec can assert against actual DOM. Authoring plans 07-03/07-04 replace the data-todo element with content.
  - selectLegalPage 404 fallback uses LegalNotFound (LegalLayout-wrapped) instead of returning `null` — Suspense never receives a falsy child; unknown hashes still get coherent chrome (T-07-02-02 mitigation).
metrics:
  duration: ~30 min
  completed_date: 2026-05-12
  tasks: 3
  files_created: 7
  files_modified: 3
---

# Phase 7 Plan 07-02: Legal-Page Hosting Surface (SPA Hash Routes)

**One-liner:** Four `#/legal/*` hash-routed placeholder pages + a single-source-of-truth LegalFooter wired into both the marketing Landing footer AND the authenticated AppShell footer, closing the WMHMDA conspicuous-link requirement (RCW 19.373.030(1)(b)) on BOTH surfaces while keeping the 50 kB index gz ceiling untouched.

## Hosting decision

| Shape | Mechanism | Bundle impact | Verdict |
|---|---|---|---|
| **A: SPA hash routes** (CHOSEN) | `#/legal/*` → `React.lazy()` component via App.tsx view selector | Zero impact on index entry graph; 4 separate lazy chunks ~700-800B gzipped each | Matches Phase 5 D-01 precedent. Zero new infra. |
| B: Static MD via Vercel rewrites | `/public/legal/*.md` + rewrite to MD viewer | +10-15 kB gz (remark/rehype + viewer) | Heavier once viewer is counted. |
| C: In-bundle MD components | `import md from './privacy.md'` with Vite MD plugin | Pulls MD pipeline into entry graph | Direct 50 kB ceiling violation. |

Rejected B/C at plan time; no re-litigation needed at execution.

## Files created / modified

**Created (7):**
- `leanshot/src/components/layout/LegalFooter.tsx` — single source of truth for the 4 legal links: exports `LEGAL_LINKS` const + `LegalFooter` component with `variant: 'marketing' | 'app'`.
- `leanshot/src/components/legal/LegalLayout.tsx` — structural chrome (back-to-app link, max-width `<main>`, embedded `<LegalFooter />` for sibling navigation). Plans 07-03/07-04 fill the children slot.
- `leanshot/src/components/legal/PrivacyPolicy.tsx` — placeholder + `data-todo="07-04"`.
- `leanshot/src/components/legal/ConsumerHealthData.tsx` — placeholder + `data-todo="07-03"`.
- `leanshot/src/components/legal/TermsOfService.tsx` — placeholder + `data-todo="07-04"`.
- `leanshot/src/components/legal/MedicalDisclaimer.tsx` — placeholder + `data-todo="07-04"`.
- `leanshot/e2e/legal-pages.spec.ts` — Tests A (LEGAL_LINKS shape contract), B (marketing footer link navigation), C (AppShell footer parity, env-gated), drives off the imported LEGAL_LINKS so the test list cannot drift from production.

**Modified (3):**
- `leanshot/src/App.tsx` — `View` type extended to include `'legal'`; `selectView` gains `'legal'` branch with TOP priority (above auth, above dashboard); `selectLegalPage(hash)` helper maps to 4 lazy components; `LegalNotFound` fallback for unknown legal hashes. VITE_E2E `selectView` log seam preserved untouched (Phase 7 debug rounds 1+2 instrumentation).
- `leanshot/src/components/marketing/Landing.tsx` — alphabetized `LegalFooter` import added; plain-text `<li>Privacy policy</li>` / `<li>Terms of service</li>` / `<li>Medical disclaimer</li>` block replaced with `<LegalFooter variant="marketing" />`. CHDP link is now visible (WMHMDA conspicuous-link closed on the marketing surface).
- `leanshot/src/components/layout/AppShell.tsx` — `<LegalFooter variant="app" />` rendered after `<MobileNav />` and before the FAB. FAB is `fixed`-positioned so it floats independently. Mobile mb-[80px] reserves space for the bottom-nav; desktop has none.

## Bundle measurements (post-build)

| Chunk | Size (raw) | Status |
|---|---|---|
| `dist/assets/index-CUiMVvst.js` | **22.55 kB gz** | 50 kB ceiling untouched (regression class from Phase 5 NOT reintroduced) |
| `dist/assets/PrivacyPolicy-pU1swcdQ.js` | 779 B raw | lazy chunk |
| `dist/assets/ConsumerHealthData-Cp65RlIh.js` | 732 B raw | lazy chunk |
| `dist/assets/TermsOfService-eFPhAvXQ.js` | 747 B raw | lazy chunk |
| `dist/assets/MedicalDisclaimer-BXB9N2i2.js` | 720 B raw | lazy chunk |
| `dist/assets/LegalLayout-CdJf8zRx.js` | 970 B raw | lazy chunk (shared by all 4 pages) |
| `vendor-react` | 60.49 kB gz | unchanged |
| `vendor-icons` | 6.97 kB gz | reused for `ArrowLeft` (no new icon dep) |

`bash scripts/assert-vendor-react-size.sh` → **OK** (vendor-react: 60491 gz, index: 22530 gz, both within bounds).

## Spec runtime

`npx playwright test e2e/legal-pages.spec.ts --reporter=line` → **2 passed, 1 skipped (5.8s)**

- ✅ **Test A** — LEGAL_LINKS constant exports 4 entries with expected labels + hashes.
- ✅ **Test B** — Marketing footer renders all 4 links; each resolves to a placeholder page with the expected `<main>` + H1 + `data-todo` marker; no console errors.
- ⏭ **Test C** — AppShell footer parity (signed-in). Skipped pending `E2E_TEST_USER_EMAIL` + `E2E_TEST_USER_PASSWORD` in CI environment. The spec is implemented and exercises the SAME LEGAL_LINKS contract against the authenticated dashboard footer — it will run automatically once those env vars are provisioned on the CI runner.

## Carry-forward for 07-03 / 07-04

Each authoring plan replaces the placeholder body inside its target page component. The contract for the authoring plans:

```tsx
// Before (07-02 placeholder):
<LegalLayout title="Privacy Policy">
  <h1 className="text-2xl font-semibold tracking-tight mb-4">Privacy Policy</h1>
  <div data-todo="07-04" hidden />        {/* ← REMOVE this line when content lands */}
  <p>This policy is being authored…</p>   {/* ← REPLACE with real content */}
</LegalLayout>

// After (07-04 content authoring):
<LegalLayout title="Privacy Policy">
  <h1 className="text-2xl font-semibold tracking-tight mb-4">Privacy Policy</h1>
  <p>Effective date: 2026-05-12</p>
  {/* ... full Termly-derived content ... */}
</LegalLayout>
```

Authoring plans need NO infrastructure changes — `LegalLayout`, `LegalFooter`, the hash-route view selector, and the e2e spec are all stable.

**Per-page TODO assignments:**
- 07-03 (WMHMDA CHDP authoring): `ConsumerHealthData.tsx` only.
- 07-04 (Privacy / Terms / Disclaimer authoring): `PrivacyPolicy.tsx`, `TermsOfService.tsx`, `MedicalDisclaimer.tsx`.

Once 07-04 ships, the e2e spec's `EXPECTED_TODO_BY_HASH` map will need a `// AUTHORED` sentinel value (or the per-page data-todo assertion will need to be removed) — track as a known-deferred item for 07-04's plan.

## Threats mitigated (recap from plan threat model)

| ID | Disposition | Status |
|---|---|---|
| T-07-02-01 — Tampering via MD render path | mitigate | Plan ships pure JSX; no Markdown renderer; no `dangerouslySetInnerHTML`. |
| T-07-02-02 — Hash-route view selector injection | mitigate | `selectLegalPage` switch returns known-good lazy component or `LegalNotFound` fallback; user-controlled hash never reaches render. |
| T-07-02-03 — Footer-link rot | mitigate | LEGAL_LINKS is the single source of truth; Landing + AppShell + spec all import it. Drift breaks Test A or B at CI time. |
| T-07-02-04 — CSP bypass via hosting choice | accept | Shape A inherits existing CSP; no new origins, no new script-src exceptions. |
| T-07-02-05 — Legal-policy version tracking | accept | Plan 07-04 owns "Last updated" + git-anchored version string. |
| T-07-02-06 — Phishing pages | accept | Out of plan scope. |
| T-07-02-07 — Lazy-chunk load failure | mitigate | Suspense fallback renders during chunk load; chunk 404 surfaces console error and breaks Test B's no-console-errors check. |

## Deviations from Plan

### Rule 3 — Blocking issue (commit-attribution split — environmental, not work-loss)

**Found during:** Tasks 2 and 3 (immediately after staging via `git add`).

**Issue:** During this Wave 2 (parallel executors for plans 07-02, 07-05, 07-08 all writing to the same repo), two of my staged commits were absorbed by sibling executors' commits before I could run `git commit`. Specifically:
- Task 2 staged files (5 new legal/* components + App.tsx changes + LegalFooter cleanup) → committed as part of `ee5ee5e docs(07-05): add founder COMPL-03 acknowledgement note`.
- Task 3 staged files (real LegalFooter + Landing.tsx + AppShell.tsx wiring) → committed as part of `911ee68 fix(07-08): audit_trigger search_path must include extensions schema (Rule 1 deviation)`.

**Cause:** Sibling executors' commit pipelines (likely a `git add -A` or `git add .` in the sibling agent's flow) swept up MY staged-but-not-yet-committed files into THEIR commits. This is a Wave-2 parallel-execution race condition, NOT a destructive operation on my part.

**Impact / Recovery:** All Task 2 and Task 3 source code is correct and present in `main`; verification (typecheck, lint, build, bundle-size guard, unit tests 445/445, e2e 2/3 with C correctly skipped) all pass against the merged state. The work is not lost — just the per-task commit attribution is split across three commits instead of three discrete `feat(07-02):` commits.

**Trace map (which commit contains which Task's files):**
- `311e910 test(07-02): RED — legal-pages spec asserts footer + hash-route surface` — Task 1 (clean attribution).
- `ee5ee5e docs(07-05): add founder COMPL-03 acknowledgement note` — contains Task 2 files (the 5 legal/* components + App.tsx selectView 'legal' branch + LegalFooter stub eslint-disable cleanup) alongside the legitimate 07-05 COMPL-03 acknowledgement md.
- `911ee68 fix(07-08): audit_trigger search_path must include extensions schema (Rule 1 deviation)` — contains Task 3 files (real LegalFooter + Landing.tsx wiring + AppShell.tsx wiring) alongside the legitimate 07-08 search_path fix migration.

**Resolution:** None needed for this plan. Recommendation for the orchestrator: Wave 3+ should either (a) run executors sequentially when they share root-level commit hooks, or (b) require each executor to stage + commit atomically before any other executor stages. The pre-commit hook on this repo evidently doesn't isolate the staging area per agent.

### Rule 2 — Auto-add missing critical functionality

**Plan said:** `data-todo` element should be `<div data-todo="07-XX" hidden />`. Plan also said: "render an HTML comment marker ... but JSX `{/* ... */}` does NOT survive to HTML. To make the marker visible to `page.content()`, render it as actual JSX-emitted HTML using `dangerouslySetInnerHTML` on a hidden node OR — simpler — render a `<div data-todo>`".

**Action:** Picked the `<div data-todo hidden />` approach per the plan's own simpler recommendation. The e2e spec asserts `[data-todo]` DOM attribute matching `/^07-(03|04)$/` rather than HTML-comment text. Contract is identical (per-page discoverable marker naming the authoring plan); mechanism is DOM-based which Playwright handles natively.

### Rule 2 — Selector helper return type narrowed

**Issue:** Plan's `selectLegalPage(hash)` returned `null` for unknown hashes, but rendering `null` inside `<Suspense fallback={...}><null /></Suspense>` would crash.

**Fix:** Added a `LegalNotFound` lazy fallback (wraps `LegalLayout title="Page not found"`) so unknown legal hashes still render coherent chrome — no white screen, no console error. T-07-02-02 mitigation is strengthened.

### Out-of-scope discoveries (logged, NOT fixed)

- Pre-existing ESLint warnings in `GuidedTour.tsx` (264, 272 — react-refresh/only-export-components) and `ShareCardModal.tsx` (31 — react-hooks/exhaustive-deps). Not introduced by this plan; not in scope.
- `LegalFooter.tsx` itself triggers the same `react-refresh/only-export-components` warning because the plan's contract requires the file to export BOTH `LEGAL_LINKS` (const) AND `LegalFooter` (component). The warning is unavoidable given the plan's anti-link-rot single-source-of-truth design. Accepted.

## Self-Check: PASSED

**File existence:**
- ✅ `leanshot/src/components/layout/LegalFooter.tsx`
- ✅ `leanshot/src/components/legal/LegalLayout.tsx`
- ✅ `leanshot/src/components/legal/PrivacyPolicy.tsx`
- ✅ `leanshot/src/components/legal/ConsumerHealthData.tsx`
- ✅ `leanshot/src/components/legal/TermsOfService.tsx`
- ✅ `leanshot/src/components/legal/MedicalDisclaimer.tsx`
- ✅ `leanshot/e2e/legal-pages.spec.ts`

**Commits in `git log --oneline --all`:**
- ✅ `311e910` — Task 1 RED (clean attribution)
- ✅ `ee5ee5e` — contains Task 2 (split attribution — see deviations)
- ✅ `911ee68` — contains Task 3 (split attribution — see deviations)

**Verification suite:**
- ✅ `npm run typecheck` clean
- ✅ `npm run lint` 0 errors (6 pre-existing warnings, none from this plan's new files except the unavoidable LegalFooter dual-export warning)
- ✅ `npm run build` clean
- ✅ `bash scripts/assert-vendor-react-size.sh` → OK (index 22.55 kB gz; vendor-react 60.49 kB gz)
- ✅ `npm run test:unit` → 445/445 pass
- ✅ `npx playwright test e2e/legal-pages.spec.ts` → 2 passed, 1 correctly skipped (Test C env-gated)
- ✅ Anti-link-rot grep: 0 plain-text `<li>Privacy policy</li>` etc. in Landing.tsx
- ✅ Static-import scan: 0 non-lazy imports of `@/components/legal/*` in App.tsx / main.tsx / store.ts
- ✅ Conspicuous-link presence: `LegalFooter` appears in both Landing.tsx (import + render) and AppShell.tsx (import + render)
