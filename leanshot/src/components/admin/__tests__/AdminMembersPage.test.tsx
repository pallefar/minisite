/**
 * Phase 22 plan 22-01 Wave 0 scaffold — AdminMembersPage (ADMIN-01).
 * Owner of impl: plan 22-02 (admin members table page).
 *
 * Behaviors deferred:
 *   - is_staff client gate redirects non-staff users
 *   - dispatches `admin_list_members` RPC with current filter+sort state
 *   - Pill filter (free | paid | clinic_seat | past_due) updates query params
 */
import { describe, it } from 'vitest';

import { AdminMembersPage } from '@/components/admin/pages/AdminMembersPage';

describe('AdminMembersPage (Phase 22 ADMIN-01)', () => {
  it.skip('renders the members table for is_staff users [DEFERRED — Wave 0 scaffold; impl in plan 22-02]', () => {
    void AdminMembersPage;
  });
  it.skip('dispatches admin_list_members with filter+sort params [DEFERRED — Wave 0 scaffold; impl in plan 22-02]', () => {
    void AdminMembersPage;
  });
  it.skip('Pill filter for tier updates URL query [DEFERRED — Wave 0 scaffold; impl in plan 22-02]', () => {
    void AdminMembersPage;
  });
});

// Wave 0 scaffold per .planning/phases/22-…/22-RESEARCH.md §Validation Architecture — DEFERRED implementation owner: 22-02
