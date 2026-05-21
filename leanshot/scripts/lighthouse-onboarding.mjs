/**
 * Phase 34 Plan 34-10 (ONBOARD-10) — Lighthouse mobile audit harness.
 *
 * Invoked by `leanshot/e2e/onboarding-mobile-lighthouse.spec.ts` (Playwright spec)
 * AND directly via `npm run lighthouse:onboard` (top-level convenience script).
 *
 * Why a separate script (not inline in the spec): the `lighthouse` ESM package
 * does not load cleanly inside Playwright's CJS worker context on Node 22.x;
 * shelling out keeps the audit isolated and side-steps the conflict.
 *
 * Why `.mjs` extension: `leanshot/package.json` declares `"type": "module"`,
 * so a `.js` file would still be ESM — but lighthouse + chrome-launcher both
 * export ESM. `.mjs` makes the intent unambiguous (per NEW-W-01 plan-checker
 * carry-over: "Lighthouse script ESM, not CommonJS").
 *
 * Output: JSON to stdout. Errors → stderr + non-zero exit code.
 *
 * Usage:
 *   node leanshot/scripts/lighthouse-onboarding.mjs <url>
 *
 * Example:
 *   node leanshot/scripts/lighthouse-onboarding.mjs http://localhost:5173/onboard
 *
 * Threat model (T-34-10-04): the LHR JSON output stays on the local CI runner;
 * we never upload it to lighthouse-ci or external aggregators.
 */

import lighthouse from 'lighthouse';
import * as chromeLauncher from 'chrome-launcher';

async function main() {
  const url = process.argv[2];
  if (!url) {
    console.error('usage: lighthouse-onboarding.mjs <url>');
    process.exit(1);
  }

  const chrome = await chromeLauncher.launch({
    chromeFlags: ['--headless=new', '--no-sandbox', '--disable-gpu'],
  });

  try {
    const result = await lighthouse(url, {
      port: chrome.port,
      output: 'json',
      logLevel: 'error',
      // Lighthouse v12 uses `preset: 'desktop'` OR formFactor+screenEmulation.
      // For mobile audits we rely on the default formFactor='mobile' + the
      // built-in `mobileSlow4G` throttling (4x CPU slowdown + 1.6Mbps net),
      // which matches the must_haves contract exactly.
      formFactor: 'mobile',
      throttlingMethod: 'simulate',
      onlyCategories: ['performance', 'accessibility'],
      // Required when formFactor='mobile': supply explicit screen emulation
      // so Lighthouse doesn't desktop-mode-detect against headless Chrome.
      screenEmulation: {
        mobile: true,
        width: 412,
        height: 823,
        deviceScaleFactor: 1.75,
        disabled: false,
      },
    });

    if (!result || !result.lhr) {
      console.error('lighthouse returned no LHR');
      process.exit(3);
    }

    const lhr = result.lhr;
    const perf = Math.round((lhr.categories.performance?.score ?? 0) * 100);
    const a11y = Math.round((lhr.categories.accessibility?.score ?? 0) * 100);
    process.stdout.write(
      JSON.stringify({
        performance: perf,
        accessibility: a11y,
        url,
        timestamp: new Date().toISOString(),
        // Per-metric breakdown for the SUMMARY narrative (kept lightweight).
        metrics: {
          fcp: lhr.audits['first-contentful-paint']?.numericValue ?? null,
          lcp: lhr.audits['largest-contentful-paint']?.numericValue ?? null,
          tbt: lhr.audits['total-blocking-time']?.numericValue ?? null,
          cls: lhr.audits['cumulative-layout-shift']?.numericValue ?? null,
        },
      }) + '\n'
    );
    process.exit(0);
  } finally {
    try {
      await chrome.kill();
    } catch {
      /* noop — already dead */
    }
  }
}

main().catch((err) => {
  console.error('lighthouse-onboarding.mjs failed:', err?.stack ?? err);
  process.exit(2);
});
