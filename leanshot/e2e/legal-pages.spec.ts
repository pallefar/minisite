// Phase 7 Plan 07-02 — End-to-end spec asserting the legal-page hosting surface.
//
// Drives off the SAME LEGAL_LINKS constant the production footer renders, so
// any drift between the spec link list and the rendered footer is impossible
// (T-07-02-03 mitigation — see plan threat model).
//
// Coverage:
//   A — LEGAL_LINKS shape contract (4 entries, expected labels + hashes).
//   B — Marketing footer renders all 4 links; each resolves to a page with
//       a <main> + H1 + a per-page TODO marker (data-todo attribute).
//   C — Authenticated AppShell footer parity (researcher OQ#7 + WMHMDA
//       conspicuous-link requirement applied to the in-app homepage). Gated
//       behind E2E_TEST_USER_EMAIL so it skips in environments without a real
//       Supabase user.
//   D — No console errors logged across the full navigation matrix.

import { expect, test, type ConsoleMessage } from '@playwright/test';
import { LEGAL_LINKS } from '../src/components/layout/LegalFooter';

const EXPECTED_LABELS: readonly string[] = [
  'Privacy policy',
  'Consumer health data (WA residents)',
  'Terms of service',
  'Medical disclaimer',
];

const EXPECTED_H1_BY_HASH: Record<string, string> = {
  '#/legal/privacy': 'Privacy Policy',
  '#/legal/consumer-health': 'Consumer Health Data',
  '#/legal/terms': 'Terms of Service',
  '#/legal/disclaimer': 'Medical Disclaimer',
};

const EXPECTED_TODO_BY_HASH: Record<string, RegExp> = {
  '#/legal/privacy': /^07-04$/,
  '#/legal/consumer-health': /^07-03$/,
  '#/legal/terms': /^07-04$/,
  '#/legal/disclaimer': /^07-04$/,
};

test.describe('legal pages', () => {
  // ── Test A — LEGAL_LINKS constant shape ────────────────────────────────────
  test('A — LEGAL_LINKS constant exports 4 entries with expected labels + hashes', () => {
    expect(LEGAL_LINKS).toHaveLength(4);
    expect(LEGAL_LINKS.map((l) => l.label)).toEqual(EXPECTED_LABELS);
    expect(LEGAL_LINKS.map((l) => l.hash)).toEqual([
      '#/legal/privacy',
      '#/legal/consumer-health',
      '#/legal/terms',
      '#/legal/disclaimer',
    ]);
    for (const link of LEGAL_LINKS) {
      expect(typeof link.label).toBe('string');
      expect(typeof link.hash).toBe('string');
      expect(link.hash.startsWith('#/legal/')).toBe(true);
    }
  });

  // ── Test B — Marketing footer links resolve ────────────────────────────────
  test('B — marketing footer renders all 4 links and each resolves to its placeholder page', async ({
    page,
  }) => {
    const consoleErrors: string[] = [];
    page.on('console', (msg: ConsoleMessage) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    await page.goto('/');
    // Scroll into the footer so the legal links become accessible.
    await page.locator('footer').last().scrollIntoViewIfNeeded();

    for (const link of LEGAL_LINKS) {
      // Click the link inside the marketing footer by accessible name.
      // Take the LAST occurrence (the marketing Footer renders below other
      // page content; AppShell isn't present on the marketing surface).
      await page
        .locator('footer')
        .last()
        .getByRole('link', { name: link.label })
        .click();

      // URL hash should match.
      await expect.poll(() => page.url()).toContain(link.hash);

      // <main> with the expected H1 must be visible.
      const h1 = page.locator('main h1');
      await expect(h1).toHaveText(EXPECTED_H1_BY_HASH[link.hash]);

      // Per-page TODO marker: a DOM element with data-todo attribute matching
      // the expected authoring-plan tag (07-03 for CHDP, 07-04 for the rest).
      const todoMarker = page.locator(`[data-todo]`).first();
      await expect(todoMarker).toHaveCount(1);
      const todoValue = await todoMarker.getAttribute('data-todo');
      expect(todoValue).not.toBeNull();
      expect(todoValue!).toMatch(EXPECTED_TODO_BY_HASH[link.hash]);

      // Return to the marketing surface to click the next link.
      await page.goto('/');
      await page.locator('footer').last().scrollIntoViewIfNeeded();
    }

    // No console errors across the entire navigation matrix.
    expect(consoleErrors).toEqual([]);
  });

  // ── Test C — AppShell footer parity (signed-in) ────────────────────────────
  test('C — AppShell footer renders all 4 links for a signed-in user', async ({ page }) => {
    test.skip(
      !process.env.E2E_TEST_USER_EMAIL || !process.env.E2E_TEST_USER_PASSWORD,
      'Requires E2E_TEST_USER_EMAIL + E2E_TEST_USER_PASSWORD to exercise signed-in dashboard footer parity.',
    );

    const consoleErrors: string[] = [];
    page.on('console', (msg: ConsoleMessage) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    // Sign in via the hash-route auth surface (Phase 5 D-01).
    await page.goto('/#/auth/signin');
    await page.getByLabel(/email/i).fill(process.env.E2E_TEST_USER_EMAIL!);
    await page.getByLabel(/password/i).fill(process.env.E2E_TEST_USER_PASSWORD!);
    await page.getByRole('button', { name: /sign in/i }).click();

    // Wait for the dashboard to render. The data-testid is set by AppShell <main>.
    await expect(page.getByTestId('dashboard')).toBeVisible({ timeout: 15_000 });

    // Scroll to the AppShell footer (rendered below MobileNav per Task 3).
    const appFooter = page.locator('footer[aria-label="Legal"]');
    await appFooter.scrollIntoViewIfNeeded();
    await expect(appFooter).toBeVisible();

    for (const link of LEGAL_LINKS) {
      // Always re-scope to the AppShell footer (after each navigation we'll
      // be on a legal page where the footer comes from LegalLayout, not AppShell).
      await appFooter.getByRole('link', { name: link.label }).click();
      await expect.poll(() => page.url()).toContain(link.hash);
      await expect(page.locator('main h1')).toHaveText(EXPECTED_H1_BY_HASH[link.hash]);

      // Return to the dashboard to click the next link.
      await page.goto('/');
      await expect(page.getByTestId('dashboard')).toBeVisible({ timeout: 15_000 });
      await appFooter.scrollIntoViewIfNeeded();
    }

    expect(consoleErrors).toEqual([]);
  });
});
