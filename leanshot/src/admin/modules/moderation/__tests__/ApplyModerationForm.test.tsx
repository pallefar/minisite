// Phase 48 — ApplyModerationForm test (scaffold).
// WAVE 0: RED. Drives Plan 48-11 to GREEN.

import { describe, it } from 'vitest';

describe('ApplyModerationForm', () => {
  it.todo('renders status select (active/muted/banned/temp_suspended)');
  it.todo('temp_suspended selection reveals expires_at picker (required)');
  it.todo('non-temp_suspended selection hides expires_at picker (must be null)');
  it.todo('reason field required (charlimit shown)');
  it.todo(
    'submit -> calls apply_user_moderation RPC + ban-enforcement Fn on banned/temp_suspended',
  );
  it.todo('shows error on RPC failure; preserves form values');
});
