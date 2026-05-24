// Phase 48 — ReportsQueue test (scaffold).
// WAVE 0: RED. Drives Plan 48-10 to GREEN.

import { describe, it } from 'vitest';

describe('ReportsQueue', () => {
  it.todo('renders empty state when no reports');
  it.todo('lists open + triaged reports, default sort newest-first');
  it.todo('filter by status (open/triaged/resolved/dismissed)');
  it.todo('filter by target_type (post/comment/dm_message/profile)');
  it.todo('row action: triage -> calls triage_report RPC + optimistic update');
  it.todo('row action: dismiss -> opens dismiss_reason modal');
  it.todo('does NOT show cross-org reports (can_moderate_report_org gate)');
});
