# Phase 3: Pharmacology + Insights Hardening — Context

**Gathered:** 2026-05-11
**Status:** Ready for planning

<domain>
## Phase Boundary

The drug-level curve and rule-based insights become **defensible**: every PK constant cites a peer-reviewed source, an automated Vitest corpus reproduces published steady-state values within ±15% per drug class, the chart shows uncertainty as a shaded band (not a deterministic line), insights can never produce strings recommending dose changes, and saved injection data carries a `pkEngineVersion` field so a future v1.1 two-compartment upgrade can be applied retroactively without ambiguity.

The phase is verified before any audience external to the patient (doctor read-share Phase 8, clinic operator Phase 10) sees the curve. External clinician sign-off is **NOT** in scope — that's bundled with the legal-counsel-led work in Phase 7. Phase 3's "defensibility" floor is the test corpus + cited sources + visible chart disclaimer.

</domain>

<decisions>
## Implementation Decisions

### PK model fidelity (D-01)

- **D-01:** Ship v1 with the existing **1-compartment exponential-decay model** (`calcMedLevel` in `src/lib/pharmacology.ts`). The ±15% accuracy bar in SC#2 is **steady-state only** — after ~5 half-lives (4-5 weeks for sema/tirz) the 1-compartment and 2-compartment curves converge, so 1-comp is sufficient for SC#2's published-trial-comparison test. The early-titration absorption peak (first 24-72h) is not in scope for v1's accuracy claim.
- **D-02:** The 2-compartment upgrade is **deferred to v1.1**. SC#5's `pkEngineVersion: 1` field makes that upgrade retroactively applicable without data loss — see D-07.

### Drug scope and test corpus (D-03, D-04)

- **D-03:** **5 drug-classes get full peer-reviewed steady-state assertions** (broader than SC#2's literal 3): semaglutide, tirzepatide, liraglutide, **dulaglutide**, **retatrutide**. All 10 medications inherit a class via the existing `trialClass()` mapping in `pharmacology.ts:101-114`, so compounds (`compound-sema`, `compound-tirz`) and brand-name variants (Wegovy/Ozempic/Rybelsus → semaglutide; Mounjaro/Zepbound → tirzepatide; Saxenda → liraglutide; Trulicity → dulaglutide) are all covered.
- **D-04:** The test corpus lives at `src/lib/pharmacology-corpus.ts` (or `__tests__/` if convention dictates). Each drug-class entry includes: published mean ± SD steady-state value, source citation (DOI or FDA label URL), publication year, and the `±15%` predicate. Vitest assertions live in `pharmacology.test.ts`.

### Insights refusal-list (D-05)

- **D-05:** Refusal-list extends beyond SC#3's 4 explicit words to a **~15-stem regex** covering: `increase`, `decrease`, `raise`, `lower`, `double`, `halve`, `skip`, `stop`, `start`, `taper`, `ramp`, `escalate`, `de-escalate`, `bump`, `more`, `less`. A **context-guard** allows non-medication contexts to pass (`increase your protein`, `lower your stress`) by requiring proximity (within 5 tokens) to a medication-related noun: `dose`, `mg`, `unit`, `injection`, `Ozempic`, `Wegovy`, `Mounjaro`, `Zepbound`, `Rybelsus`, `Saxenda`, `Trulicity`, `Retatrutide`, `semaglutide`, `tirzepatide`, etc. The 50+ adversarial test corpus in SC#3 includes both true-positives (phrases that MUST trigger refusal) and intentional false-positive bait (phrases that MUST NOT trigger).

### Uncertainty band representation (D-06)

- **D-06:** Per-drug-class **CV%** from cited sources drives the band width (semaglutide ~25% CV, tirzepatide ~20%, liraglutide ~30%, etc — exact values populated by researcher). UI label is **fixed** at "Estimate · ~30% inter-individual variation" (rounded honest number; doesn't lie about per-drug variance, doesn't overload the user with class-by-class tooltips). Implemented as a Chart.js `fill` between two line datasets (upper bound = mean × (1 + CV), lower bound = mean × (1 − CV)).

### Chart watermark coordination (D-08, D-09)

- **D-08:** **Replace** Phase 2's `medLevelWatermarkPlugin.ts` text in-place — change `'Estimate — not medical advice'` to `'estimate, not measured serum level — based on population pharmacokinetics'`. Single source of truth; no second overlay; Phase 3's longer text is a strict superset of Phase 2's intent. Bump the plugin id from `medLevelWatermark` to `medLevelWatermark-v2` for any internal cache busting (Chart.js plugin id is also the registry key).
- **D-09:** Update Phase 2's `02-06-SUMMARY.md` cross-reference + `02-HUMAN-UAT.md` C10/C11 expected text to match Phase 3's longer string. The em-dash byte-verification check from `02-06-PLAN.md` still applies.
- **D-10:** `DoctorReport.tsx` PDF must include the same watermark text — implementation depends on whether `DoctorReport` renders the chart canvas directly into the PDF (in which case the canvas plugin's watermark survives automatically) or builds a separate PDF chart (in which case a footer-style disclaimer string is added). Phase researcher should read `DoctorReport.tsx` to determine which.

### Migration story for `pkEngineVersion` (D-07)

- **D-07:** Add a `pkEngineVersion: number` field to the persisted `Injection` interface (`src/types/index.ts`). Storage version bumps **v5 → v6** (parallels Phase 2's v4 → v5). The `migrate` handler in `storage.ts` back-stamps **all existing injections** to `pkEngineVersion: 1` on first read. New injections stamp `1` on write. Future v1.1 will check `pkEngineVersion: 1` records and re-compute curves under the 2-compartment engine without ambiguity about "was this stored under the old model?".

### External sign-off (D-11)

- **D-11:** **Deferred to Phase 7** (legal-counsel-led compliance bundle). Phase 3's "defensibility" floor is the automated test corpus + cited sources + visible chart disclaimer. No clinician review gate before merge; that's a Phase 7 milestone item.

### Claude's Discretion

- Test file structure (one `pharmacology.test.ts` vs split into `pharmacology-pk.test.ts` + `pharmacology-corpus.test.ts`) — planner picks per existing test conventions.
- Per-drug-class CV% exact numbers — researcher pulls from cited sources; no need to pre-decide the digits.
- Adversarial test corpus authoring style (one big array vs grouped by attack pattern) — planner discretion.
- `medLevelWatermarkPlugin` font size adjustment for the longer Phase 3 text (the existing 45° diagonal placement was sized for the shorter Phase 2 string — may need to shrink slightly) — planner / implementer discretion at first build measurement.

</decisions>

<specifics>
## Specific Ideas

- The Chart.js fill-between-bounds pattern is documented at https://www.chartjs.org/docs/latest/charts/line.html#stepped — `fill: '+1'` or `fill: { target: '+1', above: 'rgba(...)' }`.
- Schneck 2024 (cited in REQUIREMENTS PK-01) is the canonical tirzepatide pop-PK reference — DOI 10.1002/cpt.3329 (Clinical Pharmacology & Therapeutics, doi resolves to a paywalled article; abstract has the steady-state numbers).
- FDA Clinical Pharmacology reviews live at fda.gov drug approval pages — for example, Ozempic's review at https://www.accessdata.fda.gov/drugsatfda_docs/nda/2017/209637Orig1s000ClinPharmR.pdf — researcher should pull the equivalent for tirzepatide (Mounjaro), liraglutide (Saxenda), dulaglutide (Trulicity).
- Retatrutide is investigational as of 2026-05; cite Jastreboff 2023 NEJM Phase 2 weight-loss trial (DOI 10.1056/NEJMoa2301972) for the steady-state value.
- Existing `TRIAL_DATA` in `pharmacology.ts:63-98` already has weight-loss percentages per week — those are OUTCOME values, not PK serum-level values. Phase 3's corpus needs serum-level steady-state from the cited PK sources, not weight-loss outcomes.

</specifics>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Source-of-truth for PK constants

- `src/lib/pharmacology.ts` — current `HALF_LIVES`, `TITRATION`, `TRIAL_DATA`, `calcMedLevel`. Phase 3 adds the test corpus + uncertainty band + `pkEngineVersion` plumbing. Constants are NOT changing values; Phase 3 just adds citations + tests.
- `src/types/index.ts` — `Injection` interface (line 60+). Phase 3 adds `pkEngineVersion?: number` field.
- `src/lib/storage.ts` — current `STORAGE_VERSION = 5` (Phase 2). Phase 3 bumps to 6 and adds the v5→v6 migrate handler.
- `src/lib/insights.ts` — `generateInsights`, `pickFocus`. Phase 3 adds the refusal-list test corpus targeting these.

### Phase 2 cross-references that Phase 3 must update

- `.planning/phases/02-visible-compliance-public-deploy/02-06-SUMMARY.md` — watermark plugin documentation; D-09 instructs to update the recorded watermark text.
- `.planning/phases/02-visible-compliance-public-deploy/02-HUMAN-UAT.md` C10 / C11 — expected watermark text; update to Phase 3's longer string.
- `src/components/dashboard/charts/medLevelWatermarkPlugin.ts` — Phase 2 file. D-08 changes the painted text; plugin id bumps to v2.

### MedLevelChart consumers (curve rendering)

- `src/components/dashboard/charts/MedLevelChart.tsx` — primary chart. Add upper/lower bound datasets + `fill` config for D-06.
- `src/components/dashboard/cards/GLPCurveCard.tsx` — wraps MedLevelChart on Home tab.
- `src/components/dashboard/tabs/MedicationTab.tsx` — second mounting site.
- `src/components/dashboard/modals/DoctorReport.tsx` — PDF export site; D-10's chart-vs-footer disclaimer decision lives here.

### REQUIREMENTS coverage

- `.planning/REQUIREMENTS.md` PK-01 through PK-05 — all 5 covered by D-01..D-11.
- `.planning/REQUIREMENTS.md` cites Schneck 2024 + FDA Clinical Pharmacology reviews as authoritative — researcher MUST pull these as primary sources.

### Prior-phase artifacts the planner should consult

- `.planning/phases/01-quality-gates-observability-foundation/01-CONTEXT.md` — D-12 (Sentry error coverage) — Phase 3's PK refusal-list test failures should NOT page Sentry (test-only).
- `.planning/phases/02-visible-compliance-public-deploy/02-CONTEXT.md` — D-13/D-14/D-15 (watermark scope, chart-only, afterDraw plugin) — Phase 3's watermark change must respect these constraints (still chart-only, still per-instance, still afterDraw).

</canonical_refs>

<deferred>
## Deferred Ideas

- **2-compartment PK upgrade** — moved to v1.1. SC#5's `pkEngineVersion: 1` field makes the upgrade retroactive.
- **External clinician sign-off / clinical advisory board** — moved to Phase 7 (legal-counsel-led compliance bundle).
- **Real-time PK simulator UI** ("what if I delay my dose by 24h?") — out of v1 scope; would belong in a "patient education" phase if proposed.
- **Drug-drug interaction warnings** (e.g., GLP-1 + insulin co-administration) — out of v1 scope; clinically heavy; would belong in a separate compliance/safety phase.
- **Per-drug "experimental" UI badge** — not needed since D-03 maps all 10 medications to a class with a published reference.
- **Renal/hepatic dose-adjustment recommendations** — out of v1 scope (would push us toward "medical advice" classification).

</deferred>

---

*Phase: 03-pharmacology-insights-hardening*
*Context gathered: 2026-05-11 via /gsd-discuss-phase 3*
*Decisions: 11 locked; 4 left to Claude's discretion*
*Next step: /gsd-plan-phase 3 (will spawn researcher → planner → plan-checker)*
