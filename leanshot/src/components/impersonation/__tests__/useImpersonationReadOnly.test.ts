/**
 * Phase 22 plan 22-01 Wave 0 scaffold — useImpersonationReadOnly hook (ADMIN-03).
 * Owner of impl: plan 22-04.
 *
 * Behaviors deferred:
 *   - Returns disabled=true when JWT app_metadata.impersonator_id is set
 *   - Provides a wrapper that intercepts mutating store actions and shows a toast
 */
import { describe, it } from 'vitest';

import { useImpersonationReadOnly } from '@/components/impersonation/useImpersonationReadOnly';

describe('useImpersonationReadOnly (Phase 22 ADMIN-03)', () => {
  it.skip('returns disabled=true under impersonation [DEFERRED — Wave 0 scaffold; impl in plan 22-04]', () => {
    void useImpersonationReadOnly;
  });
  it.skip('intercepts mutating actions with read-only toast [DEFERRED — Wave 0 scaffold; impl in plan 22-04]', () => {
    void useImpersonationReadOnly;
  });
});

// Wave 0 scaffold per .planning/phases/22-…/22-RESEARCH.md §Validation Architecture — DEFERRED implementation owner: 22-04
