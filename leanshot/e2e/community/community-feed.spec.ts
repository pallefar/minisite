/**
 * Phase 44 Plan 10 — Task 2: Community Feed Playwright e2e spec.
 *
 * Gate: PLAYWRIGHT_RUN_COMMUNITY=1 env var required.
 * Per [[reference_playwright_conditional_project_argv]] — argv detection fails
 * in worker subprocesses; env var is the source of truth.
 *
 * State seeding: page.addInitScript BEFORE page.goto
 * Per [[reference_playwright_state_seeding]] — never page.goto + page.evaluate
 * (races supabase-js INITIAL_SESSION hydration; addInitScript fires before JS runs).
 *
 * Tests:
 *   Test 1 — COMMUNITY-01/02 happy path: post + reaction toggle
 *   Test 2 — COMMUNITY-05 cross-tab realtime: post in tab A → tab B sees it <3s
 *   Test 3 — COMMUNITY-06 tier-locked space discovery card + upgrade CTA
 *   Test 4 — D-10 XSS defense: <script> stripped from rendered post body
 *
 * Test 5 (Mux video upload roundtrip — COMMUNITY-04) is NOT automated here.
 * It is a HUMAN-UAT signal in 44-UAT.md because Playwright lacks a stable
 * Mux-upload simulation and CI doesn't carry a Mux production token.
 *
 * Requirements: dev server running on localhost:5173 + live Supabase project.
 * Run: PLAYWRIGHT_RUN_COMMUNITY=1 npx playwright test --project=community --grep community
 */

import { chromium, expect, test, type Page } from '@playwright/test';

// ── Env gate ──────────────────────────────────────────────────────────────────
// Per [[reference_playwright_conditional_project_argv]]: argv detection is broken
// in worker subprocesses — env var is the canonical gate.
const PLAYWRIGHT_RUN_COMMUNITY = process.env.PLAYWRIGHT_RUN_COMMUNITY === '1';

// ── Supabase localStorage auth key ────────────────────────────────────────────
// Key format: sb-{project_ref}-auth-token
const SB_AUTH_KEY = 'sb-ytnsipxxmzgaebkqmokp-auth-token';

// ── Base URL ──────────────────────────────────────────────────────────────────
const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:5173';

// ── Test fixtures (replace with real seeded user sessions in production UAT) ──
// These are placeholder sessions; actual e2e runs require seeded test users
// with valid JWT sessions from the live Supabase project.
// See fixtures/clinic-fixtures.ts for the canonical seeding pattern.
const ALICE_SESSION = process.env.E2E_ALICE_SESSION ?? null; // Pro-tier user session JSON
const BOB_SESSION = process.env.E2E_BOB_SESSION ?? null;     // Pro-tier user session JSON
const CHARLIE_SESSION = process.env.E2E_CHARLIE_SESSION ?? null; // Free-tier user session JSON
const TEST_SPACE_ID = process.env.E2E_COMMUNITY_SPACE_ID ?? null;    // Free-tier space id
const TEST_PRO_SPACE_ID = process.env.E2E_COMMUNITY_PRO_SPACE_ID ?? null; // Pro-only space id

// ── Self-skip guard ────────────────────────────────────────────────────────────
// Skip entire suite if the env var gate is not set OR fixture vars are missing.
// This prevents CI failures on machines without live Supabase creds.
const SKIP =
  !PLAYWRIGHT_RUN_COMMUNITY ||
  !ALICE_SESSION ||
  !BOB_SESSION ||
  !CHARLIE_SESSION ||
  !TEST_SPACE_ID ||
  !TEST_PRO_SPACE_ID;

// ── Seed session helper ────────────────────────────────────────────────────────
/**
 * Seed a Supabase session into localStorage via addInitScript BEFORE navigation.
 * Per [[reference_playwright_state_seeding]]: addInitScript fires before any JS
 * executes in the page, ensuring supabase-js INITIAL_SESSION sees the seeded token.
 * NEVER use page.goto + page.evaluate — that races with INITIAL_SESSION hydration.
 */
async function seedSession(page: Page, sessionJson: string): Promise<void> {
  await page.addInitScript(
    ({ key, value }: { key: string; value: string }) => {
      try {
        localStorage.setItem(key, value);
      } catch {
        // private-mode browsers silently fail — test will skip due to auth failure
      }
    },
    { key: SB_AUTH_KEY, value: sessionJson },
  );
}

// ── Test 1: COMMUNITY-01/02 — Post + reaction toggle ─────────────────────────

test('community — Test 1: post body renders + reaction toggle is idempotent', async ({ page }) => {
  test.skip(SKIP, 'PLAYWRIGHT_RUN_COMMUNITY=1 + E2E_ALICE_SESSION + E2E_COMMUNITY_SPACE_ID required');

  await seedSession(page, ALICE_SESSION!);
  await page.goto(`${BASE_URL}/#community/${TEST_SPACE_ID}`);
  await page.waitForSelector('[data-testid="community-composer"]', { timeout: 10_000 });

  // Type and submit a post
  const body = 'Hello world ' + Date.now();
  await page.fill('[data-testid="community-composer-body"]', body);
  await page.click('[data-testid="community-composer-submit"]');

  // Assert the new post card renders
  await expect(page.locator(`text=${body}`).first()).toBeVisible({ timeout: 5_000 });

  // Click the 🔥 reaction pill; assert it becomes aria-pressed=true with count 1
  const reactionBtn = page.locator('[data-testid="reaction-fire"]').first();
  await reactionBtn.click();
  await expect(reactionBtn).toHaveAttribute('aria-pressed', 'true', { timeout: 3_000 });
  await expect(reactionBtn.locator('[data-testid="reaction-count"]')).toHaveText('1');

  // Click again; assert count returns to 0 (idempotent toggle)
  await reactionBtn.click();
  await expect(reactionBtn).toHaveAttribute('aria-pressed', 'false', { timeout: 3_000 });
  await expect(reactionBtn.locator('[data-testid="reaction-count"]')).toHaveText('0');
});

// ── Test 2: COMMUNITY-05 — Cross-tab realtime ─────────────────────────────────

test('community — Test 2: Realtime test — post in tab A appears in tab B within 3s', async () => {
  test.skip(SKIP, 'PLAYWRIGHT_RUN_COMMUNITY=1 + E2E_ALICE_SESSION + E2E_BOB_SESSION + E2E_COMMUNITY_SPACE_ID required');

  // Open two independent browser contexts (alice, bob)
  const browser = await chromium.launch();
  const aliceCtx = await browser.newContext();
  const bobCtx = await browser.newContext();
  const alicePage = await aliceCtx.newPage();
  const bobPage = await bobCtx.newPage();

  try {
    // Seed sessions via addInitScript BEFORE navigation
    await alicePage.addInitScript(
      ({ key, value }: { key: string; value: string }) => { localStorage.setItem(key, value); },
      { key: SB_AUTH_KEY, value: ALICE_SESSION! },
    );
    await bobPage.addInitScript(
      ({ key, value }: { key: string; value: string }) => { localStorage.setItem(key, value); },
      { key: SB_AUTH_KEY, value: BOB_SESSION! },
    );

    // Both navigate to the same space
    await Promise.all([
      alicePage.goto(`${BASE_URL}/#community/${TEST_SPACE_ID}`),
      bobPage.goto(`${BASE_URL}/#community/${TEST_SPACE_ID}`),
    ]);
    await alicePage.waitForSelector('[data-testid="community-composer"]', { timeout: 10_000 });
    await bobPage.waitForSelector('[data-testid="community-feed"]', { timeout: 10_000 });

    // Alice posts 'Realtime test' with timestamp for uniqueness
    const realtimeBody = 'Realtime test ' + Date.now();
    await alicePage.fill('[data-testid="community-composer-body"]', realtimeBody);
    await alicePage.click('[data-testid="community-composer-submit"]');

    // Bob's page should see the post within 3 seconds WITHOUT reload
    await bobPage.getByText(realtimeBody).waitFor({ timeout: 3_000 });
  } finally {
    await aliceCtx.close();
    await bobCtx.close();
    await browser.close();
  }
});

// ── Test 3: COMMUNITY-06 — Tier-locked discovery card + upgrade CTA ───────────

test('community — Test 3: /pricing — Free user sees locked card → Upgrade button navigates to /pricing', async ({ page }) => {
  test.skip(SKIP, 'PLAYWRIGHT_RUN_COMMUNITY=1 + E2E_CHARLIE_SESSION + E2E_COMMUNITY_PRO_SPACE_ID required');

  await seedSession(page, CHARLIE_SESSION!);
  await page.goto(`${BASE_URL}/#community`);

  // Assert the Pro-tier space appears as a locked card
  const lockedCard = page.locator(`[data-testid="space-locked-card-${TEST_PRO_SPACE_ID}"]`);
  await expect(lockedCard).toBeVisible({ timeout: 10_000 });

  // Post body content must NOT be visible on the locked card
  await expect(lockedCard.locator('[data-testid="space-preview-body"]')).not.toBeVisible();

  // Upgrade CTA button exists
  const upgradeBtn = lockedCard.locator('[data-testid="upgrade-cta"]');
  await expect(upgradeBtn).toBeVisible();

  // Click Upgrade → navigate to /pricing
  await upgradeBtn.click();
  await expect(page).toHaveURL(/\/pricing/, { timeout: 5_000 });
});

// ── Test 4: D-10 XSS defense — markdown injection stripped ───────────────────

test('community — Test 4: window.__pwned — <script> in post body is sanitized, window.__pwned is undefined', async ({ page }) => {
  test.skip(SKIP, 'PLAYWRIGHT_RUN_COMMUNITY=1 + E2E_ALICE_SESSION + E2E_COMMUNITY_SPACE_ID required');

  await seedSession(page, ALICE_SESSION!);
  await page.goto(`${BASE_URL}/#community/${TEST_SPACE_ID}`);
  await page.waitForSelector('[data-testid="community-composer"]', { timeout: 10_000 });

  // Post body with XSS attempt
  const xssBody = '<script>window.__pwned = 1;</script>Plain text';
  await page.fill('[data-testid="community-composer-body"]', xssBody);
  await page.click('[data-testid="community-composer-submit"]');

  // Reload to ensure render is server-fresh
  await page.reload();
  await page.waitForSelector('[data-testid="community-feed"]', { timeout: 10_000 });

  // Post body renders as 'Plain text' (script stripped)
  await expect(page.locator('text=Plain text').first()).toBeVisible({ timeout: 5_000 });

  // window.__pwned is undefined (script tag never executed)
  const pwned = await page.evaluate(() => (window as unknown as { __pwned?: number }).__pwned);
  expect(pwned).toBeUndefined();
});
