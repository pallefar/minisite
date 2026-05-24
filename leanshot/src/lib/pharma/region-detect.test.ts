/**
 * Phase 39 Plan 39-05 Task 1 — region-detect tests (D-07 client-side layer).
 *
 * D-07: WMHMDA (WA) + CTDPA (CT) region detection. Vercel edge sets the
 * `lt_pharma_blocked` cookie based on `x-vercel-ip-country-region` at first
 * touch; on signup, `profile.state_of_residence` (when present) supersedes
 * — profile wins. region-detect is the client-side companion: it reads the
 * cookie AND the Zustand store-mirror of the profile state.
 *
 * Branch matrix:
 *   (a) cookie=1                          -> true
 *   (b) cookie absent + profile=WA        -> true
 *   (c) cookie absent + profile=CT        -> true
 *   (d) cookie absent + profile=CA        -> false
 *   (e) document undefined (SSR)          -> false
 *   (f) profile wins over absent cookie   -> profile-only path is sufficient
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock the store BEFORE importing region-detect (it reads getState() inline).
const getStateMock = vi.fn<() => { user: { state_of_residence?: string | null } | null }>();
vi.mock('@/lib/store', () => ({
  useStore: {
    getState: () => getStateMock(),
  },
}));

import { isPharmaRegionBlocked } from './region-detect';

function setCookie(value: string | null): void {
  if (value === null) {
    Object.defineProperty(document, 'cookie', {
      configurable: true,
      get: () => '',
      set: () => {},
    });
    return;
  }
  Object.defineProperty(document, 'cookie', {
    configurable: true,
    get: () => value,
    set: () => {},
  });
}

describe('isPharmaRegionBlocked (D-07 client-side)', () => {
  beforeEach(() => {
    getStateMock.mockReset();
    getStateMock.mockReturnValue({ user: null });
    setCookie(null);
  });
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('(a) returns true when cookie lt_pharma_blocked=1 is present', () => {
    setCookie('lt_pharma_blocked=1');
    expect(isPharmaRegionBlocked()).toBe(true);
  });

  it('(a2) returns true when cookie is one of many cookies', () => {
    setCookie('foo=bar; lt_pharma_blocked=1; baz=qux');
    expect(isPharmaRegionBlocked()).toBe(true);
  });

  it('(b) returns true when cookie absent and profile.state_of_residence=WA', () => {
    setCookie(null);
    getStateMock.mockReturnValue({ user: { state_of_residence: 'WA' } });
    expect(isPharmaRegionBlocked()).toBe(true);
  });

  it('(c) returns true when cookie absent and profile.state_of_residence=CT', () => {
    setCookie(null);
    getStateMock.mockReturnValue({ user: { state_of_residence: 'CT' } });
    expect(isPharmaRegionBlocked()).toBe(true);
  });

  it('(d) returns false when cookie absent and profile.state_of_residence=CA', () => {
    setCookie(null);
    getStateMock.mockReturnValue({ user: { state_of_residence: 'CA' } });
    expect(isPharmaRegionBlocked()).toBe(false);
  });

  it('(d2) returns false when cookie absent and profile is null (anonymous user)', () => {
    setCookie(null);
    getStateMock.mockReturnValue({ user: null });
    expect(isPharmaRegionBlocked()).toBe(false);
  });

  it('(e) returns false when document is undefined (SSR-safe)', () => {
    const origDocument = globalThis.document;
    // @ts-expect-error: deliberately remove for SSR-safety probe
    delete (globalThis as { document?: Document }).document;
    try {
      expect(isPharmaRegionBlocked()).toBe(false);
    } finally {
      (globalThis as { document?: Document }).document = origDocument;
    }
  });

  it('(f) profile-only signal (no cookie) is sufficient to return true (D-07 profile-wins precedence)', () => {
    // Confirms that profile path alone is enough; cookie is not required when profile asserts WA/CT.
    setCookie(null);
    getStateMock.mockReturnValue({ user: { state_of_residence: 'WA' } });
    expect(isPharmaRegionBlocked()).toBe(true);
  });

  it('case-insensitive on profile state code (regulatory robustness)', () => {
    setCookie(null);
    getStateMock.mockReturnValue({ user: { state_of_residence: 'wa' } });
    expect(isPharmaRegionBlocked()).toBe(true);
  });
});
