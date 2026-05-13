/**
 * Phase 12 Plan 12-03 — clinic-ad-free.spec.ts
 *
 * Three-layer Playwright ad-free assertion on B2B, share, and admin routes.
 *
 * Scope (CONTEXT.md D-14):
 *   - /clinic  — B2B operator-facing surface
 *   - /share   — read-share surface (doctor view)
 *   - /admin   — admin surface
 *
 * Assertion layers (CONTEXT.md D-14):
 *   Layer 1 — DOM scripts: zero <script src> tags whose URL matches an ad-provider origin
 *   Layer 2 — AdSlot mounts: zero AdSlot component mounts in the DOM
 *   Layer 3 — Network requests: zero outbound requests to ad-provider origins during page lifecycle
 *
 * PR-blocking gate (CONTEXT.md D-15):
 *   This spec is wired into .github/workflows/ci.yml as part of the test-e2e job.
 *   It is also invoked as an explicit named step "Phase 12 SC-3 — Clinic ad-free e2e gate"
 *   to make the gate grep-discoverable and to emit a distinct PR check entry.
 *
 * Cross-cutting concern #2 (REQUIREMENTS.md CCC-2):
 *   "No ads on B2B surfaces — TRIPLE-layered: AD-03 component check + AD-02 Edge Function +
 *    CSP report-only + Playwright e2e in Phase 12."
 *   This spec is the Playwright (runtime DOM) layer of that defense in depth.
 *
 * Phase 12 baseline (Pitfall 4 acknowledgment):
 *   Routes don't exist as distinct SPA routes yet in Phase 12 → the SPA root renders on all
 *   three paths → trivially zero ads. The spec becomes a real safety net once Phase 14 ships
 *   /clinic/{slug}, Phase 15 ships /admin/*, etc. AND once Phase 20 ships ad code that would
 *   (incorrectly) try to load on these routes.
 *
 * Maintenance contract:
 *   Any new ad provider added in Phase 20+ MUST be appended to AD_PROVIDER_ORIGINS in this
 *   spec, otherwise the gate has a blind spot. Document the addition in the Phase 20 plan.
 */

import { expect, test } from '@playwright/test';

// ── Ad-provider origins list ──────────────────────────────────────────────────
//
// 13 entries covering Google (GPT, AdSense, Ads, DoubleClick, AdMob),
// Meta (Audience Network, fbcdn), Amazon Ads, and major programmatic SSPs
// (Moat, Index Exchange, PubMatic, Magnite/Rubicon).
//
// Source: RESEARCH §5 table (Phase 12, Plan 12-03).
//
// MAINTENANCE CONTRACT: When Phase 20+ integrates a new ad provider, append
// its FQDN here. Omitting it creates a blind spot in the B2B ad-free gate.
const AD_PROVIDER_ORIGINS: readonly string[] = [
  'googletagservices.com',
  'googlesyndication.com',
  'googleadservices.com',
  'doubleclick.net',
  'googletag.com',
  'admob.googleapis.com',
  'facebook.net',
  'fbcdn.net',
  'adsystem.amazon.com',
  'moatads.com',
  'casalemedia.com',
  'pubmatic.com',
  'rubiconproject.com',
];

// ── Protected routes (D-14) ───────────────────────────────────────────────────
//
// B2B surfaces that must NEVER serve ad-provider scripts, mounts, or network
// requests, regardless of whether Phase 20 ad code exists in the bundle.
const PROTECTED_ROUTES: readonly string[] = [
  '/clinic',
  '/share',
  '/admin',
];

// ── Helper ────────────────────────────────────────────────────────────────────

/**
 * Returns true if the given URL string contains any of the ad-provider origins.
 */
function isAdProviderUrl(url: string): boolean {
  return AD_PROVIDER_ORIGINS.some((origin) => url.includes(origin));
}

// ── Tests ─────────────────────────────────────────────────────────────────────

for (const route of PROTECTED_ROUTES) {
  test(`no ad scripts, no AdSlot mounts, no ad network requests on ${route}`, async ({
    page,
    context,
  }) => {
    // Layer 3 setup: accumulate any ad-provider network requests fired during
    // the page lifecycle. The context request event captures requests from
    // the page, iframes, workers, and service workers — broader than page.route.
    const adRequests: string[] = [];
    context.on('request', (req) => {
      if (isAdProviderUrl(req.url())) {
        adRequests.push(req.url());
      }
    });

    // Navigate and wait for networkidle so lazy-loaded scripts have a chance
    // to fire before assertions run. DO NOT use page.waitForTimeout (flake bait).
    await page.goto(route, { waitUntil: 'networkidle' });

    // ── Layer 1: DOM script tags ──────────────────────────────────────────────
    //
    // Phase 12 acknowledgment (Pitfall 4): routes don't exist yet → SPA root
    // renders → trivially zero ads. The spec becomes a real safety net once
    // Phase 14 ships /clinic/{slug}, Phase 15 ships /admin/*, etc. AND once
    // Phase 20 ships ad code that would (incorrectly) try to load on these routes.
    const adScripts = await page.evaluate(
      (origins) =>
        Array.from(document.querySelectorAll('script[src]'))
          .map((s) => (s as HTMLScriptElement).src)
          .filter((src) => origins.some((o) => src.includes(o))),
      AD_PROVIDER_ORIGINS as unknown as string[],
    );
    expect(
      adScripts,
      `Ad script tags found on ${route}: ${adScripts.join(', ')}`,
    ).toHaveLength(0);

    // ── Layer 2: AdSlot component mounts ──────────────────────────────────────
    const adSlots = await page
      .locator('[data-ad-slot], [data-testid="ad-slot"]')
      .count();
    expect(adSlots, `AdSlot mounts found on ${route}`).toBe(0);

    // ── Layer 3: Network requests to ad-provider origins ──────────────────────
    expect(
      adRequests,
      `Ad network requests fired on ${route}: ${adRequests.join(', ')}`,
    ).toHaveLength(0);
  });
}
