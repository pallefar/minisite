/**
 * Phase 22 plan 22-10 — Pattern 3: vanilla-cookieconsent config + Consent Mode v2 bridge.
 *
 * Behaviors covered:
 *   1. consentModal layout='box inline' + position='bottom right' (UI-SPEC §banner).
 *   2. EU geo (DE) → analytics category enabled=false (privacy default).
 *   3. US geo (US) → analytics category enabled=true (CCPA opt-out).
 *   4. Unknown geo (no __VERCEL_GEO__) → analytics enabled=false (fail-safe per T-22-58).
 *   5. onConsent callback invokes upsertConsentRecord + gtag('consent','update', ...).
 *   6. categories.analytics declares a 'services' map containing 'posthog' (Pitfall 7).
 *   7. categories.necessary is readOnly + enabled.
 *   8. cookie.name === 'cc_cookie' + cookie.expiresAfterDays === 182.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock the consent-records writer so we can spy on it without hitting supabase.
const upsertConsentRecordSpy = vi.fn(async () => {});
vi.mock('@/lib/consent/consent-records', () => ({
  upsertConsentRecord: (...args: unknown[]) => upsertConsentRecordSpy(...args),
}));

// Capture the CookieConsent.run config so we can inspect it deterministically.
let capturedConfig: Record<string, unknown> | null = null;
const acceptedCategoryMock = vi.fn((_cat: string) => false);
const acceptedServiceMock = vi.fn((_svc: string, _cat: string) => false);

vi.mock('vanilla-cookieconsent', () => ({
  run: (config: Record<string, unknown>) => {
    capturedConfig = config;
    return Promise.resolve();
  },
  acceptedCategory: (cat: string) => acceptedCategoryMock(cat),
  acceptedService: (svc: string, cat: string) => acceptedServiceMock(svc, cat),
}));

interface ConsentConfigBucket {
  categories: {
    necessary: { enabled?: boolean; readOnly?: boolean };
    analytics: { enabled?: boolean; services?: Record<string, unknown> };
    marketing: { enabled?: boolean };
    personalization: { enabled?: boolean };
  };
  guiOptions: {
    consentModal: { layout?: string; position?: string };
    preferencesModal: { layout?: string };
  };
  cookie: { name?: string; expiresAfterDays?: number };
  onFirstConsent: (arg: { cookie: unknown }) => void;
  onConsent: (arg: { cookie: unknown }) => void;
  onChange: (arg: { cookie: unknown }) => void;
}

interface GeoWindow extends Window {
  __VERCEL_GEO__?: { country?: string };
  dataLayer?: unknown[];
}

async function loadInitWithGeo(country: string | undefined): Promise<ConsentConfigBucket> {
  // Reset module graph so consent-config recomputes isEU from the current window state.
  vi.resetModules();
  capturedConfig = null;
  if (country === undefined) {
    delete (window as GeoWindow).__VERCEL_GEO__;
  } else {
    (window as GeoWindow).__VERCEL_GEO__ = { country };
  }
  (window as GeoWindow).dataLayer = [];
  const mod = await import('@/components/consent/consent-config');
  mod.initCookieConsent();
  if (!capturedConfig) throw new Error('CookieConsent.run was never called');
  return capturedConfig as unknown as ConsentConfigBucket;
}

describe('consent-config (Phase 22 GDPR-01 Pattern 3 banner)', () => {
  beforeEach(() => {
    upsertConsentRecordSpy.mockReset();
    acceptedCategoryMock.mockReset();
    acceptedServiceMock.mockReset();
  });

  afterEach(() => {
    delete (window as GeoWindow).__VERCEL_GEO__;
    delete (window as GeoWindow).dataLayer;
  });

  it('UI-SPEC §banner: consentModal uses box-inline + bottom-right layout', async () => {
    const cfg = await loadInitWithGeo('US');
    expect(cfg.guiOptions.consentModal.layout).toBe('box inline');
    expect(cfg.guiOptions.consentModal.position).toBe('bottom right');
    expect(cfg.guiOptions.preferencesModal.layout).toBe('box');
  });

  it('cookie name + lifetime match spec (cc_cookie / 182d)', async () => {
    const cfg = await loadInitWithGeo('US');
    expect(cfg.cookie.name).toBe('cc_cookie');
    expect(cfg.cookie.expiresAfterDays).toBe(182);
  });

  it('necessary category is enabled + readOnly', async () => {
    const cfg = await loadInitWithGeo('US');
    expect(cfg.categories.necessary.enabled).toBe(true);
    expect(cfg.categories.necessary.readOnly).toBe(true);
  });

  it('EU geo (DE) → analytics category enabled=false (privacy default)', async () => {
    const cfg = await loadInitWithGeo('DE');
    expect(cfg.categories.analytics.enabled).toBe(false);
  });

  it('US geo → analytics category enabled=true (CCPA opt-out)', async () => {
    const cfg = await loadInitWithGeo('US');
    expect(cfg.categories.analytics.enabled).toBe(true);
  });

  it('unknown geo (no __VERCEL_GEO__) → analytics enabled=false (fail-safe per T-22-58)', async () => {
    const cfg = await loadInitWithGeo(undefined);
    expect(cfg.categories.analytics.enabled).toBe(false);
  });

  it('Pitfall 7: analytics category declares services.posthog for acceptedService() gate', async () => {
    const cfg = await loadInitWithGeo('US');
    expect(cfg.categories.analytics.services).toBeDefined();
    expect(cfg.categories.analytics.services?.posthog).toBeDefined();
  });

  it('onConsent invokes upsertConsentRecord + pushes consent-update to gtag dataLayer', async () => {
    const cfg = await loadInitWithGeo('US');
    acceptedCategoryMock.mockImplementation((cat: string) => cat === 'analytics');
    const fakeCookie = { categories: ['necessary', 'analytics'], consentId: 'uuid-abc' };
    cfg.onConsent({ cookie: fakeCookie });
    expect(upsertConsentRecordSpy).toHaveBeenCalledWith(fakeCookie);
    // gtag('consent','update', ...) writes via dataLayer.push(arguments)
    const dl = (window as GeoWindow).dataLayer ?? [];
    const sawConsentUpdate = dl.some((entry) => {
      // arguments-object has 0,1,2... keys
      const e = entry as Record<string, unknown>;
      return e[0] === 'consent' && e[1] === 'update';
    });
    expect(sawConsentUpdate).toBe(true);
  });
});
