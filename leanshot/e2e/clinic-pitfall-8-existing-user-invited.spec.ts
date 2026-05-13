// Phase 9 Plan 09-01 Wave-0 scaffold for Pitfall #8 scenario (a):
// existing-personal-user + invited-to-an-org.
//
// Plan 09-09 owns the green implementation (5-scenario matrix). This
// scaffold uses test.fixme so the file exists in the test glob without
// being a CI failure during Wave 0. Per memory
// `feedback_defer_then_batch_fix_pattern.md`: deferring with explicit
// fixme + plan reference is preferred over silent absence.

import { test } from '@playwright/test';

test.fixme(
  'Pitfall #8 scenario (a): existing personal user can accept invite without duplicate auth.users — Plan 09-09 implements',
  async () => {
    // Implementation owned by Plan 09-09. The matrix should:
    //   1. Create user X via supabase.auth.admin.createUser (existing personal account).
    //   2. Operator U sends an invite to X's email via send_invite RPC.
    //   3. X opens /clinic-invite/<token>, accepts with consent_scope.
    //   4. Assert: exactly ONE auth.users row for X's email exists.
    //   5. Assert: memberships table has ONE active row (user_id=X, org_id=U.org).
    //   6. Assert: data visibility honours consent_scope in both directions.
  },
);
