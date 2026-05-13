// Phase 9 Plan 09-01 Wave-0 scaffold for D-07 role + permission grid admin UI.
//
// Plan 09-03 owns the green implementation (Roles tab in clinic settings).
import { test } from '@playwright/test';

test.fixme(
  'D-07 role admin UI: create custom role + permission grid + assign to member — Plan 09-03 implements',
  async () => {
    // Plan 09-03 ships:
    //   1. /clinic/<slug>/settings/roles tab.
    //   2. List of system + custom roles.
    //   3. "Create role" button → modal with name + description + 10-key
    //      permission checkbox grid.
    //   4. Save → create_role RPC → role appears in list.
    //   5. Edit/delete custom roles (system roles disabled).
    //   6. Assign role to member via update_member_role RPC.
    //   7. has_permission RLS dispatch picks up new role permissions
    //      immediately on next query.
  },
);
