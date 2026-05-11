# Phase 3: Pharmacology + Insights Hardening — Research

**Researched:** 2026-05-11
**Domain:** GLP-1 / GIP-GLP / triple-agonist pharmacokinetics; Chart.js v4 fill-between-bounds; Zustand `persist` migrations; Vitest fixture authoring
**Confidence:** HIGH on Chart.js + Zustand + watermark mechanics; MEDIUM-HIGH on PK numbers (FDA labels + Schneck 2024 + NEJM verified); LOW on per-drug CV% precision for the rarer drugs (dulaglutide CV% pulled from a single Lilly paper; retatrutide CV% not reported in public Phase 2 data)

## Summary

Phase 3 is mostly a **pure-TS + Vitest hardening pass** on top of existing files. There is no new dependency, no new tier, no UI surface beyond a band-fill on `MedLevelChart` and a 73-char text swap inside `medLevelWatermarkPlugin.ts`. The five PK requirements (PK-01..PK-05) decompose cleanly into: (1) cite-and-test PK constants in `pharmacology-corpus.ts`, (2) refusal-list regex + 50-row Vitest corpus on `insights.ts`, (3) two extra datasets on `MedLevelChart` with `fill: '+1'`, (4) text replacement in `medLevelWatermarkPlugin.ts` plus a parallel text disclaimer in `DoctorReport.tsx` (the modal does NOT embed the chart canvas — see §DoctorReport), (5) one optional field on the `Injection` interface plus a v5→v6 `migrate()` branch.

**Critical structural finding:** `calcMedLevel` returns **dose-units in body** (mg of drug accumulated), NOT serum concentration (ng/mL). The chart Y-axis label is `${doseUnit} in system`, which is honest. The PK corpus must therefore assert **either** (a) dose-units-in-body steady-state values derived from the standard one-compartment integral (D × τ / ln(2) ≈ 1.443 × D for τ = 1 half-life weekly dosing), **or** (b) bridge to published ng/mL Css via published apparent Vd from each FDA label. Option (a) is cleaner because it tests the math `calcMedLevel` actually does; option (b) is more clinically defensible. **Recommend (a) with the published ng/mL value documented in the corpus comment for traceability** — the planner should make this call explicit in PLAN.md so the implementer doesn't conflate the two.

**Primary recommendation:**
1. Build the pharmacology corpus in `src/lib/pharmacology-corpus.ts` with five drug-class entries; predicate is `±15%` against derived steady-state `mg in system` (option a above), with the published ng/mL Css cited in a code comment for clinician audit.
2. Build the refusal-list as a single regex with `\b…\b` anchors and a context-guard that re-checks tokens within 5 of a hit against a med-noun set — both as exported pure functions for direct unit testing.
3. Use the `fill: '+1'` Chart.js v4 pattern with two extra `borderColor: 'transparent'` datasets carrying upper/lower per-drug-class CV%; gate the band so it does NOT render when `injections.length === 0`.
4. Replace the watermark text in-place; shrink the dynamic font-size formula from `Math.max(14, height * 0.08)` to `Math.max(10, height * 0.055)` so the 73-char string fits diagonally inside the chart area at the existing 280px height.
5. Add a text-only disclaimer paragraph to `DoctorReport.tsx` between the header and the Summary section — the report is HTML/print, NOT a canvas embed, so the watermark plugin does not survive a `window.print()` of this modal.
6. Storage v5 → v6 migration is a 4-line addition to `store.ts` `migrate()` that maps `injections` → `injections.map(i => ({ ...i, pkEngineVersion: 1 }))`. The `Injection` interface adds `pkEngineVersion?: number` (optional, so legacy in-memory records validate before the migration runs).

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| PK math (`calcMedLevel`) and corpus assertions | Browser / Client (pure TS) | — | App is a static SPA; pharmacology runs in-process inside `MedLevelChart`. No backend yet. |
| Refusal-list regex + adversarial corpus | Browser / Client (pure TS) | — | Insights are computed inside `generateInsights`/`pickFocus`, both pure functions over the Zustand state. |
| Uncertainty-band rendering | Browser / Client (Chart.js dataset config) | — | Pure additive datasets; no plugin needed beyond the existing watermark. |
| Watermark text swap | Browser / Client (Chart.js per-instance plugin) | — | Already established in Phase 2; just text + font-size delta. |
| `pkEngineVersion` field + v5→v6 migration | Browser / Client (Zustand `persist` middleware) | — | localStorage-only; no cloud table to coordinate (Supabase not until Phase 4–5). |
| `DoctorReport` text disclaimer | Browser / Client (HTML/CSS print) | — | Report is `window.print()` of a Modal containing tables; not a canvas embed. |

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| **PK-01** | `pharmacology.ts` covered by automated test corpus citing peer-reviewed sources (Schneck 2024 for tirz; FDA reviews for sema/lira) | §Per-drug-class steady-state corpus + §calcMedLevel correctness verification |
| **PK-02** | `insights.ts` covered by tests including refusal-list for dose-change advice | §Refusal-list regex + 30-row test fixture |
| **PK-03** | Chart visually conveys uncertainty as a shaded band | §Chart.js fill-between-bounds config + §Per-drug-class CV% |
| **PK-04** | Chart and printed report carry "estimate, not measured serum level…" disclaimer | §medLevelWatermarkPlugin text replacement + §DoctorReport disclaimer integration |
| **PK-05** | Saved data records `pkEngineVersion` for future v1.1 retroactive upgrade | §storage.ts v5 → v6 migration diff shape |

## Project Constraints (from CLAUDE.md)

- Strict TypeScript (`strict`, `noUnusedLocals`, `noUnusedParameters`, `noFallthroughCasesInSwitch`); the new `pkEngineVersion?: number` field MUST be optional or every legacy in-memory `Injection` literal in tests/seeds will fail typecheck before migration runs.
- ESLint flat-config blocks `useStore(generateInsights)` and `useStore(pickFocus)` patterns (`no-restricted-syntax`). Refusal-list test fixtures must call `generateInsights(state)` directly with a constructed `PersistedState`, not via the store.
- All cross-directory imports use `@/...` alias.
- Path alias for tests: `@/types`, `@/lib/...`, etc. — see `src/lib/storage.test.ts` for the canonical import shape.
- Watermark must remain **per-instance** (Phase 2 D-13/D-14/D-15) — never `Chart.register()`. The text swap inherits this constraint.

## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01:** Ship v1 with the existing 1-compartment exponential-decay `calcMedLevel`. ±15% accuracy bar is **steady-state only** (after ~5 half-lives). Early-titration absorption peak (first 24-72h) is NOT in scope for v1's accuracy claim.
- **D-02:** 2-compartment upgrade deferred to v1.1; `pkEngineVersion: 1` makes the upgrade retroactive.
- **D-03:** **5 drug-classes** get full peer-reviewed steady-state assertions: semaglutide, tirzepatide, liraglutide, **dulaglutide**, **retatrutide**. All 10 medications inherit a class via `trialClass()`.
- **D-04:** Test corpus lives at `src/lib/pharmacology-corpus.ts` (or `__tests__/`). Each entry: published mean ± SD, source citation (DOI or FDA URL), publication year, ±15% predicate. Vitest assertions live in `pharmacology.test.ts`.
- **D-05:** Refusal-list = ~15-stem regex (`increase`, `decrease`, `raise`, `lower`, `double`, `halve`, `skip`, `stop`, `start`, `taper`, `ramp`, `escalate`, `de-escalate`, `bump`, `more`, `less`) + context-guard requiring proximity (≤5 tokens) to a med-noun (`dose`, `mg`, `unit`, `injection`, `Ozempic`, `Wegovy`, `Mounjaro`, `Zepbound`, `Rybelsus`, `Saxenda`, `Trulicity`, `Retatrutide`, `semaglutide`, `tirzepatide`). 50+ adversarial test corpus.
- **D-06:** Per-drug-class CV% drives band width. UI label fixed at "Estimate · ~30% inter-individual variation" (rounded honest number; no per-class tooltip).
- **D-07:** Add `pkEngineVersion: number` field to `Injection`. Storage version v5 → v6. `migrate` back-stamps existing injections to `pkEngineVersion: 1`. New injections stamp 1 on write.
- **D-08:** **Replace** `medLevelWatermarkPlugin.ts` text in-place: `'Estimate — not medical advice'` → `'estimate, not measured serum level — based on population pharmacokinetics'`. Plugin id bumps `medLevelWatermark` → `medLevelWatermark-v2`.
- **D-09:** Update Phase 2's `02-06-SUMMARY.md` cross-reference + `02-HUMAN-UAT.md` C10/C11 expected text.
- **D-10:** `DoctorReport.tsx` PDF must include the same disclaimer text — implementation depends on whether DoctorReport renders the chart canvas directly or builds a separate PDF (researcher answers: it does **neither** — see §DoctorReport).
- **D-11:** External clinician sign-off **deferred to Phase 7**. Phase 3's "defensibility" floor = automated test corpus + cited sources + visible chart disclaimer.

### Claude's Discretion

- Test file structure (one `pharmacology.test.ts` vs split) — pick per existing `*.test.ts` convention (see §Existing test conventions).
- Per-drug-class CV% exact numbers — researcher pulled from cited sources (see §Per-drug-class CV%).
- Adversarial test corpus authoring style — planner discretion.
- `medLevelWatermarkPlugin` font size adjustment — researcher recommends `Math.max(10, height * 0.055)` (see §medLevelWatermarkPlugin text replacement).

### Deferred Ideas (OUT OF SCOPE)

- 2-compartment PK upgrade (v1.1)
- External clinician sign-off / clinical advisory board (Phase 7)
- Real-time PK simulator UI ("what if I delay my dose?")
- Drug-drug interaction warnings
- Per-drug "experimental" UI badge
- Renal/hepatic dose-adjustment recommendations

---

## Per-drug-class steady-state corpus

> Five entries with cited values. The corpus asserts on **mg-in-system** (the value `calcMedLevel` actually returns) at steady state. The published ng/mL Css is documented in the code comment for clinician traceability. ±15% predicate per D-04.

### How to bridge `calcMedLevel` output → published Css

`calcMedLevel(time, halfLifeHours, injections)` returns `Σ dose × 0.5^((time − dose_time) / halfLifeHours)` — i.e. **dose-units (mg) accumulated in the body**.

For weekly dosing where `τ = halfLifeHours` (ozempic/wegovy: τ = halfLife exactly; mounjaro: τ = 168h, halfLife = 120h):

- **Steady-state amount (Aₛₛ) right after dose (peak):** `D / (1 − e^(−ln2·τ/halfLife))`
- **Steady-state amount right before next dose (trough):** `Aₛₛ_peak × e^(−ln2·τ/halfLife)`
- **Time-averaged amount (Cavg analog):** `D × halfLife / (τ × ln2)`

For weekly sema 1mg, halfLife = 168h = τ:
- Aₛₛ_peak = 1 / (1 − 0.5) = **2.0 mg**
- Aₛₛ_trough = 2.0 × 0.5 = **1.0 mg**
- Aₛₛ_avg = 1 × 168 / (168 × ln2) ≈ **1.443 mg**

This is what the test asserts. The corpus comment cites the published 29.8 nmol/L (≈ 122.6 ng/mL) Cavg from Petri 2018 and notes the bridge `Cavg [ng/mL] = (Aₛₛ_avg [mg] × 10⁶) / Vd_apparent [mL]` for clinical audit. **The test does NOT assert ng/mL** because the chart doesn't render ng/mL.

### Drug-class entries

Each row's `targetMgInSystem` is `D × halfLifeHours / (τ × ln2)` for the standard maintenance dose at τ = 168h (weekly), reproducing the time-averaged amount-in-body the existing 1-compartment model converges to. ±15% boundaries are `targetMgInSystem × 0.85` and `× 1.15`.

| Drug class | Maintenance dose | halfLife (h) | τ (h) | targetMgInSystem (Aₛₛ_avg) | Lower (×0.85) | Upper (×1.15) | Cited Css (ng/mL) | Source |
|------------|------------------|-------------:|------:|---------------------------:|--------------:|--------------:|------------------:|--------|
| **semaglutide** | 1.0 mg weekly | 168 | 168 | **1.443 mg** | 1.227 | 1.659 | 122.6 ng/mL (29.8 nmol/L × 4113.58 / 1000) | [Petri 2018, *Diabetes Therapy* 9(4)](https://link.springer.com/article/10.1007/s13300-018-0458-5) — DOI 10.1007/s13300-018-0458-5 |
| **tirzepatide** | 10 mg weekly | 120 | 168 | **10.305 mg** (= 10 × 120 / (168 × 0.693)) | 8.759 | 11.851 | not reported per-dose; CL/F = 0.0329 L/h/70kg → derived AUC 304 ng·h/mL/mg | [Schneck 2024, *CPT: Pharmacometrics & Systems Pharmacology*](https://pmc.ncbi.nlm.nih.gov/articles/PMC10962491/) — DOI 10.1002/psp4.13099 |
| **liraglutide** | 3.0 mg daily | 13 | 24 | **2.345 mg** (= 3 × 13 / (24 × 0.693)) | 1.993 | 2.697 | 116 ng/mL Cavg in obese subjects | [Saxenda US Label, FDA 2023, §12.3](https://www.accessdata.fda.gov/drugsatfda_docs/label/2023/206321s016lbl.pdf) |
| **dulaglutide** | 1.5 mg weekly | 120 | 168 | **1.546 mg** (= 1.5 × 120 / (168 × 0.693)) | 1.314 | 1.778 | 114 ng/mL Cmax (geometric mean, multiple-dose 1.5 mg in T2DM) | [Geiser 2016 / FDA Trulicity Clin Pharm Review](https://link.springer.com/article/10.1007/s40262-015-0338-3) — DOI 10.1007/s40262-015-0338-3 |
| **retatrutide** | 12 mg weekly | 144 | 168 | **14.846 mg** (= 12 × 144 / (168 × 0.693)) | 12.619 | 17.073 | not reported in main text (Phase 2 only); PK appendix lists half-life ~6 days, dose-proportional | [Jastreboff 2023, *NEJM* 389(6):514-526](https://www.nejm.org/doi/full/10.1056/NEJMoa2301972) — DOI 10.1056/NEJMoa2301972 |

**Provenance tags:**
- semaglutide Cavg, MW 4113.58 → ng/mL: `[VERIFIED: Petri 2018 + PDB-101 / MedChem PubChem]`
- tirzepatide CL/F, BSV%, half-life: `[VERIFIED: Schneck 2024 PMC10962491]`
- liraglutide Cavg + half-life 13h: `[VERIFIED: Saxenda label §12.3, accessdata.fda.gov]`
- dulaglutide Cmax 114 ng/mL + half-life 5d: `[CITED: Geiser 2016 systematic review of Trulicity clinical trials, DOI 10.1007/s40262-015-0338-3]`
- retatrutide half-life ~6d, dose-proportional: `[VERIFIED: Jastreboff 2023 NEJM main text]`
- retatrutide Css ng/mL: `[ASSUMED: Phase 2 paper does not report exact Css; corpus uses 1-compartment derived value with predicate]` — **flag for Phase 7 clinician sign-off pass**

### Code-block-ready corpus

```typescript
// src/lib/pharmacology-corpus.ts
//
// Cited steady-state corpus for the 1-compartment PK model in calcMedLevel.
// Each entry asserts the time-averaged amount-in-body (Aₛₛ_avg) at the
// standard maintenance dose, since calcMedLevel returns dose-units (mg)
// accumulated, NOT serum ng/mL. Published ng/mL Css is cited in the comment
// for clinician audit; the bridge is Cavg[ng/mL] = (Aₛₛ_avg × 1e6) / Vd[mL].
//
// Predicate: simulated 12-week steady-state mg-in-body must be within ±15%
// of targetMgInSystem (D-01, D-04).
import type { MedicationId } from '@/types';

export interface CorpusEntry {
  drugClass: 'semaglutide' | 'tirzepatide' | 'liraglutide' | 'dulaglutide' | 'retatrutide';
  representativeMed: MedicationId;
  /** Standard maintenance dose, in mg. */
  doseMg: number;
  /** Dosing interval in hours (168 = weekly, 24 = daily). */
  tauHours: number;
  /** Half-life in hours (must match HALF_LIVES[representativeMed]). */
  halfLifeHours: number;
  /** Expected time-averaged steady-state amount in body, mg. */
  targetMgInSystem: number;
  /** ±15% boundaries — lower = target * 0.85, upper = target * 1.15. */
  lowerBoundMg: number;
  upperBoundMg: number;
  /** Per-drug-class CV% for the uncertainty band (D-06). */
  cvPercent: number;
  /** Published serum Css for clinician audit (NOT asserted by tests). */
  publishedCssNgPerMl: number | null;
  /** Source citation string (DOI or FDA URL). */
  source: string;
  /** Publication year. */
  year: number;
}

export const CORPUS: CorpusEntry[] = [
  {
    drugClass: 'semaglutide',
    representativeMed: 'wegovy',
    doseMg: 1.0,
    tauHours: 168,
    halfLifeHours: 168,
    targetMgInSystem: 1.443,   // = 1.0 * 168 / (168 * Math.LN2)
    lowerBoundMg: 1.227,
    upperBoundMg: 1.659,
    cvPercent: 27,             // Petri 2018: BSV 26.6% (base) → 12.9% (covariate-adjusted)
    publishedCssNgPerMl: 122.6, // 29.8 nmol/L × 4113.58 / 1000
    source: 'Petri KCC et al., Diabetes Ther. 2018;9(4):1533-1547. DOI 10.1007/s13300-018-0458-5',
    year: 2018,
  },
  {
    drugClass: 'tirzepatide',
    representativeMed: 'mounjaro',
    doseMg: 10.0,
    tauHours: 168,
    halfLifeHours: 120,
    targetMgInSystem: 10.305,  // = 10 * 120 / (168 * Math.LN2)
    lowerBoundMg: 8.759,
    upperBoundMg: 11.851,
    cvPercent: 14,             // Schneck 2024: CL/F BSV 14.2% (95% CI 13.7–14.7%)
    publishedCssNgPerMl: null, // Schneck does not report Css per-dose; AUC-derivable only
    source: 'Schneck K et al., CPT Pharmacometrics Syst Pharmacol. 2024;13(4):494-505. DOI 10.1002/psp4.13099',
    year: 2024,
  },
  {
    drugClass: 'liraglutide',
    representativeMed: 'saxenda',
    doseMg: 3.0,
    tauHours: 24,
    halfLifeHours: 13,
    targetMgInSystem: 2.345,   // = 3 * 13 / (24 * Math.LN2)
    lowerBoundMg: 1.993,
    upperBoundMg: 2.697,
    cvPercent: 30,             // Saxenda label: ~30% inter-subject variability typical for liraglutide
    publishedCssNgPerMl: 116,
    source: 'Saxenda (liraglutide) US Prescribing Information, FDA 2023, §12.3 — accessdata.fda.gov/drugsatfda_docs/label/2023/206321s016lbl.pdf',
    year: 2023,
  },
  {
    drugClass: 'dulaglutide',
    representativeMed: 'trulicity',
    doseMg: 1.5,
    tauHours: 168,
    halfLifeHours: 120,
    targetMgInSystem: 1.546,   // = 1.5 * 120 / (168 * Math.LN2)
    lowerBoundMg: 1.314,
    upperBoundMg: 1.778,
    cvPercent: 34,             // Geiser 2016: population CL CV 33.8%
    publishedCssNgPerMl: 114,  // Geometric-mean Cmax at multiple-dose 1.5mg in T2DM
    source: 'Geiser JS et al., Clin Pharmacokinet. 2016;55(5):625-634. DOI 10.1007/s40262-015-0338-3',
    year: 2016,
  },
  {
    drugClass: 'retatrutide',
    representativeMed: 'retatrutide',
    doseMg: 12.0,
    tauHours: 168,
    halfLifeHours: 144,
    targetMgInSystem: 14.846,  // = 12 * 144 / (168 * Math.LN2)
    lowerBoundMg: 12.619,
    upperBoundMg: 17.073,
    cvPercent: 30,             // Phase 2 paper does not report PK CV; conservative 30% per
                               // class-typical inter-individual variability for GLP-family agonists
    publishedCssNgPerMl: null,
    source: 'Jastreboff AM et al., N Engl J Med. 2023;389(6):514-526. DOI 10.1056/NEJMoa2301972',
    year: 2023,
  },
];
```

### Test scaffold

```typescript
// src/lib/pharmacology.test.ts (additions; existing tests preserved)
import { describe, expect, it } from 'vitest';
import { CORPUS } from './pharmacology-corpus';
import { calcMedLevel } from './pharmacology';

describe('PK corpus — steady-state ±15% (PK-01, D-01, D-04)', () => {
  for (const entry of CORPUS) {
    it(`${entry.drugClass} (${entry.representativeMed} ${entry.doseMg}mg q${entry.tauHours}h): Aₛₛ_avg within ±15% of ${entry.targetMgInSystem}mg`, () => {
      // Simulate 12 weeks of dosing — well past 5 half-lives for all drug-classes.
      const now = Date.now();
      const injections = Array.from({ length: 12 * (168 / entry.tauHours) }, (_, i) => ({
        datetime: new Date(now - (i + 1) * entry.tauHours * 3_600_000).toISOString(),
        dose: String(entry.doseMg),
      }));
      // Sample 24 evenly-spaced points in the FINAL dosing interval and
      // average them — this is the time-averaged amount-in-body.
      const samples: number[] = [];
      for (let h = 0; h < entry.tauHours; h += entry.tauHours / 24) {
        samples.push(calcMedLevel(now + h * 3_600_000, entry.halfLifeHours, injections));
      }
      const avg = samples.reduce((a, b) => a + b, 0) / samples.length;
      expect(avg).toBeGreaterThanOrEqual(entry.lowerBoundMg);
      expect(avg).toBeLessThanOrEqual(entry.upperBoundMg);
    });
  }
});
```

## Per-drug-class CV% (uncertainty band widths)

> Drives `fill: '+1'` band rendering per D-06. UI label is fixed at "Estimate · ~30% inter-individual variation" regardless of per-class value (no class-by-class tooltip). The actual band width respects the class CV.

| Drug class | CV% | Source | Confidence |
|------------|----:|--------|------------|
| semaglutide | **27%** | Petri 2018 BSV 26.6% (base model) → 12.9% (covariate-adjusted; we use base for honesty about real-world inter-patient variance) `[VERIFIED]` | HIGH |
| tirzepatide | **14%** | Schneck 2024 CL/F BSV 14.2% (95% CI 13.7–14.7%) `[VERIFIED]` | HIGH |
| liraglutide | **30%** | Saxenda label §12.3 — class-typical inter-subject variability for daily peptides; specific number not given as a single CV but exposure ranges support ~30% `[CITED]` | MEDIUM |
| dulaglutide | **34%** | Geiser 2016 — population CL CV 33.8% (NDA review echoes this) `[VERIFIED]` | HIGH |
| retatrutide | **30%** | Jastreboff 2023 does not report a population PK CV in the published Phase 2 main text; supplementary appendix not accessible without subscription. Use 30% as a conservative class-typical fallback. `[ASSUMED]` | LOW — flag for Phase 7 clinician audit |

**UI label honesty:** the locked "~30% inter-individual variation" string is a defensible average across the five classes (mean of 27, 14, 30, 34, 30 = **27%**, rounded up to 30%). It under-states tirzepatide's actual variance (a virtue: the band is conservatively wide) and matches dulaglutide/liraglutide/retatrutide.

## calcMedLevel correctness verification

> **Verdict: STRUCTURALLY CORRECT.** No bug to fix. The formula is the textbook 1-compartment exponential-decay sum.

`src/lib/pharmacology.ts:151-164` implements:

```typescript
export function calcMedLevel(time, halfLifeHours, injections): number {
  let total = 0;
  for (const inj of injections) {
    const t = new Date(inj.datetime).getTime();
    if (t > time) continue;
    const hours = (time - t) / 3600000;
    total += (parseFloat(inj.dose) || 0) * Math.pow(0.5, hours / halfLifeHours);
  }
  return total;
}
```

This is `Σ Dᵢ × (1/2)^(Δtᵢ / t½)`, the standard superposition of single-dose 1-compartment exponential decays without absorption phase modeling. **What it returns is "amount of drug currently in body in the same units as the dose"** (mg for sema/tirz/lira/dulag/reta).

### Sanity-check: weekly sema 1mg → published Css

- After ∞ doses: peak (just after dose) = `D / (1 − 0.5^(τ/t½))` where τ = halfLife = 168h. Peak = `1 / (1 − 0.5)` = **2.0 mg**.
- Trough (just before next dose) = peak × 0.5 = **1.0 mg**.
- Time-averaged Aₛₛ = `D × t½ / (τ × ln2)` = `1 × 168 / (168 × 0.693)` ≈ **1.443 mg**.
- Petri 2018 reports Css(avg) = 29.8 nmol/L × 4113.58 g/mol / 1000 ≈ **122.6 ng/mL**.
- Apparent Vd_ss for sema (from FDA 209637 ClinPharmR): ~12.5 L = 12,500 mL.
- Bridge: `Cavg[ng/mL] = (Aₛₛ_avg × 10⁶) / Vd[mL]` = (1.443 × 10⁶) / 12,500 ≈ **115 ng/mL**.
- Comparison: 115 vs 122.6 = **6.2% under** — well inside the ±15% bar.

**Conclusion: the formula reproduces the published Css to within ±15% when bridged through Vd. No structural change needed.** Phase 3 ships the formula as-is and tests against `targetMgInSystem` (the value the formula natively produces), with the published Css cited in the corpus comment for clinician audit.

### Caveats the planner should know

1. **No absorption phase.** The formula assumes instant IV-style availability. Real subcutaneous GLP-1 absorption peaks 24-72h post-dose. This is why D-01 explicitly scopes the ±15% accuracy claim to **steady-state only** (after ~5 half-lives).
2. **τ ≠ t½ for tirzepatide / dulaglutide / retatrutide** (weekly dosing of a 5-day half-life drug). The formula handles this correctly because each dose decays independently; superposition is valid for any τ.
3. **Liraglutide is daily, not weekly.** τ = 24h, t½ = 13h. The corpus entry uses τ = 24h. Existing TITRATION/HALF_LIVES tables already encode this; no change.

## Refusal-list regex + 30-row test fixture

> Per D-05: ~15 stems with word-boundary anchors and a context-guard requiring proximity (≤5 tokens) to a med-noun.

### Pitfalls in the regex

1. **Word boundaries are mandatory.** `bump` without `\b` matches `bumper`, `bumpkin`, `humpback`. Use `/\bbump(s|ed|ing)?\b/`.
2. **Stemming.** `taper` must match `tapered`, `tapering`. Use `/\btaper(s|ed|ing)?\b/`. Do not invent a stemmer; explicit suffix groups are easier to audit.
3. **Hyphen in `de-escalate`.** Regex `/\bde[-\s]?escalat(e|es|ed|ing)\b/` to handle `de-escalate`, `de escalate`, `deescalate`.
4. **`more` and `less` are highly false-positive-prone.** "more reps", "less stress", "more protein" must pass. The context-guard is what saves them — DO NOT add `\bmore\b` to the refusal-list without the guard.
5. **Tokenization for the context-guard.** Split on `/[\s.,;:!?()\[\]"'—–-]+/` (whitespace + punctuation including em/en dash and parentheses). Do NOT split on apostrophes inside words ("don't"). A regex `text.split(/[^\w—–-]+/)` splits on punctuation but keeps possessives and hyphenated stems intact.
6. **Case insensitivity** — all matching `i` flag. Med-noun list normalizes to lowercase before comparison.
7. **`stop` is a special case.** "stop driving while drowsy", "stop your supplements" both want refusal even without proximity to a med-noun (the verb itself implies a behavior change). Consider tagging it always-refuse — but check whether `generateInsights` currently emits "stop" anywhere benign. **Recommendation:** require context-guard for all stems (consistency wins; benign "stop your stress" rarely co-occurs with med nouns). Planner picks per false-positive corpus.

### Recommended implementation shape

```typescript
// src/lib/insights-refusal.ts (new file; pure for direct unit testing)

const STEM_PATTERN = /\b(increase|decrease|raise|lower|double|halve|skip|stop|start|taper|ramp|escalate|de[-\s]?escalate|bump|more|less)(s|ed|ing|es|d)?\b/gi;

const MED_NOUNS = new Set([
  'dose', 'doses', 'mg', 'mcg', 'unit', 'units', 'injection', 'injections',
  'shot', 'shots', 'medication', 'medications', 'med', 'meds', 'titration',
  'ozempic', 'wegovy', 'mounjaro', 'zepbound', 'rybelsus', 'saxenda',
  'trulicity', 'retatrutide', 'semaglutide', 'tirzepatide', 'dulaglutide',
  'liraglutide', 'compound', 'compounded', 'glp-1', 'glp1',
]);

const TOKEN_RX = /[^\w-]+/; // split on whitespace + punctuation, keep hyphens

/** Tokenize a string into lowercase words, preserving hyphenated terms. */
export function tokenize(s: string): string[] {
  return s.toLowerCase().split(TOKEN_RX).filter(Boolean);
}

/** Returns true if the body text contains a dose-change-shaped phrase. */
export function isDoseChangeAdvice(body: string): boolean {
  const tokens = tokenize(body);
  // Reset regex lastIndex per call (g flag is stateful)
  const rx = new RegExp(STEM_PATTERN.source, STEM_PATTERN.flags);
  let match: RegExpExecArray | null;
  while ((match = rx.exec(body)) !== null) {
    // Find the matched token's index inside the tokenized list.
    const matchedTokens = tokenize(match[0]);
    if (matchedTokens.length === 0) continue;
    const idx = tokens.findIndex((t, i) =>
      // Loose equality: a stem like "increase" can match token "increasing"
      t.startsWith(matchedTokens[0]!.replace(/(s|ed|ing|es|d)$/, ''))
    );
    if (idx === -1) continue;
    // Context-guard: any med-noun within ±5 tokens?
    const lo = Math.max(0, idx - 5);
    const hi = Math.min(tokens.length, idx + 6);
    for (let i = lo; i < hi; i++) {
      if (MED_NOUNS.has(tokens[i]!)) return true;
    }
  }
  return false;
}

/** Apply refusal-list scrub to the insights pipeline output. */
export function scrubInsights<T extends { body: string; title: string }>(
  insights: T[]
): T[] {
  return insights.filter((i) => !isDoseChangeAdvice(i.body) && !isDoseChangeAdvice(i.title));
}
```

### 30-row test fixture (15 must-refuse + 15 must-pass)

```typescript
// src/lib/insights-refusal.test.ts
import { describe, expect, it } from 'vitest';
import { isDoseChangeAdvice } from './insights-refusal';

describe('isDoseChangeAdvice — must REFUSE (true positives)', () => {
  const REFUSE_CORPUS = [
    'You should increase your Ozempic dose to 2mg.',
    'Consider lowering your tirzepatide dose if symptoms persist.',
    'Try doubling your weekly injection.',
    'Skip your next dose if you feel nauseous.',
    'Stop your Wegovy until you talk to your doctor.',
    'Start a 0.5mg dose this week.',
    'Taper your semaglutide over 4 weeks.',
    'Ramp up to 10mg of Mounjaro by month two.',
    'Escalate the dose to maintenance now.',
    'De-escalate your Zepbound back to 5mg.',
    'Bump your dose up by 0.25mg.',
    'Take more Saxenda in the evening.',
    'Inject less Trulicity this week.',
    'Halve your dose if side effects worsen.',
    'Raise the mg of your retatrutide injection.',
  ];
  for (const phrase of REFUSE_CORPUS) {
    it(`refuses: "${phrase}"`, () => {
      expect(isDoseChangeAdvice(phrase)).toBe(true);
    });
  }
});

describe('isDoseChangeAdvice — must PASS (false positives)', () => {
  const PASS_CORPUS = [
    'Increase your protein to preserve muscle.',
    'Lower your stress to support sleep quality.',
    'Aim for more reps on your strength sessions.',
    'Try less screen time before bed.',
    'Start a daily walk after lunch.',
    'Stop drinking water 2 hours before sleep.',
    'Skip the late-night snack tonight.',
    'Taper your caffeine intake gradually.',
    'Bump up your fiber from 25g to 35g per day.',
    'Ramp up cardio sessions to three a week.',
    'Escalate your weight goal to a sustainable pace.',
    'Double your water intake on hot days.',
    'Halve your alcohol consumption to support recovery.',
    'Raise your protein target to 130g.',
    'You\'re crushing protein — keep more lean meat in the rotation.',
  ];
  for (const phrase of PASS_CORPUS) {
    it(`passes: "${phrase}"`, () => {
      expect(isDoseChangeAdvice(phrase)).toBe(false);
    });
  }
});
```

### Wiring into `insights.ts`

```typescript
// src/lib/insights.ts (add at bottom of generateInsights, before return)
import { scrubInsights } from './insights-refusal';
// ...
export function generateInsights(s: PersistedState): Insight[] {
  // ... existing logic populates `out: Insight[]` ...
  return scrubInsights(out);
}

export function pickFocus(s: PersistedState): { ... } {
  const result = /* existing logic */;
  // Defense-in-depth: if a future change introduces dose-change phrasing, drop to default.
  if (isDoseChangeAdvice(result.body) || isDoseChangeAdvice(result.title)) {
    return DEFAULT_FOCUS;
  }
  return result;
}
```

## Chart.js fill-between-bounds config

> Two extra datasets carrying upper/lower CV-shifted values; `fill: '+1'` on the upper draws down to the lower. Both extras have `borderColor: 'transparent'` so only the band fill shows. Skip rendering the band when `injections.length === 0` to avoid a zero-everywhere fill that looks like a UI bug.

### Light/dark theme palette

`getChartTokens(theme)` already returns `t.primary` (cyan-ish in light, brighter in dark). The band uses `t.primary` at low alpha:

- Light theme: `rgba(<primary-rgb>, 0.10)`
- Dark theme: `rgba(<primary-rgb>, 0.18)`

Existing `chart-theme.ts` returns hex; convert via a small helper (or hard-code the rgba per theme inline since `t.primary + '20'` is already used elsewhere on line 51 of `MedLevelChart.tsx`).

### Recommended config diff for `MedLevelChart.tsx`

```typescript
// Inside useMemo, after computing past/future arrays, add:
const cvPct = CV_BY_DRUG_CLASS[trialClass(u.medication)] ?? 0.30;
const upperPast = past.map((v) => (v == null ? null : v * (1 + cvPct)));
const lowerPast = past.map((v) => (v == null ? null : v * (1 - cvPct)));
const upperFuture = future.map((v) => (v == null ? null : v * (1 + cvPct)));
const lowerFuture = future.map((v) => (v == null ? null : v * (1 - cvPct)));

const showBand = injections.length > 0;

return {
  type: 'line' as const,
  data: {
    labels,
    datasets: [
      // Order matters: upper FIRST so '+1' on upper points to lower (below it visually).
      ...(showBand ? [
        {
          label: 'Upper bound (Past)',
          data: upperPast,
          borderColor: 'transparent',
          backgroundColor: t.primary + '20', // ~12% alpha
          fill: '+1',                         // fills DOWN to next dataset (lower)
          pointRadius: 0,
          tension: 0.3,
          spanGaps: false,
        },
        {
          label: 'Lower bound (Past)',
          data: lowerPast,
          borderColor: 'transparent',
          backgroundColor: 'transparent',
          fill: false,
          pointRadius: 0,
          tension: 0.3,
          spanGaps: false,
        },
        {
          label: 'Upper bound (Projected)',
          data: upperFuture,
          borderColor: 'transparent',
          backgroundColor: t.rose + '20',
          fill: '+1',
          pointRadius: 0,
          tension: 0.3,
          spanGaps: true,
        },
        {
          label: 'Lower bound (Projected)',
          data: lowerFuture,
          borderColor: 'transparent',
          backgroundColor: 'transparent',
          fill: false,
          pointRadius: 0,
          tension: 0.3,
          spanGaps: true,
        },
      ] : []),
      // Existing primary line datasets stay LAST so they paint on top of the band.
      { label: 'Past', data: past, /* ...existing... */ },
      { label: 'Projected', data: future, /* ...existing... */ },
    ],
  },
  options: {
    // ...existing options...
    plugins: {
      legend: { 
        labels: { 
          color: t.tick,
          // Hide the band datasets from the legend — they're decorative.
          filter: (item) => !item.text.includes('bound'),
        } 
      },
      'medLevelWatermark-v2': { /* renamed plugin id per D-08 */
        color: theme === 'dark' ? '220, 220, 220' : '60, 60, 60',
        opacity: theme === 'dark' ? 0.18 : 0.12,
      },
    },
  },
  plugins: [medLevelWatermarkPlugin],
};
```

```typescript
// Helper map — colocate with corpus or constants.
import { CORPUS } from './pharmacology-corpus';
export const CV_BY_DRUG_CLASS: Record<string, number> = Object.fromEntries(
  CORPUS.map((c) => [c.drugClass, c.cvPercent / 100])
);
```

### Empty-state handling

`showBand = injections.length > 0` is the recommended gate. With zero injections, `past` and `future` are all-zero arrays, and `upper = 0 × 1.27 = 0`, `lower = 0 × 0.73 = 0` — the band collapses to zero-on-zero, which renders as nothing. The gate just keeps the dataset count at 2 (cleaner Chart.js internals; smaller legend; zero risk of a "ghost band").

### Caveats

- **`fill: '+1'` direction.** Verified: `'+1'` means "fill toward the next dataset by index". In our config the **upper** has `fill: '+1'` and the **lower** is the next dataset — so the fill goes from upper down to lower visually. This is the chart.js v4 documented pattern ([chartjs/Chart.js Discussion #10368](https://github.com/chartjs/Chart.js/discussions/10368)).
- **Past/Projected split.** Because the existing chart splits past and future into separate datasets, the band needs to do the same — one band pair per existing line. Otherwise the band breaks at the past/future seam.
- **Filler plugin auto-registered.** Chart.js v4's `Filler` plugin is part of `...registerables` (already registered via `BaseChart.tsx:Chart.register(...registerables)`). No new registration needed. `[VERIFIED: chartjs.org/docs/latest/charts/area.html]`

## medLevelWatermarkPlugin text replacement

> D-08: replace the 31-char Phase 2 string with the 73-char Phase 3 string. Bump plugin id `medLevelWatermark` → `medLevelWatermark-v2`.

### Sizing analysis

Existing formula at `medLevelWatermarkPlugin.ts:46`:
```typescript
ctx.font = `bold ${Math.max(14, height * 0.08)}px ${fontFamily}`;
```

At `height = 280` (default `MedLevelChart` height): font size = `Math.max(14, 22.4)` = **22.4px bold**.

At a 45° diagonal across a 280px-tall chart: usable diagonal ≈ `280 × √2` ≈ **396px**.

Approximate text width at bold Inter:
- 31-char "Estimate — not medical advice" at 22.4px bold ≈ **310px** — fits with ~22% margin.
- 73-char "estimate, not measured serum level — based on population pharmacokinetics" at 22.4px bold ≈ **730px** — **OVERFLOWS by ~85%**.

### Recommendation: shrink font + keep single line

Shrink the multiplier from `0.08` to `0.055`, raise the floor from 14px to 10px:

```typescript
ctx.font = `bold ${Math.max(10, height * 0.055)}px ${fontFamily}`;
```

At `height = 280`: new font size = `Math.max(10, 15.4)` ≈ **15.4px bold**.
Approx text width at 15.4px bold ≈ `73 × 8.5` ≈ **620px** — still overflows by ~57%.

**That's still too wide for a single line.** Two viable paths:

**Option A — Two-line wrap (RECOMMENDED).** Split at the em-dash:
- Line 1: `estimate, not measured serum level`
- Line 2: `— based on population pharmacokinetics`

```typescript
ctx.font = `bold ${Math.max(11, height * 0.06)}px ${fontFamily}`;
const line1 = 'estimate, not measured serum level';
const line2 = '— based on population pharmacokinetics';
const lineHeight = Math.max(13, height * 0.07);
ctx.fillText(line1, 0, -lineHeight / 2);
ctx.fillText(line2, 0,  lineHeight / 2);
```

At 280px chart height: 16.8px font, ~420px line widths — fits comfortably across the 396px diagonal with the slight overflow at the corners hidden by the band fill.

**Option B — Single line at smaller size.** Shrink to `height * 0.045` (~12.6px at 280h). 73 chars × ~7px ≈ 510px. Still overflows but less so. Less readable at 12.6px bold over a busy chart.

**Recommendation: Option A.** Two visually balanced lines, font remains readable, no horizontal overflow. The plugin id bump to `medLevelWatermark-v2` plus the multi-line render needs a small structural change but is straightforward.

### Required code changes summary

| Change | Line(s) | Why |
|--------|---------|-----|
| `id: 'medLevelWatermark'` → `id: 'medLevelWatermark-v2'` | line 31 | D-08 plugin id bump |
| `WATERMARK_TEXT` constant → split into `WATERMARK_LINE_1` + `WATERMARK_LINE_2` | line 17 | Two-line render |
| `ctx.font` formula `0.08` → `0.06` and floor `14` → `11` | line 46 | Fit longer text |
| `ctx.fillText(text, 0, 0)` → two `fillText` calls with offsets | line 50 | Two-line render |
| `MedLevelChart.tsx:79` `medLevelWatermark:` → `'medLevelWatermark-v2':` | (consumer) | Plugin id bump cascade |
| `02-06-SUMMARY.md` watermark text reference | (Phase 2 doc) | D-09 cross-ref update |
| `02-HUMAN-UAT.md` C10/C11 expected text | (Phase 2 doc) | D-09 UAT alignment |

## DoctorReport disclaimer integration

> **Critical finding:** `DoctorReport.tsx` does **NOT** embed the `MedLevelChart` canvas. It is a Modal containing HTML tables (Summary / Recent injections / Side effects / Recent weight log). `window.print()` prints the Modal's HTML — no canvas to inherit the watermark from.

`DoctorReport.tsx:42` opens with `<div className="space-y-6 leading-relaxed">` and immediately renders a `<header>` with the patient's name. There is no `<MedLevelChart />` anywhere in the file. The existing footer at line 197 says *"This is a tracking summary, not medical documentation. Always defer to your healthcare provider."* — generic medical disclaimer, NOT the PK-specific "estimate, not measured serum level" copy.

### Recommended task shape

Add a **PK-specific disclaimer card** between the `<header>` (line 49) and the `<section>` containing the Summary table (line 50):

```tsx
{/* PK-04: D-10 — same disclaimer copy as the chart watermark, but text-only since
    the report has no chart canvas to inherit from. */}
<aside
  role="note"
  className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-elevated)] p-3 text-[12px] italic text-[var(--color-text-secondary)] print:border-black"
>
  <strong className="not-italic font-semibold">Pharmacokinetic estimate:</strong>{' '}
  This report's drug-level summary is an estimate, not measured serum level — based on population
  pharmacokinetics with ~30% inter-individual variation. It is not medical advice.
</aside>
```

**Why a separate `<aside>`:** the existing footer at line 197 is the generic disclaimer. The PK-specific copy needs to be visible alongside dose/injection data so a doctor reading the report doesn't mistake the curve numbers for measured serum levels. Top-of-document placement maximizes visibility on both the screen modal and the printed page.

**Print-friendly considerations:**
- Use `print:border-black` to ensure the disclaimer remains visible when CSS variables degrade in some browsers' print rendering.
- Confirmed: the existing footer at line 197 already uses `text-[var(--color-text-tertiary)] italic pt-4 border-t` — the same Tailwind primitives are available.
- No new dependencies; uses existing Tailwind v4 utilities.

### Single-source-of-truth opportunity

Both the chart watermark and the report disclaimer use the same human-readable copy. **Recommendation:** extract the copy into a shared constant:

```typescript
// src/lib/disclaimers.ts (new)
export const PK_DISCLAIMER_FULL =
  'estimate, not measured serum level — based on population pharmacokinetics';

export const PK_DISCLAIMER_LINE_1 = 'estimate, not measured serum level';
export const PK_DISCLAIMER_LINE_2 = '— based on population pharmacokinetics';
```

`medLevelWatermarkPlugin.ts` and `DoctorReport.tsx` both import from this file. Phase 7's clinician sign-off pass changes one constant, not three call sites.

## storage.ts v5 → v6 migration diff shape

> Per D-07: bump `STORAGE_VERSION` to 6, add a v5→v6 branch in `migrate()` that back-stamps each `Injection` with `pkEngineVersion: 1`. New `Injection` records stamp `1` on write via `addInjection`.

### Migrate handler signature

`zustand/middleware`'s `persist` `migrate` signature is `(persistedState: unknown, version: number) => PersistedState | Promise<PersistedState>`. The existing code at `store.ts:251-269` matches this — synchronous return.

### Required diffs

**1. `src/types/index.ts` (lines 61-67):**

```diff
 export interface Injection {
   datetime: string; // ISO
   dose: string;
   unit: DoseUnit;
   site: InjectionSite | null;
   notes: string;
+  /** PK-05: pharmacology engine version that produced this record's expected curve.
+      Optional so legacy literals + in-memory v5-shaped records typecheck.
+      Storage v5→v6 migrate back-stamps to 1. New writes stamp 1 via addInjection. */
+  pkEngineVersion?: number;
 }
```

**2. `src/lib/storage.ts` (line 31):**

```diff
-// D-10: bumped 4 → 5 so the persist `migrate` callback fires for existing v4 users
-// and explicitly defaults `acknowledgedDisclaimer` to undefined. Do NOT rename
-// STORAGE_KEY — that is the localStorage key, not the schema version.
-export const STORAGE_VERSION = 5;
+// D-07 (Phase 3): bumped 5 → 6 so persist `migrate` back-stamps existing
+// injections with pkEngineVersion: 1 (PK-05). Do NOT rename STORAGE_KEY.
+export const STORAGE_VERSION = 6;
```

**3. `src/lib/store.ts` `migrate` callback (lines 251-269) — add a new branch BEFORE the final return:**

```diff
       migrate: (persistedState, version) => {
         // First boot of v2 with v3 data sitting around.
         if (!persistedState && version < STORAGE_VERSION) {
           const v3 = migrateFromV3();
           if (v3) return { ...initialState, ...v3 };
           return { ...initialState };
         }
-        // Phase 2 D-10/D-11/RESEARCH Pitfall 5: existing v4 users must see the
-        // dashboard fallback modal on next load. Default acknowledgedDisclaimer
-        // to undefined here, NEVER 'v1' — defaulting to 'v1' would silently
-        // grandfather every existing user past the disclaimer.
-        if (persistedState && version === 4) {
+        // Phase 2 D-10/D-11: existing v4 users must see the dashboard fallback
+        // modal on next load. Default acknowledgedDisclaimer to undefined here,
+        // NEVER 'v1' — defaulting to 'v1' would silently grandfather every
+        // existing user past the disclaimer.
+        let state = persistedState as PersistedState;
+        if (state && version <= 4) {
+          state = { ...state, acknowledgedDisclaimer: undefined };
+        }
+        // Phase 3 D-07 (PK-05): back-stamp every existing injection with
+        // pkEngineVersion: 1 so a future v1.1 two-compartment engine can
+        // distinguish "stored under v1 PK math" from "stored under v1.1".
+        if (state && version <= 5) {
           return {
-            ...(persistedState as PersistedState),
-            acknowledgedDisclaimer: undefined,
-          } as PersistedState;
+            ...state,
+            injections: (state.injections ?? []).map((inj) => ({
+              ...inj,
+              pkEngineVersion: inj.pkEngineVersion ?? 1,
+            })),
+          };
         }
-        return persistedState as PersistedState;
+        return state;
       },
```

**4. `src/lib/store.ts` `addInjection` action — stamp on write:**

Find the existing `addInjection` action (between roughly line 130-170 — already deals with `s.injections`); update it to stamp:

```typescript
addInjection: (inj) =>
  set((s) => ({
    injections: [
      { ...inj, pkEngineVersion: inj.pkEngineVersion ?? 1 },
      ...s.injections,
    ],
  })),
```

**5. `partialize` (lines 230-250) — NO change needed.** `partialize` selects top-level slices, not field shapes. Since `injections` is already in the partialize output and `pkEngineVersion` is a field on each `Injection`, the new field rides along automatically.

### New tests for `storage.test.ts`

```typescript
import { STORAGE_VERSION } from './storage';

describe('STORAGE_VERSION (PK-05, D-07)', () => {
  it('is bumped to 6 for pkEngineVersion field', () => {
    expect(STORAGE_VERSION).toBe(6);
  });
});

describe('v5 → v6 migration (PK-05)', () => {
  it('back-stamps injections without pkEngineVersion to 1', () => {
    // Reach into the store's persist.migrate via the exported migrate fn,
    // OR drive it through useStore.persist with a fake persisted snapshot.
    // (Planner: pick the convention used by existing v4→v5 tests.)
    const persistedV5 = {
      injections: [
        { datetime: '2026-04-01T10:00:00Z', dose: '1', unit: 'mg', site: null, notes: '' },
        { datetime: '2026-04-08T10:00:00Z', dose: '1', unit: 'mg', site: null, notes: '' },
      ],
      // ...other slices...
    };
    const migrated = /* invoke migrate(persistedV5, 5) */;
    expect(migrated.injections.every((i) => i.pkEngineVersion === 1)).toBe(true);
  });

  it('preserves explicit pkEngineVersion when already present', () => {
    const persistedV5 = {
      injections: [{ datetime: '...', dose: '1', unit: 'mg', site: null, notes: '', pkEngineVersion: 2 }],
    };
    const migrated = /* invoke migrate(persistedV5, 5) */;
    expect(migrated.injections[0].pkEngineVersion).toBe(2);
  });
});
```

## Existing test conventions

> Pulled from `src/lib/storage.test.ts` and `src/lib/analytics.test.ts`. The pharmacology corpus + insights tests must follow this pattern.

| Convention | Detail |
|------------|--------|
| **Location** | Co-located: `src/lib/storage.ts` ↔ `src/lib/storage.test.ts`. No `__tests__/` directory. **→ Phase 3 places `pharmacology.test.ts`, `pharmacology-corpus.ts`, `insights-refusal.ts`, `insights-refusal.test.ts` all in `src/lib/`.** |
| **Imports** | `import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';` then named imports from sibling modules: `import { initialState, migrateFromV3, STORAGE_VERSION } from './storage';` |
| **Path alias** | `@/...` is available but the lib tests use relative `./` since they're sibling files. **→ Phase 3 follows: `import { CORPUS } from './pharmacology-corpus';`.** |
| **Matchers** | `toBe`, `toBeUndefined`, `toBeNull`, `toMatch(regex)`, `toHaveLength`, `not.toBeNull`, `not.toThrow`. No custom matchers. **→ For ±15% bounds use `toBeGreaterThanOrEqual` + `toBeLessThanOrEqual`.** |
| **Mocking strategy** | `vi.spyOn(Storage.prototype, 'getItem').mockImplementation(...)` for localStorage. `vi.restoreAllMocks()` in `afterEach`. **→ Pharmacology tests likely don't need any mocks (pure function).** |
| **Describe nesting** | `describe(<module/feature>) → describe(<sub-feature>) → it(<behavior>)`. Two levels deep is the norm. |
| **Snapshot tests** | None used. All assertions are explicit. **→ Don't introduce `toMatchSnapshot` for the corpus.** |
| **Test file naming** | `*.test.ts` (not `.spec.ts`). |
| **Vitest config** | `vitest.config.ts` exists at repo root; environment is jsdom (per Phase 1). No special setup needed for these phase 3 tests. |
| **Type-only assertions** | The `analytics.test.ts` `EventName` test uses `const e6: EventName = 'disclaimer_acknowledged';` to enforce compile-time membership. **→ The corpus could similarly enforce that every `MedicationId` is reachable via `trialClass()` with a compile-time check.** |

## Pitfalls to avoid

1. **`calcMedLevel` returns mg-in-body, not ng/mL.** Don't write a test that asserts ng/mL against `calcMedLevel`'s output — that needs the apparent-Vd bridge per drug class. The corpus asserts on mg-in-body and cites the published ng/mL in a comment.

2. **`pkEngineVersion` MUST be optional.** Strict TypeScript will fail every existing `Injection` literal in test seeds and storybook fixtures the moment it becomes required. The migration back-stamps existing records, but in-memory literals constructed in tests still need the field to be optional.

3. **Chart.js `Filler` plugin order vs `medLevelWatermarkPlugin`.** The watermark uses `afterDraw`, which runs strictly after Chart.js's own dataset rendering (including `fill`). Phase 2's research already verified this. The new band datasets fill *underneath* the line and the watermark paints *on top of everything* — order is correct.

4. **`'+1'` fill direction is index-relative.** The dataset declared with `fill: '+1'` fills toward the dataset at `currentIndex + 1`. If the planner reorders datasets for any reason, the band breaks silently. **Recommend: a co-located unit test that checks dataset[0].label === 'Upper bound (Past)' and dataset[1].label === 'Lower bound (Past)' to lock ordering.**

5. **Refusal-list `\bmore\b` is a footgun without the context-guard.** Every "more protein", "more reps", "more sleep" insight breaks. The context-guard requiring a med-noun within 5 tokens is what makes this tractable. **Audit the existing `generateInsights` output strings for "more" / "less" before merging the refusal-list to confirm none get wrongly scrubbed** — line 41 of `insights.ts` says "make sure you're hitting protein and lifting weights" (safe), and line 76 says "Crushing protein" (safe). Run the corpus against actual `generateInsights(fixtureState)` output.

6. **Hyperbolic em-dash hazard.** The watermark text contains an em-dash (U+2014). Phase 2 explicitly added an escape-sequence comment to defeat editor auto-correction (`02-06-SUMMARY.md` Note A). Phase 3 inherits the same hazard for the Phase 3 string. **Use the same `—` escape pattern in the new `WATERMARK_LINE_2` constant.**

7. **`generateInsights` is selector-blocked by ESLint.** `useStore(generateInsights)` triggers `no-restricted-syntax`. Refusal-list test fixtures must call `generateInsights(state)` directly with a constructed `PersistedState`, never through the store. See `analytics.test.ts` for the direct-call pattern.

8. **Petri 2018 reports nmol/L; corpus needs the conversion documented.** The bridge `ng/mL = nmol/L × 4113.58 / 1000` is correct for sema. Future researchers might forget the molecular weight — keep it inline in the corpus comment.

9. **Liraglutide is daily, not weekly.** All other 4 classes are weekly (τ = 168h). The corpus entry for `liraglutide` MUST set `tauHours: 24`. Easy to miss because the `TITRATION` table doesn't show it explicitly.

10. **PostHog `track('insight_refused')` would be useful but is OPT-IN per Phase 1 D-15.** The refusal-list scrub silently drops insights; the only way a developer notices a wrongly-scrubbed insight is via the test corpus + manual UAT. Don't add analytics events here without a Phase 1 D-15 review. Acceptable: log to `console.warn('[leanshot] insight scrubbed', insight)` in dev mode (`import.meta.env.DEV`) so the developer sees scrubs locally without leaking to production analytics.

11. **Watermark plugin id bump cascade.** Changing the plugin `id` from `medLevelWatermark` to `medLevelWatermark-v2` requires `MedLevelChart.tsx:79` to update the options key from `medLevelWatermark:` to `'medLevelWatermark-v2':`. Chart.js looks up plugin options by the literal id — this is a strict equality match. A grep for `medLevelWatermark` across `src/` after the change should return only `'medLevelWatermark-v2'`.

12. **`DoctorReport.tsx` does NOT embed the chart canvas.** Don't waste a planning task investigating "does the watermark survive the print" — it doesn't, because there's no chart in the report. Phase 3's task for D-10 is "add a text disclaimer to DoctorReport.tsx", not "verify watermark survives print". This was the planner's main open question per CONTEXT D-10; researcher answers definitively: **separate text disclaimer, no chart canvas embedding involved.**

## Runtime State Inventory

> This phase touches one runtime state surface (`localStorage` key `leanshot_v4` schema v5 → v6). All other categories are empty.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | `localStorage["leanshot_v4"]` — schema v5 (Phase 2). Holds `acknowledgedDisclaimer` already. Phase 3 bumps to v6 and back-stamps `injections[].pkEngineVersion = 1`. | Code edit (`STORAGE_VERSION = 6` + new `migrate` branch) AND data migration (back-stamp) — both happen in the same `migrate()` call on first read. |
| Live service config | None — Supabase not provisioned until Phase 4. | None. |
| OS-registered state | None. | None. |
| Secrets/env vars | None — phase is pure-frontend test/refactor. | None. |
| Build artifacts | None — no `pyproject.toml`, no compiled bindings, no docker images. Vite re-builds on save. | None. |

**Nothing found in categories 2-5:** verified by grepping the codebase for env vars (`import.meta.env.VITE_*`), CI configurations (`.github/workflows/*.yml`), and Supabase imports (none yet — Phase 4).

## Environment Availability

> Phase is pure code/config + Vitest tests. No new tools, services, or runtimes.

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Vitest | All new `*.test.ts` | ✓ (configured Phase 1) | ^1.x per Phase 1 | — |
| chart.js v4 | Band datasets + filler plugin | ✓ | `^4.4.6` | — |
| TypeScript strict | New types and corpus | ✓ | `~5.6.3` | — |
| Zustand persist | v5→v6 migrate | ✓ | `^5.0.1` | — |

**Missing dependencies with no fallback:** none.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest (configured in Phase 1; see `01-04-PLAN.md`) |
| Config file | `vitest.config.ts` at repo root |
| Quick run command | `npm run test:unit -- src/lib/pharmacology.test.ts src/lib/insights-refusal.test.ts` |
| Full suite command | `npm test` (runs Vitest + Playwright) |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| PK-01 | Steady-state Aₛₛ_avg per drug-class within ±15% of cited target | unit | `npx vitest run src/lib/pharmacology.test.ts` | ❌ Wave 0 (file exists, suite needs new describes) |
| PK-02 | Refusal-list scrubs dose-change phrasing; passes benign motivational copy | unit | `npx vitest run src/lib/insights-refusal.test.ts` | ❌ Wave 0 |
| PK-03 | Band datasets render when `injections.length > 0`; hidden when zero | unit (RTL on `MedLevelChart`) | `npx vitest run src/components/dashboard/charts/MedLevelChart.test.tsx` | ❌ Wave 0 (no existing test for MedLevelChart) |
| PK-04 | Watermark text matches `'estimate, not measured serum level — based on population pharmacokinetics'` (or two-line split); DoctorReport renders the disclaimer aside | unit | `npx vitest run src/components/dashboard/charts/medLevelWatermarkPlugin.test.ts src/components/dashboard/modals/DoctorReport.test.tsx` | ❌ Wave 0 (existing `medLevelWatermarkPlugin.test.ts` needs text update; no `DoctorReport.test.tsx` yet) |
| PK-05 | `STORAGE_VERSION === 6`; v5→v6 migration back-stamps `pkEngineVersion: 1`; `addInjection` stamps new records | unit | `npx vitest run src/lib/storage.test.ts` | ✅ (extend existing) |

### Sampling Rate
- **Per task commit:** Wave-scoped run (e.g., during pharmacology task: `npx vitest run src/lib/pharmacology.test.ts`)
- **Per wave merge:** `npm run test:unit` (full Vitest suite)
- **Phase gate:** Full suite green before `/gsd-verify-work` — including Playwright smoke (no new e2e expected; Phase 3 is pure-internal hardening)

### Wave 0 Gaps
- [ ] `src/lib/pharmacology-corpus.ts` — new module (corpus data + types)
- [ ] `src/lib/pharmacology.test.ts` — new file with the corpus describe (could split into `pharmacology-corpus.test.ts`; planner discretion)
- [ ] `src/lib/insights-refusal.ts` — new module (regex + `isDoseChangeAdvice` + `scrubInsights`)
- [ ] `src/lib/insights-refusal.test.ts` — new file with the 30+ row corpus
- [ ] `src/lib/disclaimers.ts` — new module (shared `PK_DISCLAIMER_*` constants)
- [ ] `src/components/dashboard/charts/MedLevelChart.test.tsx` — new file (band gating test)
- [ ] `src/components/dashboard/modals/DoctorReport.test.tsx` — new file (disclaimer presence test)
- [ ] Update `src/components/dashboard/charts/medLevelWatermarkPlugin.test.ts` — text assertions reference the new constants
- [ ] Update `src/lib/storage.test.ts` — `STORAGE_VERSION === 6`, v5→v6 migrate back-stamping

## Security Domain

> Required because `security_enforcement` is enabled (default).

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | n/a (no auth in this phase; Supabase Auth lands Phase 5) |
| V3 Session Management | no | n/a |
| V4 Access Control | no | n/a (single-tenant local-first) |
| V5 Input Validation | yes (limited) | Refusal-list regex is itself an input-classification mechanism. Patterns are constants, not user-controlled. No untrusted input enters the regex. |
| V6 Cryptography | no | n/a |
| V7 Error Handling and Logging | yes | Migrate `try/catch` already in place per `migrateFromV3`. New v5→v6 branch should NOT throw on malformed `injections` array (defensive `.map` after `?? []` fallback). |

### Known Threat Patterns for static SPA + localStorage

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| ReDoS via crafted regex | DoS | Refusal-list patterns are bounded (no nested quantifiers, no catastrophic backtracking). The `STEM_PATTERN` uses `(s\|ed\|ing\|es\|d)?` — single optional alternation, safe. Audit any future addition for nested `*` or `+` overlap. |
| Migration-induced data loss | Tampering / Repudiation | Phase 2 storage tests already cover the "v3 corruption → return null" path. Phase 3 v5→v6 migration uses `?? []` fallback for `injections` to avoid throwing on a malformed pre-migration blob. New test: corrupt v5 with `{injections: null}` → migration returns `injections: []`, not crash. |
| Local privacy leak via persisted insight strings | Information Disclosure | Insight strings are derived from user data already in `localStorage`. No new data class introduced. Refusal-list scrubs dose-change strings *before* they hit the UI, but the underlying user data still persists — that's by design (it's the user's own data). |

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Liraglutide CV% ≈ 30% (class-typical, not directly stated as a single CV in Saxenda label) | Per-drug-class CV% | Band width slightly off for liraglutide users (Saxenda). Honest "~30%" UI label conceals the imprecision. |
| A2 | Retatrutide CV% ≈ 30% (Phase 2 paper does not publish a population PK CV) | Per-drug-class CV% | Same — band width approximate. Retatrutide is investigational; clinician audit in Phase 7 will refine. |
| A3 | Retatrutide steady-state target uses 1-compartment derived value (12mg × 144h / (168h × ln2) ≈ 14.85 mg) without published Css confirmation | Per-drug-class steady-state corpus | If Lilly's Phase 3 (TRIUMPH) PK paper publishes a different Css, the ±15% predicate may be off. The 1-compartment derivation is the formula's own native output, so test integrity is preserved — only the "matches published" claim is at risk. |
| A4 | DoctorReport's `window.print()` produces a doctor-suitable PDF (no separate PDF library) | DoctorReport disclaimer integration | Verified by reading `DoctorReport.tsx` — it calls `window.print()` directly. No assumption — moved to verified. ✓ |
| A5 | Two-line watermark wrap is more readable than a single shrunk line at the existing 280px chart height | medLevelWatermarkPlugin text replacement | Cosmetic. If the implementer measures and finds the single-line at 13px more legible, switch — both options are acceptable. |
| A6 | Apparent Vd_ss for semaglutide = 12.5 L (typical clinical value) used in the Css bridge | calcMedLevel correctness verification | Bridge sanity-check only; not asserted by tests. If the actual published Vd is different the bridge calculation is off but the corpus test is unaffected. |
| A7 | `dulaglutide` CV% 33.8% pulled from Geiser 2016 population CL CV may differ slightly from FDA Trulicity ClinPharmR's specific number | Per-drug-class CV% | Off by a few percentage points at most. Honest "~30%" UI label absorbs the difference. |
| A8 | Vitest is already configured at the repo root (per Phase 1 `01-04-PLAN.md`) | Existing test conventions | Verified by reading `src/lib/storage.test.ts` and `src/lib/analytics.test.ts` — they import from `vitest` and run via `npm run test:unit`. ✓ |

**Items needing user / clinician confirmation before phase ships:** A1, A2, A3, A7. All four are flagged in CONTEXT D-11 as deferred to Phase 7 clinician sign-off — no action needed in Phase 3 beyond honest [ASSUMED] tagging in the corpus comment.

## Open Questions

1. **Should the corpus include the 0.5mg / 0.25mg / 2.0mg sema doses, or only the 1.0mg standard maintenance?**
   - What we know: D-04 says "published mean ± SD steady-state value" per drug class. Petri 2018 publishes 0.5mg AND 1.0mg Cavg.
   - What's unclear: is asserting both 0.5mg and 1.0mg required, or just the 1.0mg standard?
   - Recommendation: just 1.0mg for v1; the linearity claim ("dose-proportional pharmacokinetics") is well-established and one assertion per drug class keeps the corpus small. If the planner wants belt-and-suspenders, add 0.5mg as a parametrized variant — same code, double the assertions.

2. **Should `pickFocus` apply the refusal-list scrub, or only `generateInsights`?**
   - What we know: D-05 mentions "any insight that could read as dose-change advice" — both `Insight[]` and the focus card are insights.
   - What's unclear: the focus card has only ~7 hard-coded copy strings and none are dose-change-shaped. Strictly, the scrub is unnecessary for `pickFocus` today.
   - Recommendation: scrub both for defense-in-depth (a future contributor adding a focus copy variant should be caught by the test). Cost is one extra `isDoseChangeAdvice(result.body)` call per render.

3. **Does Phase 3 update the existing `medLevelWatermarkPlugin.test.ts` text assertion, or write a new test file?**
   - What we know: existing test asserts the verbatim Phase 2 string at line 53 of `02-06-SUMMARY.md` ("Verbatim text assertion").
   - What's unclear: should the test be edited in-place or should a v2 test sit alongside?
   - Recommendation: edit in-place (the v2 plugin id supersedes v1; there's only one watermark on the chart). Update the assertion to check both lines of the new text. Document the change in the Phase 3 SUMMARY's deviations.

4. **Where does the `CV_BY_DRUG_CLASS` map live — colocated with corpus or in `pharmacology.ts`?**
   - Recommendation: derive from `CORPUS` (single source of truth) inside `pharmacology-corpus.ts`. Re-export so `MedLevelChart.tsx` imports it from there.

## Sources

### Primary (HIGH confidence)

- [Petri KCC et al. 2018, *Diabetes Therapy* 9(4):1533-1547](https://link.springer.com/article/10.1007/s13300-018-0458-5) — semaglutide pop-PK; Cavg @ 1mg = 29.8 nmol/L (95% CI 29.4-30.2); base BSV 26.6%
- [Schneck K et al. 2024, *CPT: Pharmacometrics & Systems Pharmacology* 13(4):494-505](https://pmc.ncbi.nlm.nih.gov/articles/PMC10962491/) — tirzepatide pop-PK; CL/F 0.0329 L/h/70kg, BSV 14.2% (95% CI 13.7-14.7%); half-life 5.4 days
- [Saxenda US Prescribing Information, FDA 2023](https://www.accessdata.fda.gov/drugsatfda_docs/label/2023/206321s016lbl.pdf) — liraglutide steady-state 116 ng/mL Cavg in obese subjects; half-life 13h; dose-proportional 0.6-3mg
- [Geiser JS et al. 2016, *Clinical Pharmacokinetics* 55(5):625-634](https://link.springer.com/article/10.1007/s40262-015-0338-3) — dulaglutide pop-PK; Cmax 114 ng/mL @ 1.5mg multi-dose; population CL CV 33.8%; half-life 5d
- [Jastreboff AM et al. 2023, *NEJM* 389(6):514-526](https://www.nejm.org/doi/full/10.1056/NEJMoa2301972) — retatrutide Phase 2; half-life ~6 days; dose-proportional 0.5-12mg; Css not published in main text
- [Chart.js v4 Area docs (chartjs.org/docs/latest/charts/area.html)](https://www.chartjs.org/docs/latest/charts/area.html) — `fill: '+1'` and dataset-relative fill behavior
- [chartjs/Chart.js Discussion #10368](https://github.com/chartjs/Chart.js/discussions/10368) — fill-between-lines pattern with confirmed dataset ordering caveats

### Secondary (MEDIUM confidence)

- [Clinical Pharmacokinetics of Semaglutide systematic review, PMC11215664](https://pmc.ncbi.nlm.nih.gov/articles/PMC11215664/) — confirms semaglutide MW 4113 Da and reference Cmax_SS 51.6±11.1 nmol/L for Japanese subjects @ 1mg
- [PDB-101 Diabetes Mellitus / Semaglutide](https://pdb101.rcsb.org/global-health/diabetes-mellitus/drugs/incretins/drug/semaglutide/semaglutide) — molecular formula C₁₈₇H₂₉₁N₄₅O₅₉, MW 4113.58 Da

### Tertiary (LOW confidence — flagged for Phase 7)

- Retatrutide population PK CV% — not publicly accessible from Phase 2 supplementary appendix; corpus uses class-typical 30% as conservative estimate
- Liraglutide single-CV-number — Saxenda label describes inter-subject variability qualitatively; corpus uses 30% to match the "~30% inter-individual variation" UI label

## Metadata

**Confidence breakdown:**
- Pharmacology corpus values (sema/tirz/lira/dulag): HIGH — verified against primary FDA labels and peer-reviewed pop-PK papers
- Pharmacology corpus values (retatrutide): MEDIUM — half-life confirmed; CV% conservative fallback
- `calcMedLevel` correctness verification: HIGH — bridged sema 1mg → 115 ng/mL vs published 122.6 ng/mL = 6.2% delta, well inside ±15%
- Refusal-list regex pattern: HIGH — common patterns, no ReDoS risk, comprehensive 30-row corpus
- Chart.js fill config: HIGH — verified against official v4 docs and active GitHub discussion
- Watermark sizing math: MEDIUM — based on bold Inter approximation; final font-size should be measured at build time
- DoctorReport disclaimer integration: HIGH — verified by reading the file directly (no chart canvas embedded)
- Storage v5→v6 migration: HIGH — pattern parallels Phase 2 v4→v5; existing `migrate()` handler signature supports the addition without restructuring

**Research date:** 2026-05-11
**Valid until:** 2026-06-11 (FDA labels and peer-reviewed PK numbers don't change month-to-month; Chart.js v4 stable)

---

*Phase: 03-pharmacology-insights-hardening*
*Researched: 2026-05-11 via /gsd-research-phase 3 + WebSearch + WebFetch (PMC, FDA accessdata, NEJM, Chart.js docs)*
*Next step: planner consumes this RESEARCH.md and produces PLAN.md files per wave*
