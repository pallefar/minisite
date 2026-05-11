import { describe, expect, it } from 'vitest';
import { calcMedLevel } from './pharmacology';
import { CORPUS, CV_BY_DRUG_CLASS } from './pharmacology-corpus';

const HOUR_MS = 3_600_000;

describe('PK corpus — steady-state ±15% (PK-01, D-01, D-04)', () => {
  for (const entry of CORPUS) {
    it(`${entry.drugClass} (${entry.representativeMed} ${entry.doseMg}mg q${entry.tauHours}h): Aₛₛ_avg within ±15% of ${entry.targetMgInSystem}mg`, () => {
      // Simulate 12 weeks of dosing — well past 5 half-lives for all drug classes.
      // Most recent dose is at `now` (i=0); prior doses go backwards in τ-steps.
      // We then sample 24 evenly-spaced points across the FINAL dosing interval
      // [now, now + τ) and average them — that is the time-averaged amount-in-body
      // (Aₛₛ_avg), which is what targetMgInSystem encodes.
      const now = Date.now();
      const doseCount = Math.ceil(12 * (168 / entry.tauHours));
      const injections = Array.from({ length: doseCount }, (_, i) => ({
        datetime: new Date(now - i * entry.tauHours * HOUR_MS).toISOString(),
        dose: String(entry.doseMg),
      }));

      const samples: number[] = [];
      for (let k = 0; k < 24; k++) {
        const tOffsetH = (k / 24) * entry.tauHours;
        samples.push(calcMedLevel(now + tOffsetH * HOUR_MS, entry.halfLifeHours, injections));
      }
      const avg = samples.reduce((a, b) => a + b, 0) / samples.length;

      expect(avg).toBeGreaterThanOrEqual(entry.lowerBoundMg);
      expect(avg).toBeLessThanOrEqual(entry.upperBoundMg);
    });
  }
});

describe('CV_BY_DRUG_CLASS — derived width map', () => {
  it('semaglutide cv = 0.27', () => {
    expect(CV_BY_DRUG_CLASS['semaglutide']).toBe(0.27);
  });
});
