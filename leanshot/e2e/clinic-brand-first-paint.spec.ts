/**
 * Phase 31 Plan 31-03 — clinic-brand-first-paint.spec.ts
 *
 * First-paint smoke for path-based white-label (ORG-11 SC#1).
 *
 * What this spec proves (D-07 contract):
 *   The pre-mount block in main.tsx reads a brand-token blob from localStorage
 *   SYNCHRONOUSLY — before await hydrate() — and applies all --brand-* CSS
 *   custom properties on <html>. This means a returning visitor's first-paint
 *   already has the correct clinic colors, with zero flash of LeanShot defaults.
 *
 * Why addInitScript is used (not page.evaluate + reload):
 *   Per [[reference_playwright_state_seeding]]: page.addInitScript runs BEFORE
 *   any page script (including main.tsx's warm-paint block), which is exactly
 *   the precondition we need to simulate. page.goto + page.evaluate(seed) +
 *   reload races supabase-js's INITIAL_SESSION and is NOT reliable.
 *
 * Why gated behind PLAYWRIGHT_RUN_P31=1:
 *   This spec requires a running dev or preview server (5173 / 4173). The bare
 *   CI run (chromium project) is fast and should not depend on a running server
 *   for the standard regression suite. Opt-in via env var keeps CI lean while
 *   preserving the ability to run on demand and in dedicated P31 CI jobs.
 *
 * Conditional-project detection uses ONLY process.env.PLAYWRIGHT_RUN_P31 — per
 * [[reference_playwright_conditional_project_argv]]: process.argv.some(…) fails
 * in worker subprocesses and should NEVER be used for project gating.
 *
 * See: 31-CONTEXT.md D-07 + 31-UI-SPEC.md §Surface 4 (brand overlay tokens)
 */

import { expect, test } from '@playwright/test';

// ---------------------------------------------------------------------------
// Test constants (file-scoped slug prefix per [[feedback_rls_per_file_slug_prefix]]
// — even though this spec does not write to the DB, the prefix discipline avoids
// cross-suite collisions if the test ever moves to a live-DB variant)
// ---------------------------------------------------------------------------

const TEST_SLUG = 'p31-brand-firstpaint-fixture';

const SEEDED_TOKENS = {
  org_id: '00000000-0000-0000-0000-000000000031',
  slug: TEST_SLUG,
  name: 'P31 Test Clinic',
  logo_url: null,
  favicon_url: null,
  logo_alt_text: 'P31 Test Clinic',
  primary_color: 'oklch(0.45 0.18 168)',
  accent_color: 'oklch(0.55 0.12 150)',
  bg_color: 'oklch(0.97 0.02 95)',
  text_color: 'oklch(0.15 0.02 50)',
  heading_font: 'Fraunces',
  body_font: 'Inter',
  radius_scale: 'md',
  updated_at: '2026-05-18T00:00:00Z',
} as const;

const CACHE_KEY = 'leanshot_brand_' + TEST_SLUG;

// ---------------------------------------------------------------------------
// Test 1 — Warm-paint sets --brand-primary on <html> before React mounts
// ---------------------------------------------------------------------------

test('warm-paint sets --brand-primary on <html> before React mounts', async ({ page }) => {
  // Seed localStorage BEFORE navigation — addInitScript runs before ANY page
  // script including main.tsx's warm-paint block (per [[reference_playwright_state_seeding]])
  await page.addInitScript(
    (args: { key: string; value: string }) => {
      try {
        localStorage.setItem(args.key, args.value);
      } catch {
        /* noop — private mode */
      }
    },
    { key: CACHE_KEY, value: JSON.stringify(SEEDED_TOKENS) },
  );

  // Navigate to the clinic route and wait for network-idle so main.tsx has
  // fully executed. The SPA does not need a matching route — even a 404 React
  // render triggers main.tsx's pre-mount block.
  await page.goto(`/clinic/${TEST_SLUG}/`, { waitUntil: 'networkidle' });

  // Assert the CSS custom property is set as an inline style on <html>
  // (NOT computed style — we want to verify applyBrandTokens used style.setProperty)
  const brandPrimary = await page.evaluate(
    () => document.documentElement.style.getPropertyValue('--brand-primary'),
  );
  expect(brandPrimary.trim()).toBe('oklch(0.45 0.18 168)');
});

// ---------------------------------------------------------------------------
// Test 2 — Non-clinic route does NOT pollute --brand-* properties
// ---------------------------------------------------------------------------

test('non-clinic route does NOT set --brand-primary', async ({ page }) => {
  // Seed localStorage (a user might have visited /clinic/{slug} before)
  await page.addInitScript(
    (args: { key: string; value: string }) => {
      try {
        localStorage.setItem(args.key, args.value);
      } catch {
        /* noop */
      }
    },
    { key: CACHE_KEY, value: JSON.stringify(SEEDED_TOKENS) },
  );

  // Navigate to the root (non-clinic path)
  await page.goto('/', { waitUntil: 'networkidle' });

  // --brand-primary must NOT be set on non-clinic routes
  const brandPrimary = await page.evaluate(
    () => document.documentElement.style.getPropertyValue('--brand-primary'),
  );
  expect(brandPrimary).toBe('');
});

// ---------------------------------------------------------------------------
// Test 3 — Tailwind fallback chain falls back to LeanShot default when
//          --brand-primary is unset
// ---------------------------------------------------------------------------

test('Tailwind fallback chain resolves to LeanShot teal default when --brand-* unset', async ({
  page,
}) => {
  // Do NOT seed localStorage — verify the fallback path
  await page.goto('/', { waitUntil: 'networkidle' });

  // Read the resolved value of --color-primary via getComputedStyle(:root)
  // When --brand-primary is unset, it should resolve through
  // var(--brand-primary, var(--color-teal-700)) → #1b4842
  const colorPrimary = await page.evaluate(
    () => getComputedStyle(document.documentElement).getPropertyValue('--color-primary'),
  );
  expect(colorPrimary.trim()).toBe('#1b4842');
});
