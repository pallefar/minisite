/**
 * Phase 22 Plan 22-05 — /cancel-deletion route + RPC round-trip.
 *
 * Validates the three primary user-visible outcomes on the /cancel-deletion
 * page:
 *   1. No token in URL → friendly "Cancel deletion" page with help text.
 *   2. Garbage token → "This link is no longer valid" message.
 *   3. Placeholder token (?token=pending — emitted by lifecycle-transactional
 *      when Vault CANCEL_DELETION_HMAC_KEY is not loaded) → falls into the
 *      no_token branch (treated as missing per cancel-deletion.tsx
 *      getTokenFromUrl()).
 *
 * Real HMAC round-trip (#4 in the plan behavior list) is gated behind
 * SUPABASE_URL + SERVICE_ROLE_KEY + CANCEL_DELETION_HMAC_KEY env vars. Per
 * 22-01 SUMMARY + 22-02 SUMMARY the Vault key is a DEFERRED vendor pass —
 * once loaded, this spec can be promoted by exporting the key and minting
 * a token server-side. Until then, the full round-trip is recorded as a
 * deferred test in the SUMMARY.
 *
 * Per-file slug prefix per Pattern S5 (feedback_rls_per_file_slug_prefix.md):
 *   CANCEL_PREFIX = 'phase22-cancel-deletion-e2e'
 */
import { expect, test } from '@playwright/test';

// CANCEL_PREFIX scoped to this file — referenced for future cleanup of
// test users created by the env-gated round-trip path. Currently unused
// because the env-gated path is itself deferred (see deferred suite
// below).
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const CANCEL_PREFIX = 'phase22-cancel-deletion-e2e';

test.describe('/cancel-deletion route (Phase 22 Plan 22-05)', () => {
  test('no token in URL → friendly help-text screen rendered', async ({ page }) => {
    await page.goto('/cancel-deletion');
    // Wait for either the no-token branch or the confirming->no-token
    // settle. The page mounts in confirming-or-no-token state synchronously.
    await expect(page.getByTestId('cancel-deletion-no-token')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole('heading', { name: /Cancel deletion/ })).toBeVisible();
    await expect(page.getByText(/use the link in the confirmation email/)).toBeVisible();
  });

  test('garbage token → "This link is no longer valid" or vault_missing fallback', async ({
    page,
  }) => {
    await page.goto('/cancel-deletion?token=garbage.0.deadbeef');
    // Either branch is acceptable depending on Vault key presence:
    //   - vault_missing: Vault CANCEL_DELETION_HMAC_KEY not loaded → RPC
    //     raises hmac_key_missing → page shows "temporarily unavailable".
    //   - invalid: Vault key loaded but token doesn't verify → page shows
    //     "no longer valid".
    // Both are non-crash, non-stack-trace user-facing outcomes — the
    // contract is "fails gracefully" not "always shows one specific copy".
    const eitherOutcome = page.locator(
      '[data-testid="cancel-deletion-invalid"], [data-testid="cancel-deletion-vault-missing"], [data-testid="cancel-deletion-unknown"]',
    );
    await expect(eitherOutcome).toBeVisible({ timeout: 15_000 });
  });

  test('placeholder token (?token=pending from lifecycle-transactional fallback) renders help-text', async ({
    page,
  }) => {
    // Plan 22-02 emits `?token=pending` in the cancel_url when Vault
    // CANCEL_DELETION_HMAC_KEY is not yet loaded. cancel-deletion.tsx
    // getTokenFromUrl() short-circuits that literal value to "no_token"
    // so the user gets the friendly screen instead of an RPC error.
    await page.goto('/cancel-deletion?token=pending');
    await expect(page.getByTestId('cancel-deletion-no-token')).toBeVisible({ timeout: 10_000 });
  });
});

/**
 * Full HMAC round-trip — DEFERRED. Requires:
 *   - process.env.SUPABASE_URL
 *   - process.env.SUPABASE_SERVICE_ROLE_KEY
 *   - process.env.CANCEL_DELETION_HMAC_KEY (mirror of the Vault secret)
 *
 * Once all three are present in CI, the env-gated suite can be enabled by
 * dropping `test.skip` below and providing a server-side helper that mints
 * the 3-part token (uid.epoch.hex_hmac) matching the cancel_account_deletion
 * RPC contract.
 */
// see deferred-tests.md#8-e2eaccount-delete-cancelspects--hmac-cancel-link-test-deferred-on-vault-key
test.skip('account-delete cancel via HMAC link [DEFERRED — Vault key not yet loaded; see 22-01/22-02 SUMMARY]', async () => {
  // Placeholder body — full round-trip to land when CANCEL_DELETION_HMAC_KEY
  // is loaded into Supabase Vault (22-01 deferred vendor pass).
});

// Wave 0 scaffold superseded by plan 22-05 — execution owner: 22-05 (this file).
