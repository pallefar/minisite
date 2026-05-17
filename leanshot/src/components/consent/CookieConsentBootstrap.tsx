/**
 * Phase 22 Plan 22-10 — CookieConsentBootstrap (GDPR-01 mount invoker).
 *
 * Renders null; the cookie banner library writes its own DOM directly to
 * document.body once `initCookieConsent()` resolves inside the Pattern 4
 * dynamic-import gate (consent-defer.ts).
 *
 * Mount note (consumer plan 22-12): place `<CookieConsentBootstrap />`
 * at App.tsx root (sibling of the AppShell outlet) so the banner covers
 * marketing + onboarding + dashboard surfaces uniformly. The useEffect deps
 * array is intentionally empty — React StrictMode double-invoke is safe
 * because scheduleConsentInit() is idempotent at the module level (see
 * src/lib/consent/consent-defer.ts).
 */
import { useEffect } from 'react';
import { scheduleConsentInit } from '@/lib/consent/consent-defer';

export function CookieConsentBootstrap(): null {
  useEffect(() => {
    scheduleConsentInit();
  }, []);
  return null;
}
