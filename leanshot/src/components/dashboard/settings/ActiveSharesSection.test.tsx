// Phase 8 Plan 08-01 Wave 0 scaffold — ActiveSharesSection unit/contract tests.
//
// Plan 08-03 implements ActiveSharesSection.tsx (the new SettingsPage section
// between Privacy and Recovery). This scaffold defines the contract:
//   - Aggregates view count + last_viewed correctly from audit_logs
//   - Renders one row per active share
//   - Revoke button wires to revoke_share RPC

import { describe, it } from 'vitest';

describe('ActiveSharesSection — Plan 08-03', () => {
  it.skip('aggregates view count + last_viewed correctly from audit_logs', () => {
    // Plan 08-03 implements:
    //   - Seed N audit_logs rows for share X (actor_type='share_recipient')
    //   - Render <ActiveSharesSection />
    //   - Assert row for share X shows view_count = N, last_viewed = max(timestamp)
  });

  it.skip('revoke button fires revoke_share RPC and removes row from active list', () => {
    // Plan 08-03 implements:
    //   - Mount with active share row
    //   - Click "Revoke" → confirm modal → assert revoke_share RPC called with share.id
    //   - Assert row moves to revoked state on success
  });
});
