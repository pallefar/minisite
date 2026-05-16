/**
 * Phase 22 plan 22-01 Wave 0 scaffold — account-delete cancel-link e2e (DEL-01).
 * Owner of impl: plan 22-05.
 *
 * Behaviors deferred:
 *   - Request deletion via Settings → pending row exists
 *   - Transactional email (test mode via admin.generateLink stub) contains HMAC cancel link
 *   - Click cancel link → cancel_account_deletion RPC fires → pending row deleted + audit row written
 */
import { test } from '@playwright/test';

test.skip('account-delete cancel via HMAC link [DEFERRED — Wave 0 scaffold; impl in plan 22-05]', async ({ page: _page }) => {
  // Placeholder: full flow — request → email → click cancel link → row gone.
});

// Wave 0 scaffold per .planning/phases/22-…/22-RESEARCH.md §Validation Architecture — DEFERRED implementation owner: 22-05
