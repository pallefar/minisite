// Phase 9 Plan 09-01 Wave-0 scaffold for Pitfall #8 scenario (d):
// invited-but-never-accepts (token expires after 7 days).
import { test } from '@playwright/test';

test.fixme(
  'Pitfall #8 scenario (d): expired invite cannot be accepted; operator can re-send — Plan 09-09 implements',
  async () => {
    // D-17 (7-day expiry). Plan 09-09 should:
    //   1. Send invite, advance system time / overwrite expires_at past now().
    //   2. Attempt accept → expects 'invite_not_found_or_used' (P0002).
    //   3. Operator re-sends; new token works; old row retained for audit trail.
    //   4. Assert: ZERO memberships rows; original invite row still SELECT-able
    //      with expired-but-not-consumed state.
  },
);
