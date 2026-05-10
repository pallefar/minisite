/**
 * Pharmacokinetic constants — peer-reviewed half-lives and FDA-label
 * titration schedules. Ported verbatim from v1 (leanshot.html:1318-1359).
 */
import type { MedicationId } from '@/types';

export const HALF_LIVES: Record<MedicationId, number> = {
  ozempic: 168,
  wegovy: 168,
  rybelsus: 168,
  'compound-sema': 168,
  mounjaro: 120,
  zepbound: 120,
  'compound-tirz': 120,
  trulicity: 120,
  saxenda: 13,
  retatrutide: 144,
};

export interface TitrationStep {
  d: string; // dose label
  w: string; // week range "1–4"
  n: string; // note
}

export const TITRATION: Partial<Record<MedicationId, TitrationStep[]>> = {
  ozempic: [
    { d: '0.25 mg', w: '1–4', n: 'Tolerance only.' },
    { d: '0.5 mg', w: '5–8', n: 'First therapeutic.' },
    { d: '1.0 mg', w: '9+', n: 'Standard maintenance.' },
    { d: '2.0 mg', w: 'If needed', n: 'Max for some.' },
  ],
  wegovy: [
    { d: '0.25 mg', w: '1–4', n: 'Tolerance.' },
    { d: '0.5 mg', w: '5–8', n: '' },
    { d: '1.0 mg', w: '9–12', n: '' },
    { d: '1.7 mg', w: '13–16', n: '' },
    { d: '2.4 mg', w: '17+', n: 'Maintenance.' },
  ],
  mounjaro: [
    { d: '2.5 mg', w: '1–4', n: 'Tolerance only.' },
    { d: '5 mg', w: '5–8', n: 'First therapeutic.' },
    { d: '7.5 mg', w: '9–12', n: '' },
    { d: '10 mg', w: '13–16', n: '' },
    { d: '12.5 mg', w: '17–20', n: '' },
    { d: '15 mg', w: '21+', n: 'Max maintenance.' },
  ],
  zepbound: [
    { d: '2.5 mg', w: '1–4', n: 'Starting.' },
    { d: '5 mg', w: '5–8', n: 'First therapeutic.' },
    { d: '7.5 mg', w: '9–12', n: '' },
    { d: '10 mg', w: '13–16', n: '' },
    { d: '12.5 mg', w: '17–20', n: '' },
    { d: '15 mg', w: '21+', n: 'Max maintenance.' },
  ],
};

export interface TrialPoint {
  w: number;
  pct: number;
}

export const TRIAL_DATA: Record<string, TrialPoint[]> = {
  semaglutide: [
    { w: 4, pct: 2 },
    { w: 12, pct: 6 },
    { w: 20, pct: 10 },
    { w: 28, pct: 12.5 },
    { w: 40, pct: 14 },
    { w: 52, pct: 14.9 },
    { w: 68, pct: 14.9 },
  ],
  tirzepatide: [
    { w: 4, pct: 2.5 },
    { w: 12, pct: 7.5 },
    { w: 20, pct: 12 },
    { w: 28, pct: 16 },
    { w: 40, pct: 19 },
    { w: 52, pct: 20.9 },
    { w: 72, pct: 22.5 },
  ],
  liraglutide: [
    { w: 4, pct: 1.5 },
    { w: 12, pct: 4 },
    { w: 28, pct: 6 },
    { w: 56, pct: 8 },
  ],
  dulaglutide: [
    { w: 12, pct: 2 },
    { w: 28, pct: 4 },
    { w: 52, pct: 5 },
  ],
  retatrutide: [
    { w: 12, pct: 8 },
    { w: 24, pct: 17 },
    { w: 48, pct: 24 },
  ],
};

export function trialClass(med: MedicationId): keyof typeof TRIAL_DATA {
  const map: Record<MedicationId, keyof typeof TRIAL_DATA> = {
    ozempic: 'semaglutide',
    wegovy: 'semaglutide',
    rybelsus: 'semaglutide',
    'compound-sema': 'semaglutide',
    mounjaro: 'tirzepatide',
    zepbound: 'tirzepatide',
    'compound-tirz': 'tirzepatide',
    saxenda: 'liraglutide',
    trulicity: 'dulaglutide',
    retatrutide: 'retatrutide',
  };
  return map[med] ?? 'semaglutide';
}

export function medLabel(m: MedicationId): string {
  return (
    {
      ozempic: 'Ozempic · Semaglutide',
      wegovy: 'Wegovy · Semaglutide',
      mounjaro: 'Mounjaro · Tirzepatide',
      zepbound: 'Zepbound · Tirzepatide',
      rybelsus: 'Rybelsus · oral Semaglutide',
      saxenda: 'Saxenda · Liraglutide',
      trulicity: 'Trulicity · Dulaglutide',
      retatrutide: 'Retatrutide',
      'compound-sema': 'Compounded Semaglutide',
      'compound-tirz': 'Compounded Tirzepatide',
    } as const
  )[m];
}

export function medLabelShort(m: MedicationId): string {
  return (
    {
      ozempic: 'Ozempic',
      wegovy: 'Wegovy',
      mounjaro: 'Mounjaro',
      zepbound: 'Zepbound',
      rybelsus: 'Rybelsus',
      saxenda: 'Saxenda',
      trulicity: 'Trulicity',
      retatrutide: 'Retatrutide',
      'compound-sema': 'Sema',
      'compound-tirz': 'Tirz',
    } as const
  )[m];
}

/** Half-life decay sum across all injections — port of v1 calcMedLevel (leanshot.html:2054). */
export function calcMedLevel(
  time: number,
  halfLifeHours: number,
  injections: { datetime: string; dose: string }[],
): number {
  let total = 0;
  for (const inj of injections) {
    const t = new Date(inj.datetime).getTime();
    if (t > time) continue;
    const hours = (time - t) / 3600000;
    total += (parseFloat(inj.dose) || 0) * Math.pow(0.5, hours / halfLifeHours);
  }
  return total;
}
