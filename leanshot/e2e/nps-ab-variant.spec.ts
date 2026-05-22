/**
 * Phase 36 Plan 36-05 Task 2 — NPS A/B variant copy E2E (REVIEW-06 / D-19).
 *
 * Behavior: `nps-trigger-decide` Edge Fn returns a `copy_variant` field
 * (e.g., 'control' | 'variant_a') resolved from the PostHog `nps_prompt_copy`
 * feature flag. The consumer NPSPromptModal renders different copy per
 * variant (or surfaces the variant via a `data-copy-variant` attribute on
 * the modal root for analytics joins).
 *
 * Test stubs `nps-trigger-decide` per-user via `page.route` so the spec
 * does NOT depend on a live PostHog Experiment being created at the time
 * of run (PostHog Experiment creation is a HUMAN-UAT step deferred to
 * milestone close; see CARRY-OVER.md).
 *
 * Gate: PLAYWRIGHT_RUN_P36=1 + live Supabase env. If the Wave 3 consumer
 * modal does not yet wire visible copy differentiation (variant rendered
 * only via `data-copy-variant` attribute), the spec asserts the attribute
 * instead of visible text. If neither path is wired, the spec is deferred
 * to milestone close via deferred-tests.md per
 * [[feedback_defer_then_batch_fix_pattern]].
 *
 * Per-file slug prefix per [[feedback_rls_per_file_slug_prefix]]:
 *   `nps-ab-${Date.now().toString(36)}-`
 */
import { test, expect } from '@playwright/test';

const PLAYWRIGHT_RUN = process.env.PLAYWRIGHT_RUN_P36 === '1';
const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const HAS_LIVE = Boolean(SUPABASE_URL && ANON_KEY && SERVICE_ROLE);

test.describe('Phase 36 — NPS A/B variant copy', () => {
  test.skip(
    !PLAYWRIGHT_RUN || !HAS_LIVE,
    'PLAYWRIGHT_RUN_P36=1 + live Supabase env required',
  );

  test.skip(
    true,
    'DEFERRED — see .planning/deferred-tests.md: requires Wave 3 NPSPromptModal to expose variant via either visible copy or data-copy-variant attribute. Re-enable once consumer modal wires variant prop end-to-end OR a HUMAN-UAT confirms the variant render path at staging.',
  );

  test('variant_a render differs from control', async ({ page }) => {
    // Stub the Edge Fn response per-user via page.route.
    await page.route('**/functions/v1/nps-trigger-decide', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          should_fire: true,
          rule_id: '00000000-0000-0000-0000-000000000001',
          copy_variant: 'variant_a',
          cta_set: { surface: 'A', cta_slugs: [] },
        }),
      });
    });

    await page.goto('/');

    // Expect the modal root to expose the variant (either as data attr or copy).
    const variantRoot = page.locator('[data-copy-variant="variant_a"]');
    await expect(variantRoot).toHaveCount(1, { timeout: 5000 });
  });
});
