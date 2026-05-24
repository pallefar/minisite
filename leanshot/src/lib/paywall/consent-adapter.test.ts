/**
 * Phase 39 Plan 39-04 — consent-adapter tests.
 *
 * RESEARCH OQ-2 resolution: Phase 22 vanilla-cookieconsent exposes
 * `CookieConsent.acceptedCategory('analytics')` — NOT a boolean
 * `tracking` flag. The adapter wraps this so paywall surfaces see a
 * single stable boolean contract regardless of upstream shape.
 *
 * Defensive cases: if vanilla-cookieconsent hasn't loaded yet (Phase 22
 * idle-deferred dynamic import), `acceptedCategory` may be undefined OR
 * throw — return `false` (privacy-default).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Top-level dynamic mock so we can reset implementation per test.
const acceptedCategoryMock = vi.fn<(cat: string) => boolean>();

vi.mock('vanilla-cookieconsent', () => ({
  acceptedCategory: (cat: string) => acceptedCategoryMock(cat),
}));

describe('getPaywallTrackingConsent', () => {
  beforeEach(() => {
    acceptedCategoryMock.mockReset();
  });
  afterEach(() => {
    vi.resetModules();
  });

  it('returns true when CookieConsent.acceptedCategory("analytics") === true', async () => {
    acceptedCategoryMock.mockImplementation((cat) => cat === 'analytics');
    const { getPaywallTrackingConsent } = await import('./consent-adapter');
    expect(getPaywallTrackingConsent()).toBe(true);
  });

  it('returns false when CookieConsent.acceptedCategory("analytics") === false', async () => {
    acceptedCategoryMock.mockImplementation(() => false);
    const { getPaywallTrackingConsent } = await import('./consent-adapter');
    expect(getPaywallTrackingConsent()).toBe(false);
  });

  it('returns false when acceptedCategory returns undefined (library not loaded)', async () => {
    acceptedCategoryMock.mockImplementation((): boolean => undefined as unknown as boolean);
    const { getPaywallTrackingConsent } = await import('./consent-adapter');
    expect(getPaywallTrackingConsent()).toBe(false);
  });

  it('returns false when acceptedCategory throws (defensive guard)', async () => {
    acceptedCategoryMock.mockImplementation(() => {
      throw new Error('library not yet initialised');
    });
    const { getPaywallTrackingConsent } = await import('./consent-adapter');
    expect(getPaywallTrackingConsent()).toBe(false);
  });

  it('returns false when given a non-boolean truthy value (defensive boolean coercion)', async () => {
    // Some library versions return objects from acceptedCategory; the adapter
    // MUST collapse to a strict boolean and refuse anything that is not
    // literally `true`.
    acceptedCategoryMock.mockImplementation(() => 'yes' as unknown as boolean);
    const { getPaywallTrackingConsent } = await import('./consent-adapter');
    expect(getPaywallTrackingConsent()).toBe(false);
  });
});
