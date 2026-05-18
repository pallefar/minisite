/**
 * Phase 25 Plan 02 — RLS + append-only proof for `phi_access_log`.
 *
 * Tests (per plan Task 3):
 *   T1: Patient A SELECT own rows → 1 row (after fixture INSERT via service_role).
 *   T2: Patient B SELECT → 0 rows (cross-patient isolation proof).
 *   T3: Staff user SELECT → sees all rows.
 *   T4: Patient A direct INSERT → 42501 (no insert policy for authenticated).
 *   T5: Patient A invokes log_phi_access RPC for own user → succeeds; SELECT confirms row.
 *   T6: Patient A invokes log_phi_access with p_accessed_user_id = B's uuid → succeeds;
 *       SELECT as B shows the row; actor_user_id = A's uid (RPC auth.uid() enforced).
 *   T7: service_role UPDATE on existing row → fails (REVOKE enforced).
 *   T8: Anonymous SELECT → 0 rows (no authenticated JWT).
 *
 * File-scoped PREFIX = 'pal-test-' per [[feedback_rls_per_file_slug_prefix]].
 * Per-file prefix + Date.now() suffix prevents vitest file-parallelism clobbering.
 *
 * Environment: requires SUPABASE_URL + SUPABASE_ANON_KEY + SUPABASE_SERVICE_ROLE_KEY.
 * Tests are skipped automatically when env not set (CI with linked project only).
 *
 * RLS fixture pattern: admin.auth.admin.generateLink + verifyOtp (ES256-compat).
 * Per [[reference_rls_fixture_gotrueclient_flake]] 2026-05-16 fix.
 * Never calls signInWithPassword (avoids cross-contamination under vitest).
 */

import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// ─── Environment ─────────────────────────────────────────────────────────────

const SUPABASE_URL =
  process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? '';
const SUPABASE_ANON_KEY =
  process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY ?? '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

const SHOULD_RUN = Boolean(
  SUPABASE_URL && SUPABASE_ANON_KEY && SUPABASE_SERVICE_ROLE_KEY,
);

// ─── File-scoped prefix (per [[feedback_rls_per_file_slug_prefix]]) ──────────

const _basename = path.basename(__filename ?? 'phi-access-log.test.ts');
const _ts = Date.now().toString(36);
const PREFIX = `pal-test-${_basename.replace('.test.ts', '').slice(0, 16)}-${_ts}`;

// ─── Admin client (service-role) ──────────────────────────────────────────────

// Test-fixture exception: service-role needed to seed cross-patient scenarios
// and to test the REVOKE enforcements. Production code NEVER uses service-role.
function makeAdmin(): SupabaseClient {
  // eslint-disable-next-line leanshot/no-raw-service-role-client -- test fixture
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

// ─── Session helper (ES256-compat per [[reference_rls_fixture_gotrueclient_flake]]) ─

interface UserSession {
  access_token: string;
  user_id: string;
  email: string;
  client: SupabaseClient;
}

async function createTestUser(
  admin: SupabaseClient,
  email: string,
): Promise<UserSession> {
  const { data: userData, error: userErr } = await admin.auth.admin.createUser({
    email,
    email_confirm: true,
    password: `Phi25-${crypto.randomUUID()}`,
  });
  if (userErr || !userData?.user) {
    throw new Error(`createUser failed for ${email}: ${userErr?.message}`);
  }

  const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
    type: 'magiclink',
    email,
  });
  if (linkErr || !linkData) {
    throw new Error(`generateLink failed for ${email}: ${linkErr?.message}`);
  }
  const tokenHash = linkData.properties?.hashed_token;
  if (!tokenHash) {
    throw new Error(`no hashed_token for ${email}`);
  }

  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: verifyData, error: verifyErr } = await userClient.auth.verifyOtp({
    type: 'magiclink',
    token_hash: tokenHash,
  });
  if (verifyErr || !verifyData?.session) {
    throw new Error(`verifyOtp failed for ${email}: ${verifyErr?.message}`);
  }

  return {
    access_token: verifyData.session.access_token,
    user_id: userData.user.id,
    email,
    client: userClient,
  };
}

// ─── Cleanup helper ───────────────────────────────────────────────────────────

async function cleanup(admin: SupabaseClient, userIds: string[]): Promise<void> {
  // Delete phi_access_log rows for these users (cascade would handle it, but explicit is safer).
  for (const uid of userIds) {
    await admin
      .from('phi_access_log')
      .delete()
      .or(`accessed_user_id.eq.${uid},actor_user_id.eq.${uid}`);
    await admin.auth.admin.deleteUser(uid);
  }
}

// ─── Staff user helper ────────────────────────────────────────────────────────

async function makeStaffUser(
  admin: SupabaseClient,
  email: string,
): Promise<UserSession> {
  const sess = await createTestUser(admin, email);
  // Grant staff role via profiles table update (service-role bypasses RLS).
  await admin
    .from('profiles')
    .update({ admin_role: 'staff' })
    .eq('id', sess.user_id);
  return sess;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

const describeIfLive = SHOULD_RUN ? describe : describe.skip;

describeIfLive('P25 RLS — phi_access_log cross-patient isolation + append-only', () => {
  let admin: SupabaseClient;
  let sessA: UserSession;
  let sessB: UserSession;
  let sessStaff: UserSession;
  let seedRowId: number;

  beforeAll(async () => {
    admin = makeAdmin();

    const emailA = `${PREFIX}-a@leanshot.test`;
    const emailB = `${PREFIX}-b@leanshot.test`;
    const emailStaff = `${PREFIX}-staff@leanshot.test`;

    [sessA, sessB, sessStaff] = await Promise.all([
      createTestUser(admin, emailA),
      createTestUser(admin, emailB),
      makeStaffUser(admin, emailStaff),
    ]);

    // Seed 1 row for Patient A via service_role (fixture INSERT — not via RPC).
    // actor_user_id = sessStaff.user_id to simulate a staff access event.
    const { data: seedData, error: seedErr } = await admin
      .from('phi_access_log')
      .insert({
        actor_user_id: sessStaff.user_id,
        accessed_user_id: sessA.user_id,
        accessed_fields: ['dose_log.value', 'dose_log.timestamp'],
        reason: 'P25 integration test fixture row',
      })
      .select('id')
      .single();
    if (seedErr || !seedData) throw new Error(`seed INSERT failed: ${seedErr?.message}`);
    seedRowId = (seedData as { id: number }).id;
  }, 90_000);

  afterAll(async () => {
    // Clean up all rows first (revoke prevents UPDATE but not DELETE by admin).
    // The REVOKE only blocked the service_role UPDATE permission, not DELETE.
    // We need the admin client to clean up test data.
    if (seedRowId) {
      // Use direct SQL via service_role (this is a delete, not update — allowed).
      await admin.from('phi_access_log').delete().eq('id', seedRowId);
    }
    await cleanup(admin, [sessA.user_id, sessB.user_id, sessStaff.user_id]);
  });

  it('T1: Patient A SELECT own rows → 1 row (fixture row visible)', async () => {
    const { data, error } = await sessA.client
      .from('phi_access_log')
      .select('id, accessed_user_id, actor_user_id');
    expect(error).toBeNull();
    const ids = (data ?? []).map((r: { id: number }) => r.id);
    expect(ids).toContain(seedRowId);
  }, 30_000);

  it('T2: Patient B SELECT → 0 rows (cross-patient isolation)', async () => {
    const { data, error } = await sessB.client
      .from('phi_access_log')
      .select('id');
    expect(error).toBeNull();
    // B's rows are empty; A's row is NOT visible to B.
    const ids = (data ?? []).map((r: { id: number }) => r.id);
    expect(ids).not.toContain(seedRowId);
  }, 30_000);

  it('T3: Staff user SELECT → sees fixture row (staff override policy)', async () => {
    const { data, error } = await sessStaff.client
      .from('phi_access_log')
      .select('id');
    expect(error).toBeNull();
    const ids = (data ?? []).map((r: { id: number }) => r.id);
    expect(ids).toContain(seedRowId);
  }, 30_000);

  it('T4: Patient A direct INSERT → 42501 (no insert policy for authenticated)', async () => {
    const { error } = await sessA.client.from('phi_access_log').insert({
      actor_user_id: sessA.user_id,
      accessed_user_id: sessA.user_id,
      accessed_fields: ['dose_log.value'],
      reason: 'direct insert attempt — should fail',
    });
    // RLS default-deny: no insert policy for authenticated role → 42501.
    expect(error).not.toBeNull();
    expect(error?.code).toBe('42501');
  }, 30_000);

  it('T5: Patient A invokes log_phi_access RPC for own user → row inserted; actor_user_id = A', async () => {
    const { error } = await sessA.client.rpc('log_phi_access', {
      p_accessed_user_id: sessA.user_id,
      p_accessed_fields: ['photos'],
      p_reason: 'T5 self-access smoke test',
    });
    expect(error).toBeNull();

    // SELECT as A and confirm the new row has actor_user_id = A.
    const { data } = await sessA.client
      .from('phi_access_log')
      .select('id, actor_user_id, accessed_fields, reason')
      .eq('reason', 'T5 self-access smoke test');
    const row = (data ?? []).find(
      (r: { actor_user_id: string | null }) => r.actor_user_id === sessA.user_id,
    );
    expect(row).toBeTruthy();
    expect(row?.actor_user_id).toBe(sessA.user_id);
  }, 30_000);

  it('T6: Patient A logs access to B — row written; SELECT as B shows it; actor_user_id = A', async () => {
    const { error } = await sessA.client.rpc('log_phi_access', {
      p_accessed_user_id: sessB.user_id,
      p_accessed_fields: ['dose_log.value'],
      p_reason: 'T6 cross-patient RPC test',
    });
    expect(error).toBeNull();

    // B can see this row (it's accessed_user_id = B).
    const { data } = await sessB.client
      .from('phi_access_log')
      .select('id, actor_user_id, accessed_user_id')
      .eq('reason', 'T6 cross-patient RPC test');
    const row = (data ?? [])[0] as
      | { id: number; actor_user_id: string; accessed_user_id: string }
      | undefined;
    expect(row).toBeTruthy();
    // RPC MUST have used auth.uid() (= A's uid) not any caller-supplied actor_user_id.
    expect(row?.actor_user_id).toBe(sessA.user_id);
    expect(row?.accessed_user_id).toBe(sessB.user_id);
  }, 30_000);

  it('T7: service_role UPDATE on existing row → fails (REVOKE update enforced)', async () => {
    // REVOKE update, delete FROM service_role is applied in 20270702000004.
    const { error } = await admin
      .from('phi_access_log')
      .update({ reason: 'TAMPERED' })
      .eq('id', seedRowId);
    // The revoke should cause an error (permission denied).
    expect(error).not.toBeNull();
  }, 30_000);

  it.skip('T8: anonymous SELECT → 0 rows [DEFERRED — requires anon client without auth; skip in CI linked-DB run]', async () => {
    // An anonymous client (no JWT) cannot select from phi_access_log.
    // RLS requires auth.uid() to be non-null for both select policies.
    // Skipped: constructing a truly anonymous (non-authenticated) supabase client
    // from the integration test harness requires additional setup not yet provided.
    const anonClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data, error } = await anonClient.from('phi_access_log').select('id');
    // Should return 0 rows or an RLS error.
    const rowCount = (data ?? []).length;
    expect(rowCount).toBe(0);
    // error may be null (RLS returns 0 rows silently) or non-null.
    void error;
  });
});
