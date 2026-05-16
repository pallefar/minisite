/**
 * Phase 22 plan 22-01 Wave 0 scaffold — SoftDeleteCountdownBanner (DEL-01).
 * Owner of impl: plan 22-05 (soft-delete UI + 7d cron).
 *
 * Behaviors deferred:
 *   - Renders "Account scheduled for deletion in N days" when pending_account_deletions row exists
 *   - Cancel CTA invokes cancel_account_deletion RPC with HMAC token
 *   - Disappears when row deleted
 */
import { describe, it } from 'vitest';

import { SoftDeleteCountdownBanner } from '@/components/soft-delete/SoftDeleteCountdownBanner';

describe('SoftDeleteCountdownBanner (Phase 22 DEL-01)', () => {
  it.skip('renders countdown when pending_account_deletions row exists [DEFERRED — Wave 0 scaffold; impl in plan 22-05]', () => {
    void SoftDeleteCountdownBanner;
  });
  it.skip('Cancel CTA invokes cancel_account_deletion RPC [DEFERRED — Wave 0 scaffold; impl in plan 22-05]', () => {
    void SoftDeleteCountdownBanner;
  });
});

// Wave 0 scaffold per .planning/phases/22-…/22-RESEARCH.md §Validation Architecture — DEFERRED implementation owner: 22-05
