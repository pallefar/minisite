/**
 * Phase 22 plan 22-01 Wave 0 scaffold — RefundModal (ADMIN-04).
 * Owner of impl: plan 22-03 (admin stripe action modal + edge fn).
 *
 * Behaviors deferred:
 *   - 3-step gating: pick charge → amount entry → typed-confirm "REFUND ${amount}"
 *   - Typed-confirm must match exact string before Submit enables
 *   - On submit calls admin-stripe-action Edge Fn with refund payload
 */
import { describe, it } from 'vitest';

import { RefundModal } from '@/components/admin/members/RefundModal';

describe('RefundModal (Phase 22 ADMIN-04)', () => {
  it.skip('Submit disabled until typed-confirm matches REFUND <amount> [DEFERRED — Wave 0 scaffold; impl in plan 22-03]', () => {
    void RefundModal;
  });
  it.skip('3-step gating: pick charge then amount then confirm [DEFERRED — Wave 0 scaffold; impl in plan 22-03]', () => {
    void RefundModal;
  });
});

// Wave 0 scaffold per .planning/phases/22-…/22-RESEARCH.md §Validation Architecture — DEFERRED implementation owner: 22-03
