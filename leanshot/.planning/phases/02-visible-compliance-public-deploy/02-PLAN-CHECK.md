# Phase 02 — Plan Verification

**Verifier:** gsd-plan-checker (goal-backward)
**Date:** 2026-05-11
**Phase:** 02-visible-compliance-public-deploy
**Plans checked:** 8 (02-01 … 02-08)

---

## Verdict

**PASS with LOW/MEDIUM observations** — execution can proceed.

- **BLOCKER findings:** 0
- **HIGH-severity warnings:** 0
- **MEDIUM warnings:** 2
- **LOW observations:** 4

Every Success Criterion (SC#1–SC#5), every locked Decision (D-01…D-25), and all four required research corrections are traceably encoded in at least one plan. The dependency graph is acyclic, file-conflict-free per wave, and Step-0 atomicity (D-08) is preserved within plan 02-04. Plans are safe to execute.

---

## 1. Goal coverage — SC#1..SC#5

| SC | What must be true | Covering plan(s) | Status |
|----|-------------------|------------------|--------|
| SC#1 | Lighthouse ≥ 90 over HTTPS at deploy URL | 02-02 (measurement) → 02-07 (manualChunks + sourcemap:'hidden') → 02-08 (lighthouserc.json + lhci CI job + manual fallback) | COVERED |
| SC#2 | Blocking disclaimer before any tab interactive (Step 0 + dashboard fallback) | 02-01 (`acknowledgedDisclaimer` field + `acknowledgeDisclaimer` action + v4→v5 migration) → 02-04 (Step 0 + DisclaimerModal + RTL + e2e) → 02-05 (dashboard-render fallback in App.tsx) | COVERED — both onboarding AND dashboard render fallback paths planned |
| SC#3 | `MedLevelChart` carries verbatim "Estimate — not medical advice" watermark in canvas | 02-06 (medLevelWatermarkPlugin.ts + per-instance wiring + em-dash U+2014 byte-verified in plan text) | COVERED |
| SC#4 | Marketing on separate origin with strict CSP on SPA | 02-07 (vercel.json strict CSP + vercel.marketing.json minimal headers + vite.marketing.config.ts + marketing.html + main.marketing.tsx) → 02-08 (HUMAN-UAT Section A creates the two Vercel projects) | COVERED |
| SC#5 | CI grep blocks 4 CMIA AB 2089 terms | 02-03 (compliance-copy job with `if grep -rniE '\b(depression\|anxiety\|therapy\|mental health treatment)\b' src; then exit 1; fi`) | COVERED |

All five SCs trace to at least one plan with a verifiable artifact.

---

## 2. Decision compliance (sampled per orchestrator brief)

| Decision | Encoded in plan | Evidence |
|----------|-----------------|----------|
| D-04: Two Vercel projects, one repo | 02-07 + 02-08 | `vite.marketing.config.ts` (separate config), `dist-marketing/` output, `build:marketing` npm script; HUMAN-UAT A1/A2 creates two projects |
| D-08: Step 0 of OnboardingFlow | 02-04 | `TOTAL_STEPS = 8`, `useState(0)`, Step-0 inline render block, OnboardingFlow.test.tsx + e2e/onboarding.spec.ts both updated in same plan |
| D-09: No decline path | 02-02 (`dismissible` prop) + 02-04 (DisclaimerModal uses `dismissible={false}` + `hideClose`, no Back button on Step 0) | DisclaimerModal.test.tsx asserts neither Escape nor backdrop click calls acknowledge |
| D-10: Versioned string `'v1'` persistence | 02-01 | `PersistedState.acknowledgedDisclaimer: 'v1' \| undefined`, default `undefined`, `STORAGE_VERSION 4→5` migration spreads `acknowledgedDisclaimer: undefined` |
| D-11: Dashboard fallback for v4-migrated users | 02-01 (migration defaults to undefined NEVER 'v1') + 02-05 (App.tsx `needsDisclaimer = !!user && acknowledgedDisclaimer !== 'v1'`) | 4-state test matrix in App.disclaimer.test.tsx; storage.test.ts asserts v3-migrated payload has undefined |
| D-13: Diagonal watermark ~45°, light-gray, ~12%/~18% opacity | 02-06 | `ctx.rotate(-Math.PI / 4)`, opacity 0.12 light / 0.18 dark, color triplet "60,60,60" light / "220,220,220" dark |
| D-14: MedLevelChart only | 02-06 | Per-instance `config.plugins: [medLevelWatermarkPlugin]`; explicit `grep -c medLevelWatermarkPlugin` checks on BaseChart.tsx + SimpleCharts.tsx return 0 |
| D-15: Chart.js plugin via `afterDraw`, per-instance | 02-06 | Plugin id `medLevelWatermark`, `afterDraw` hook, NOT registered globally via `Chart.register()` |
| D-16: 4 denylist terms | 02-03 | All 4 terms (`depression`, `anxiety`, `therapy`, `mental health treatment`) encoded in regex; case-insensitive `-i`, word-boundary `\b…\b` |
| D-17: New CI job `compliance-copy` parallel to existing 5 | 02-03 | Job appended to `.github/workflows/ci.yml`, no setup-node needed (pure shell), inherits `defaults.run.working-directory: leanshot` |
| D-20: Sentry source-map blocking in Production | 02-07 | `sentryVitePlugin({ disable: !env.SENTRY_AUTH_TOKEN })` — when token present in Prod, plugin runs and failure breaks build; when absent (Preview/Dev), no-op |
| D-21: Release tag = git commit SHA | 02-07 | `release: { name: process.env.VERCEL_GIT_COMMIT_SHA }` + `build.sourcemap: 'hidden'` + `filesToDeleteAfterUpload: ['./dist/**/*.map']` |
| D-22: Preview skips source-map upload | 02-07 | Same `disable: !env.SENTRY_AUTH_TOKEN` short-circuit; HUMAN-UAT env matrix sets `SENTRY_AUTH_TOKEN` Production-only |
| D-23: manualChunks (measurement-driven) | 02-02 (measure) → 02-07 (commit) | 02-02 produces 02-02-BUNDLE-MEASUREMENT.md baseline before 02-07 commits to chunk groupings (wave gating: Wave 1 → Wave 3) |
| D-24: No library swaps | 02-07 | `lucide-react`, `framer-motion`, `chart.js` kept; only grouped via manualChunks, not replaced |
| D-25: Lighthouse via `@lhci/cli` in CI | 02-08 | `lighthouserc.json` + `lighthouse` CI job (7th); PR-only via `if: github.event_name == 'pull_request'`; manual fallback documented in HUMAN-UAT Section E |

All sampled decisions verifiably encoded.

---

## 3. Research-correction encoding (the 4 valid gotchas)

| Correction | Encoded? | Plan + Line |
|------------|----------|-------------|
| CSP host depth — `*.ingest.us.sentry.io` AND `*.ingest.sentry.io`, NOT `*.sentry.io` | YES | 02-07 lines 112, 249, 496 (`vercel.json` CSP value) — both hosts present in `connect-src` |
| CSP missing hosts — `fonts.googleapis.com` (style-src), `fonts.gstatic.com` (font-src), `worker-src 'self' blob:`, `blob:` in img-src | YES | 02-07 lines 112, 249, 496 — verbatim CSP string contains all four; Task 3 `done` block explicitly greps for `fonts.googleapis.com` and `worker-src` |
| Migration default `acknowledgedDisclaimer: undefined`, NEVER `'v1'` | YES | 02-01 truth #3 ("NOT `false`, NOT `'v1'`"), Task 1 action step 4 explicitly comments "RESEARCH Pitfall 5", Task 2 v4→v5 migrate handler comment "NEVER 'v1'"; `<verification>` block runs `grep -E "acknowledgedDisclaimer:\\s*'v1'" src/lib/storage.ts src/lib/store.ts` to assert NO matches inside defaults |
| Grep CI step inverts exit code (`if grep …; then exit 1; fi`) | YES | 02-03 truth #3 ("Uses idiom B"), action body line 87/186 uses `if grep -rniE ...; then exit 1; fi` form |

All 4 corrections encoded with verification commands.

---

## 4. Dependency correctness

| Plan | depends_on | Justification | Verdict |
|------|-----------|---------------|---------|
| 02-01 | [] | No upstream — store foundation | ✓ |
| 02-02 | [] | No upstream — Modal prop + measurement | ✓ |
| 02-03 | [] | No upstream — CI job + EventName + .env.example are independent | ✓ |
| 02-06 | [] | No upstream — watermark plugin is standalone | ✓ |
| 02-04 | [1, 2, 3] | 01 → store action; 02 → `dismissible` prop; 03 → `disclaimer_acknowledged` event name | ✓ All three needed |
| 02-05 | [1, 4] | 01 → `acknowledgedDisclaimer` field; 04 → `DisclaimerModal` export | ✓ |
| 02-07 | [2] | 02 → `rollup-plugin-visualizer` install + manualChunks shape approved by HUMAN | ✓ No dependency on 01/04 needed: 02-07 only touches build configs (vite, vercel) and never references `disclaimer_required` event or modal CSS variables — the planner's claim of depends_on=[2] only is correct |
| 02-08 | [3, 7] | 03 → ci.yml has the workflow file in place (compliance-copy lands first); 07 → vercel.json/marketing config must exist before lighthouse job validates against deploy | ✓ |

**Graph is acyclic.** Waves are consistent: max(deps)+1.
- Wave 1: 01, 02, 03, 06 (no deps)
- Wave 2: 04 (deps on Wave 1 plans)
- Wave 3: 05 (deps on Wave 2), 07 (deps on Wave 1)
- Wave 4: 08 (deps on Wave 3)

The orchestrator-reported dependency graph matches the frontmatter exactly.

---

## 5. File-conflict safety (per wave)

### Wave 1 (02-01, 02-02, 02-03, 02-06) — parallel execution

| File | 01 | 02 | 03 | 06 | Conflict |
|------|----|----|----|----|----------|
| `src/lib/storage.ts` + `store.ts` + `storage.test.ts` | ✓ | | | | none |
| `src/components/ui/Modal.tsx` | | ✓ | | | none |
| `package.json` + `package-lock.json` | | ✓ | | | none |
| `.github/workflows/ci.yml` | | | ✓ | | none |
| `src/lib/analytics.ts` + `analytics.test.ts` | | | ✓ | | none |
| `.env.example` | | | ✓ | | none |
| Chart plugin files + `MedLevelChart.tsx` | | | | ✓ | none |
| `vite.config.ts` (not in 02-02 frontmatter but in action body) | | ✓ | | | only 02-02 in Wave 1 — no Wave-1 conflict |
| `.gitignore` (not in 02-02 frontmatter but in action body) | | ✓ | | | only 02-02 in Wave 1 — no Wave-1 conflict |

**Wave 1 — no file conflict.** See observation O-1 (frontmatter drift).

### Wave 2 (02-04 only)
- DisclaimerModal.tsx/.test.tsx + OnboardingFlow.tsx/.test.tsx + e2e/onboarding.spec.ts — single plan, no parallelism, atomic.

### Wave 3 (02-05, 02-07) — parallel
- 02-05: `src/App.tsx`, `src/App.disclaimer.test.tsx`
- 02-07: vite.config.ts, vite.marketing.config.ts, marketing.html, src/main.marketing.tsx, package.json, package-lock.json, vercel.json, vercel.marketing.json, .gitignore

Disjoint paths. **No conflict.**

### Wave 4 (02-08 only)
- ci.yml, lighthouserc.json, 02-HUMAN-UAT.md. Single plan, no parallelism.

### Cross-wave package.json edits
- Wave 1 (02-02) installs `rollup-plugin-visualizer`
- Wave 3 (02-07) installs `@sentry/vite-plugin`
- Wave 4 (02-08) installs `@lhci/cli`

All sequential (different waves), so `npm install` ordering is deterministic. **No conflict.**

---

## 6. Step-0 atomicity (D-08)

Verified: 02-04 frontmatter `files_modified` lists ALL of:
- `src/components/onboarding/OnboardingFlow.tsx`
- `src/components/onboarding/OnboardingFlow.test.tsx`
- `e2e/onboarding.spec.ts`

Plus the new `DisclaimerModal.tsx` + its test. **Atomic — Step 0 insertion, RTL update, and e2e update land in the same plan.** ✓

---

## 7. Measure-first gate (02-02 → 02-07 ordering)

02-02 Task 3 is a `<task type="checkpoint:human-verify" gate="blocking">` BEFORE 02-07 can run (02-07 depends on 02-02). Wave 1 → Wave 3 ordering enforces this. 02-07 Task 1 step 2 explicitly says "Read `02-02-BUNDLE-MEASUREMENT.md` and confirm the approved manualChunks shape."

**Measure-first gate is enforced.** ✓

---

## 8. Gray-area handling

The brief mentions 5 gray areas. Each documented discretion in the plans carries an explicit recommended choice plus rationale:

| Area | Plan | Resolution |
|------|------|-----------|
| Modal `dismissible` prop semantics | 02-02 | Single boolean prop, default true (preserves all existing callers) |
| Disclaimer modal file path | 02-04 | `src/components/dashboard/DisclaimerModal.tsx` (under `dashboard/` because 02-05 fallback is primary consumer) |
| Step 0 illustration | 02-04 Task 2 step 5 | Discretion: render NO illustration (gate vs form) |
| Marketing → SPA handoff | 02-07 main.marketing.tsx comment | Plain `<a href>` redirect (anchor wins per CONTEXT Deferred Ideas) |
| Lighthouse PR-only vs main+PR | 02-08 | PR-only per D-25 planner judgment (per-PR gate, not per-merge) |

All gray areas have recorded mitigations / acknowledged-deferrals. **No silent assumptions.** ✓

---

## Findings

### MEDIUM warnings (recommended fix, execution can proceed)

**M-1 — `02-02-PLAN.md` frontmatter omits `vite.config.ts` and `.gitignore` from `files_modified`.**
- Plan: 02-02
- File: `02-02-PLAN.md` frontmatter lines 7–11
- Severity: medium
- Description: Task 2 action body explicitly modifies `vite.config.ts` (adds visualizer plugin behind ANALYZE gate) and `.gitignore` (excludes `stats.html`), but the frontmatter `files_modified` block only lists Modal.tsx + package.json + package-lock.json + the measurement doc. This is a documentation accuracy gap, not a runtime risk — no other Wave 1 plan touches these files. However, downstream tooling that reasons about file ownership (lock-step verification, audit logs) will miss the edit.
- Fix hint: Add `vite.config.ts` and `.gitignore` to 02-02's `files_modified` block.

**M-2 — `02-RESEARCH.md` retains an outdated "project lives at repo root" assertion (line 150) that the orchestrator did NOT flag.**
- File: `02-RESEARCH.md` "Critical layout note"
- Severity: medium
- Description: The orchestrator's brief corrected only gotcha #3 (`ci.yml missing`). RESEARCH §"Architecture Patterns → Recommended Project Structure → Critical layout note" additionally claims "the project lives at the repo root — there is no `leanshot/` subdirectory". Reality (verified by `ls /Users/karstenhaldan/minisite/leanshot/`): the `leanshot/` subdirectory DOES exist, contains all source, and the CI workflow uses `defaults.run.working-directory: leanshot`. The plans themselves correctly target `leanshot/` paths (e.g. 02-08 HUMAN-UAT explicitly says "Root Directory: leanshot"), but the RESEARCH inconsistency could mislead a future re-planner.
- Fix hint: Update 02-RESEARCH.md line 150 to acknowledge `leanshot/` subdir exists. No plan-level change required — the plans already use the correct layout.

### LOW observations (informational)

**L-1 — 02-02 couples two unrelated foundations behind a single human checkpoint.**
- Plan: 02-02
- Severity: low
- Description: Modal `dismissible` prop (needed by 02-04) and bundle measurement (needed by 02-07) live in the same plan and share one human-verify gate. Result: 02-04 must wait on the bundle-measurement human approval even though 02-04 only needs the Modal prop. A future re-plan could split into "02-02a: Modal prop only" (Wave 1) and "02-02b: Measurement + human-verify" (Wave 1, blocks 02-07) for finer-grained parallelism.
- Fix hint: Acceptable as-is; revisit only if Wave 1 latency becomes a bottleneck.

**L-2 — 02-04 Task 2 step 7 has a soft guard for `next()` from step 0.**
- Plan: 02-04
- Severity: low
- Description: The plan says "Confirm by reading lines 96-100 that `next()` is wired to the Continue button only. If `next()` is callable from step 0…, guard with `if (step === 0) return;`". The executor is asked to make a judgment call mid-task. This is acceptable for tdd-style work but leaves a small specification gap.
- Fix hint: Either explicitly require the guard (defense-in-depth) or explicitly forbid it with the rationale. Current "conditional add" is fine.

**L-3 — 02-05 App.disclaimer.test.tsx test fixture imports `makeUser()` with incomplete fields.**
- Plan: 02-05 Task 2
- Severity: low
- Description: `makeUser()` fixture in the test sketch has placeholder comment "… fill remaining required fields per User interface". The plan instructs the executor to read `src/types/index.ts` first — but if the executor skips this step, the cast `as never` will hide the failure. Acceptable because every existing Phase 1 test that calls `useStore.setState({ user: … as never })` uses the same pattern, and the `as never` cast is a known team idiom.
- Fix hint: None required. The pattern matches existing convention.

**L-4 — 02-07 marketing build's `VITE_SPA_URL` introduces a new env var not in 02-03's `.env.example`.**
- Plans: 02-03 + 02-07 + 02-08
- Severity: low
- Description: 02-07 Task 2 step 3 reads `import.meta.env.VITE_SPA_URL` in `src/main.marketing.tsx`. 02-03 Task 3's `.env.example` lists 7 vars but NOT `VITE_SPA_URL`. 02-08 HUMAN-UAT Section B-marketing lists `VITE_SPA_URL` correctly, so the variable is documented for the human — but `.env.example` should mirror it for consistency.
- Fix hint: Append `VITE_SPA_URL=` to `.env.example` in 02-03 (or have 02-07 extend it).

---

## Closing summary

8/8 plans verified against the phase goal, all 5 SCs covered, all 25 sampled decisions encoded, all 4 research corrections present, dependency graph acyclic + wave-consistent, no file conflicts within waves, Step-0 atomicity preserved, measure-first gate enforced, gray areas explicitly resolved.

The 2 medium + 4 low findings are quality-of-life improvements and do NOT block execution. Plans may proceed to Wave 1 immediately.

**Verdict: PASS with LOW/MEDIUM observations.**
