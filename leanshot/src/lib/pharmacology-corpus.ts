/**
 * Cited steady-state corpus for the 1-compartment PK model in `calcMedLevel`.
 * Implements PK-01 (D-01, D-04, D-06) — five drug-class entries with peer-
 * reviewed sources, the ±15% steady-state predicate bounds, and per-class CV%
 * for the uncertainty band rendering.
 *
 * Each entry asserts the time-averaged amount-in-body (Aₛₛ_avg) at the
 * standard maintenance dose. `calcMedLevel` returns dose-units (mg) accumulated
 * in the body, NOT serum ng/mL. The published ng/mL Cavg is recorded for
 * clinician audit only — the bridge math is:
 *
 *     Cavg [ng/mL] = (Aₛₛ_avg [mg] × 10^6) / Vd_apparent [mL]
 *
 * Tests in pharmacology.test.ts assert the mg-in-body bound, not the ng/mL Css.
 *
 * Source citations (DOI or FDA URL) live in each entry's `source` field so a
 * doctor or auditor can trace the steady-state value back to a peer-reviewed
 * reference without leaving the source tree.
 */
import type { MedicationId } from '@/types';

export interface CorpusEntry {
  drugClass: 'semaglutide' | 'tirzepatide' | 'liraglutide' | 'dulaglutide' | 'retatrutide';
  representativeMed: MedicationId;
  /** Standard maintenance dose, in mg. */
  doseMg: number;
  /** Dosing interval in hours (168 = weekly, 24 = daily). */
  tauHours: number;
  /** Half-life in hours (matches HALF_LIVES[representativeMed]). */
  halfLifeHours: number;
  /** Expected time-averaged steady-state amount in body, mg. */
  targetMgInSystem: number;
  /** ±15% lower bound — targetMgInSystem × 0.85. */
  lowerBoundMg: number;
  /** ±15% upper bound — targetMgInSystem × 1.15. */
  upperBoundMg: number;
  /** Per-drug-class CV% for the uncertainty band (D-06). */
  cvPercent: number;
  /** Published serum Css for clinician audit only (NOT asserted by tests). */
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
    targetMgInSystem: 1.443, // = 1.0 * 168 / (168 * Math.LN2)
    lowerBoundMg: 1.227,
    upperBoundMg: 1.659,
    // CV-adjusted bandwidth per D-06
    cvPercent: 27, // Petri 2018: BSV 26.6% (base model)
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
    targetMgInSystem: 10.305, // = 10 * 120 / (168 * Math.LN2)
    lowerBoundMg: 8.759,
    upperBoundMg: 11.851,
    cvPercent: 14, // Schneck 2024: CL/F BSV 14.2% (95% CI 13.7-14.7%)
    publishedCssNgPerMl: null, // Schneck does not report Css per-dose; AUC-derivable only
    source:
      'Schneck K et al., CPT Pharmacometrics Syst Pharmacol. 2024;13(4):494-505. DOI 10.1002/psp4.13099',
    year: 2024,
  },
  {
    drugClass: 'liraglutide',
    representativeMed: 'saxenda',
    doseMg: 3.0,
    tauHours: 24,
    halfLifeHours: 13,
    targetMgInSystem: 2.345, // = 3 * 13 / (24 * Math.LN2)
    lowerBoundMg: 1.993,
    upperBoundMg: 2.697,
    cvPercent: 30, // Saxenda label: ~30% inter-subject variability typical for liraglutide
    publishedCssNgPerMl: 116,
    source:
      'Saxenda (liraglutide) US Prescribing Information, FDA 2023, §12.3 — accessdata.fda.gov/drugsatfda_docs/label/2023/206321s016lbl.pdf',
    year: 2023,
  },
  {
    drugClass: 'dulaglutide',
    representativeMed: 'trulicity',
    doseMg: 1.5,
    tauHours: 168,
    halfLifeHours: 120,
    targetMgInSystem: 1.546, // = 1.5 * 120 / (168 * Math.LN2)
    lowerBoundMg: 1.314,
    upperBoundMg: 1.778,
    cvPercent: 34, // Geiser 2016: population CL CV 33.8%
    publishedCssNgPerMl: 114, // Geometric-mean Cmax at multiple-dose 1.5mg in T2DM
    source:
      'Geiser JS et al., Clin Pharmacokinet. 2016;55(5):625-634. DOI 10.1007/s40262-015-0338-3',
    year: 2016,
  },
  {
    drugClass: 'retatrutide',
    representativeMed: 'retatrutide',
    doseMg: 12.0,
    tauHours: 168,
    halfLifeHours: 144,
    targetMgInSystem: 14.846, // = 12 * 144 / (168 * Math.LN2)
    lowerBoundMg: 12.619,
    upperBoundMg: 17.073,
    cvPercent: 30, // Jastreboff 2023 Phase 2 main text does not report PK CV;
    // conservative class-typical 30% pending Phase 7 clinician audit
    publishedCssNgPerMl: null,
    source: 'Jastreboff AM et al., N Engl J Med. 2023;389(6):514-526. DOI 10.1056/NEJMoa2301972',
    year: 2023,
  },
];

/**
 * Per-drug-class CV as a unit fraction (cvPercent / 100). Derived from CORPUS
 * so the two cannot drift. Consumed by the chart uncertainty band layer
 * (Plan 03 / MedLevelChart) — see D-06.
 */
export const CV_BY_DRUG_CLASS: Record<string, number> = Object.fromEntries(
  CORPUS.map((c) => [c.drugClass, c.cvPercent / 100]),
);
