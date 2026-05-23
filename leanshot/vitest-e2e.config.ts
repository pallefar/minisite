import { defineConfig } from 'vitest/config';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    globals: true,
    // Phase 22 plan 22-12: extended to include admin-impersonation-write-deny
    // + cron-finalize-7day (vitest live-DB tests not prefixed with `rls-`).
    // Phase 28 plan 28-01: extended to include P28 org-scoped RLS suites
    // (in src/lib/__tests__/rls-org-*.test.ts per plan spec).
    // Phase 29 plan 29-01: extended to include count-active-patients D-01 invariant tests.
    // Phase 29 plan 29-03: added stripe-namespace-separation.test.ts (ORG-08 CI proof).
    // Phase 30 plan 30-05: added P30 unit/invariant test files (CLIN-01/04/05).
    //   - rank-org-patients-weights: SECDEF custom weights + NULL-fallback parity.
    //   - clinician-alert-debounce: debounce_key UNIQUE constraint invariant (CLIN-04).
    //   - clinician-alert-auto-resolve: auto-resolve cron status transition (D-10).
    //   - mv-clinic-alert-metrics: matview CONCURRENTLY refresh + shape (CLIN-05).
    // Phase 27 plan 27-04: funnel-anomaly detection + 4h suppression integration
    //   tests (TAXO-05 + SC#5). Live-DB; auto-skip absent service-role key.
    // Phase 26 plan 26-01: AFFTIER-01/02 vitest live-DB specs (note `.spec.ts`
    //   extension per plan body; routed to vitest here AND ignored by playwright
    //   chromium project in playwright.config.ts).
    // Phase 42 plan 42-07: quarterly NPS backend (POLISH-12) — RLS cross-tenant
    //   + 3 integration tests. Live-DB; auto-skip absent service-role key.
    include: [
      'e2e/rls-*.test.ts',
      'e2e/admin-impersonation-write-deny.test.ts',
      'e2e/cron-finalize-7day.test.ts',
      'e2e/affiliate-tier-stamping.spec.ts',
      'e2e/affiliate-tier-promotion.spec.ts',
      'src/lib/__tests__/rls-org-*.test.ts',
      'src/lib/__tests__/count-active-patients.test.ts',
      'src/lib/__tests__/stripe-namespace-separation.test.ts',
      'src/lib/__tests__/rank-org-patients-weights.test.ts',
      'src/lib/__tests__/clinician-alert-debounce.test.ts',
      'src/lib/__tests__/clinician-alert-auto-resolve.test.ts',
      'src/lib/__tests__/mv-clinic-alert-metrics.test.ts',
      'tests/integration/funnel-anomaly-detection.test.ts',
      'tests/integration/anomaly-suppression.test.ts',
      'tests/rls/quarterly-nps-rls.test.ts',
      'tests/integration/quarterly-nps-cron.test.ts',
      'tests/integration/quarterly-nps-respond.test.ts',
      'tests/integration/quarterly-nps-fallback.test.ts',
      // Phase 38 plan 38-03 — recommender RLS cross-tenant proof (T-38-13),
      // e2e personalized/popular branching + p95 perf, and multi-surface
      // payload contract snapshot. Live-DB; auto-skip when SUPABASE env
      // vars (SUPABASE_URL + SUPABASE_ANON_KEY + SUPABASE_SERVICE_ROLE_KEY)
      // are missing. `.spec.ts` extension matches affiliate-tier-* convention.
      'tests/rls/recommender-cross-tenant.spec.ts',
      'tests/e2e/recommender.spec.ts',
      'tests/e2e/multi-surface-payload.spec.ts',
      // Phase 38 plan 38-07 — winback-scorer e2e (RECOMMEND-07 + RECOMMEND-10).
      // Live-DB; auto-skip when SUPABASE_URL / SUPABASE_ANON_KEY /
      // SUPABASE_SERVICE_ROLE_KEY are missing. Seeds 10 users (5 active /
      // 3 inactive-eligible / 2 inactive-capped), runs cron handler over HTTP,
      // asserts win_back_sends + user_notifications + 30d cap behavior + Phase 40 handoff.
      'tests/e2e/winback-scorer.spec.ts',
      // Phase 38 plan 38-08 — HITL admin queue lifecycle (RECOMMEND-07).
      // 7 e2e behaviors: kb-audit landing, pending queue, approve+release,
      // reject, edit-then-approve, clinic-admin RLS gate, bulk approve.
      // Live-DB; auto-skip when SUPABASE env vars are missing.
      'tests/e2e/hitl-queue.spec.ts',
      // Phase 37 plan 37-09 — RLS cross-tenant impersonation proofs for
      // the helpdesk surface. File #1 covers tickets / ticket_messages /
      // ticket_attachments / ticket_ai_suggestions (+ log_phi_access RPC
      // end-to-end audit). File #2 covers kb_articles / kb_article_versions
      // / agent_macros / helpdesk_routing_rules / sla_targets +
      // publish_kb_article + search_kb_articles RPC role-gating. Live-DB;
      // auto-skip when SUPABASE env vars are missing. Per
      // [[reference_supabase_project]]: every RLS surface gets a live
      // cross-tenant impersonation proof test.
      'src/test/rls-helpdesk-tickets.test.ts',
      'src/test/rls-helpdesk-kb.test.ts',
      // Phase 44 plan 44-05 — COMMUNITY-03 notify-community integration (mention fan-out
      // + toggle-respect + user-JWT auth + impersonation reject).
      // Phase 44 plan 44-05 — COMMUNITY-04 mux-create-upload tier gate (Free=403, Pro=200,
      // Trial=200, missing-bearer=401).
      // Both self-skip when SUPABASE env vars are missing.
      // REQUIRES: 44-10 supabase db push --linked + supabase functions deploy first.
      'tests/integration/community-mention-notification.test.ts',
      'tests/integration/mux-tier-gate.test.ts',
    ],
    testTimeout: 30000,
  },
});
