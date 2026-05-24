// Phase 48 — ModerationLayout test (scaffold).
// WAVE 0: RED. Drives Plan 48-10 to GREEN.
//
// Per memory feedback_executor_tdd_scaffolds_sibling_plan_files: source file
// does not yet exist (ships Plan 48-10). Use `it.todo()` (no execution body)
// so the TS compiler tolerates missing imports.

import { describe, it } from 'vitest';

describe('ModerationLayout', () => {
  it.todo('renders default sub-view (Reports queue) when path = /admin/moderation');
  it.todo('switches sub-view on popstate event (Reports/BannedWords/UserBans/AuditLog)');
  it.todo('renders nav with 4 sub-views and active state on current path');
  it.todo('does not mount when caller is non-staff (route guard)');
});
