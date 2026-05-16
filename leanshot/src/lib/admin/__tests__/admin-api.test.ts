/**
 * Phase 22 plan 22-01 Wave 0 scaffold — admin-api wrapper (ADMIN-01..04).
 * Owner of impl: plan 22-02 (admin members table) + 22-03 (stripe actions).
 *
 * Behaviors deferred:
 *   - listMembers wraps admin_list_members RPC with correct param shape
 *   - Returns typed MembersRow[] with tier discriminator
 */
import { describe, it } from 'vitest';

import { listMembers } from '@/lib/admin/admin-api';

describe('admin-api (Phase 22 ADMIN-01)', () => {
  it.skip('listMembers calls admin_list_members RPC with p_page/p_size [DEFERRED — Wave 0 scaffold; impl in plan 22-02]', () => {
    void listMembers;
  });
});

// Wave 0 scaffold per .planning/phases/22-…/22-RESEARCH.md §Validation Architecture — DEFERRED implementation owner: 22-02
