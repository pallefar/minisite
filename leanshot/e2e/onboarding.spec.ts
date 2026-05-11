import { expect, test } from '@playwright/test';

test('onboarding happy path: marketing → 8 steps (Step 0 + 1-7) → HomeTab dashboard', async ({
  page,
}) => {
  // ── Marketing landing ──────────────────────────────────────────────────────
  await page.goto('/');

  // Click the nav "Get started" CTA (first button on the page, always visible
  // without scrolling — avoids the Hero's "Start free" which may be below fold).
  await page.getByRole('button', { name: /get started/i }).first().click();

  // ── Step 0: Disclaimer ────────────────────────────────────────────────────
  await expect(page.getByText(/not medical advice/i)).toBeVisible();
  await page.getByRole('button', { name: /i understand/i }).click();

  // ── Step 1: Name + units ───────────────────────────────────────────────────
  // Heading: "Welcome in."  Required field: "Your name"  Button: "Continue"
  await expect(page.getByRole('heading', { name: /welcome/i })).toBeVisible();
  await page.getByLabel('Your name').fill('Alex');
  // Units default to metric — no change needed for happy path
  await page.getByRole('button', { name: /continue/i }).click();

  // ── Step 2: Medication ─────────────────────────────────────────────────────
  // Heading: "Your medication"  Required: GLP-1 medication select  Button: "Continue"
  await expect(page.getByRole('heading', { name: /your medication/i })).toBeVisible();
  await page.getByLabel('GLP-1 medication').selectOption('ozempic');
  await page.getByLabel('Current dose').fill('0.5');
  // Start date auto-fills to today; leave as-is
  await page.getByRole('button', { name: /continue/i }).click();

  // ── Step 3: Starting point ─────────────────────────────────────────────────
  // Heading: "Your starting point"  Required: Weight  Optional: Height, Age, Sex, Body fat
  await expect(page.getByRole('heading', { name: /your starting point/i })).toBeVisible();
  await page.getByLabel(/weight/i).first().fill('90');
  await page.getByLabel(/height/i).first().fill('175');
  await page.getByLabel('Age').fill('35');
  // Sex defaults to "male" — no change needed
  await page.getByRole('button', { name: /continue/i }).click();

  // ── Step 4: Goals ──────────────────────────────────────────────────────────
  // Heading: "Your goals"  Optional: Target weight, Primary goal pills, Protein
  await expect(page.getByRole('heading', { name: /your goals/i })).toBeVisible();
  await page.getByLabel(/target weight/i).fill('75');
  // Primary goal defaults to "Fat loss" pill — already active, no click needed
  await page.getByRole('button', { name: /continue/i }).click();

  // ── Step 5: Routine ────────────────────────────────────────────────────────
  // Heading: "Your routine"  Fields: Injection day select, Activity pills, Lifting pills
  await expect(page.getByRole('heading', { name: /your routine/i })).toBeVisible();
  await page.getByLabel('Injection day').selectOption('1'); // Monday
  // Activity defaults to "Light"; Lifting defaults to "None" — leave as-is
  await page.getByRole('button', { name: /continue/i }).click();

  // ── Step 6: Snapshot (review) ─────────────────────────────────────────────
  // Heading: "Your starting snapshot"  Read-only tiles  Button: "Continue"
  await expect(page.getByRole('heading', { name: /snapshot/i })).toBeVisible();
  // Confirm name is reflected in the snapshot tiles
  await expect(page.getByText('Alex')).toBeVisible();
  await page.getByRole('button', { name: /continue/i }).click();

  // ── Step 7: Ready ──────────────────────────────────────────────────────────
  // Heading: "You're all set."  Button: "Open dashboard" (Check icon trailing)
  await expect(page.getByRole('heading', { name: /all set/i })).toBeVisible();
  await page.getByRole('button', { name: /open dashboard/i }).click();

  // ── Dashboard: HomeTab renders ────────────────────────────────────────────
  // After onComplete(), App.tsx sets view to 'dashboard' and renders HomeTab.
  // GreetingStrip renders "Good {morning|afternoon|evening}," in a <p> tag.
  // Assert on the greeting text appearing somewhere in the page.
  await expect(
    page.getByText(/good (morning|afternoon|evening)/i),
  ).toBeVisible({ timeout: 10_000 });
});
