/**
 * Phase 22 plan 22-01 Wave 0 scaffold — RLS proof for audit_logs.impersonator_id column.
 * Owner of impl: plan 22-04.
 *
 * Per-file slug prefix per feedback_rls_per_file_slug_prefix.md — DO NOT share with sibling files.
 *
 * Behaviors deferred:
 *   T1 admin writes audit row with impersonator_id=adminA, target_user_id=userB → row visible to userB (own audit) but admin sees nothing extra via authenticated client
 *   T2 partial index audit_logs_impersonator_idx is used for impersonator-scoped queries
 */
import { describe, it } from 'vitest';

const IMPERSONATION_PREFIX = 'phase22-impersonation-rls';
void IMPERSONATION_PREFIX; // future cleanup hook

describe.skip('Phase 22 — RLS audit_logs.impersonator_id [DEFERRED — Wave 0 scaffold; impl in plan 22-04]', () => {
  it('admin impersonate_start audit row scoped to target_user_id', () => {});
});

// Wave 0 scaffold per .planning/phases/22-…/22-RESEARCH.md §Validation Architecture — DEFERRED implementation owner: 22-04
