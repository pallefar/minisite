/**
 * Phase 25 Plan 25-01 — vendor_baa_chain RLS cross-tenant impersonation proof.
 *
 * Verifies, against the live cloud DB (ytnsipxxmzgaebkqmokp), that:
 *
 *   T1: Anonymous SELECT returns zero rows (no data leak)
 *   T2: Non-staff authenticated SELECT returns zero rows
 *   T3: Staff SELECT returns all 6 seed rows (Supabase, Vercel, Sentry, Anthropic, AWS SES, PostHog)
 *   T4: Non-superadmin staff (admin_role='admin') UPDATE denied (PGRST116/42501)
 *   T5: Superadmin UPDATE allowed (returns 1 row affected)
 *   T6: service_role UPDATE on status DENIED — load-bearing proof of RESEARCH Pitfall 6 mitigation
 *         (explicit REVOKE update from service_role closes the elevated-privilege bypass)
 *   T7: DELETE denied for all roles (anon, staff, superadmin, service_role)
 *
 * Pattern references honored:
 *   - reference_rls_fixture_gotrueclient_flake.md — admin.generateLink + /auth/v1/verify
 *     via plain fetch (NOT signInWithPassword); avoids ES256-compat issues.
 *   - feedback_rls_per_file_slug_prefix.md — file-scoped const TEST_SLUG_PREFIX;
 *     never shared with sibling test files.
 *   - reference_vitest_skip_fixme.md — use it.skip(...) not it.fixme(...) if needed.
 *   - reference_supabase_project.md — every RLS surface gets a live cross-tenant test.
 *
 * Environment:
 *   SUPABASE_URL              — public project URL (also VITE_SUPABASE_URL)
 *   SUPABASE_ANON_KEY         — public anon key (also VITE_SUPABASE_ANON_KEY)
 *   SUPABASE_SERVICE_ROLE_KEY — PRIVATE service_role key (CI secret; never commit)
 *
 * Self-skipping: entire describe block is skipped when env vars are absent.
 * This prevents failures in local dev or fork PRs that lack the service_role key.
 *
 * Run via:
 *   npx vitest run supabase/functions/tests/integration/vendor-baa-chain.test.ts
 */

import { randomUUID } from 'node:crypto';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? '';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY ?? '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

const SHOULD_RUN = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY && SUPABASE_SERVICE_ROLE_KEY);
const describeIfLive = SHOULD_RUN ? describe : describe.skip;

// ---------------------------------------------------------------------------
// File-scoped prefix — feedback_rls_per_file_slug_prefix.md
// Must NOT be a shared global; prevents clobbering under vitest file-parallelism.
// ---------------------------------------------------------------------------
const TEST_SLUG_PREFIX = 'vbc-test-' + randomUUID().slice(0, 8) + '-';

// ---------------------------------------------------------------------------
// Auth helper: admin.generateLink + /auth/v1/verify via plain fetch
// Avoids GoTrueClient cross-contamination (reference_rls_fixture_gotrueclient_flake.md)
// No signInWithPassword — ES256 project; only /auth/v1/verify produces valid tokens.
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

async function getUserAccessToken(email: string): Promise<string> {
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

// ---------------------------------------------------------------------------
// Client builders
// ---------------------------------------------------------------------------

function getAdmin(): SupabaseClient {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

function getAnon(): SupabaseClient {
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false, storageKey: `anon-${randomUUID()}` },
  });
}

function buildAuthenticatedClient(accessToken: string): SupabaseClient {
  const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false, storageKey: `user-${randomUUID()}` },
    global: {
      headers: { Authorization: `Bearer ${accessToken}` },
    },
  });
  return client;
}

// ---------------------------------------------------------------------------
// Module-level state
// ---------------------------------------------------------------------------

let admin: SupabaseClient;
const createdUserIds: string[] = [];

let nonStaffUserId: string;
let staffUserId: string;
let adminRoleUserId: string;
let superadminUserId: string;

let nonStaffEmail: string;
let staffEmail: string;
let adminRoleEmail: string;
let superadminEmail: string;

let staffToken: string;
let adminRoleToken: string;
let superadminToken: string;

const SEED_VENDOR_NAMES = ['Supabase', 'Vercel', 'Sentry', 'Anthropic', 'AWS SES', 'PostHog'];

// ---------------------------------------------------------------------------
// Setup: create 4 test users with different admin_role values
// ---------------------------------------------------------------------------

describeIfLive('Phase 25 Plan 25-01 — vendor_baa_chain RLS cross-tenant impersonation proof', () => {
  beforeAll(async () => {
    admin = getAdmin();
    const ts = randomUUID().slice(0, 8);
    const password = `VbcTest1!-${ts}`;

    nonStaffEmail    = `${TEST_SLUG_PREFIX}nonstaf@leanshot.test`;
    staffEmail       = `${TEST_SLUG_PREFIX}staff@leanshot.test`;
    adminRoleEmail   = `${TEST_SLUG_PREFIX}admin@leanshot.test`;
    superadminEmail  = `${TEST_SLUG_PREFIX}super@leanshot.test`;

    // Create all 4 users
    for (const [varRef, email] of [
      ['nonStaffUserId', nonStaffEmail],
      ['staffUserId', staffEmail],
      ['adminRoleUserId', adminRoleEmail],
      ['superadminUserId', superadminEmail],
    ] as const) {
      const { data, error } = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
      });
      if (error) throw new Error(`createUser(${email}): ${error.message}`);
      const id = data.user!.id;
      createdUserIds.push(id);
      if (varRef === 'nonStaffUserId')   nonStaffUserId   = id;
      if (varRef === 'staffUserId')      staffUserId      = id;
      if (varRef === 'adminRoleUserId')  adminRoleUserId  = id;
      if (varRef === 'superadminUserId') superadminUserId = id;
    }

    // Set admin_role for staff, admin, superadmin via service_role (RLS bypassed for setup)
    await admin.from('profiles').update({ admin_role: 'staff' }).eq('id', staffUserId);
    await admin.from('profiles').update({ admin_role: 'admin' }).eq('id', adminRoleUserId);
    await admin.from('profiles').update({ admin_role: 'superadmin' }).eq('id', superadminUserId);

    // Mint ES256-signed access tokens for users that need authenticated access
    [staffToken, adminRoleToken, superadminToken] = await Promise.all([
      getUserAccessToken(staffEmail),
      getUserAccessToken(adminRoleEmail),
      getUserAccessToken(superadminEmail),
    ]);
  }, 90_000);

  afterAll(async () => {
    // Revert any status changes we made during tests back to 'pending'
    // (service_role UPDATE is blocked, so we must do this via admin client
    // with raw SQL or RPC — using the admin client here which bypasses RLS)
    // Note: service_role cannot UPDATE because of our REVOKE, but we still
    // need to restore. We do this via admin.rpc or direct query won't work.
    // The best-effort approach: if the test for T5 changed Sentry to 'signed',
    // we use the admin's postgres-level access to restore it.
    // Since admin client uses service_role which has REVOKE on UPDATE,
    // we cannot restore via supabase-js. Document: the test uses a SECURITY
    // DEFINER RPC path that Plan 25-08 will ship. For now, the test is
    // marked to skip the cleanup of vendor_baa_chain status (the table is
    // a global seed; the verifier will check status via SQL in manual verification).
    // Cleanup test users only (which is achievable via service_role admin.auth.admin.deleteUser).
    for (const id of createdUserIds) {
      try {
        await admin.auth.admin.deleteUser(id);
      } catch {
        // best-effort
      }
    }
    // Clean up profiles rows for test users (cascade should handle, but be explicit)
    for (const id of createdUserIds) {
      try {
        await admin.from('profiles').delete().eq('id', id);
      } catch {
        // best-effort
      }
    }
  }, 30_000);

  // -------------------------------------------------------------------------
  // T1: Anonymous SELECT denied
  // -------------------------------------------------------------------------
  it('T1: anonymous SELECT returns zero rows (no data leak)', async () => {
    const anon = getAnon();
    const { data, error } = await anon.from('vendor_baa_chain').select('vendor_name');
    // PostgREST default-deny: either empty array or PGRST116 depending on version
    expect(error === null || (data !== null && data.length === 0)).toBe(true);
    expect(data?.length ?? 0).toBe(0);
  });

  // -------------------------------------------------------------------------
  // T2: Non-staff authenticated SELECT denied
  // -------------------------------------------------------------------------
  it('T2: non-staff authenticated user SELECT returns zero rows', async () => {
    // Use a direct token from the non-staff user — but we need their token too.
    // We mint it here inline.
    const nonStaffToken = await getUserAccessToken(nonStaffEmail);
    const client = buildAuthenticatedClient(nonStaffToken);
    const { data, error } = await client.from('vendor_baa_chain').select('vendor_name');
    expect(error === null || (data !== null && data.length === 0)).toBe(true);
    expect(data?.length ?? 0).toBe(0);
  });

  // -------------------------------------------------------------------------
  // T3: Staff SELECT allowed — expects all 6 seed rows
  // -------------------------------------------------------------------------
  it('T3: staff-role user can SELECT all 6 seed rows', async () => {
    const client = buildAuthenticatedClient(staffToken);
    const { data, error } = await client
      .from('vendor_baa_chain')
      .select('vendor_name, status')
      .order('vendor_name');
    expect(error).toBeNull();
    expect(data).not.toBeNull();
    const names = data!.map((r) => r.vendor_name).sort();
    for (const vendorName of SEED_VENDOR_NAMES) {
      expect(names).toContain(vendorName);
    }
    expect(data!.length).toBeGreaterThanOrEqual(6);
  });

  // -------------------------------------------------------------------------
  // T4: Non-superadmin staff UPDATE denied
  //     admin_role='admin' (not superadmin) cannot update status
  // -------------------------------------------------------------------------
  it('T4: admin-role (non-superadmin) UPDATE on status is denied', async () => {
    const client = buildAuthenticatedClient(adminRoleToken);
    const { data, error } = await client
      .from('vendor_baa_chain')
      .update({ status: 'signed' })
      .eq('vendor_name', 'Sentry')
      .select();
    // PostgREST returns an error (insufficient_privilege / PGRST301)
    // or an empty data array (no rows match the policy)
    const rowsAffected = data?.length ?? 0;
    const isBlocked = error !== null || rowsAffected === 0;
    expect(isBlocked).toBe(true);
  });

  // -------------------------------------------------------------------------
  // T5: Superadmin UPDATE allowed
  //     Note: service_role REVOKE means we use the superadmin's JWT here,
  //     which is allowed by the update policy (admin_role='superadmin').
  // -------------------------------------------------------------------------
  it('T5: superadmin UPDATE allowed (1 row affected)', async () => {
    const client = buildAuthenticatedClient(superadminToken);
    const { data, error } = await client
      .from('vendor_baa_chain')
      .update({ status: 'signed' })
      .eq('vendor_name', 'Sentry')
      .select('vendor_name, status');
    expect(error).toBeNull();
    expect(data).not.toBeNull();
    expect(data!.length).toBe(1);
    expect(data![0].status).toBe('signed');

    // Restore — superadmin can set it back since the policy allows update
    await client
      .from('vendor_baa_chain')
      .update({ status: 'pending' })
      .eq('vendor_name', 'Sentry');
  });

  // -------------------------------------------------------------------------
  // T6: service_role UPDATE on status DENIED
  //     Load-bearing proof of RESEARCH Pitfall 6 mitigation.
  //     The migration contains: REVOKE UPDATE, DELETE ON vendor_baa_chain FROM service_role
  //     PostgREST/Supabase-js with service_role key must receive an error.
  // -------------------------------------------------------------------------
  it('T6: service_role UPDATE on status is denied (REVOKE update from service_role)', async () => {
    // admin client uses SUPABASE_SERVICE_ROLE_KEY — this is the service_role test
    const { data, error } = await admin
      .from('vendor_baa_chain')
      .update({ status: 'expired' })
      .eq('vendor_name', 'AWS SES')
      .select();
    // Expectation: error returned (permission_denied) OR zero rows affected.
    // The REVOKE should produce a PostgreSQL error code 42501 (insufficient_privilege).
    const rowsAffected = data?.length ?? 0;
    const isBlocked = error !== null || rowsAffected === 0;
    expect(isBlocked).toBe(true);
  });

  // -------------------------------------------------------------------------
  // T7: DELETE denied for all roles
  // -------------------------------------------------------------------------
  it('T7a: anonymous DELETE is denied', async () => {
    const anon = getAnon();
    const { data, error } = await anon
      .from('vendor_baa_chain')
      .delete()
      .eq('vendor_name', 'PostHog')
      .select();
    const rowsDeleted = data?.length ?? 0;
    const isBlocked = error !== null || rowsDeleted === 0;
    expect(isBlocked).toBe(true);
  });

  it('T7b: staff DELETE is denied', async () => {
    const client = buildAuthenticatedClient(staffToken);
    const { data, error } = await client
      .from('vendor_baa_chain')
      .delete()
      .eq('vendor_name', 'PostHog')
      .select();
    const rowsDeleted = data?.length ?? 0;
    const isBlocked = error !== null || rowsDeleted === 0;
    expect(isBlocked).toBe(true);
  });

  it('T7c: superadmin DELETE is denied (no delete policy exists)', async () => {
    const client = buildAuthenticatedClient(superadminToken);
    const { data, error } = await client
      .from('vendor_baa_chain')
      .delete()
      .eq('vendor_name', 'PostHog')
      .select();
    const rowsDeleted = data?.length ?? 0;
    const isBlocked = error !== null || rowsDeleted === 0;
    expect(isBlocked).toBe(true);
  });

  it('T7d: service_role DELETE is denied (REVOKE delete from service_role)', async () => {
    const { data, error } = await admin
      .from('vendor_baa_chain')
      .delete()
      .eq('vendor_name', 'PostHog')
      .select();
    const rowsDeleted = data?.length ?? 0;
    const isBlocked = error !== null || rowsDeleted === 0;
    expect(isBlocked).toBe(true);
  });
});
