/**
 * Phase 22 Plan 22-10 — Pattern 3: vanilla-cookieconsent v3 config with
 * Google Consent Mode v2 bridge (GDPR-01 banner).
 *
 * D-07 from 22-CONTEXT.md: bottom slide-up modal with Accept all / Reject all
 * / Customize, inline-expand to 4 categories (Essential / Analytics /
 * Marketing / Personalization).
 *
 * Geo-aware defaults (T-22-58 fail-safe direction):
 *   - EU country code     → analytics OFF until explicit grant.
 *   - US country code     → analytics ON by default (CCPA opt-out model).
 *   - Unknown/null geo    → analytics OFF (privacy-default fallback when
 *                            window.__VERCEL_GEO__ is unavailable; corrects
 *                            the literal `!isEU` flip in 22-RESEARCH §Pattern 3
 *                            which would silently default to US treatment on
 *                            edge cases per T-22-58).
 *
 * Pitfall 7 compliance (22-RESEARCH §Pitfalls): analytics category declares
 * `services: { posthog: {...} }` so `acceptedService('posthog', 'analytics')`
 * works for the per-service Consent Mode v2 distinction
 * (analytics_storage vs ad_storage).
 *
 * Bundle contract: this module is reached ONLY via the dynamic-import gate
 * in src/lib/consent/consent-defer.ts. Value-importing `vanilla-cookieconsent`
 * here is safe — the entire module sits in a lazy chunk.
 */
import * as CookieConsent from 'vanilla-cookieconsent';
// Phase 22 plan 22-12 — vanilla-cookieconsent's stylesheet is REQUIRED for
// the banner to render (without it the modal is in the DOM but invisible).
// The import is a side-effect-only `import` that Vite bundles into the same
// lazy chunk as this module, preserving the Pattern 4 dynamic-import gate
// (consent-config + its CSS both stay off the index static graph).
import 'vanilla-cookieconsent/dist/cookieconsent.css';

import { CONSENT_CHANGE_EVENT, type ConsentChangeDetail } from '@/lib/consent/consent-event';
import { upsertConsentRecord } from '@/lib/consent/consent-records';

/**
 * 27 EU member states + UK (post-Brexit, still GDPR-equivalent under UK GDPR).
 * Source: 22-RESEARCH §Specifics line 142.
 */
const EU_COUNTRIES = new Set([
  'AT', 'BE', 'BG', 'CY', 'CZ', 'DE', 'DK', 'EE', 'ES', 'FI',
  'FR', 'GR', 'HR', 'HU', 'IE', 'IT', 'LT', 'LU', 'LV', 'MT',
  'NL', 'PL', 'PT', 'RO', 'SE', 'SI', 'SK', 'GB',
]);

interface VercelGeoWindow extends Window {
  __VERCEL_GEO__?: { country?: string };
  dataLayer?: unknown[];
}

function readGeoCountry(): string | undefined {
  if (typeof window === 'undefined') return undefined;
  // Phase 22 plan 22-12 — `?force_geo=eu|us|de|fr|...` query-param override
  // for e2e tests + manual smoke. Honored before window.__VERCEL_GEO__ so a
  // test can deterministically exercise either branch of the EU/US fork.
  // Production never sets this param; Vercel geo header drives the
  // window.__VERCEL_GEO__ value normally.
  try {
    const params = new URLSearchParams(window.location.search);
    const forced = params.get('force_geo');
    if (forced) {
      const up = forced.toUpperCase();
      // `eu` is a meta-token: choose any EU member state (DE picked here).
      if (up === 'EU') return 'DE';
      // `us` is the non-EU sentinel.
      if (up === 'US') return 'US';
      // Otherwise treat as an ISO country code (already uppercased).
      return up;
    }
  } catch {
    /* URLSearchParams unavailable or window.location.search missing — fall through */
  }
  return (window as VercelGeoWindow).__VERCEL_GEO__?.country;
}

/**
 * Privacy-default direction for unknown geo: treat as EU.
 * Matches T-22-58 ("fail-safe direction"); corrects the literal
 * `country ? EU.includes(country) : false` from 22-RESEARCH which would
 * incorrectly default to US treatment when Vercel geo headers are missing.
 */
function computeIsEU(country: string | undefined): boolean {
  if (!country) return true; // privacy-default
  return EU_COUNTRIES.has(country);
}

/**
 * Push a Consent Mode v2 update to gtag's dataLayer.
 *
 * NOTE: Google's Consent Mode v2 reference impl uses
 * `dataLayer.push(arguments)` (the arguments object) — preserve that shape
 * so gtag.js's deserializer reads positional args correctly. The `_args`
 * rest param is required by TypeScript so callers get a typed signature
 * even though we read from `arguments` at runtime.
 */
 
function gtag(..._args: unknown[]): void {
  const w = window as VercelGeoWindow;
  if (!w.dataLayer) w.dataLayer = [];
  // eslint-disable-next-line prefer-rest-params
  w.dataLayer.push(arguments);
}

function applyDefaultConsentState(isEU: boolean): void {
  gtag('consent', 'default', {
    ad_storage: 'denied',
    ad_user_data: 'denied',
    ad_personalization: 'denied',
    analytics_storage: isEU ? 'denied' : 'granted',
    functionality_storage: 'granted',
    personalization_storage: 'denied',
    security_storage: 'granted',
  });
}

function updateGtagConsent(): void {
  gtag('consent', 'update', {
    analytics_storage: CookieConsent.acceptedCategory('analytics') ? 'granted' : 'denied',
    ad_storage: CookieConsent.acceptedCategory('marketing') ? 'granted' : 'denied',
    ad_user_data: CookieConsent.acceptedCategory('marketing') ? 'granted' : 'denied',
    ad_personalization: CookieConsent.acceptedCategory('marketing') ? 'granted' : 'denied',
    personalization_storage: CookieConsent.acceptedCategory('personalization') ? 'granted' : 'denied',
  });
}

/**
 * Phase 41 plan 41-01 (D-09 foundation) — emit the canonical
 * `leanshot:consent-change` CustomEvent so downstream subscribers (Plan 41-05
 * ConsentGatedEmbed HOC, Plan 41-03 Deno-rendered marketing pages) can
 * auto-load embeds the moment the user grants the required category.
 *
 * Additive only — Phase 22 side-effects (updateGtagConsent +
 * upsertConsentRecord) still fire BEFORE this emit so persisted state is in
 * sync when subscribers read `cc_cookie` (T-41-01-03 mitigation).
 *
 * The `functional` category mirrors `acceptedCategory('necessary')` per
 * RESEARCH §Code Examples (no separate functional toggle in v3 schema).
 */
function emitConsentChange(): void {
  if (typeof window === 'undefined') return;
  const detail: ConsentChangeDetail = {
    categories: {
      necessary: true,
      analytics: CookieConsent.acceptedCategory('analytics'),
      marketing: CookieConsent.acceptedCategory('marketing'),
      personalization: CookieConsent.acceptedCategory('personalization'),
      functional: CookieConsent.acceptedCategory('necessary'),
    },
  };
  window.dispatchEvent(new CustomEvent<ConsentChangeDetail>(CONSENT_CHANGE_EVENT, { detail }));
}

/**
 * Phase 64 Plan 64-07 (LEGAL-07 + AUTH-16) — Build the US-specific consentModal
 * description string. Exported as a testable pure helper to avoid triggering the
 * vanilla-cookieconsent value-import during unit tests (bundle-budget contract per
 * file-header comment). The helper is called once inside initCookieConsent() where
 * isEU is already computed.
 *
 * US copy includes:
 *   - AUTH-16 cross-reference: sign-in rate-limiting mention (CPRA notice-of-security-practices)
 *   - CPRA "Do Not Sell or Share" link to /privacy/do-not-sell (LEGAL-07)
 *     Note: no target="_blank" so it opens in-app per UI-SPEC §6
 */
export function buildConsentModalDescription(isEU: boolean): string {
  if (isEU) {
    return (
      "We use cookies to keep the app working, measure how it\u2019s used, and improve your experience." +
      " You can accept all, reject all, or customize your choices. Essential cookies are always on." +
      " <a href=\"/privacy\" target=\"_blank\">Privacy policy</a>"
    );
  }
  return (
    "We use cookies to keep the app working, measure how it\u2019s used, and improve your experience." +
    " Essential cookies are always on. You can opt out of analytics any time." +
    " We also use sign-in rate-limiting to protect your account." +
    " <a href=\"/privacy\" target=\"_blank\">Privacy policy</a>" +
    " \u00b7 <a href=\"/privacy/do-not-sell\">Do Not Sell or Share My Personal Information</a>"
  );
}
/**
 * Phase 64 Plan 64-07 (LEGAL-07) — Build the preferencesModal "Further information"
 * section description. Includes Do Not Sell or Share anchor + privacy@leanshot.app.
 */
export function buildFurtherInfoDescription(): string {
  return 'Questions? Read our <a href="/privacy" target="_blank">privacy policy</a>, exercise <a href="/privacy/do-not-sell">Do Not Sell or Share</a> rights, or email privacy@leanshot.app.';
}

/**
 * GDPR-01 banner init — called once by `loadConsent()` in consent-defer.ts.
 * Returns void so the caller doesn't need to await the modal-creation promise.
 */
export function initCookieConsent(): void {
  const country = readGeoCountry();
  const isEU = computeIsEU(country);

  // Consent Mode v2 spec: default state MUST be set before any gtag('config')
  // (i.e. before PostHog/GA/Pixel SDK loads). Banner loads via idle callback
  // post-paint; PostHog's existing telemetry-defer waits on the same idle
  // hook, so default-state-first ordering is preserved.
  applyDefaultConsentState(isEU);

  // Phase 22 plan 22-12 — bot-hiding escape hatch for e2e tests.
  // vanilla-cookieconsent v3 defaults `hideFromBots: true` and Playwright's
  // chromium sets navigator.webdriver=true, so the modal would never appear
  // under test even though the library initialized cleanly. The `?force_geo=`
  // query param is the test-only signal (production never sets it, so this
  // is safe to bind 1:1).
  const isTestHarness = (() => {
    try {
      return typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('force_geo');
    } catch {
      return false;
    }
  })();

  void CookieConsent.run({
    // Production keeps the v3 default (true). Tests (`?force_geo=eu|us`)
    // disable it so Playwright can drive the modal.
    hideFromBots: !isTestHarness,
    guiOptions: {
      consentModal: {
        layout: 'box inline',          // UI-SPEC §banner: bottom slide-up
        position: 'bottom right',
        equalWeightButtons: true,
      },
      preferencesModal: {
        layout: 'box',                 // inline-expand customise per D-07
      },
    },
    cookie: { name: 'cc_cookie', expiresAfterDays: 182 },
    categories: {
      necessary: { enabled: true, readOnly: true },
      analytics: {
        enabled: !isEU,                // CCPA opt-out (US ON; EU/unknown OFF)
        autoClear: {
          cookies: [
            { name: /^ph_/ },         // PostHog
            { name: /^_ga/ },         // Google Analytics
            { name: 'posthog_disabled' },
          ],
        },
        services: {
          // Pitfall 7: per-service declaration enables
          // CookieConsent.acceptedService('posthog', 'analytics') for
          // Consent Mode v2's analytics_storage gate.
          posthog: {
            label: 'PostHog product analytics',
          },
        },
      },
      marketing: {
        enabled: false,
        autoClear: {
          cookies: [
            { name: '_fbp' },
            { name: 'fr' },
          ],
        },
        services: {
          // Forward-compat per D-07 + 22-RESEARCH Pattern 3 — Meta + AdSense
          // hooks land here when P20 (mobile ads / web ads) ships.
          adsense: { label: 'Google AdSense' },
          meta_pixel: { label: 'Meta Pixel (Facebook)' },
        },
      },
      personalization: { enabled: false },
    },
    language: {
      default: 'en',
      translations: {
        en: {
          consentModal: {
            title: 'We value your privacy',
            description: buildConsentModalDescription(isEU),
            acceptAllBtn: 'Accept all',
            acceptNecessaryBtn: 'Reject all',
            showPreferencesBtn: 'Customize',
          },
          preferencesModal: {
            title: 'Cookie preferences',
            acceptAllBtn: 'Accept all',
            acceptNecessaryBtn: 'Reject all',
            savePreferencesBtn: 'Save preferences',
            closeIconLabel: 'Close',
            sections: [
              {
                title: 'Essential cookies',
                description:
                  'Required for sign-in, account state, and security. These cannot be turned off.',
                linkedCategory: 'necessary',
              },
              {
                title: 'Analytics cookies',
                description:
                  'Help us understand which features people use and where they get stuck. We use PostHog with strict data minimization.',
                linkedCategory: 'analytics',
              },
              {
                title: 'Marketing cookies',
                description:
                  'Used to measure ad campaigns we run on Meta or Google. Off by default.',
                linkedCategory: 'marketing',
              },
              {
                title: 'Personalization cookies',
                description:
                  'Used to remember in-app preferences across devices. Off by default.',
                linkedCategory: 'personalization',
              },
              {
                title: 'Further information',
                // Phase 64 Plan 64-07 (LEGAL-07): includes Do Not Sell or Share anchor + privacy email.
                description: buildFurtherInfoDescription(),
              },
            ],
          },
        },
      },
    },
    onFirstConsent: ({ cookie }) => {
      updateGtagConsent();
      void upsertConsentRecord(cookie);
      emitConsentChange();
    },
    onConsent: ({ cookie }) => {
      updateGtagConsent();
      void upsertConsentRecord(cookie);
      emitConsentChange();
    },
    onChange: ({ cookie }) => {
      updateGtagConsent();
      void upsertConsentRecord(cookie);
      emitConsentChange();
    },
  });
}
