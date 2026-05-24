// REQUIRES: 47-01 supabase db push --linked (events / event_rsvps / RLS) +
//           tests/rls/fixtures-events.ts seed helpers (47-05 ships scaffold).
//
// EVENT-01 cross-space RLS visibility — RED scaffold (Wave 0 / Plan 47-05).
// Wave 1 (Plan 47-01) flips it.todo → it() and asserts cross-space + tier-gate +
// org-isolation visibility for the events feed. See 47-VALIDATION.md §Wave 0 Requirements.

import { describe, it } from 'vitest';

describe('Phase 47 — event-visibility RLS (EVENT-01)', () => {
  it.todo('TODO: member of space-A sees events scoped to space-A only (cross-space isolation)');
  it.todo('TODO: non-member of space-B does NOT see events scoped to space-B');
  it.todo('TODO: admin (is_staff) sees events across all spaces (impersonation negative-control)');
  it.todo('TODO: org-scoped event hidden from members of a different org (tenant boundary)');
  it.todo('TODO: global (org_id null) event visible to all space members regardless of org');
});
