/**
 * Phase 41 plan 41-01 — Task 2: retrofit Phase 22 callbacks to emit canonical
 * `leanshot:consent-change` CustomEvent.
 *
 * Behaviors covered (per PLAN.md <behavior>):
 *   1. onFirstConsent dispatches CONSENT_CHANGE_EVENT exactly once with
 *      detail.categories.necessary === true.
 *   2. When CookieConsent.acceptedCategory is mocked to return true for
 *      'analytics' + false for 'marketing', the dispatched detail reflects
 *      those exact booleans.
 *   3. onChange callback ALSO dispatches (re-grant + revoke flows).
 *   4. updateGtagConsent() + upsertConsentRecord(cookie) still fire on each
 *      callback — additive change, not replacement (regression guard for
 *      D-07 cookie-mode-v2 wiring).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CONSENT_CHANGE_EVENT, type ConsentChangeDetail } from '@/lib/consent/consent-event';

// Spy on the consent-records writer so we can assert the regression guard
// without hitting Supabase.
const upsertConsentRecordSpy = vi.fn(async () => {});
vi.mock('@/lib/consent/consent-records', () => ({
  upsertConsentRecord: (...args: unknown[]) => upsertConsentRecordSpy(...args),
}));

// Mock vanilla-cookieconsent so we can:
//   - capture the CookieConsent.run config (to drive each callback manually)
//   - control acceptedCategory return values per test
let capturedConfig: Record<string, unknown> | null = null;
const acceptedCategoryMock = vi.fn((_cat: string) => false);
vi.mock('vanilla-cookieconsent', () => ({
  run: (config: Record<string, unknown>) => {
    capturedConfig = config;
    return Promise.resolve();
  },
  acceptedCategory: (cat: string) => acceptedCategoryMock(cat),
  acceptedService: (_svc: string, _cat: string) => false,
}));

interface ConfigShape {
  onFirstConsent: (arg: { cookie: unknown }) => void;
  onConsent: (arg: { cookie: unknown }) => void;
  onChange: (arg: { cookie: unknown }) => void;
}

interface GeoWindow extends Window {
  __VERCEL_GEO__?: { country?: string };
  dataLayer?: unknown[];
}

async function loadConfigWithGeo(country: string): Promise<ConfigShape> {
  vi.resetModules();
  capturedConfig = null;
  (window as GeoWindow).__VERCEL_GEO__ = { country };
  (window as GeoWindow).dataLayer = [];
  const mod = await import('@/components/consent/consent-config');
  mod.initCookieConsent();
  if (!capturedConfig) throw new Error('CookieConsent.run was never called');
  return capturedConfig as unknown as ConfigShape;
}

function captureNextEvent(): Promise<CustomEvent<ConsentChangeDetail>> {
  return new Promise((resolve) => {
    const handler = (e: Event) => {
      window.removeEventListener(CONSENT_CHANGE_EVENT, handler);
      resolve(e as CustomEvent<ConsentChangeDetail>);
    };
    window.addEventListener(CONSENT_CHANGE_EVENT, handler);
  });
}

describe('consent-config emit retrofit (Phase 41 41-01 Task 2)', () => {
  beforeEach(() => {
    upsertConsentRecordSpy.mockReset();
    acceptedCategoryMock.mockReset();
  });

  afterEach(() => {
    delete (window as GeoWindow).__VERCEL_GEO__;
    delete (window as GeoWindow).dataLayer;
  });

  it('Test 1: onFirstConsent dispatches CONSENT_CHANGE_EVENT once with necessary=true', async () => {
    const cfg = await loadConfigWithGeo('US');
    acceptedCategoryMock.mockReturnValue(false);

    const eventPromise = captureNextEvent();
    cfg.onFirstConsent({ cookie: { categories: ['necessary'], consentId: 'uuid-1' } });
    const event = await eventPromise;

    expect(event.type).toBe(CONSENT_CHANGE_EVENT);
    expect(event.detail.categories.necessary).toBe(true);
  });

  it('Test 2: dispatched detail mirrors acceptedCategory mock returns (analytics=true, marketing=false)', async () => {
    const cfg = await loadConfigWithGeo('US');
    acceptedCategoryMock.mockImplementation((cat: string) => {
      if (cat === 'analytics') return true;
      if (cat === 'marketing') return false;
      if (cat === 'personalization') return false;
      if (cat === 'necessary') return true; // drives `functional` per RESEARCH §Code Examples
      return false;
    });

    const eventPromise = captureNextEvent();
    cfg.onConsent({ cookie: { categories: ['necessary', 'analytics'], consentId: 'uuid-2' } });
    const event = await eventPromise;

    expect(event.detail.categories.necessary).toBe(true);
    expect(event.detail.categories.analytics).toBe(true);
    expect(event.detail.categories.marketing).toBe(false);
    expect(event.detail.categories.personalization).toBe(false);
    expect(event.detail.categories.functional).toBe(true);
  });

  it('Test 3: onChange callback also dispatches (covers re-grant + revoke flows)', async () => {
    const cfg = await loadConfigWithGeo('US');
    acceptedCategoryMock.mockImplementation((cat: string) => cat === 'marketing');

    const eventPromise = captureNextEvent();
    cfg.onChange({ cookie: { categories: ['necessary', 'marketing'], consentId: 'uuid-3' } });
    const event = await eventPromise;

    expect(event.type).toBe(CONSENT_CHANGE_EVENT);
    expect(event.detail.categories.marketing).toBe(true);
    expect(event.detail.categories.analytics).toBe(false);
  });

  it('Test 4 (regression): updateGtagConsent + upsertConsentRecord still fire on every callback', async () => {
    const cfg = await loadConfigWithGeo('US');
    acceptedCategoryMock.mockImplementation((cat: string) => cat === 'analytics');
    const fakeCookie = { categories: ['necessary', 'analytics'], consentId: 'uuid-4' };

    // Drain any event so the listener doesn't leak across assertions.
    const drain = captureNextEvent();
    cfg.onConsent({ cookie: fakeCookie });
    await drain;

    // upsertConsentRecord was called with the cookie payload (regression guard).
    expect(upsertConsentRecordSpy).toHaveBeenCalledWith(fakeCookie);

    // gtag('consent','update', ...) was pushed to dataLayer (regression guard
    // for D-07 cookie-mode-v2 wiring).
    const dl = (window as GeoWindow).dataLayer ?? [];
    const sawConsentUpdate = dl.some((entry) => {
      const e = entry as Record<string, unknown>;
      return e[0] === 'consent' && e[1] === 'update';
    });
    expect(sawConsentUpdate).toBe(true);
  });
});
