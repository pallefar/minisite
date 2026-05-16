/**
 * Phase 22 plan 22-01 Wave 0 scaffold — consent-records UPSERT helper (GDPR-02).
 * Owner of impl: plan 22-10 (cookie banner) + 22-11 (email preferences).
 *
 * Behaviors deferred:
 *   - UPSERT shape: cookie_categories jsonb + email_preferences jsonb + consent_revision int
 *   - Anonymous-mode insert: user_id null + anonymous_id set
 */
import { describe, it } from 'vitest';

import { upsertConsentRecord } from '@/lib/consent/consent-records';

describe('consent-records (Phase 22 GDPR-02)', () => {
  it.skip('UPSERTs consent_records with cookie_categories jsonb [DEFERRED — Wave 0 scaffold; impl in plan 22-10]', () => {
    void upsertConsentRecord;
  });
  it.skip('anonymous-mode insert sets user_id null + anonymous_id [DEFERRED — Wave 0 scaffold; impl in plan 22-10]', () => {
    void upsertConsentRecord;
  });
});

// Wave 0 scaffold per .planning/phases/22-…/22-RESEARCH.md §Validation Architecture — DEFERRED implementation owner: 22-10
