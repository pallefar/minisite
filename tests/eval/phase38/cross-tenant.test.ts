/**
 * Phase 38 Plan 38-10 — Dim 4: Cross-tenant + cross-user data isolation.
 *
 * AI-SPEC §5 Dim 4 (Critical):
 *   PASS: live impersonation — user A's recommender + digest never returns
 *         content where visible_to_user_id ≠ A or where embedding source
 *         row's org_id ≠ A.org_id. Same test under service-role + JWT-sub.
 *   FAIL: any leak across user_id or org_id boundary.
 *
 * Per project memory `reference_supabase_project`: every RLS surface gets a
 * live cross-tenant impersonation proof test. Reuses the pattern from
 * tests/rls/recommender-cross-tenant.spec.ts but extends to the 20-row
 * refset cross-tenant pairs (R-09/R-10) plus 4 additional synthetic pairs.
 */
import { describe, expect, it } from 'vitest';

import { callRecommender } from '../_fixtures/digest-call.ts';
import { loadRefset, SHOULD_RUN_EVAL } from '../_fixtures/refset.ts';

const describeIfLive = SHOULD_RUN_EVAL ? describe : describe.skip;

describeIfLive('Phase 38 Plan 38-10 Dim 4 — cross-tenant isolation', () => {
  const refset = loadRefset();
  const crossTenantRows = refset.filter((r) => r.expected_dim4_zero_cross_org);

  for (const row of crossTenantRows) {
    it(`row ${row.id}: zero cross-org leaks in recommender response`, async () => {
      const result = await callRecommender(row.user_facts.userId);
      expect(result.ok, `recommender call failed for ${row.id}: ${result.status}`).toBe(true);

      // Find the paired row (R-09 ↔ R-10 etc.).
      const pairedRow = refset.find((r) => r.id === row._cross_tenant_pair);
      const ownOrgId = row.user_facts.orgId;
      const peerOrgId = pairedRow?.user_facts.orgId ?? null;
      const peerUserId = pairedRow?.user_facts.userId ?? null;

      for (const item of result.items) {
        // No content visible only to a different user.
        if (item.visible_to_user_id) {
          expect(
            item.visible_to_user_id === row.user_facts.userId,
            `row ${row.id}: leaked content visible_to_user_id=${item.visible_to_user_id}`,
          ).toBe(true);
        }
        // No content tagged to the peer org.
        if (peerOrgId && item.org_id) {
          expect(
            item.org_id !== peerOrgId,
            `row ${row.id}: leaked content org_id=${item.org_id} (peer=${peerOrgId})`,
          ).toBe(true);
        }
        // No content tagged to the peer user.
        if (peerUserId && item.visible_to_user_id) {
          expect(
            item.visible_to_user_id !== peerUserId,
            `row ${row.id}: leaked content visible_to_user_id=${peerUserId}`,
          ).toBe(true);
        }
        // Consumer (orgId=null) MUST NEVER see clinic-scoped content.
        if (ownOrgId === null) {
          expect(
            item.org_id === null || item.org_id === undefined,
            `row ${row.id}: consumer leaked clinic content org_id=${item.org_id}`,
          ).toBe(true);
        }
      }
    });
  }

  // Extended impersonation matrix — 4 synthetic user-pairs (synthetic ids
  // seeded by the GH Actions workflow seed step). The pairs are documented
  // in 38-10-SUMMARY.md so the seeder can stay deterministic across runs.
  const SYNTHETIC_PAIRS: Array<{ a: string; b: string }> = [
    { a: 'p38-eval-syn-A1', b: 'p38-eval-syn-B1' },
    { a: 'p38-eval-syn-A2', b: 'p38-eval-syn-B2' },
    { a: 'p38-eval-syn-A3', b: 'p38-eval-syn-B3' },
    { a: 'p38-eval-syn-A4', b: 'p38-eval-syn-B4' },
  ];

  for (const pair of SYNTHETIC_PAIRS) {
    it(`synthetic pair ${pair.a} ↔ ${pair.b}: zero cross-user leaks`, async () => {
      const result = await callRecommender(pair.a);
      expect(result.ok).toBe(true);
      for (const item of result.items) {
        if (item.visible_to_user_id) {
          expect(
            item.visible_to_user_id === pair.a,
            `leak: ${pair.a} saw content visible_to_user_id=${item.visible_to_user_id}`,
          ).toBe(true);
        }
      }
    });
  }
});
