// Phase 9 Plan 09-01 Wave-0 scaffold for Pitfall #8 scenario (c):
// existing-personal-user + 2 invitations from different orgs.
import { test } from '@playwright/test';

test.fixme(
  'Pitfall #8 scenario (c): one auth.users + 2 active memberships across 2 orgs — Plan 09-09 implements',
  async () => {
    // Single-identity invariant under multi-org: user accepts invites from
    // org A and org B. Asserts: ONE auth.users row, TWO active memberships
    // rows (one per org) — UNIQUE(user_id, org_id) WHERE revoked_at IS NULL
    // permits this because (user_id, orgA) and (user_id, orgB) are distinct
    // pairs.
  },
);
