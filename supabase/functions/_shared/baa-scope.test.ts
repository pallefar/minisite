/**
 * Phase 38 Plan 38-02 — tests for baa-scope.ts (Task 2 partial).
 *
 * Coverage:
 *  T1: BAA_COVERED_MODELS includes claude-sonnet-4-6 (Phase 38 extension)
 *  T2: assertBaaCoveredModel passes for sonnet-4-6, throws for non-allowlist,
 *      passes after vendor-prefix strip (handled by assertBaaScope)
 *  T3: resolveBaaScope(consumer) → consumer credential, isClinical:false, orgId:null
 *  T4: resolveBaaScope(clinic) → clinical credential, isClinical:true, orgId:<uuid>
 *  T5: assertBaaScope is a no-op on consumer scope; throws Response on clinical+non-allowlisted
 *
 * Convention: Deno.test + jsr:@std/assert per [[reference_deno_test_discovery]].
 * Sentry breadcrumb-order assertion lives in anthropic-summarize.test.ts (load-bearing T5).
 */

import { assert, assertEquals, assertRejects } from 'jsr:@std/assert@^1';
import { BAA_COVERED_MODELS, assertBaaCoveredModel } from './anthropic-baa-allowlist.ts';
import { assertBaaScope, BaaScopeError, resolveBaaScope } from './baa-scope.ts';

// ─── Mock supabase builder ───────────────────────────────────────────────────

interface ProfileRow {
  id: string;
  primary_org_id: string | null;
}

function makeMockSupabase(profiles: ProfileRow[]) {
  // deno-lint-ignore no-explicit-any
  const client: any = {
    from(table: string) {
      if (table !== 'profiles') throw new Error(`unexpected table ${table}`);
      return {
        _filter: undefined as { id: string } | undefined,
        select(_cols: string) {
          return this;
        },
        eq(col: string, val: string) {
          if (col !== 'id') throw new Error(`unexpected filter col ${col}`);
          this._filter = { id: val };
          return this;
        },
        maybeSingle() {
          const row = profiles.find((p) => p.id === this._filter?.id) ?? null;
          return Promise.resolve({ data: row, error: null });
        },
      };
    },
  };
  return client;
}

function makeErrorSupabase(message: string) {
  // deno-lint-ignore no-explicit-any
  const client: any = {
    from(_table: string) {
      return {
        select(_cols: string) {
          return this;
        },
        eq(_col: string, _val: string) {
          return this;
        },
        maybeSingle() {
          return Promise.resolve({ data: null, error: { message } });
        },
      };
    },
  };
  return client;
}

// ─── T1: claude-sonnet-4-6 in BAA_COVERED_MODELS ─────────────────────────────

Deno.test('T1: BAA_COVERED_MODELS includes claude-sonnet-4-6 (Phase 38 extension)', () => {
  const models = BAA_COVERED_MODELS as readonly string[];
  assert(models.includes('claude-sonnet-4-5'), 'must keep existing 4-5');
  assert(models.includes('claude-sonnet-4-6'), 'must add 4-6 in same plan');
  assert(models.includes('claude-opus-4-6'), 'must keep opus-4-6');
  assert(models.includes('claude-haiku-4-5-20251001'), 'must keep haiku');
});

// ─── T2: assertBaaCoveredModel pass/fail + vendor-prefix strip via assertBaaScope ────

Deno.test('T2: assertBaaCoveredModel — sonnet-4-6 passes, non-allowlist throws', () => {
  assertBaaCoveredModel('claude-sonnet-4-6'); // no throw
  let threw = false;
  try {
    assertBaaCoveredModel('claude-3-opus-20240229');
  } catch (err) {
    threw = true;
    assert(err instanceof Response, 'must throw Response');
    assertEquals(err.status, 403);
  }
  assert(threw, 'must throw for non-allowlisted');
});

Deno.test('T2b: assertBaaScope strips anthropic/ prefix on clinical path', () => {
  // Clinical scope + prefixed sonnet-4-6 ID should pass (prefix stripped before allowlist).
  const scope = { credential: 'sb_x', isClinical: true, orgId: 'org-1' };
  assertBaaScope(scope, 'anthropic/claude-sonnet-4-6'); // no throw

  // Clinical scope + non-allowlisted ID (even with prefix) must throw Response.
  let threw = false;
  try {
    assertBaaScope(scope, 'anthropic/claude-3-opus-20240229');
  } catch (err) {
    threw = true;
    assert(err instanceof Response);
  }
  assert(threw, 'must throw for clinical non-allowlisted');
});

Deno.test('T2c: assertBaaScope is no-op on consumer scope', () => {
  const scope = { credential: 'sb_x', isClinical: false, orgId: null };
  // Even a non-allowlisted model passes on consumer path — no BAA needed.
  assertBaaScope(scope, 'anthropic/claude-3-opus-20240229'); // no throw
  assertBaaScope(scope, 'claude-3-opus-20240229'); // no throw
});

// ─── T3+T4: resolveBaaScope consumer vs clinical credential selection ────────

Deno.test('T3: resolveBaaScope(consumer user) returns consumer credential + isClinical=false', async () => {
  Deno.env.set('AI_GATEWAY_API_KEY_CONSUMER', 'sb_consumer_test_key');
  Deno.env.set('AI_GATEWAY_API_KEY_CLINICAL', 'sb_clinical_test_key');
  const supabase = makeMockSupabase([
    { id: 'user-consumer', primary_org_id: null },
  ]);
  const scope = await resolveBaaScope(supabase, 'user-consumer');
  assertEquals(scope.credential, 'sb_consumer_test_key');
  assertEquals(scope.isClinical, false);
  assertEquals(scope.orgId, null);
});

Deno.test('T4: resolveBaaScope(clinic user) returns clinical credential + isClinical=true', async () => {
  Deno.env.set('AI_GATEWAY_API_KEY_CONSUMER', 'sb_consumer_test_key');
  Deno.env.set('AI_GATEWAY_API_KEY_CLINICAL', 'sb_clinical_test_key');
  const supabase = makeMockSupabase([
    { id: 'user-clinic', primary_org_id: 'org-abc-123' },
  ]);
  const scope = await resolveBaaScope(supabase, 'user-clinic');
  assertEquals(scope.credential, 'sb_clinical_test_key');
  assertEquals(scope.isClinical, true);
  assertEquals(scope.orgId, 'org-abc-123');
});

Deno.test('T4b: resolveBaaScope throws BaaScopeError when credential env unset', async () => {
  Deno.env.delete('AI_GATEWAY_API_KEY_CONSUMER');
  Deno.env.set('AI_GATEWAY_API_KEY_CLINICAL', 'sb_clinical_test_key');
  const supabase = makeMockSupabase([{ id: 'u1', primary_org_id: null }]);
  await assertRejects(
    () => resolveBaaScope(supabase, 'u1'),
    BaaScopeError,
    'AI_GATEWAY_API_KEY_CONSUMER',
  );
  // Re-set for downstream tests.
  Deno.env.set('AI_GATEWAY_API_KEY_CONSUMER', 'sb_consumer_test_key');
});

Deno.test('T4c: resolveBaaScope throws BaaScopeError on profiles query error', async () => {
  Deno.env.set('AI_GATEWAY_API_KEY_CONSUMER', 'sb_consumer_test_key');
  const supabase = makeErrorSupabase('connection refused');
  await assertRejects(
    () => resolveBaaScope(supabase, 'u1'),
    BaaScopeError,
    'profiles lookup failed',
  );
});

Deno.test('T4d: resolveBaaScope treats missing profile row as consumer (not error)', async () => {
  Deno.env.set('AI_GATEWAY_API_KEY_CONSUMER', 'sb_consumer_test_key');
  const supabase = makeMockSupabase([]); // empty profiles table
  const scope = await resolveBaaScope(supabase, 'nonexistent-user');
  assertEquals(scope.isClinical, false);
  assertEquals(scope.orgId, null);
});

Deno.test('T4e: resolveBaaScope rejects empty userId', async () => {
  const supabase = makeMockSupabase([]);
  await assertRejects(() => resolveBaaScope(supabase, ''), BaaScopeError);
});
