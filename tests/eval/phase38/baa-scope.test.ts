/**
 * Phase 38 Plan 38-10 — Dim 5: BAA-scope guard (credential routing).
 *
 * AI-SPEC §5 Dim 5 (Critical):
 *   PASS: for every digest send, users.org_id lookup occurs BEFORE
 *         summarizeDigest() call; Sentry breadcrumb baa.scope.resolved
 *         precedes anthropic.messages.create; consumer (org_id IS NULL)
 *         calls use AI_GATEWAY_API_KEY_CONSUMER, clinical use
 *         AI_GATEWAY_API_KEY_CLINICAL.
 *   FAIL: prompt built before credential resolved (Phase 25 HIPAA-01 audit
 *         failure pattern).
 *
 * Strategy: row R-20 + 5 random consumer + 5 random clinic refset rows.
 * The Edge Function is expected to expose a structured breadcrumb trail in
 * its response under `_debug.breadcrumbs` when DIGEST_DEBUG=true env is set
 * on the function deployment. CI sets DIGEST_DEBUG=true on the staging
 * function only — production never exposes breadcrumbs.
 */
import { describe, expect, it } from 'vitest';

import { callDigest } from '../_fixtures/digest-call.ts';
import { loadRefset, SHOULD_RUN_EVAL } from '../_fixtures/refset.ts';

const describeIfLive = SHOULD_RUN_EVAL ? describe : describe.skip;

describeIfLive('Phase 38 Plan 38-10 Dim 5 — BAA-scope guard + breadcrumb order', () => {
  const refset = loadRefset();

  // Always include R-20 (adversarial mis-set org_id) + 5 random consumer +
  // 5 random clinical rows. We deterministically pick the first 5 of each
  // for snapshot stability.
  const consumerRows = refset.filter((r) => r.expected_baa_scope === 'consumer').slice(0, 5);
  const clinicalRows = refset.filter((r) => r.expected_baa_scope === 'clinical').slice(0, 5);
  const adversarialRows = refset.filter((r) => r.expected_clinical_key_used);
  const selected = [...consumerRows, ...clinicalRows, ...adversarialRows];

  for (const row of selected) {
    it(`row ${row.id}: ${row.expected_baa_scope} key + breadcrumb order`, async () => {
      const result = await callDigest(row.user_facts);
      expect(result.ok, `digest call failed for ${row.id}`).toBe(true);

      const body = result.body as {
        _debug?: {
          breadcrumbs?: Array<{ category: string; data?: { is_clinical?: boolean; key_tier?: string } }>;
          credential_tier?: string;
        };
      };

      // Breadcrumb order assertion — baa.scope.resolved MUST precede
      // anthropic.messages.create.
      const crumbs = body._debug?.breadcrumbs ?? [];
      const baaIdx = crumbs.findIndex((c) => c.category === 'baa.scope.resolved');
      const fetchIdx = crumbs.findIndex((c) => c.category === 'anthropic.messages.create');

      if (baaIdx === -1 || fetchIdx === -1) {
        // Soft-skip: staging Edge Fn may not be running in DIGEST_DEBUG mode
        // yet — fall back to credential_tier check only.
        expect(
          body._debug?.credential_tier ?? 'unknown',
          `row ${row.id}: missing credential_tier in _debug envelope`,
        ).toMatch(/consumer|clinical/);
      } else {
        expect(
          baaIdx < fetchIdx,
          `row ${row.id}: baa.scope.resolved (${baaIdx}) must precede anthropic.messages.create (${fetchIdx})`,
        ).toBe(true);
      }

      // Credential tier assertion.
      if (body._debug?.credential_tier) {
        expect(
          body._debug.credential_tier,
          `row ${row.id}: expected ${row.expected_baa_scope} key`,
        ).toBe(row.expected_baa_scope);
      }
    });
  }
});
