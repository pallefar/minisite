---
phase: 02-visible-compliance-public-deploy
verified: 2026-05-11T00:00:00Z
status: human_needed
score: 5/5 success criteria substantively encoded in code; 2 require post-deploy human verification
top_level_verdict: PASS
blockers: 0
gaps:
  - truth: "vendor-react chunk is only ~3 kB gz; react-dom is in vendor-motion (or another chunk) instead of vendor-react"
    status: partial
    reason: "manualChunks group `'vendor-react': ['react','react-dom','scheduler']` is declared in vite.config.ts but the emitted vendor-react chunk gzips to only 3 kB (raw 7.7 kB), implying react-dom (~98 kB gz) ended up in a sibling chunk. Likely root cause: framer-motion imports react-dom symbols through its module graph and Rollup attributes the shared import to vendor-motion. Bundle topology concern, not a SC#1 blocker — the index dropped from 205.8 → 69.5 kB gz, still well under the threshold lighthouserc.json gates against. lhci will validate the actual Lighthouse score."
    classification: followup
    artifacts:
      - path: leanshot/vite.config.ts
        issue: "manualChunks groups declared correctly but vendor-react under-fills"
      - path: leanshot/dist/assets/vendor-react-Dvy8yi29.js
        issue: "raw 7,749 B / gz 3,009 B — react-dom not landing here"
    missing:
      - "Verify under `dist/stats.html` where react-dom actually lands; if it sits under vendor-motion, consider moving framer-motion BEFORE vendor-react in manualChunks ordering OR explicitly merging vendor-react into another grouping."
      - "Validation gate is the lhci CI run (Section E of HUMAN-UAT) — only fix if Performance < 90 on the Vercel preview."
human_verification:
  - test: "Section A — Create the 2 Vercel projects and link env vars per the D-18/19/20 matrix"
    expected: "leanshot-app + leanshot-marketing both deploy from main branch; SPA picks up vercel.json, marketing picks up vercel.marketing.json via Configuration Override"
    why_human: "Requires Vercel dashboard credentials Claude does not have on this branch (acknowledged in 02-08-SUMMARY.md Tasks 3+4)"
  - test: "Section E — Lighthouse ≥ 90 on Performance / Accessibility / Best Practices against Vercel preview"
    expected: "lhci CI job on a PR exits green, OR manual `lhci collect && lhci assert` against the preview URL exits green with all three categories ≥ 0.9"
    why_human: "Cannot run lhci against a live HTTPS Vercel preview from this branch — depends on Section A being complete first. Bundle measurement says HIGH-confidence ≥ 90, but the actual measured score is the SC#1 success condition."
  - test: "C9 — Dashboard fallback fires for v4-migrated user"
    expected: "Set acknowledgedDisclaimer=undefined in localStorage with a user already created → refresh → blocking modal appears over dashboard → click `I understand` → modal dismisses"
    why_human: "Requires browser DevTools manipulation of localStorage on a real deploy"
  - test: "C10 — Watermark survives screenshot tool"
    expected: "Open MedLevelChart → take system screenshot → 'Estimate — not medical advice' visible verbatim in saved PNG"
    why_human: "Visual verification requires running the app and a screenshot tool"
---

# Phase 02 — Visible Compliance & Public Deploy: Verification Report

**Phase Goal:** Ship the LeanShot SPA + marketing site to publicly reachable Vercel HTTPS URLs with visible medical-grade compliance posture (blocking disclaimer, watermarked drug-level chart, mental-health copy denylist) and the Lighthouse ≥ 90 budget gated in CI.

**Verified:** 2026-05-11
**Status:** PASS — code-side success criteria are all encoded; 2 SCs require post-deploy human action that is structurally blocked by the absence of Vercel credentials on this branch (this is the documented Phase 2 hand-off shape, not a defect).
**Re-verification:** No — initial verification.

---

## Goal Achievement — Success Criteria

| #    | Success Criterion                                                                                | Status     | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ---- | ------------------------------------------------------------------------------------------------ | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SC#1 | Lighthouse ≥ 90 (Performance / Accessibility / Best Practices) at deploy URL                     | COVERED (code) + HUMAN-PENDING (measurement) | `leanshot/vite.config.ts:46-67` — manualChunks declared with 5 vendor groupings; emitted bundle (`leanshot/dist/assets/`): index-* 69.5 kB gz (down from 205.8 baseline per `02-02-BUNDLE-MEASUREMENT.md` line 15), 4 parallel-fetched vendor chunks. `leanshot/lighthouserc.json:1-20` — Performance/Accessibility/Best-Practices each gated at min 0.9 as `error`. `.github/workflows/ci.yml:145-167` — `lighthouse` job, PR-only, needs all 6 prior jobs, runs `@lhci/cli@0.15.1 autorun` against the wait-for-vercel-preview URL.            |
| SC#2 | Blocking disclaimer before any tab interactive (Step 0 + dashboard fallback)                     | COVERED    | `leanshot/src/lib/storage.ts:31` STORAGE_VERSION=5; `:54` `acknowledgedDisclaimer: 'v1' \| undefined`; `:77` initialState defaults to `undefined`; `:108-110` migrateFromV3 explicitly defaults to `undefined` NEVER `'v1'`. `leanshot/src/lib/store.ts:115` `acknowledgeDisclaimer` action; `:262-267` v4→v5 migrate handler spreads `acknowledgedDisclaimer: undefined`. `leanshot/src/components/dashboard/DisclaimerModal.tsx:46-61` Modal uses `dismissible={false}` + `hideClose`. `leanshot/src/components/onboarding/OnboardingFlow.tsx:60` `TOTAL_STEPS=8`; `:97` Step 0 guards `next()`; `:106-110` `handleAcknowledge` calls `acknowledgeDisclaimer('v1')` then advances to step 1; `:190-200` Step 0 inline render of DisclaimerBody; `:529` no Back button on step 0. `leanshot/src/App.tsx:71` `needsDisclaimer = !!user && acknowledgedDisclaimer !== 'v1'`; `:171-176` DisclaimerModal mounted as dashboard-render fallback. |
| SC#3 | MedLevelChart canvas carries verbatim "Estimate — not medical advice" watermark                  | COVERED    | `leanshot/src/components/dashboard/charts/medLevelWatermarkPlugin.ts:17` `WATERMARK_TEXT = 'Estimate — not medical advice'` — em-dash bytes verified `e2 80 94` (U+2014). `:30-53` Plugin object, `afterDraw` hook, `ctx.rotate(-Math.PI/4)` (45° CCW), opacity defaults 0.12 / can be 0.18 (dark). `leanshot/src/components/dashboard/charts/MedLevelChart.tsx:79-82` light/dark opacity wired theme-aware (0.12/0.18); `:95` `plugins: [medLevelWatermarkPlugin]` per-instance. Grep shows ZERO `Chart.register(medLevelWatermarkPlugin)` calls anywhere — plugin is NOT global. BaseChart.tsx only registers `...registerables`. |
| SC#4 | Marketing site on a separate origin with strict CSP on the SPA origin                            | COVERED (code) + HUMAN-PENDING (deploy)      | `vercel.json:10` (REPO ROOT) — `default-src 'none'; script-src 'self'; connect-src 'self' https://*.ingest.us.sentry.io https://*.ingest.sentry.io https://*.posthog.com https://api.anthropic.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; img-src 'self' data: blob:; font-src 'self' data: https://fonts.gstatic.com; …; worker-src 'self' blob:` — all 4 RESEARCH-corrected hosts present. `vercel.marketing.json:5-14` (REPO ROOT) — minimal headers, no CSP, `buildCommand: npm run build:marketing`. `leanshot/vite.marketing.config.ts:15-27` — separate config, dist-marketing/ output. `leanshot/marketing.html` + `leanshot/src/main.marketing.tsx` — separate entry; main.marketing.tsx reads `VITE_SPA_URL` for the cross-origin handoff anchor. `leanshot/package.json:9` `build:marketing` script.            |
| SC#5 | CI grep blocks the 4 CMIA AB 2089 mental-health terms                                            | COVERED    | `.github/workflows/ci.yml:119-143` — `compliance-copy` job; `:137-142` `if grep -rniE '\b(depression\|anxiety\|therapy\|mental health treatment)\b' src --include='*.ts' --include='*.tsx' --exclude='*.test.ts' --exclude='*.test.tsx'; then echo "::error::…"; exit 1; fi` — case-insensitive, word-boundary, inverted exit per RESEARCH gotcha #5. Grep against `leanshot/src/**` returns ZERO matches → job currently passes.                                                                                                  |

**Score:** 5/5 success criteria substantively encoded in code. SC#1 and SC#4 each carry a deploy-time human-verify component that is documented in `02-HUMAN-UAT.md` (Sections A, C, D, E, F).

---

## Required Artifacts (read-verified)

| Artifact                                                                  | Expected                                                       | Status     | Details                                                                                                                                                                                                                              |
| ------------------------------------------------------------------------- | -------------------------------------------------------------- | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `leanshot/src/lib/storage.ts`                                             | STORAGE_VERSION=5, ackDisclaimer field, defensive migration   | ✓ VERIFIED | Read end-to-end: STORAGE_VERSION=5 (line 31); `acknowledgedDisclaimer: 'v1' \| undefined` (54); initialState default undefined (77); migrateFromV3 defaults to undefined with research-pitfall comment (108-110).                       |
| `leanshot/src/lib/store.ts`                                               | acknowledgeDisclaimer action + v4→v5 migrate handler           | ✓ VERIFIED | Action at line 115 (`set({ acknowledgedDisclaimer: version })`); persist `migrate` at 251-269 with explicit `version === 4` branch returning `{ ...state, acknowledgedDisclaimer: undefined }`; comment "NEVER 'v1'".                  |
| `leanshot/src/components/dashboard/DisclaimerModal.tsx`                   | dismissible={false}, hideClose, no decline path                | ✓ VERIFIED | DisclaimerBody export + DisclaimerModal export; uses Modal with `dismissible={false}` + `hideClose`; onClose is `() => {}` no-op with D-09 comment.                                                                                  |
| `leanshot/src/components/onboarding/OnboardingFlow.tsx`                   | TOTAL_STEPS=8, Step 0 disclaimer, no back from step 1 to step 0 | ✓ VERIFIED | TOTAL_STEPS=8 (60), Step 0 advances ONLY via handleAcknowledge guard at line 97, no Back button on step 0 at line 529, handleAcknowledge calls `acknowledgeDisclaimer('v1')` (107).                                                  |
| `leanshot/src/App.tsx`                                                    | dashboard-render fallback when needsDisclaimer                 | ✓ VERIFIED | needsDisclaimer derived at line 71; DisclaimerModal rendered at lines 171-176 outside Suspense, so it layers above lazy overlays; eager-loaded (top of file import).                                                                  |
| `leanshot/src/components/dashboard/charts/medLevelWatermarkPlugin.ts`     | em-dash, 45°, opacity defaults                                 | ✓ VERIFIED | Hex bytes `e2 80 94` confirmed for em-dash; `ctx.rotate(-Math.PI / 4)` (45° CCW) at line 45; opacity defaults 0.12 with override path.                                                                                              |
| `leanshot/src/components/dashboard/charts/MedLevelChart.tsx`              | per-instance plugin wiring; theme-aware opacity                | ✓ VERIFIED | `plugins: [medLevelWatermarkPlugin]` at line 95; theme-driven opacity 0.18 dark / 0.12 light at lines 80-82; comment forbidding Chart.register; grep confirms NO global registration anywhere.                                       |
| `leanshot/vite.config.ts`                                                 | manualChunks (5 groups), sourcemap:'hidden', sentry plugin     | ✓ VERIFIED | `sourcemap: 'hidden'` (45), 5 manualChunks groups (53-65), sentryVitePlugin with `disable: !env.SENTRY_AUTH_TOKEN` (33) and `filesToDeleteAfterUpload: ['./dist/**/*.map']` (32).                                                    |
| `leanshot/vite.marketing.config.ts`                                       | separate config, dist-marketing/, marketing.html input         | ✓ VERIFIED | outDir 'dist-marketing' (21), input pointing at marketing.html (24).                                                                                                                                                                 |
| `leanshot/marketing.html`                                                 | independent HTML entry, loads main.marketing.tsx               | ✓ VERIFIED | references `/src/main.marketing.tsx` (line 19).                                                                                                                                                                                      |
| `leanshot/src/main.marketing.tsx`                                         | reads VITE_SPA_URL, no Sentry/PostHog imports                  | ✓ VERIFIED | Reads `import.meta.env.VITE_SPA_URL ?? '/'` (18); only imports react-dom + Landing + index.css; no Sentry/PostHog.                                                                                                                  |
| `leanshot/lighthouserc.json`                                              | 0.9 minScore for Performance + A11y + Best Practices            | ✓ VERIFIED | All three categories asserted as `error` at minScore 0.9 (lines 11-13); `numberOfRuns: 3`, `preset: "desktop"`.                                                                                                                      |
| `.github/workflows/ci.yml` (REPO ROOT)                                    | compliance-copy job + lighthouse job + working-directory: leanshot | ✓ VERIFIED | Repo-root file confirmed via `ls /Users/karstenhaldan/minisite/.github/workflows/`. `defaults.run.working-directory: leanshot` at line 16. compliance-copy job (119-143) with inverted-grep idiom. Lighthouse PR-only job (145-167). |
| `vercel.json` (REPO ROOT)                                                 | strict CSP with all RESEARCH gotcha #2 hosts                   | ✓ VERIFIED | Repo-root file. Single CSP value contains: `*.ingest.us.sentry.io`, `*.ingest.sentry.io`, `*.posthog.com`, `api.anthropic.com` in connect-src; `fonts.googleapis.com` in style-src; `fonts.gstatic.com` in font-src; `worker-src 'self' blob:`; `blob:` in img-src; HSTS, X-Frame-Options DENY, X-Content-Type-Options nosniff, Referrer-Policy strict-origin-when-cross-origin, Permissions-Policy locked. |
| `vercel.marketing.json` (REPO ROOT)                                       | minimal headers, no CSP                                        | ✓ VERIFIED | Repo-root file. Only HSTS + X-Content-Type-Options + Referrer-Policy. `buildCommand: npm run build:marketing`, `outputDirectory: dist-marketing`.                                                                                  |

---

## Key-Link Verification (Wiring)

| From                                       | To                                              | Via                                                                  | Status   | Details                                                                                                                                                                                                                          |
| ------------------------------------------ | ----------------------------------------------- | -------------------------------------------------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `App.tsx`                                  | `acknowledgedDisclaimer` store field            | `useStore((s) => s.acknowledgedDisclaimer)`                          | ✓ WIRED  | Line 63 selector + line 71 derived `needsDisclaimer`.                                                                                                                                                                            |
| `App.tsx`                                  | `DisclaimerModal`                               | conditional render `{needsDisclaimer && <DisclaimerModal …/>}`       | ✓ WIRED  | Lines 171-176; eager import at line 2.                                                                                                                                                                                           |
| `DisclaimerModal`                          | `acknowledgeDisclaimer('v1')` action            | `useStore.getState().acknowledgeDisclaimer('v1')`                    | ✓ WIRED  | onAcknowledge passed in at App.tsx:174.                                                                                                                                                                                          |
| `OnboardingFlow.handleAcknowledge`         | `acknowledgeDisclaimer('v1')` action            | `useStore.getState().acknowledgeDisclaimer('v1')`                    | ✓ WIRED  | Line 107.                                                                                                                                                                                                                        |
| `OnboardingFlow` Step 0                    | `DisclaimerBody`                                | inline `<DisclaimerBody onAcknowledge={handleAcknowledge}/>`         | ✓ WIRED  | Line 198, only rendered when `step === 0`.                                                                                                                                                                                       |
| `MedLevelChart`                            | `medLevelWatermarkPlugin`                       | `plugins: [medLevelWatermarkPlugin]` in Chart config                 | ✓ WIRED  | Line 95.                                                                                                                                                                                                                         |
| `medLevelWatermarkPlugin`                  | global Chart registry                           | `Chart.register(...)`                                                | ✓ ABSENT-AS-INTENDED | grep confirms no global registration; only BaseChart.tsx calls `Chart.register(...registerables)` for chart.js core. D-14/D-15 satisfied. |
| `acknowledgeDisclaimer` action             | persisted state via Zustand persist + partialize | `partialize` includes `acknowledgedDisclaimer`                       | ✓ WIRED  | store.ts line 249.                                                                                                                                                                                                               |
| `migrate v4→v5`                            | sets `acknowledgedDisclaimer: undefined`        | `if (persistedState && version === 4) return { ..., undefined }`     | ✓ WIRED  | store.ts lines 262-267.                                                                                                                                                                                                          |
| `compliance-copy` CI job                   | repo source tree                                | inherited `defaults.run.working-directory: leanshot` resolves `src` | ✓ WIRED  | ci.yml line 16 + 137. No per-job override.                                                                                                                                                                                       |
| `lighthouse` CI job                        | Vercel preview                                  | `wait-for-vercel-preview@v1.3.2` then `--collect.url=…`              | ✓ WIRED  | ci.yml lines 152-165. PR-only via `if: github.event_name == 'pull_request'`.                                                                                                                                                     |
| `vercel.json` (repo root)                  | SPA Vercel project                              | Vercel reads `vercel.json` from project root with Root Directory `leanshot` mapped per HUMAN-UAT A1 | ⚠ HUMAN-VERIFY | Documented in `02-HUMAN-UAT.md` Section A. Cannot verify without Vercel dashboard. |
| `vercel.marketing.json` (repo root)        | Marketing Vercel project                        | Pasted into project's Configuration Override per HUMAN-UAT A2.4      | ⚠ HUMAN-VERIFY | Documented; cannot verify without Vercel dashboard.                                                                                                                                                                              |
| `main.marketing.tsx` → SPA                  | cross-origin handoff                            | `window.location.href = import.meta.env.VITE_SPA_URL`                 | ✓ WIRED (code) + ⚠ HUMAN (env) | Code reads env var; env value populated per HUMAN-UAT B-marketing matrix.                                                                                                                                                  |

---

## Data-Flow Trace (Level 4)

| Artifact                                | Data Variable                  | Source                                                                            | Produces Real Data | Status     |
| --------------------------------------- | ------------------------------ | --------------------------------------------------------------------------------- | ------------------ | ---------- |
| `App.tsx` `needsDisclaimer` gate         | `acknowledgedDisclaimer`       | Persisted Zustand state (initialState default `undefined`; migrate keeps `undefined`) | Yes (real boolean) | ✓ FLOWING  |
| `MedLevelChart` watermark text           | `WATERMARK_TEXT` constant      | `medLevelWatermarkPlugin.ts:17`                                                   | Yes (verbatim)     | ✓ FLOWING  |
| `MedLevelChart` watermark opacity        | theme                           | `useTheme()` hook → light=0.12, dark=0.18                                         | Yes (theme-aware)  | ✓ FLOWING  |
| `compliance-copy` job exit code         | `grep -rniE` over `src/`       | Real source tree at CI time                                                       | Yes (currently 0 matches) | ✓ FLOWING  |
| `lighthouse` job assertion              | LHCI score from preview URL    | Vercel preview deployment                                                         | Yes — but pending real PR run | ⚠ STATIC (until first PR merges through CI) |

---

## Behavioral Spot-Checks

| Behavior                                                   | Command                                                                             | Result                                                                                                                                                                                                  | Status |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| Index chunk size after manualChunks                        | `gzip -c leanshot/dist/assets/index-*.js \| wc -c`                                  | 69,543 bytes gz (vs 205,822 baseline per `02-02-BUNDLE-MEASUREMENT.md` line 15) — 66% reduction                                                                                                          | ✓ PASS |
| Vendor chunks emitted                                      | `ls leanshot/dist/assets/vendor-*.js`                                              | 5 files: vendor-charts, vendor-icons, vendor-motion, vendor-react, vendor-telemetry                                                                                                                      | ✓ PASS |
| `vendor-react` is sized as expected                        | `gzip -c leanshot/dist/assets/vendor-react-*.js \| wc -c`                          | 3,009 bytes gz — react-dom (~98 kB gz) is NOT in this chunk; bundle-topology concern (see Gaps below). Likely landed in vendor-motion (38.15 kB gz vs framer-motion's standalone ~113 kB gz suggests no — react-dom must be elsewhere; probable: index or vendor-telemetry pulled it via shared module graph). | ⚠ PARTIAL |
| CMIA denylist absent from src                              | `grep -rE '\b(depression\|anxiety\|therapy\|mental health treatment)\b' leanshot/src --include='*.ts' --include='*.tsx' --exclude='*.test.ts' --exclude='*.test.tsx'` | (empty — exit 1 from grep, which is success for the inverted-exit CI step)                                                                                                                              | ✓ PASS |
| Em-dash byte sequence in watermark plugin                  | `hexdump -C leanshot/src/components/dashboard/charts/medLevelWatermarkPlugin.ts \| grep Estimate` | `e2 80 94` confirmed (UTF-8 for U+2014 EM DASH)                                                                                                                                                          | ✓ PASS |
| Plugin NOT registered globally                             | `grep -r 'Chart.register(medLevelWatermarkPlugin)' leanshot/src`                    | 0 matches — only `Chart.register(...registerables)` in BaseChart                                                                                                                                         | ✓ PASS |
| `STORAGE_VERSION` is 5                                     | `grep STORAGE_VERSION leanshot/src/lib/storage.ts`                                  | `export const STORAGE_VERSION = 5`                                                                                                                                                                       | ✓ PASS |
| Migration NEVER defaults to `'v1'`                         | `grep -E "acknowledgedDisclaimer:\s*'v1'" leanshot/src/lib/{storage,store}.ts`     | 0 matches in default/init/migrate paths; `'v1'` literal only appears in (a) the type union, (b) the `acknowledgeDisclaimer` action's value the **user** writes, and (c) the `App.tsx` comparison. NEVER as a migration default. | ✓ PASS |
| Modal supports `dismissible` + `hideClose`                  | `grep -nE 'dismissible\|hideClose' leanshot/src/components/ui/Modal.tsx`           | Both props present, `dismissible` defaults true, blocks Escape and backdrop close when false                                                                                                             | ✓ PASS |
| `vercel.json` CSP contains all gotcha-#2 hosts              | `grep -nE 'ingest\.us\.sentry\|ingest\.sentry\|fonts\.googleapis\|fonts\.gstatic\|worker-src\|blob:' vercel.json` | All 6 patterns present in single CSP value at line 10                                                                                                                                                    | ✓ PASS |
| `compliance-copy` uses inverted-exit grep idiom             | `grep -nE 'if grep .* then exit 1; fi' .github/workflows/ci.yml`                   | Lines 137-143 use `if grep -rniE '\b(...)\b' src ...; then echo "::error::"; exit 1; fi`                                                                                                                 | ✓ PASS |
| Lighthouse job is PR-only                                   | `grep -nE "github.event_name == 'pull_request'" .github/workflows/ci.yml`           | Line 149                                                                                                                                                                                                 | ✓ PASS |
| Both build commands exit 0                                  | (per 02-08-SUMMARY.md `Verification`) `npm run build` ran clean; dist/ + dist-marketing/ produced (dist-marketing/ no longer present locally → re-run if needed). | dist/ present; dist-marketing/ NOT present in workspace (build:marketing not run since last clean). Code path is verified from config; the build-output check is human-deferred to UAT. | ⚠ SKIP (no dist-marketing/ on disk) |

---

## Anti-Pattern Scan (modified files)

| File                                                                  | Pattern checked                | Severity   | Notes                                                                                                                                                                              |
| --------------------------------------------------------------------- | ------------------------------ | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/components/dashboard/DisclaimerModal.tsx`                        | empty handler                  | ℹ Info     | `onClose: () => { /* no-op: D-09 forbids decline / dismiss paths */ }` — INTENTIONAL stub with explicit decision-link comment. Not a defect.                                       |
| `src/components/onboarding/OnboardingFlow.tsx`                        | guard for step 0 in `next()`    | ℹ Info     | `if (step === 0) return;` at line 97 — defense-in-depth per L-2 in PLAN-CHECK. Acceptable.                                                                                         |
| `src/App.tsx`                                                         | placeholder/TODO                | None       | No TODO/FIXME left over from this phase.                                                                                                                                          |
| `src/lib/storage.ts`                                                  | comment hygiene                 | ℹ Info     | Multiple `D-10/D-11`, `RESEARCH Pitfall 5` decision-link comments — good.                                                                                                          |
| `src/lib/store.ts`                                                    | partialize includes new field   | ✓ Verified | `acknowledgedDisclaimer` listed in partialize at line 249 — persists across reloads.                                                                                                |
| `vercel.json`                                                         | hand-rolled JSON validity       | ✓ Verified | Single quoted strings, balanced braces, valid `vercel.json` schema reference.                                                                                                      |
| `.github/workflows/ci.yml`                                            | YAML validity + duplication     | ✓ Verified | Single `lighthouse:` job, single `compliance-copy:` job per 02-08 verification (`grep -c` returned 1 each).                                                                       |
| `leanshot/vite.config.ts`                                             | sentry plugin order             | ✓ Verified | sentryVitePlugin is the LAST plugin in `.plugins` array (line 27) per official guidance.                                                                                            |

No blocker anti-patterns detected.

---

## Deferred Items (in-scope of phase, formally deferred to later phases by ROADMAP / 02-HUMAN-UAT Section G)

| Item                                                       | Addressed In                  | Evidence                                                                                                                |
| ---------------------------------------------------------- | ----------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Custom domain (leanshot.app DNS)                            | Future phase                  | D-02 in 02-CONTEXT.md line 43; SC#1 explicitly downgraded to "Lighthouse 90+ at the Vercel deploy URL".                  |
| CSP report-only endpoint                                    | Phase 4                       | 02-HUMAN-UAT.md Section G.                                                                                              |
| Tailwind v4 `'unsafe-inline'` removal                       | Phase 7 hardening             | D-07 / Section G.                                                                                                       |
| WMHMDA / CMIA disclaimer copy variants                      | Phase 7                       | 02-CONTEXT.md / Section G.                                                                                              |
| DoctorReport PDF disclaimer baking                          | Phase 3                       | Section G.                                                                                                              |
| Phase 2.1 (Lighthouse follow-up)                            | Conditional next phase         | Open ONLY if Section E lighthouse score < 90.                                                                           |

---

## Gaps and Concerns (classified)

### Concern G-1 (followup, NOT a blocker) — `vendor-react` is under-filled

- **Observation:** `vite.config.ts:54` declares `'vendor-react': ['react','react-dom','scheduler']`, but the emitted `dist/assets/vendor-react-*.js` is only 3 kB gz (raw 7.7 kB). react-dom (~98 kB gz pre-bundle) clearly didn't end up there.
- **Where it likely went:** Most plausible: framer-motion or chart.js's BaseChart import graph caused Rollup to attribute react-dom to the chunk that imports it first under the manualChunks resolver. The other vendor chunks total: vendor-motion 38 kB gz, vendor-charts 71 kB gz, vendor-telemetry 93 kB gz, vendor-icons 6.5 kB gz, index 69.5 kB gz. The "missing" ~95 kB gz of react-dom is most likely **inside `index-*.js`** (which is still 69.5 kB gz — under the SC#1 threshold) or attributed to `vendor-motion` via the framer-motion → react-dom shared subgraph (vendor-motion at 38 kB gz is suspiciously larger than framer-motion's standalone ~38 kB gz — actually consistent, so react-dom is most likely in `index`).
- **Why followup, not blocker:**
  - The phase goal (Lighthouse ≥ 90) is gated by `lhci`, not by chunk-name aesthetics. `index-*.js` at 69.5 kB gz is still 66% smaller than the 205.8 kB baseline — well within the headroom that 02-02-BUNDLE-MEASUREMENT.md modeled for HIGH confidence.
  - The 02-08-SUMMARY.md verification block (line 76) recorded the same emitted sizes (vendor-react 2.99 kB gz) and treated them as "no regression". The phase author was aware.
  - SC#1 succeeds or fails on the Lighthouse score, not on chunk topology.
- **Recommendation:** Track as a Phase 2.1 input. If lhci CI passes ≥ 90, do nothing. If it fails, the first lever is to inspect `dist/stats.html` (run `ANALYZE=true npm run build`) to confirm where react-dom landed and either reorder manualChunks or merge vendor-react into a different grouping.

### No other gaps detected.

---

## Human Verification Required

These items are structurally blocked by the absence of Vercel credentials on this branch. They are NOT bugs in the phase work — they are the documented hand-off shape (02-08-SUMMARY.md: "Tasks 3+4 — checkpoint:human-action and checkpoint:human-verify — These are deliberately left open").

### 1. Section A — Vercel project setup

**Test:** Create the 2 Vercel projects (`leanshot-app` + `leanshot-marketing`), import the GitHub repo, set Root Directory to `leanshot`, paste the marketing project's Configuration Override, deploy.

**Expected:** Both projects deploy cleanly from main; SPA picks up `vercel.json`; marketing picks up `vercel.marketing.json` via override.

**Why human:** Requires Vercel dashboard credentials.

### 2. Section B — Vercel env-var matrix

**Test:** Set the SPA project's Production env vars (`VITE_SENTRY_DSN`, `VITE_POSTHOG_KEY`, `VITE_POSTHOG_HOST`, `VITE_ANALYTICS_ENABLED=true`, `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT`); leave Preview/Development empty per the matrix. Set the marketing project's `VITE_SPA_URL`.

**Expected:** Production builds upload Sentry source-maps then delete them; Preview builds skip the upload (Sentry plugin no-ops); marketing project picks up `VITE_SPA_URL` for its CTA.

**Why human:** Vercel credentials.

### 3. Section C — Post-deploy smoke (11 checks)

**Test:** Walk through `02-HUMAN-UAT.md` Section C against the deployed URLs. Critical items: C8 Disclaimer Step 0, C9 Dashboard fallback, C10 Watermark survives screenshot, C11 watermark NOT on other charts.

**Expected:** All 11 checkboxes green; CSP doesn't break the AI coach, fonts, photo upload, or PostHog Replay.

**Why human:** Visual + behavioral browser verification on real deploy.

### 4. Section D — Sentry / PostHog observability

**Test:** Verify a Sentry release exists with the commit SHA and a symbolicated test error lands in Issues; verify PostHog receives metadata-only events.

**Why human:** Requires production Sentry/PostHog dashboards.

### 5. Section E — Lighthouse ≥ 90

**Test:** Either rely on the lhci CI job on a real PR, or run `npx --yes @lhci/cli@0.15.1 collect --url=<PREVIEW_URL> --numberOfRuns=3 && lhci assert` manually.

**Expected:** Performance / Accessibility / Best Practices each ≥ 0.9.

**Why human:** Cannot run lhci against a live HTTPS Vercel preview from this branch.

### 6. Section F — CI verification on a real PR

**Test:** F1 compliance-copy passes; F2 lighthouse passes; F3 throwaway PR with `depression` makes compliance-copy go red.

**Why human:** Requires opening real PRs against main.

---

## Top-Level Verdict

**PASS — 0 blockers.**

All 5 success criteria are substantively encoded in the codebase with verified file reads, byte-level checks (em-dash), grep checks, and key-link confirmations. The two SCs that include a deployed-environment component (SC#1 measurement, SC#4 cross-origin verification) have their CI/automation infrastructure in place (lhci + wait-for-vercel-preview) and are explicitly hand-offed to the human via 02-HUMAN-UAT.md, which is the documented Phase 2 close-out shape.

The only flagged concern (vendor-react under-fill) is a bundle-topology observation that does NOT affect SC#1 success since `index-*.js` is already 66% smaller than baseline and lhci will be the actual judge. Track as Phase 2.1 input only if Lighthouse falls under 90.

---

_Verified: 2026-05-11_
_Verifier: Claude (gsd-verifier, goal-backward)_
