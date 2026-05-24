// Phase 48 — AccountSuspended consumer-surface test (scaffold).
// WAVE 0: RED. Drives Plan 48-11 to GREEN.
//
// AccountSuspended is the consumer surface shown when the SPA detects a
// 401/403 caused by a ban-enforcement session revoke. It renders a static
// page (no API calls) explaining the suspension and offering an appeals
// mailto / contact link.

import { describe, it } from 'vitest';

describe('AccountSuspended', () => {
  it.todo('renders headline + suspended-state copy');
  it.todo('renders appeals contact link (mailto:support@leanshot.app)');
  it.todo('shows expires_at relative countdown when status="temp_suspended"');
  it.todo('does NOT show countdown when status="banned"');
  it.todo('signs out the local Zustand store on mount (prevents stale UI)');
  it.todo('accessible: role=main, headline is <h1>, contact is keyboard-focusable');
});
