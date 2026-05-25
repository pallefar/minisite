/**
 * Phase 56 Plan 03 — Consent-gated AdSense script injector (AD-02).
 *
 * FIREWALL: MUST NOT import from native/health (ESLint Zone 1 restriction).
 * No health-shaped data is processed here.
 *
 * Injects the AdSense <script> element once per page load, idempotently.
 * Only injects when:
 *   1. publisherId is non-empty (real publisher ID pending Phase 70)
 *   2. The user has granted marketing consent via 'leanshot:consent-change'
 *
 * CSP allowance for pagead2.googlesyndication.com is added by Plan 56-04.
 */

const ADSENSE_SCRIPT_ID = 'adsense-script';
const ADSENSE_SCRIPT_URL =
  'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js';

// ─── injectAdSenseScript ─────────────────────────────────────────────────────

/**
 * Idempotently inject the AdSense <script> tag into document.head.
 *
 * @param publisherId - AdSense publisher ID (ca-pub-XXXX).
 *   When empty/falsy, injection is skipped; callers render a placeholder div.
 *   Real fill arrives in Phase 70 (D-08).
 */
export function injectAdSenseScript(publisherId: string): void {
  if (!publisherId) return;

  // Idempotency guard — never inject twice.
  if (document.getElementById(ADSENSE_SCRIPT_ID)) return;

  const script = document.createElement('script');
  script.id = ADSENSE_SCRIPT_ID;
  script.async = true;
  script.src = `${ADSENSE_SCRIPT_URL}?client=${publisherId}`;
  script.setAttribute('data-ad-client', publisherId);
  document.head.appendChild(script);
}

// ─── ConsentChangeEvent type ──────────────────────────────────────────────────

interface ConsentChangeDetail {
  categories: {
    marketing: boolean;
    analytics?: boolean;
    functional?: boolean;
  };
}

// ─── subscribeAdSenseConsent ──────────────────────────────────────────────────

/**
 * Subscribe to 'leanshot:consent-change' and inject AdSense when marketing
 * consent is granted.
 *
 * Call once at app boot. Safe to call multiple times — the underlying
 * injectAdSenseScript is idempotent.
 *
 * @param publisherId - AdSense publisher ID forwarded to injectAdSenseScript.
 * @returns Cleanup function to remove the event listener.
 */
export function subscribeAdSenseConsent(publisherId: string): () => void {
  function handleConsentChange(event: Event): void {
    const detail = (event as CustomEvent<ConsentChangeDetail>).detail;
    if (detail?.categories?.marketing === true) {
      injectAdSenseScript(publisherId);
    }
  }

  window.addEventListener('leanshot:consent-change', handleConsentChange);

  return () => {
    window.removeEventListener('leanshot:consent-change', handleConsentChange);
  };
}
