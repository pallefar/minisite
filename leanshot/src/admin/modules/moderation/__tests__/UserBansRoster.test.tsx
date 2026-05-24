// Phase 48 — UserBansRoster test (scaffold).
// WAVE 0: RED. Drives Plan 48-10/48-11 to GREEN.

import { describe, it } from 'vitest';

describe('UserBansRoster', () => {
  it.todo('renders empty state when no user_moderation_state rows');
  it.todo('lists muted + banned + temp_suspended users with status pill');
  it.todo('temp_suspended row shows expires_at countdown (relative time)');
  it.todo('row action: open ApplyModerationForm to mutate status (mute/ban/unmute)');
  it.todo('row action: revoke ban -> calls apply_user_moderation(active)');
  it.todo('search filter (by handle or email)');
});
