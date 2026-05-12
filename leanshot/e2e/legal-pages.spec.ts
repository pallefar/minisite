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
import { DATA_CATEGORIES } from '../src/lib/legal/data-categories';

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

// ─────────────────────────────────────────────────────────────────────────────
// Phase 7 Plan 07-03 — Consumer Health Data Privacy notice content anchors.
//
// Three assertions pinned to the rendered #/legal/consumer-health page:
//   1. All 5 WMHMDA structural anchors land as <h2> headings (RCW 19.373.030(1)(b)(i)–(v))
//   2. The 3 verbatim statute strings required by COMPL-02 SC#2
//   3. Every DATA_CATEGORIES[i].label from the source-of-truth manifest is
//      rendered verbatim — this is the manifest/policy drift gate
//      (T-07-03-03 mitigation). A future phase adding a persisted slice
//      without updating data-categories.ts will fail this assertion in CI,
//      and so will a phase that updates the manifest but forgets to render.
//
// Fenced as its own test.describe so Plan 07-04 (Batch 2) can append its own
// @phase07-04 block below without merge conflict on the closing brace.
// ─────────────────────────────────────────────────────────────────────────────
test.describe('@phase07-03 — CHDP content anchors', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/#/legal/consumer-health');
    // Wait for the lazy-loaded ConsumerHealthData chunk to mount.
    await expect(page.locator('main h1')).toHaveText('Consumer Health Data');
  });

  test('CHDP page contains all 5 WMHMDA mandatory structural anchors (RCW 19.373.030(1)(b))', async ({
    page,
  }) => {
    // Each anchor is rendered as an <h2>. Assert verbatim heading text so a
    // future drift (e.g. someone renames §4 to "Partners") fails CI.
    const anchors = [
      'Categories of consumer health data we collect',
      'Sources from which we collect consumer health data',
      'Categories of consumer health data we share',
      'Third parties and affiliates with whom we share consumer health data',
      'How Washington residents exercise their rights',
    ];

    for (const heading of anchors) {
      await expect(
        page.locator('main h2', { hasText: heading }),
        `WMHMDA structural anchor missing: ${heading}`,
      ).toHaveCount(1);
    }
  });

  test('CHDP page contains the 3 verbatim statute strings required by COMPL-02 SC#2', async ({
    page,
  }) => {
    const bodyText = await page.locator('main article').innerText();

    // These strings are load-bearing for a WMHMDA private-right-of-action
    // defense if our notice is ever challenged on adequacy grounds.
    expect(bodyText.toLowerCase(), 'missing "consumer health data"').toContain(
      'consumer health data',
    );
    expect(bodyText, 'missing "Washington"').toContain('Washington');
    expect(bodyText.toLowerCase(), 'missing "private right of action"').toContain(
      'private right of action',
    );
  });

  test('CHDP page enumerates every persisted data category from the manifest', async ({
    page,
  }) => {
    const bodyText = await page.locator('main article').innerText();

    // Every DATA_CATEGORIES[i].label MUST appear verbatim. This is the
    // mitigation for T-07-03-03 (policy drift): future phases that add a new
    // slice but forget to update either the manifest or the rendered list
    // will fail CI here. The error message includes the offending key so a
    // future-you triaging CI sees exactly which manifest entry slipped.
    for (const cat of DATA_CATEGORIES) {
      expect(
        bodyText,
        `Data category "${cat.label}" (key=${cat.key}) is in DATA_CATEGORIES manifest ` +
          `but missing from rendered CHDP. Either render it in ConsumerHealthData.tsx ` +
          `or remove it from data-categories.ts.`,
      ).toContain(cat.label);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Phase 7 Plan 07-04 — Privacy / Terms / Medical Disclaimer content anchors.
//
// Coverage:
//   - Privacy Policy: 8 section anchors, 6 subprocessor names, full DATA_CATEGORIES
//     enumeration (21 entries — manifest is the source of truth; plan's "19"
//     number predated the 07-03 manifest finalization which added Profile +
//     authIdentity + operational + symptoms as separate entries).
//   - Terms of Service: 7 section anchors, verbatim "Not medical advice" string,
//     cross-link to MedicalDisclaimer, governing-law anchor (King County, WA).
//   - Medical Disclaimer: 4 expansion sections, verbatim Phase-2-paragraph-1
//     byte-replication regex (T1-LEGAL mitigation).
//   - Footer-link resolution from Landing for all 3 hashes.
//   - Threat-model consistency: verbatim Phase-2-paragraph regex on the
//     MedicalDisclaimer page (the litigation-relevant surface).
// ─────────────────────────────────────────────────────────────────────────────
test.describe('@phase07-04 — Privacy / Terms / Medical Disclaimer content anchors', () => {
  // ── Privacy Policy ──────────────────────────────────────────────────────────
  test('PrivacyPolicy: H1 + 8 section anchors + 6 subprocessors + 21 data categories', async ({
    page,
  }) => {
    await page.goto('/#/legal/privacy');
    await expect(page.locator('main h1')).toHaveText('Privacy Policy');

    const sectionAnchors = [
      '§ Categories collected',
      '§ How we use it',
      '§ How we share',
      '§ How long we retain',
      '§ Your rights',
      '§ Children',
      '§ Changes to this policy',
      '§ Contact',
    ];
    for (const heading of sectionAnchors) {
      await expect(
        page.locator('main h2', { hasText: heading }),
        `PrivacyPolicy section anchor missing: ${heading}`,
      ).toHaveCount(1);
    }

    // All 6 subprocessor names render verbatim.
    const article = page.locator('main article');
    const bodyText = await article.innerText();
    for (const name of ['Supabase', 'Vercel', 'Anthropic', 'Moonshot', 'PostHog', 'Sentry']) {
      expect(bodyText, `subprocessor "${name}" missing from PrivacyPolicy`).toContain(name);
    }

    // Every DATA_CATEGORIES entry's label renders (T3-LEGAL + T6-LEGAL mitigation:
    // if a future store-shape change adds a new persisted slice without updating
    // the manifest, this assertion fails and the developer is forced to update
    // the policy). The plan stated "19" but the 07-03 manifest finalised at 21.
    for (const cat of DATA_CATEGORIES) {
      expect(
        bodyText,
        `Data category "${cat.label}" (key=${cat.key}) in DATA_CATEGORIES manifest ` +
          `but missing from PrivacyPolicy. Render it or remove it from data-categories.ts.`,
      ).toContain(cat.label);
    }

    // Settings paths verbatim (T5-LEGAL: cross-plan coupling to 07-06 / 07-07).
    expect(bodyText).toContain('Settings → Data → Export JSON');
    expect(bodyText).toContain('Settings → Privacy → Delete account');
  });

  // ── Terms of Service ────────────────────────────────────────────────────────
  test('TermsOfService: H1 + 8 section anchors + verbatim "Not medical advice" + governing law', async ({
    page,
  }) => {
    await page.goto('/#/legal/terms');
    await expect(page.locator('main h1')).toHaveText('Terms of Service');

    const sectionAnchors = [
      '§ Service description',
      '§ Account',
      '§ Acceptable use',
      '§ Disclaimer of medical advice',
      '§ Limitation of liability',
      '§ Termination',
      '§ Governing law',
      '§ Contact',
    ];
    for (const heading of sectionAnchors) {
      await expect(
        page.locator('main h2', { hasText: heading }),
        `TermsOfService section anchor missing: ${heading}`,
      ).toHaveCount(1);
    }

    const bodyText = await page.locator('main article').innerText();

    // Verbatim "Not medical advice" string (T1-LEGAL surface coupling).
    expect(bodyText).toMatch(/Not medical advice/);

    // Governing law: Washington / King County (planner pick).
    expect(bodyText).toContain('King County, Washington');
    expect(bodyText).toContain('RCW 19.373');

    // Cross-link from § Disclaimer of medical advice → MedicalDisclaimer page.
    await expect(
      page.getByRole('link', { name: /full Medical Disclaimer/i }),
    ).toHaveAttribute('href', '#/legal/disclaimer');

    // Negative assertion (T2-LEGAL mitigation): no covered-entity language.
    expect(bodyText.toLowerCase()).not.toContain('fda-approved');
    expect(bodyText.toLowerCase()).not.toContain('clinically validated');
  });

  // ── Medical Disclaimer ──────────────────────────────────────────────────────
  test('MedicalDisclaimer: H1 + 5 section anchors + byte-replicated Phase 2 paragraph', async ({
    page,
  }) => {
    await page.goto('/#/legal/disclaimer');
    await expect(page.locator('main h1')).toHaveText('Medical Disclaimer');

    const sectionAnchors = [
      '§ GLP-1 guidance is informational',
      '§ PK chart is an estimate, not a dose recommendation',
      '§ AI coach is rule-based + AI-assisted, NOT a clinician',
      '§ Consult your healthcare provider',
      '§ Contact',
    ];
    for (const heading of sectionAnchors) {
      await expect(
        page.locator('main h2', { hasText: heading }),
        `MedicalDisclaimer section anchor missing: ${heading}`,
      ).toHaveCount(1);
    }

    // Verbatim Phase-2-paragraph-1 byte-replication (T1-LEGAL mitigation).
    // Whitespace tolerant for prettier reflow.
    const bodyText = await page.locator('main article').innerText();
    expect(bodyText).toMatch(
      /Not medical advice\.\s+LeanShot helps you track GLP-1 medications,\s+body[\s\n]+metrics,\s+food,\s+activity,\s+and symptoms\..*Always consult your healthcare[\s\n]+provider for clinical decisions/s,
    );
  });

  // ── Footer-link resolution from Landing ─────────────────────────────────────
  test('Footer links on the marketing landing page resolve to all 3 new legal pages', async ({
    page,
  }) => {
    const probes: Array<{ label: RegExp; hash: string; h1: string }> = [
      { label: /^Privacy policy$/i, hash: '#/legal/privacy', h1: 'Privacy Policy' },
      { label: /^Terms of service$/i, hash: '#/legal/terms', h1: 'Terms of Service' },
      { label: /^Medical disclaimer$/i, hash: '#/legal/disclaimer', h1: 'Medical Disclaimer' },
    ];

    for (const probe of probes) {
      await page.goto('/');
      await page.locator('footer').last().scrollIntoViewIfNeeded();
      await page.locator('footer').last().getByRole('link', { name: probe.label }).click();
      await expect.poll(() => page.url()).toContain(probe.hash);
      await expect(page.locator('main h1')).toHaveText(probe.h1);
    }
  });

  // ── Threat-model consistency: verbatim Phase-2 paragraph on disclaimer ───────
  test('Threat-model consistency: MedicalDisclaimer first paragraph byte-replicates Phase 2 DisclaimerModal:18-22', async ({
    page,
  }) => {
    await page.goto('/#/legal/disclaimer');
    await expect(page.locator('main h1')).toHaveText('Medical Disclaimer');

    // The FIRST <p> inside <article> (after the <header>) must be the verbatim
    // Phase-2-paragraph-1 ("Not medical advice…"). Whitespace tolerant.
    const firstParagraph = page.locator('main article > p').first();
    const text = await firstParagraph.innerText();

    // Anchored regex: starts with the verbatim Phase 2 string.
    expect(text).toMatch(
      /^Not medical advice\.\s+LeanShot helps you track GLP-1 medications,\s+body[\s\n]+metrics,\s+food,\s+activity,\s+and symptoms\./,
    );
    expect(text).toMatch(
      /Always consult your healthcare[\s\n]+provider for clinical decisions/,
    );
  });
});
