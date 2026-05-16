/**
 * Phase 22 plan 22-01 Wave 0 scaffold — RLS proof for feature_flag_overrides table.
 * Owner of impl: plan 22-09.
 */
import { describe, it } from 'vitest';

const FLAG_OVERRIDES_PREFIX = 'phase22-flag-overrides-rls';
void FLAG_OVERRIDES_PREFIX;

describe.skip('Phase 22 — RLS feature_flag_overrides [DEFERRED — Wave 0 scaffold; impl in plan 22-09]', () => {
  it('select-own returns my override; cross-user returns []', () => {});
  it('authenticated INSERT → 42501 (only admin_set_feature_flag_override writes)', () => {});
  it('admin RPC writes override + audit row', () => {});
});

// Wave 0 scaffold per .planning/phases/22-…/22-RESEARCH.md §Validation Architecture — DEFERRED implementation owner: 22-09
