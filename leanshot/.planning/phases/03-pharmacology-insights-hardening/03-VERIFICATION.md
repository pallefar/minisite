---
phase: 03-pharmacology-insights-hardening
verified: 2026-05-11T12:36:50Z
status: passed
goal_achieved: true
score: 5/5 requirements verified, 5/5 success criteria verified
test_suite: 177 passed / 177 total (Vitest run 2026-05-11T14:35Z)
typecheck: clean (tsc -p tsconfig.app.json --noEmit exits 0)
critical_findings_resolved: 3/3 (CR-01, CR-02, CR-03)
critical_findings_resolved_commits:
  - 8b682df  # CR-01 fix
  - 717ed3f  # CR-01 regression test
  - ac50823  # CR-02 fix
  - ca55368  # CR-02 regression test
  - 4119dc6  # CR-03 fix
  - f70c135  # CR-03 regression test
files_verified:
  - src/lib/disclaimers.ts
  - src/lib/pharmacology-corpus.ts
  - src/lib/pharmacology.test.ts
  - src/lib/insights-refusal.ts
  - src/lib/insights-refusal.test.ts
  - src/lib/insights.ts
  - src/components/dashboard/charts/MedLevelChart.tsx
  - src/components/dashboard/charts/medLevelWatermarkPlugin.ts
  - src/components/dashboard/charts/medLevelWatermarkPlugin.test.ts
  - src/components/dashboard/modals/DoctorReport.tsx
  - src/components/dashboard/modals/DoctorReport.test.tsx
  - src/types/index.ts
  - src/lib/storage.ts
  - src/lib/storage.test.ts
  - src/lib/store.ts
  - .planning/phases/02-visible-compliance-public-deploy/02-06-SUMMARY.md
  - .planning/phases/02-visible-compliance-public-deploy/02-HUMAN-UAT.md
human_verification:
  - test: "Visual UAT — render dashboard locally, navigate to Home (or Medication) tab, confirm shaded uncertainty band visible under Past + Projected lines"
    expected: "Band renders below/above mean lines at ~±27-34% width (CV-dependent); does not overflow chart area; survives theme toggle"
    why_human: "Canvas pixels are not introspectable from automated tests; band visibility is a visual judgement"
  - test: "Visual UAT — diagonal two-line watermark text reads `estimate, not measured serum level` / `— based on population pharmacokinetics` on MedLevelChart in BOTH light and dark themes"
    expected: "Both lines visible at 45° in both themes; opacity ~0.12 light / ~0.18 dark; font legible at standard viewport"
    why_human: "Canvas readability and dark-theme contrast are visual judgements"
  - test: "Print preview UAT — open DoctorReport modal, click Print, confirm `Pharmacokinetic estimate:` aside appears between patient header and Summary section in the print preview"
    expected: "Aside survives window.print(); border visible per `print:border-black`; disclaimer text matches PK_DISCLAIMER_DOCTOR_REPORT verbatim"
    why_human: "window.print() output depends on browser print engine; automated tests assert DOM presence but not print fidelity"
---

# Phase 3: Pharmacology + Insights Hardening — Verification Report

**Phase Goal:** Make the drug-level curve and rule-based insights defensible — every constant cites a peer-reviewed source, automated tests reproduce published steady-state values within ±15% per drug, the chart shows uncertainty as a band (not a deterministic line), and insights can never produce strings recommending dose changes — verified before any audience external to the patient sees the curve.

**Verified:** 2026-05-11
**Status:** PASSED
**Goal achieved:** TRUE

## Executive Summary

All 5 requirements (PK-01..PK-05) verified. All 5 ROADMAP success criteria observable in committed code. All 11 CONTEXT decisions with code consequences land in the implementation. All 3 critical review findings (CR-01..CR-03) carry both fix commits AND regression tests that pass against the live code. Full Vitest suite: 177/177 green. TypeScript build: clean.

Three items are deferred to **human verification** (visual canvas rendering, theme contrast, print-preview fidelity) — none of these can be observed via grep/test and are documented in the `human_verification` frontmatter. Status remains `passed` for code-side achievement; human spot-check is a recommended manual sign-off, not a blocker.

---

## Requirement-by-Requirement Coverage

| Req | Description (verbatim from REQUIREMENTS.md:69-73) | Evidence | Status |
| --- | -------------------------------------------------- | -------- | ------ |
| **PK-01** | `src/lib/pharmacology.ts` is covered by automated test corpus citing peer-reviewed sources (Schneck 2024, FDA reviews) | `src/lib/pharmacology-corpus.ts:47-125` — 5 CorpusEntry rows with DOI/FDA citations (`10.1007/s13300-018-0458-5` Petri 2018, `10.1002/psp4.13099` Schneck 2024, `accessdata.fda.gov` Saxenda label, `10.1007/s40262-015-0338-3` Geiser 2016, `10.1056/NEJMoa2301972` Jastreboff 2023). `src/lib/pharmacology.test.ts` runs ±15% Riemann-sum assertion per CORPUS row. Vitest reports 5 drug-class tests + 1 CV-map test passing. | **COVERED** |
| **PK-02** | `src/lib/insights.ts` covered by refusal-list automated tests | `src/lib/insights-refusal.ts:42-127` (STEM_PATTERN + MED_NOUNS + tokenize + isDoseChangeAdvice + scrubInsights). `src/lib/insights-refusal.test.ts` — 25 REFUSE + 25 PASS corpus + CR-01 multi-occurrence regression + CR-02 clinical-verb extension (Discontinue/Hold/Pause/Resume/Withhold/Cut). Wiring at `src/lib/insights.ts:9` (import), `:155` (`return scrubInsights(out)`), `:182-183` (`guard` defense-in-depth on every pickFocus branch). | **COVERED** |
| **PK-03** | Drug-level chart conveys uncertainty as shaded variability band, not deterministic line | `src/components/dashboard/charts/MedLevelChart.tsx:43-128` — `cvPct = CV_BY_DRUG_CLASS[trialClass(u.medication)]`, four bound datasets (UpperPast/LowerPast/UpperProjected/LowerProjected) with `fill: '+1'`, conditional on `showBand = injections.length > 0` (empty-state suppression). DOM caption `Estimate · ~30% inter-individual variation` rendered at lines 177-179. | **COVERED** |
| **PK-04** | Chart and any printed/shared report carry "estimate, not measured serum level — based on population pharmacokinetics" disclaimer | **Chart side:** `medLevelWatermarkPlugin.ts:39` (id `medLevelWatermark-v2`), `:59-60` (two ctx.fillText calls with PK_DISCLAIMER_LINE_1 + PK_DISCLAIMER_LINE_2). Tested at `medLevelWatermarkPlugin.test.ts:29-35` + em-dash byte verification at `:37-39`. **PDF side:** `DoctorReport.tsx:51-58` (`<aside role="note">` with `{PK_DISCLAIMER_DOCTOR_REPORT}` between header and Summary; `print:border-black` survives window.print). Tested at `DoctorReport.test.tsx`. | **COVERED** |
| **PK-05** | Pharmacology engine version recorded in saved data so future v1.1 upgrade is retroactive | `src/types/index.ts:70` — `pkEngineVersion?: number` field on Injection. `src/lib/storage.ts:31` — `STORAGE_VERSION = 6`. `src/lib/store.ts:139-153` — chained `version <= 4` AND `version <= 5` migrate transforms back-stamp every injection with `pkEngineVersion: inj.pkEngineVersion ?? 1`. `:189` — addInjection stamps `1` on every new write. `:333-338` (hydrate) also applies the v3-bootstrap stamping after CR-03 fix. | **COVERED** |

**Score: 5/5 requirements COVERED.**

---

## ROADMAP Success Criteria Coverage

| SC | Description (verbatim from ROADMAP.md:89-94) | Evidence | Status |
| -- | --------------------------------------------- | -------- | ------ |
| **SC#1** | 12-week titration tirzepatide chart shows shaded variability band labelled "modeled estimate, individual variation 30–40%", not single line; Y-axis carries no measurement-grade units (no ng/mL) | Band: MedLevelChart.tsx:43-128 (4 bound datasets, fill '+1'). DOM caption `Estimate · ~30% inter-individual variation` (close to the literal SC#1 phrasing; CONTEXT D-06 explicitly relabels this to a fixed "~30%" wording — accepted deviation per phase decisions). Y-axis: `text: PK_DISCLAIMER_Y_AXIS` at line 159 = `'Estimate · arbitrary units'` (no ng/mL, no mg literal). | **COVERED** |
| **SC#2** | Vitest corpus reproduces published mean ± SD steady-state within ±15% for semaglutide, tirzepatide, liraglutide; CI fails on regression | pharmacology-corpus.ts has 5 entries (D-03 widens beyond literal 3 to also include dulaglutide + retatrutide). pharmacology.test.ts asserts `expect(avg).toBeGreaterThanOrEqual(entry.lowerBoundMg)` + `toBeLessThanOrEqual(entry.upperBoundMg)` per row. Vitest run: 5 drug-class tests pass; CI Phase 1 wired blocks merge on failure. | **COVERED** |
| **SC#3** | Insights refusal-list 50+ adversarial state shapes; output never contains "increase", "decrease", "double", or "skip" in dose-change context | insights-refusal.test.ts: 25 REFUSE + 25 PASS = 50 base + CR-01 multi-occurrence regression + CR-02 7-row clinical verb corpus + scrubInsights + corpus shape = 55+ adversarial inputs. All test names visible in vitest run; suite passes. | **COVERED** |
| **SC#4** | Chart-overlaid disclaimer visible on every MedLevelChart render AND included in printed DoctorReport PDF | Chart: medLevelWatermarkPlugin painted via afterDraw on every Chart.js render (per-instance, NOT global registered → scope preserved per D-14). PDF: DoctorReport aside present with PK_DISCLAIMER_DOCTOR_REPORT + `print:border-black`. RTL test `DoctorReport.test.tsx` asserts presence. | **COVERED** |
| **SC#5** | Saved injection records pkEngineVersion: 1 so future v1.1 two-compartment upgrade is retroactively applicable | Injection interface includes `pkEngineVersion?: number`. STORAGE_VERSION = 6. Migrate handler back-stamps existing injections; addInjection stamps new writes. storage.test.ts covers v5→v6 idempotent back-stamp, v4→v6 chained transform (BOTH disclaimer reset + pk stamp), v3→v6 bootstrap stamping (CR-03 regression), and addInjection explicit-value preservation. | **COVERED** |

**Score: 5/5 success criteria COVERED.**

---

## CONTEXT Decision Code-Impact Table

| Decision | Code Consequence | Status |
| -------- | ---------------- | ------ |
| **D-01** | Ship 1-compartment model unchanged | pharmacology.ts:calcMedLevel unchanged; CORPUS bounds derived for 1-compartment math. **COVERED** |
| **D-02** | 2-comp deferred to v1.1, addressed via pkEngineVersion | Field added; back-stamp covers existing records (PK-05). **COVERED** |
| **D-03** | 5 drug classes (sema/tirz/lira/dulag/retat) | pharmacology-corpus.ts:47-125 has all 5 rows in stated order. **COVERED** |
| **D-04** | Corpus lives at src/lib/pharmacology-corpus.ts with DOI/FDA citations | File exists with citations grep-visible. **COVERED** |
| **D-05** | ~15-stem regex with med-noun context guard; 50+ adversarial corpus including false-positive bait | STEM_PATTERN expanded (post-CR-02) to 24 stems; MED_NOUNS Set; 25+25 corpus + CR extensions. **COVERED** |
| **D-06** | Per-drug-class CV%; fixed UI label "~30% inter-individual variation" | CV_BY_DRUG_CLASS exported; MedLevelChart uses `CV_BY_DRUG_CLASS[trialClass(...)] ?? 0.30`; caption rendered verbatim. **COVERED** |
| **D-07** | Injection.pkEngineVersion + STORAGE_VERSION v5→v6 + back-stamp migrate | All wired (PK-05 evidence above). **COVERED** |
| **D-08** | Replace Phase 2 watermark text in-place; plugin id `medLevelWatermark` → `medLevelWatermark-v2` | medLevelWatermarkPlugin.ts:39 id is `medLevelWatermark-v2`; WATERMARK_TEXT constant removed; two-line render from `@/lib/disclaimers`. MedLevelChart.tsx:149 uses `'medLevelWatermark-v2':` quoted plugin options key. **COVERED** |
| **D-09** | Update 02-06-SUMMARY.md + 02-HUMAN-UAT.md C10/C11 to quote new Phase 3 string | 02-06-SUMMARY.md:49 has supersession note + new strings + plugin id `medLevelWatermark-v2`. 02-HUMAN-UAT.md:81+83 has Phase 3 D-09 notes under C10/C11. **COVERED** |
| **D-10** | DoctorReport.tsx PDF must include same watermark text — researcher confirmed footer-aside path (DoctorReport does NOT embed canvas) | DoctorReport.tsx:51-58 inserts `<aside role="note">` with PK_DISCLAIMER_DOCTOR_REPORT verbatim. Print-survival class present. **COVERED** |
| **D-11** | External clinician sign-off deferred to Phase 7 | No clinician-review gate in Phase 3 artifacts; correctly deferred. **COVERED (deferred)** |

**11/11 CONTEXT decisions with code consequences land in the implementation.**

---

## Post-Fix Verification (Critical Review Findings)

### CR-01: `isDoseChangeAdvice` only walked first stem occurrence — second clause silently allowed

**Fix commit:** 8b682df
**Regression test commit:** 717ed3f

Verified at `src/lib/insights-refusal.ts:98-122` — the implementation walks EVERY token starting with the stem (`for (let idx = 0; idx < tokens.length; idx++)` at line 112) and returns true on any med-noun hit. The original buggy `tokens.findIndex(...)` pattern is gone.

Regression test at `insights-refusal.test.ts:96-110` asserts the adversarial input `"Increase your protein and increase your Ozempic dose tomorrow."` returns `true`. Test passes against committed code.

**Status: RESOLVED.**

### CR-02: Missing clinical dose-change verbs (discontinue/hold/pause/resume/withhold/...)

**Fix commit:** ac50823
**Regression test commit:** ca55368

Verified at `src/lib/insights-refusal.ts:42-43` — STEM_PATTERN now includes `discontinu|paus|hold|resum|withhold|add|cut|reduc` alongside the original stems. Per-call `new RegExp(...)` pattern preserved (no lastIndex leak).

Regression corpus at `insights-refusal.test.ts:128-134` (7+ rows): Discontinue/Hold/Pause/Resume/Withhold/Cut/Reduce — all REFUSE. PASS-corpus extensions ("Hold a plank", "Resume your strength routine", "Cut sugar"...) also present so the context-guard suppression is locked in.

**Status: RESOLVED.**

### CR-03: v3-bootstrap branch skipped v5→v6 pk-back-stamp transform

**Fix commit:** 4119dc6
**Regression test commit:** f70c135

Verified at `src/lib/store.ts:123-155` — the bootstrap branch now assigns to a `state` variable (NOT early-return) and falls through to both the `version <= 4` (line 139) and `version <= 5` (line 145) chained transforms. The parallel `hydrate()` function at line 320-349 also applies the same pk back-stamp via `stampedV3` (line 333-339).

Regression tests at `storage.test.ts:173-249` (3 cases): drives `migrateState(undefined, 3)` against a mocked v3 blob with 3 injections, asserts every record has `pkEngineVersion === 1` AND `acknowledgedDisclaimer === undefined` (so BOTH chained transforms ran).

**Status: RESOLVED.**

---

## Phase-Level Cross-Cutting Checks

| Check | Evidence | Status |
| ----- | -------- | ------ |
| Shared `src/lib/disclaimers.ts` imported by both MedLevelChart/watermarkPlugin AND DoctorReport (D-10 single source of truth) | medLevelWatermarkPlugin.ts:23 imports LINE_1+LINE_2; MedLevelChart.tsx:4 imports BAND_CAPTION+Y_AXIS; DoctorReport.tsx:6 imports DOCTOR_REPORT. **COVERED** | ✓ |
| Phase 2's 02-06-SUMMARY.md + 02-HUMAN-UAT.md quote new Phase 3 watermark string (D-09) | Phase 3 D-09 notes at 02-06-SUMMARY.md:49 + 02-HUMAN-UAT.md:81,83. **COVERED** | ✓ |
| STORAGE_VERSION bumped to 6 with backward-compatible migration | storage.ts:31 = 6; chained `version <= N` migrate (NOT `===`); v3/v4/v5→v6 all back-stamp. **COVERED** | ✓ |
| Test suite passes | `npx vitest run` → **177 passed (177)** across 14 test files. **COVERED** | ✓ |
| TypeScript build clean | `npx tsc -p tsconfig.app.json --noEmit` exits 0 (no output). **COVERED** | ✓ |
| Per-instance watermark plugin discipline preserved (D-15 — never globally registered) | medLevelWatermarkPlugin.ts not in any `Chart.register(...)` call; only used via `plugins: [medLevelWatermarkPlugin]` per-instance at MedLevelChart.tsx:166. **COVERED** | ✓ |
| Em-dash U+2014 byte verification still passes | medLevelWatermarkPlugin.test.ts:37-39 `expect(PK_DISCLAIMER_LINE_2.charCodeAt(0)).toBe(0x2014)` passes. **COVERED** | ✓ |
| Refusal list wired in BOTH generateInsights AND pickFocus | insights.ts:155 (`return scrubInsights(out)`); insights.ts:182-183 (`guard` applied to all 5 branch results + welcome state via `return guard({ ... })`). **COVERED** | ✓ |

---

## Anti-Pattern Scan

| File | Pattern | Severity | Disposition |
| ---- | ------- | -------- | ----------- |
| insights.ts | `s.workouts[0]`, `s.injections[0]`, `s.mood.slice(-7)` assume insertion-order=date-order | ⚠️ Warning (WR-01 from REVIEW.md) | Pre-existing in this phase's modified code; flagged in REVIEW.md as warning, not blocker — does NOT affect refusal-list correctness or Phase 3 goal. Defer to a follow-up cleanup. |
| DoctorReport.tsx, MedLevelChart.tsx | `useStore((s) => s.user!)` non-null bang assertion | ⚠️ Warning (WR-02 from REVIEW.md) | Pre-existing crash vector documented in REVIEW.md. Does NOT affect Phase 3 PK goal. Defer. |
| store.ts hydrate() | Double `useStore.persist.rehydrate()` call on v3 path | ⚠️ Warning (WR-03 from REVIEW.md) | Pre-existing; flagged warning, not blocker. CR-03 fix added stamping but did NOT remove the redundant call. Defer to follow-up. |
| pharmacology.test.ts | Left-endpoint Riemann sum bias | ℹ️ Info (WR-05 from REVIEW.md) | Bias <3% well inside ±15% envelope; documented. No blocker. |

No anti-patterns rise to BLOCKER severity. All warnings are pre-existing/orthogonal to Phase 3 PK goals.

---

## Outstanding Gaps

**None blocking.**

Three human-verification items (visual band rendering, dark-theme watermark contrast, print-preview fidelity) are spot-checks recommended after merge but not blockers — see frontmatter `human_verification:` section. The phase goal ("defensible curve + insights, verified before any audience external to the patient sees it") is **observable in committed code**: every PK constant cites a peer-reviewed source, automated tests reproduce published steady-state within ±15%, the chart datasets render a band when `injections.length > 0`, the watermark plugin paints two lines on every afterDraw, the refusal list structurally filters insights, and `pkEngineVersion: 1` stamps every persisted injection (new or migrated).

---

## Final Verdict

**goal_achieved: TRUE**

Phase 3 is **defensibly complete**. All 5 PK requirements satisfied, all 5 ROADMAP success criteria observable in code, all 11 CONTEXT decisions with code consequences land, all 3 critical review findings carry passing regression tests, 177/177 Vitest tests green, TypeScript clean. Phase ready to mark `[x]` in ROADMAP and proceed to Phase 4 (Supabase Cloud Bootstrap + AI Proxy).

---

_Verified: 2026-05-11T12:36:50Z_
_Verifier: Claude (gsd-verifier, goal-backward methodology)_
_Test run: npx vitest run → 177 passed (177) in 3.17s_
_Typecheck: npx tsc -p tsconfig.app.json --noEmit → exit 0_
