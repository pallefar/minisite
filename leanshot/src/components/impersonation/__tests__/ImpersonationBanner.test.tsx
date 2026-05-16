/**
 * Phase 22 plan 22-01 Wave 0 scaffold — ImpersonationBanner (ADMIN-03).
 * Owner of impl: plan 22-04 (impersonation UI + edge fn).
 *
 * Behaviors deferred:
 *   - Mounts at AppShell root when JWT contains app_metadata.impersonator_id
 *   - Countdown decrements every second
 *   - At 0:00 auto-fires end-impersonation request
 */
import { describe, it } from 'vitest';

import { ImpersonationBanner } from '@/components/impersonation/ImpersonationBanner';

describe('ImpersonationBanner (Phase 22 ADMIN-03)', () => {
  it.skip('mounts when JWT app_metadata.impersonator_id is present [DEFERRED — Wave 0 scaffold; impl in plan 22-04]', () => {
    void ImpersonationBanner;
  });
  it.skip('countdown decrements per second [DEFERRED — Wave 0 scaffold; impl in plan 22-04]', () => {
    void ImpersonationBanner;
  });
  it.skip('auto-ends impersonation at 0:00 [DEFERRED — Wave 0 scaffold; impl in plan 22-04]', () => {
    void ImpersonationBanner;
  });
});

// Wave 0 scaffold per .planning/phases/22-…/22-RESEARCH.md §Validation Architecture — DEFERRED implementation owner: 22-04
