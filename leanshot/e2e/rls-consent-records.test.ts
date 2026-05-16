/**
 * Phase 22 plan 22-01 Wave 0 scaffold — RLS proof for consent_records table.
 * Owner of impl: plan 22-10.
 */
import { describe, it } from 'vitest';

const CONSENT_RECORDS_PREFIX = 'phase22-consent-records-rls';
void CONSENT_RECORDS_PREFIX;

describe.skip('Phase 22 — RLS consent_records [DEFERRED — Wave 0 scaffold; impl in plan 22-10]', () => {
  it('anon insert with user_id=null permitted', () => {});
  it('authenticated insert with own user_id permitted', () => {});
  it('cross-tenant select returns []', () => {});
  it('DELETE policy absent — direct authenticated DELETE → 42501', () => {});
});

// Wave 0 scaffold per .planning/phases/22-…/22-RESEARCH.md §Validation Architecture — DEFERRED implementation owner: 22-10
