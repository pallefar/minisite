/**
 * Phase 64 Plan 64-07 — CPRA compliance tests for cookie banner copy.
 *
 * Behaviors covered:
 *   1. US users (isEU=false): consentModal description contains 'Do Not Sell or Share' linking to /privacy/do-not-sell
 *   2. US users: description contains sign-in rate-limiting mention (AUTH-16 cross-reference)
 *   3. EU users (isEU=true): description does NOT include the Do Not Sell link (CCPA-specific)
 *   4. preferencesModal 'Further information' section retains privacy@leanshot.app AND mentions /privacy/do-not-sell
 *   5. US banner copy stays under 600 characters (UI density / WCAG readability budget)
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock consent-records so we don't hit supabase.
const upsertConsentRecordSpy = vi.fn(async () => {});
vi.mock('@/lib/consent/consent-records', () => ({
  upsertConsentRecord: (...args: unknown[]) => upsertConsentRecordSpy(...args),
}));

// Capture the CookieConsent.run config so we can inspect it deterministically.
let capturedConfig: Record<string, unknown> | null = null;
const acceptedCategoryMock = vi.fn((_cat: string) => false);

vi.mock('vanilla-cookieconsent', () => ({
  run: (config: Record<string, unknown>) => {
    capturedConfig = config;
    return Promise.resolve();
  },
  acceptedCategory: (cat: string) => acceptedCategoryMock(cat),
  acceptedService: vi.fn(),
}));

interface TranslationSection {
  title: string;
  description?: string;
}

interface EnTranslation {
  consentModal: {
    description: string;
  };
  preferencesModal: {
    sections: TranslationSection[];
  };
}

interface ConsentConfigBucket {
  language: {
    translations: {
      en: EnTranslation;
    };
  };
}

interface GeoWindow extends Window {
  __VERCEL_GEO__?: { country?: string };
  dataLayer?: unknown[];
}

async function loadInitWithGeo(country: string | undefined): Promise<ConsentConfigBucket> {
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

function getUsBannerDescription(cfg: ConsentConfigBucket): string {
  return cfg.language.translations.en.consentModal.description;
}

function getFurtherInfoDescription(cfg: ConsentConfigBucket): string | undefined {
  const sections = cfg.language.translations.en.preferencesModal.sections;
  const furtherInfo = sections.find((s) => s.title === 'Further information');
  return furtherInfo?.description;
}

describe('consent-config CPRA compliance (Phase 64 LEGAL-07 + AUTH-16)', () => {
  beforeEach(() => {
    upsertConsentRecordSpy.mockReset();
    acceptedCategoryMock.mockReset();
  });

  afterEach(() => {
    delete (window as GeoWindow).__VERCEL_GEO__;
    delete (window as GeoWindow).dataLayer;
  });

  it('Test 1: US users — consentModal description contains Do Not Sell or Share linking to /privacy/do-not-sell', async () => {
    const cfg = await loadInitWithGeo('US');
    const desc = getUsBannerDescription(cfg);
    expect(desc).toContain('Do Not Sell or Share');
    expect(desc).toContain('/privacy/do-not-sell');
  });

  it('Test 2: US users — description mentions sign-in rate-limiting (AUTH-16 cross-reference)', async () => {
    const cfg = await loadInitWithGeo('US');
    const desc = getUsBannerDescription(cfg);
    expect(desc).toMatch(/sign.in.*rate.limit|rate.limit.*sign.in/i);
  });

  it('Test 3: EU users — description does NOT include Do Not Sell link (CCPA-specific only)', async () => {
    const cfg = await loadInitWithGeo('DE');
    const desc = getUsBannerDescription(cfg);
    expect(desc).not.toContain('Do Not Sell');
    expect(desc).not.toContain('/privacy/do-not-sell');
  });

  it('Test 4: preferencesModal Further information section contains privacy@leanshot.app AND /privacy/do-not-sell', async () => {
    const cfg = await loadInitWithGeo('US');
    const furtherInfo = getFurtherInfoDescription(cfg);
    expect(furtherInfo).toBeDefined();
    expect(furtherInfo).toContain('privacy@leanshot.app');
    expect(furtherInfo).toContain('/privacy/do-not-sell');
  });

  it('Test 5: US banner copy stays under 600 characters (WCAG readability budget)', async () => {
    const cfg = await loadInitWithGeo('US');
    const desc = getUsBannerDescription(cfg);
    // Strip HTML tags to measure readable character count
    const textOnly = desc.replace(/<[^>]+>/g, '');
    expect(textOnly.length).toBeLessThan(600);
  });
});
