/**
 * CTA-resolution tests for `nps-trigger-decide` — Phase 36 Plan 36-02 Task 1.
 *
 * Tests:
 *   R1 (W3 consumer cohort): primary_org_id NULL → candidate ['trustpilot'];
 *       cta_set returns the single trustpilot row with embedded url_pattern (W9)
 *   R2 (W3 clinic cohort): primary_org_id set → candidate ['g2','capterra'];
 *       cta_set returns subset of those rows
 *   R3 (W9): each cta_set item carries url_pattern string from review_cta_catalog
 *   R4 (D-13): requires_mobile_shell=true catalog rows are filtered out
 *   R5 (D-16): claimed=false catalog rows are filtered out — empty cta_set on fallback
 *   R6 (D-13/D-16): no rows match → empty cta_set is still a valid fire response
 *   R7: org_members table is NEVER read (W3 — primary_org_id is the single source of truth)
 */
import { assert, assertEquals } from 'jsr:@std/assert@^1';
import { __internal } from './index.ts';
import {
  makeFakeAdmin,
  mkReq,
  type FakeAdminCfg,
  type FakeAdminLog,
} from './_test-fixtures.ts';

const USER_UUID = '33333333-3333-4333-8333-333333333333';
const ORG_UUID = '44444444-4444-4444-8444-444444444444';
const VALID_JWT = 'jwt';

function setEnv(): void {
  Deno.env.delete('POSTHOG_PROJECT_KEY');
  Deno.env.delete('SUPABASE_URL');
  Deno.env.delete('SUPABASE_SERVICE_ROLE_KEY');
}

function baseCfg(overrides: Partial<FakeAdminCfg> = {}): FakeAdminCfg {
  const log: FakeAdminLog = { historyInserts: [], rulesQueriedFor: [], ctaQueries: [] };
  return {
    log,
    authBehavior: 'ok',
    userUid: USER_UUID,
    history: [],
    rules: [
      { id: 'rule-1', trigger_event: 'activation_completed', active: true, created_at: '2026-01-01T00:00:00Z' },
    ],
    profile: { primary_org_id: null },
    cta: [
      { slug: 'trustpilot', url_pattern: 'https://www.trustpilot.com/review/leanshot.app', requires_mobile_shell: false, claimed: true },
      { slug: 'g2', url_pattern: 'https://www.g2.com/products/leanshot/reviews', requires_mobile_shell: false, claimed: true },
      { slug: 'capterra', url_pattern: 'https://www.capterra.com/p/leanshot/reviews', requires_mobile_shell: false, claimed: true },
    ],
    insertBehavior: 'ok',
    ...overrides,
  };
}

async function call(cfg: FakeAdminCfg): Promise<{ status: number; body: unknown }> {
  __internal.resetAdminForTest();
  __internal.setAdminForTest(makeFakeAdmin(cfg));
  __internal.setVariantResolverForTest(async () => 'control');
  try {
    const res = await (__internal as unknown as {
      handleDecide: (req: Request) => Promise<Response>;
    }).handleDecide(mkReq({ jwt: VALID_JWT, body: { event_name: 'activation_completed' } }));
    return { status: res.status, body: await res.json() };
  } finally {
    __internal.resetVariantResolverForTest();
    __internal.resetAdminForTest();
  }
}

Deno.test('R1 (W3 consumer): primary_org_id NULL → cta_set = [trustpilot] with url_pattern', async () => {
  setEnv();
  const cfg = baseCfg({ profile: { primary_org_id: null } });
  const { status, body } = await call(cfg);
  assertEquals(status, 200);
  const b = body as {
    fire: boolean;
    cta_set: Array<{ slug: string; url_pattern: string }>;
  };
  assertEquals(b.fire, true);
  assertEquals(b.cta_set.length, 1);
  assertEquals(b.cta_set[0].slug, 'trustpilot');
  assert(b.cta_set[0].url_pattern.includes('trustpilot.com'));
  // Verify the query was for trustpilot only (not g2/capterra).
  assertEquals(cfg.log.ctaQueries.length, 1);
  assertEquals(cfg.log.ctaQueries[0].slugs, ['trustpilot']);
});

Deno.test('R2 (W3 clinic): primary_org_id set → cta_set is subset of [g2, capterra] each with url_pattern', async () => {
  setEnv();
  const cfg = baseCfg({ profile: { primary_org_id: ORG_UUID } });
  const { status, body } = await call(cfg);
  assertEquals(status, 200);
  const b = body as {
    fire: boolean;
    cta_set: Array<{ slug: string; url_pattern: string }>;
  };
  assertEquals(b.fire, true);
  assertEquals(b.cta_set.length, 2);
  const slugs = b.cta_set.map((c) => c.slug).sort();
  assertEquals(slugs, ['capterra', 'g2']);
  for (const item of b.cta_set) {
    assert(item.url_pattern.startsWith('https://'));
  }
  assertEquals(cfg.log.ctaQueries[0].slugs.sort(), ['capterra', 'g2']);
});

Deno.test('R3 (W9): cta_set items carry url_pattern from review_cta_catalog (server-side embed)', async () => {
  setEnv();
  // Exotic url to make the assertion unique.
  const cfg = baseCfg({
    profile: { primary_org_id: null },
    cta: [
      { slug: 'trustpilot', url_pattern: 'https://EXOTIC.example.com/trustpilot-review-target', requires_mobile_shell: false, claimed: true },
    ],
  });
  const { status, body } = await call(cfg);
  assertEquals(status, 200);
  const b = body as { cta_set: Array<{ slug: string; url_pattern: string }> };
  assertEquals(b.cta_set[0].url_pattern, 'https://EXOTIC.example.com/trustpilot-review-target');
});

Deno.test('R4 (D-13): requires_mobile_shell=true rows filtered out of cta_set', async () => {
  setEnv();
  const cfg = baseCfg({
    profile: { primary_org_id: null },
    cta: [
      // Mobile-shell only — must be filtered.
      { slug: 'trustpilot', url_pattern: 'https://web.trustpilot.com/...', requires_mobile_shell: true, claimed: true },
    ],
  });
  const { status, body } = await call(cfg);
  assertEquals(status, 200);
  const b = body as { fire: boolean; cta_set: Array<unknown> };
  assertEquals(b.fire, true);
  assertEquals(b.cta_set.length, 0); // mobile-shell filtered → empty fallback is valid
});

Deno.test('R5 (D-16): claimed=false rows filtered out — empty cta_set fallback', async () => {
  setEnv();
  const cfg = baseCfg({
    profile: { primary_org_id: null },
    cta: [
      { slug: 'trustpilot', url_pattern: 'https://www.trustpilot.com/review/leanshot.app', requires_mobile_shell: false, claimed: false },
    ],
  });
  const { status, body } = await call(cfg);
  assertEquals(status, 200);
  const b = body as { fire: boolean; cta_set: Array<unknown> };
  assertEquals(b.fire, true);
  assertEquals(b.cta_set.length, 0);
});

Deno.test('R6 (D-13/D-16): no rows match → empty cta_set still produces a valid fire=true response', async () => {
  setEnv();
  const cfg = baseCfg({
    profile: { primary_org_id: null },
    cta: [], // no catalog rows at all
  });
  const { status, body } = await call(cfg);
  assertEquals(status, 200);
  const b = body as { fire: boolean; cta_set: Array<unknown>; copy_variant: string };
  assertEquals(b.fire, true);
  assertEquals(b.cta_set.length, 0);
  assertEquals(b.copy_variant, 'control');
});

Deno.test('R7 (W3): org_members is NEVER queried — primary_org_id is single source of truth', async () => {
  setEnv();
  // The fake admin in _test-fixtures throws on any table other than the 5
  // expected ones. If the handler reads org_members it surfaces as a thrown
  // error → test fails. This implicitly verifies W3.
  const cfg = baseCfg({ profile: { primary_org_id: ORG_UUID } });
  const { status } = await call(cfg);
  assertEquals(status, 200);
});
