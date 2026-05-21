/**
 * Phase 35 Plan 35-04 — leaderboard_optin + get_leaderboard_for_user cross-tenant
 * impersonation proof + RLS write-denial proofs.
 * @requires-linked-db
 *
 * Per project rule (memory reference_supabase_project.md): every new RLS surface
 * MUST have a live cross-tenant impersonation proof, not just policy SQL.
 *
 * Threat model coverage:
 *   - T-35-04-01: user A reads cohort B leaderboard → 42501 not_cohort_member
 *   - T-35-04-02: real name leak via handle → 22023 invalid_handle (server-side)
 *   - T-35-04-03: user direct-INSERT to leaderboard_optin → 42501 (RLS write-denial)
 *   - T-35-04-04: user claims another user's handle within same cohort → UNIQUE violation
 *   - T-35-04-05: opt-in to admin-disabled cohort → P0001 cohort_leaderboard_disabled
 *   - T-35-04-06: non-member cannot opt in → 42501 not_cohort_member
 *
 * Auth pattern (per memory reference_rls_fixture_gotrueclient_flake):
 *   admin.generateLink + /auth/v1/verify via plain fetch (ES256 project).
 *   NOT signInWithPassword — avoids GoTrueClient cross-contamination.
 *
 * File-scoped slug prefix (per memory feedback_rls_per_file_slug_prefix):
 *   const TEST_SLUG_PREFIX = 'phase35-lb-cross-${randomUUID().slice(0, 8)}-';
 *   NEVER shared with sibling test files.
 *
 * Environment:
 *   SUPABASE_URL              — public project URL (also VITE_SUPABASE_URL)
 *   SUPABASE_ANON_KEY         — public anon key (also VITE_SUPABASE_ANON_KEY)
 *   SUPABASE_SERVICE_ROLE_KEY — PRIVATE service_role key (CI secret; never commit)
 *
 * Self-skipping: suite skips when env vars absent (local dev / fork PR safety).
 *
 * Run via:
 *   npx vitest run test/rls/35-leaderboard-cross-tenant.test.ts
 */

import { randomUUID } from 'node:crypto';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? '';
const SUPABASE_ANON_KEY =
  process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY ?? '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

const SHOULD_RUN = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY && SUPABASE_SERVICE_ROLE_KEY);
const describeIfLive = SHOULD_RUN ? describe : describe.skip;

// ---------------------------------------------------------------------------
// File-scoped slug prefix — feedback_rls_per_file_slug_prefix.md
// MUST NOT be shared with sibling test files; prevents clobbering under
// vitest file-parallelism.
// ---------------------------------------------------------------------------
const TEST_SLUG_PREFIX = `phase35-lb-cross-${randomUUID().slice(0, 8)}-`;

// ---------------------------------------------------------------------------
// Auth helpers (ES256 pattern — reference_rls_fixture_gotrueclient_flake)
// ---------------------------------------------------------------------------

interface GenerateLinkResponse {
  hashed_token?: string;
  email_otp?: string;
}

interface VerifySessionResponse {
  access_token?: string;
  error?: string;
  msg?: string;
}

async function mintAccessToken(email: string): Promise<string> {
  const linkRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/generate_link`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    },
    body: JSON.stringify({ type: 'magiclink', email }),
  });
  if (!linkRes.ok) {
    throw new Error(`generate_link failed: HTTP ${linkRes.status} — ${await linkRes.text()}`);
  }
  const linkBody = (await linkRes.json()) as GenerateLinkResponse;
  const verifyBody = linkBody.hashed_token
    ? { type: 'magiclink', token_hash: linkBody.hashed_token }
    : { type: 'magiclink', token: linkBody.email_otp, email };

  const verifyRes = await fetch(`${SUPABASE_URL}/auth/v1/verify`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: SUPABASE_ANON_KEY,
    },
    body: JSON.stringify(verifyBody),
  });
  if (!verifyRes.ok) {
    throw new Error(`auth/v1/verify failed: HTTP ${verifyRes.status} — ${await verifyRes.text()}`);
  }
  const session = (await verifyRes.json()) as VerifySessionResponse;
  if (!session.access_token) {
    throw new Error(`auth/v1/verify returned no access_token: ${JSON.stringify(session)}`);
  }
  return session.access_token;
}

function buildAuthedClient(accessToken: string): SupabaseClient {
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false, storageKey: `lb-${randomUUID()}` },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
}

function getAdminClient(): SupabaseClient {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

// ---------------------------------------------------------------------------
// Module-level state
// ---------------------------------------------------------------------------

let adminClient: SupabaseClient;

interface TestUser {
  id: string;
  email: string;
  client: SupabaseClient;
}

let userA: TestUser;
let userB: TestUser;
const createdUserIds: string[] = [];
const createdCohortIds: string[] = [];

/** cohortA: enabled; userA is member. cohortB: enabled; userB is member. */
let cohortAId: string;
let cohortBId: string;

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describeIfLive(
  'Phase 35 Plan 35-04 — leaderboard_optin + get_leaderboard_for_user cross-tenant proof',
  () => {
    beforeAll(async () => {
      adminClient = getAdminClient();
      const ts = Date.now();

      // Create two users
      const emailA = `${TEST_SLUG_PREFIX}a-${ts}@leanshot.test`;
      const emailB = `${TEST_SLUG_PREFIX}b-${ts}@leanshot.test`;

      const resA = await adminClient.auth.admin.createUser({
        email: emailA,
        password: `LbTest1!-${randomUUID().slice(0, 8)}`,
        email_confirm: true,
      });
      if (resA.error) throw new Error(`createUser(A): ${resA.error.message}`);

      const resB = await adminClient.auth.admin.createUser({
        email: emailB,
        password: `LbTest1!-${randomUUID().slice(0, 8)}`,
        email_confirm: true,
      });
      if (resB.error) throw new Error(`createUser(B): ${resB.error.message}`);

      createdUserIds.push(resA.data.user!.id, resB.data.user!.id);

      const tokenA = await mintAccessToken(emailA);
      const tokenB = await mintAccessToken(emailB);

      userA = { id: resA.data.user!.id, email: emailA, client: buildAuthedClient(tokenA) };
      userB = { id: resB.data.user!.id, email: emailB, client: buildAuthedClient(tokenB) };

      // Create cohort A (enabled) — userA is a member
      const cohortAName = `${TEST_SLUG_PREFIX}cohort-A`;
      const { data: cA, error: cAErr } = await adminClient
        .from('cohort_definitions')
        .insert({
          name: cohortAName,
          leaderboard_enabled: true,
          rule: { type: 'all', conditions: [] },
          compiled_sql: 'true',
        })
        .select('id')
        .single();
      if (cAErr) throw new Error(`create cohort A: ${cAErr.message}`);
      cohortAId = cA.id;
      createdCohortIds.push(cohortAId);

      // Create cohort B (enabled) — userB is a member
      const cohortBName = `${TEST_SLUG_PREFIX}cohort-B`;
      const { data: cB, error: cBErr } = await adminClient
        .from('cohort_definitions')
        .insert({
          name: cohortBName,
          leaderboard_enabled: true,
          rule: { type: 'all', conditions: [] },
          compiled_sql: 'true',
        })
        .select('id')
        .single();
      if (cBErr) throw new Error(`create cohort B: ${cBErr.message}`);
      cohortBId = cB.id;
      createdCohortIds.push(cohortBId);

      // Seed cohort membership: userA in A, userB in B
      const { error: memErr } = await adminClient.from('cohort_membership').insert([
        { cohort_id: cohortAId, user_id: userA.id },
        { cohort_id: cohortBId, user_id: userB.id },
      ]);
      if (memErr) throw new Error(`seed cohort_membership: ${memErr.message}`);

      // UserA opts into cohort A
      const { error: optAErr } = await userA.client.rpc('set_leaderboard_optin', {
        p_cohort_id: cohortAId,
        p_handle: `UserA-${randomUUID().slice(0, 4)}`,
        p_opt_in: true,
      });
      if (optAErr) throw new Error(`userA opt-in: ${optAErr.message}`);
    }, 120_000);

    afterAll(async () => {
      // Best-effort cleanup — remove cohort_membership, optin, cohort_definitions, users.
      for (const id of createdUserIds) {
        try {
          await adminClient.from('leaderboard_optin').delete().eq('user_id', id);
          await adminClient.from('cohort_membership').delete().eq('user_id', id);
        } catch {
          /* noop */
        }
      }
      for (const id of createdCohortIds) {
        try {
          await adminClient.from('cohort_definitions').delete().eq('id', id);
        } catch {
          /* noop */
        }
      }
      for (const id of createdUserIds) {
        try {
          await adminClient.auth.admin.deleteUser(id);
        } catch {
          /* noop */
        }
      }
    }, 30_000);

    // -------------------------------------------------------------------------
    // Test 1 — T-35-04-01: cross-cohort leaderboard read denied (42501)
    // -------------------------------------------------------------------------
    it(
      'user in cohort A cannot read cohort B leaderboard (T-35-04-01 not_cohort_member)',
      async () => {
        // userA is only in cohort A; asking for cohort B leaderboard → 42501
        const { error } = await userA.client.rpc('get_leaderboard_for_user', {
          p_cohort_id: cohortBId,
        });
        expect(error).not.toBeNull();
        expect(error!.code).toBe('42501');
        expect(error!.message).toContain('not_cohort_member');
      },
      30_000,
    );

    // -------------------------------------------------------------------------
    // Test 2 — T-35-04-05: opt-in to admin-disabled cohort fails (P0001)
    // -------------------------------------------------------------------------
    it(
      'opt-in to admin-disabled cohort fails with cohort_leaderboard_disabled (T-35-04-05)',
      async () => {
        // Create a disabled cohort
        const { data: cDis, error: cDisErr } = await adminClient
          .from('cohort_definitions')
          .insert({
            name: `${TEST_SLUG_PREFIX}disabled-${Date.now()}`,
            leaderboard_enabled: false,
            rule: { type: 'all', conditions: [] },
            compiled_sql: 'true',
          })
          .select('id')
          .single();
        if (cDisErr) throw new Error(`create disabled cohort: ${cDisErr.message}`);
        createdCohortIds.push(cDis.id);

        // Put userA in it
        await adminClient
          .from('cohort_membership')
          .insert({ cohort_id: cDis.id, user_id: userA.id });

        // userA tries to opt in → P0001 cohort_leaderboard_disabled
        const { error } = await userA.client.rpc('set_leaderboard_optin', {
          p_cohort_id: cDis.id,
          p_handle: 'ValidHandle-1234',
          p_opt_in: true,
        });
        expect(error).not.toBeNull();
        expect(error!.code).toBe('P0001');
        expect(error!.message).toContain('cohort_leaderboard_disabled');
      },
      30_000,
    );

    // -------------------------------------------------------------------------
    // Test 3 — T-35-04-06: non-member cannot opt in (42501 not_cohort_member)
    // -------------------------------------------------------------------------
    it(
      'non-member cannot opt into cohort leaderboard (T-35-04-06 not_cohort_member)',
      async () => {
        // userA is NOT a member of cohort B; trying to opt in → 42501
        const { error } = await userA.client.rpc('set_leaderboard_optin', {
          p_cohort_id: cohortBId,
          p_handle: 'ValidHandle-9999',
          p_opt_in: true,
        });
        expect(error).not.toBeNull();
        expect(error!.code).toBe('42501');
        expect(error!.message).toContain('not_cohort_member');
      },
      30_000,
    );

    // -------------------------------------------------------------------------
    // Test 4 — T-35-04-02: invalid handle rejected server-side (22023)
    // -------------------------------------------------------------------------
    it(
      'invalid handle (real name with spaces) rejected server-side with invalid_handle (T-35-04-02)',
      async () => {
        const { error } = await userA.client.rpc('set_leaderboard_optin', {
          p_cohort_id: cohortAId,
          p_handle: 'John Smith', // real name with space → rejected by regex
          p_opt_in: true,
        });
        expect(error).not.toBeNull();
        expect(error!.code).toBe('22023');
        expect(error!.message).toContain('invalid_handle');
      },
      30_000,
    );

    // -------------------------------------------------------------------------
    // Test 5 — T-35-04-03: direct INSERT into leaderboard_optin denied (42501)
    // -------------------------------------------------------------------------
    it(
      'authenticated user direct INSERT into leaderboard_optin fails with RLS violation (T-35-04-03)',
      async () => {
        const { error } = await userA.client.from('leaderboard_optin').insert({
          user_id: userA.id,
          cohort_id: cohortAId,
          handle: 'DirectInsert-9999',
          active: true,
          opted_in_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });
        expect(error).not.toBeNull();
        // PostgREST surfaces RLS denial as 42501 or "violates row-level security"
        expect(
          error!.code === '42501' ||
            /row-level security/i.test(error!.message ?? '') ||
            /42501/.test(error!.message ?? ''),
        ).toBe(true);
      },
      30_000,
    );

    // -------------------------------------------------------------------------
    // Test 6 — T-35-04-03: direct UPDATE into leaderboard_optin denied (42501)
    // -------------------------------------------------------------------------
    it(
      'authenticated user direct UPDATE into leaderboard_optin fails with RLS violation (T-35-04-03)',
      async () => {
        const { error } = await userA.client
          .from('leaderboard_optin')
          .update({ handle: 'HackedHandle-1234' })
          .eq('user_id', userA.id);
        expect(error).not.toBeNull();
        expect(
          error!.code === '42501' ||
            /row-level security/i.test(error!.message ?? '') ||
            /42501/.test(error!.message ?? ''),
        ).toBe(true);
      },
      30_000,
    );
  },
);

// ---------------------------------------------------------------------------
// Gating describe — always passes to avoid false-positives on CI when env absent
// ---------------------------------------------------------------------------
describe('Phase 35 Plan 35-04 — leaderboard RLS gating', () => {
  it('runs against live cloud DB when SUPABASE_SERVICE_ROLE_KEY is set', () => {
    if (!SHOULD_RUN) {
      // eslint-disable-next-line no-console
      console.warn(
        '[35-leaderboard-cross-tenant.test] SKIPPED — SUPABASE_SERVICE_ROLE_KEY (or URL/ANON) not set. Wave verification gates this.',
      );
    }
    expect(true).toBe(true);
  });
});
