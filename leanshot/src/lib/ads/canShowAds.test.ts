/**
 * Phase 56 Plan 01 — canShowAds surface+tier guard tests (AD-03, AD-10).
 *
 * Exhaustive coverage of the MUST-NEVER trust boundary:
 *   - tier === 'paid' → false on ALL surfaces
 *   - excluded surfaces → false at free / past_due
 *   - allowed surfaces → true at free / past_due
 *   - EXCLUDED_SURFACES set membership (exactly 7 entries)
 */
import { describe, it, expect } from 'vitest';
import type { Tier } from '@/types';
import { canShowAds, EXCLUDED_SURFACES, type AdSurface } from './canShowAds';

const EXCLUDED_SURFACE_LIST: AdSurface[] = [
  'clinic',
  'clinic-settings',
  'clinic-drill-in',
  'share',
  'admin',
  'dose-log',
  'patient',
];

const ALLOWED_SURFACE_LIST: AdSurface[] = [
  'home',
  'body',
  'nutrition',
  'activity',
  'supplements',
  'mood',
  'insights',
  'community',
  'classroom',
  'events',
  'marketing',
  'onboarding',
];

describe('EXCLUDED_SURFACES set membership', () => {
  it('contains exactly 7 surfaces', () => {
    expect(EXCLUDED_SURFACES.size).toBe(7);
  });

  it('contains all 7 MUST-NEVER surfaces', () => {
    for (const s of EXCLUDED_SURFACE_LIST) {
      expect(EXCLUDED_SURFACES.has(s), `EXCLUDED_SURFACES must contain '${s}'`).toBe(true);
    }
  });

  it('does not contain any allowed surface', () => {
    for (const s of ALLOWED_SURFACE_LIST) {
      expect(EXCLUDED_SURFACES.has(s), `EXCLUDED_SURFACES must NOT contain '${s}'`).toBe(false);
    }
  });
});

describe('canShowAds — tier === "paid" → false on ALL surfaces', () => {
  it('returns false for paid on every excluded surface', () => {
    for (const s of EXCLUDED_SURFACE_LIST) {
      expect(canShowAds(s, 'paid'), `paid + ${s} should be false`).toBe(false);
    }
  });

  it('returns false for paid on every allowed surface', () => {
    for (const s of ALLOWED_SURFACE_LIST) {
      expect(canShowAds(s, 'paid'), `paid + ${s} should be false`).toBe(false);
    }
  });
});

describe('canShowAds — free tier', () => {
  it('returns false for every excluded surface at free tier', () => {
    for (const s of EXCLUDED_SURFACE_LIST) {
      expect(canShowAds(s, 'free'), `free + ${s} should be false`).toBe(false);
    }
  });

  it('returns true for every allowed surface at free tier', () => {
    for (const s of ALLOWED_SURFACE_LIST) {
      expect(canShowAds(s, 'free'), `free + ${s} should be true`).toBe(true);
    }
  });
});

describe('canShowAds — past_due tier', () => {
  it('returns false for every excluded surface at past_due (exclusion wins)', () => {
    for (const s of EXCLUDED_SURFACE_LIST) {
      expect(canShowAds(s, 'past_due'), `past_due + ${s} should be false`).toBe(false);
    }
  });

  it('returns true for every allowed surface at past_due', () => {
    for (const s of ALLOWED_SURFACE_LIST) {
      expect(canShowAds(s, 'past_due'), `past_due + ${s} should be true`).toBe(true);
    }
  });
});

describe('canShowAds — spot checks', () => {
  const cases: [AdSurface, Tier, boolean][] = [
    ['home', 'free', true],
    ['home', 'paid', false],
    ['home', 'past_due', true],
    ['clinic', 'free', false],
    ['clinic', 'paid', false],
    ['clinic', 'past_due', false],
    ['admin', 'free', false],
    ['share', 'free', false],
    ['dose-log', 'free', false],
    ['patient', 'free', false],
    ['community', 'free', true],
    ['marketing', 'past_due', true],
  ];

  it.each(cases)('canShowAds(%s, %s) === %s', (surface, tier, expected) => {
    expect(canShowAds(surface, tier)).toBe(expected);
  });
});
