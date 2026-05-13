// Phase 8 Plan 08-01 Wave 0 scaffold — SharePage unit/contract tests.
//
// Plan 08-04 implements SharePage.tsx (the lazy chunk on the /share/<token>
// hash route). This scaffold defines the contract tests that must pass:
//   - Snapshot contract: zero ai_* keys (SC#3 structural enforcement)
//   - Loading / error states render
//   - Chart + DoctorReport reuse renders with snapshot data

import { describe, it } from 'vitest';

describe('SharePage — Plan 08-04', () => {
  it.skip('snapshot contract — response has zero ai_* keys (SC#3)', () => {
    // Plan 08-04 implements:
    //   - Mock /share/snapshot Edge Function response
    //   - Assert response payload has NO keys matching /^ai_|aiHistory|chat/
    //   - This is the runtime check that mirrors the schema-layer view-definition
    //     check and the type-layer SnapshotResponse contract.
  });

  it.skip('renders MedLevelChart with PK-04 disclaimer + DoctorReport from snapshot', () => {
    // Plan 08-04 implements:
    //   - Render <SharePage snapshot={...} /> with seeded snapshot data
    //   - Assert MedLevelChart present + disclaimer aria-label intact
    //   - Assert DoctorReport component renders with snapshot data
  });
});
