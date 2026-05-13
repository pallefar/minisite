/**
 * Phase 13 Plan 13-04 — auth-split-screen.spec.ts
 *
 * Deterministic Playwright layout smoke for DS-04 (split-screen login).
 * Validates the geometric + a11y invariants from 13-04-PLAN.md without
 * snapshot drift (visual-regression is plan 13-06's job).
 *
 * Invariants under test:
 *   - At ≥ 768 px: hero <aside> visible, form <main> visible, hero is LEFT
 *     (smaller x) and form is RIGHT (larger x), both pinned to viewport
 *     height (chat1.md landmine 4), form has internal overflow-y:auto.
 *   - At < 768 px: hero hidden (`hidden md:flex`), form takes full width.
 *   - Segmented Pill switcher routes signin ↔ signup via window.location.hash.
 *   - Routing-invariant: visiting #/auth/signin renders <main#auth-form>
 *     (no redirect introduced by Plan 13-04 — D-08).
 */
import { expect, test } from '@playwright/test';

test.describe('Auth split-screen layout (DS-04)', () => {
  test('≥ 768 px shows hero LEFT and form RIGHT with locked height', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/#/auth/signin');
    await page.waitForLoadState('networkidle');

    const hero = page.locator('aside[aria-hidden="true"]').first();
    const form = page.locator('main#auth-form');
    await expect(hero).toBeVisible();
    await expect(form).toBeVisible();

    const heroBox = await hero.boundingBox();
    const formBox = await form.boundingBox();
    expect(heroBox).not.toBeNull();
    expect(formBox).not.toBeNull();

    // Hero is LEFT (smaller x), form is RIGHT (larger x)
    expect(heroBox!.x).toBeLessThan(formBox!.x);

    // Both panels pinned to viewport height (chat1.md landmine 4) —
    // allow ±2 px tolerance for sub-pixel rounding.
    expect(heroBox!.height).toBeGreaterThanOrEqual(798);
    expect(heroBox!.height).toBeLessThanOrEqual(802);
    expect(formBox!.height).toBeGreaterThanOrEqual(798);
    expect(formBox!.height).toBeLessThanOrEqual(802);

    // Form has internal scroll — outer container has overflow:hidden.
    const formOverflowY = await form.evaluate((el) => getComputedStyle(el).overflowY);
    expect(formOverflowY).toBe('auto');

    // Width ratio sanity-check — hero ≈ 1.1fr, form ≈ 1fr (so hero is wider).
    expect(heroBox!.width).toBeGreaterThan(formBox!.width);
  });

  test('< 768 px hides hero and stacks form full-width', async ({ page }) => {
    await page.setViewportSize({ width: 600, height: 900 });
    await page.goto('/#/auth/signin');
    await page.waitForLoadState('networkidle');

    const hero = page.locator('aside[aria-hidden="true"]').first();
    // `hidden md:flex` → at <768px the aside is display:none
    await expect(hero).toBeHidden();

    const form = page.locator('main#auth-form');
    await expect(form).toBeVisible();
    const formBox = await form.boundingBox();
    expect(formBox).not.toBeNull();
    // Form takes (close to) full viewport width.
    expect(formBox!.width).toBeGreaterThanOrEqual(580);
  });

  test('Segmented tab switch routes to #/auth/signup via hash', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/#/auth/signin');
    await page.waitForLoadState('networkidle');

    const signUpPill = page.getByRole('button', { name: /^sign up$/i }).first();
    await signUpPill.click();
    await page.waitForFunction(() => window.location.hash === '#/auth/signup');
    expect(page.url()).toContain('#/auth/signup');
  });

  test('Routing-invariant: visiting #/auth/signin renders <main#auth-form> with no redirect (D-08)', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/#/auth/signin');
    await page.waitForLoadState('networkidle');
    expect(page.url()).toContain('#/auth/signin');
    await expect(page.locator('main#auth-form')).toBeVisible();
  });
});
