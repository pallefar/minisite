/**
 * Phase 22 plan 22-01 Wave 0 scaffold — DsarPortalPage (GDPR-03).
 * Owner of impl: plan 22-11 (DSAR portal + email preferences).
 *
 * Behaviors deferred:
 *   - Form submission inserts dsar_requests row with status='pending'
 *   - Existing requests render with status badge + completion date
 *   - Download link rendered when status='completed' + signed URL valid
 */
import { describe, it } from 'vitest';

import { DsarPortalPage } from '@/components/dsar/DsarPortalPage';

describe('DsarPortalPage (Phase 22 GDPR-03)', () => {
  it.skip('creates dsar_requests row on submit [DEFERRED — Wave 0 scaffold; impl in plan 22-11]', () => {
    void DsarPortalPage;
  });
  it.skip('renders status badge for each existing request [DEFERRED — Wave 0 scaffold; impl in plan 22-11]', () => {
    void DsarPortalPage;
  });
});

// Wave 0 scaffold per .planning/phases/22-…/22-RESEARCH.md §Validation Architecture — DEFERRED implementation owner: 22-11
