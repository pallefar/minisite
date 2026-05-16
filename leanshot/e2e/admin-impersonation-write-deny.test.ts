/**
 * Phase 22 plan 22-01 Wave 0 scaffold — write-deny enforcement across all 17 impersonated tables.
 * Owner of impl: plan 22-04.
 *
 * Coverage: JWT with app_metadata.impersonator_id set → INSERT/UPDATE/DELETE on each of the 17
 * tables returns 42501. Validates the 51 policies installed by migration 20270601000012.
 */
import { describe, it } from 'vitest';

const WRITE_DENY_PREFIX = 'phase22-write-deny-rls';
void WRITE_DENY_PREFIX;

describe.skip('Phase 22 — impersonation write-deny [DEFERRED — Wave 0 scaffold; impl in plan 22-04]', () => {
  it('17 tables × 3 ops × JWT with impersonator_id → 42501', () => {});
  it('un-impersonated owner write still succeeds (AND-combined RLS)', () => {});
});

// Wave 0 scaffold per .planning/phases/22-…/22-RESEARCH.md §Validation Architecture — DEFERRED implementation owner: 22-04
