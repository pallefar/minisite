// Phase 48 — AuditLogViewer test (scaffold).
// WAVE 0: RED. Drives Plan 48-10 to GREEN.

import { describe, it } from 'vitest';

describe('AuditLogViewer', () => {
  it.todo('renders empty state when no moderation_audit_log rows');
  it.todo('lists rows newest-first with actor (display_name or "system" when actor_id IS NULL)');
  it.todo('filter by action_type (report_filed/mute/ban/temp_suspend/auto_flag/banned_word_match/...)');
  it.todo('filter by target_type (post/comment/dm_message/profile/user)');
  it.todo('row expand reveals before_state / after_state diff (jsonb pretty-print)');
  it.todo('paginated cursor (created_at, id) — load-more button');
  it.todo('append-only invariant proof: no edit/delete affordance in UI');
});
