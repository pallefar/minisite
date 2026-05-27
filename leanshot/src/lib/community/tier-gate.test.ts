/**
 * Phase 44 (extended Phase 46 Plan 03) — tier-gate unit tests.
 *
 * NOTE: This file was created in Phase 46 Plan 03 even though tier-gate.ts ships
 * from Phase 44; no test file existed previously. Per executor deviation Rule 3
 * the file was added so the new `isResourceAllowed` extension could land under
 * TDD (RED → GREEN).
 *
 * Covers:
 *   - isVideoAllowed (Phase 44 D-06) — pre-existing function, baseline coverage
 *   - canAccessSpace (Phase 44 D-08) — pre-existing function, baseline coverage
 *   - isResourceAllowed (Phase 46 D-16 / COURSE-06) — NEW in Plan 46-03
 */
import { describe, it, expect } from 'vitest';
import type { TierLabel } from '@/lib/community/community-types';
import {
  isVideoAllowed,
  canAccessSpace,
  isResourceAllowed,
  type ResourceType,
} from '@/lib/community/tier-gate';

// ─── Phase 44 baseline coverage ───────────────────────────────────────────────

describe('isVideoAllowed (Phase 44 D-06)', () => {
  it('returns false for free tier', () => {
    expect(isVideoAllowed('free')).toBe(false);
  });

  it('returns true for pro, lifetime, trial tiers', () => {
    expect(isVideoAllowed('pro')).toBe(true);
    expect(isVideoAllowed('lifetime')).toBe(true);
    expect(isVideoAllowed('trial')).toBe(true);
  });
});

describe('canAccessSpace (Phase 44 D-08)', () => {
  it('free space is accessible by all tiers', () => {
    expect(canAccessSpace('free', 'free')).toBe(true);
    expect(canAccessSpace('free', 'trial')).toBe(true);
    expect(canAccessSpace('free', 'pro')).toBe(true);
    expect(canAccessSpace('free', 'lifetime')).toBe(true);
  });

  it('pro space is accessible by pro, trial, lifetime — not free', () => {
    expect(canAccessSpace('pro', 'free')).toBe(false);
    expect(canAccessSpace('pro', 'trial')).toBe(true);
    expect(canAccessSpace('pro', 'pro')).toBe(true);
    expect(canAccessSpace('pro', 'lifetime')).toBe(true);
  });

  it('lifetime space is accessible by lifetime only', () => {
    expect(canAccessSpace('lifetime', 'free')).toBe(false);
    expect(canAccessSpace('lifetime', 'trial')).toBe(false);
    expect(canAccessSpace('lifetime', 'pro')).toBe(false);
    expect(canAccessSpace('lifetime', 'lifetime')).toBe(true);
  });
});

// ─── Phase 46 Plan 03 NEW coverage (D-16 / COURSE-06) ─────────────────────────

describe('isResourceAllowed (Phase 46 D-16 / COURSE-06)', () => {
  const resourceTypes: ResourceType[] = ['pdf', 'video', 'zip'];

  it.each(resourceTypes)('returns false for free tier (resource=%s)', (resourceType) => {
    expect(isResourceAllowed('free', resourceType)).toBe(false);
  });

  it('returns true for pro + pdf', () => {
    expect(isResourceAllowed('pro', 'pdf')).toBe(true);
  });

  it('returns true for lifetime + video', () => {
    expect(isResourceAllowed('lifetime', 'video')).toBe(true);
  });

  it('returns true for trial + zip', () => {
    expect(isResourceAllowed('trial', 'zip')).toBe(true);
  });

  it('returns false for unknown tier (any string outside the 4-way union)', () => {
    // Cast through TierLabel to model the "TierLabel widened by an unknown
    // upstream label" scenario (e.g. clinic_member from a future phase).
    expect(isResourceAllowed('clinic_member' as TierLabel, 'pdf')).toBe(false);
  });
});
