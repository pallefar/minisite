/// <reference types="node" />
/**
 * Phase 28 Plan 01 — RLS test fixture helper.
 *
 * Provides:
 *   - `makeSlugPrefix(testFilename)` — file-scoped slug prefix factory
 *     (per [[feedback_rls_per_file_slug_prefix]] — avoids vitest
 *      file-parallelism slug clobbering)
 *   - `sessionFor(email)` — mints a test session JWT for an existing auth user
 *     via `admin.auth.admin.generateLink + verifyOtp` (ES256-compat per
 *     [[reference_rls_fixture_gotrueclient_flake]] 2026-05-16 fix)
 *   - `createTwoOrgsTwoUsers(prefix)` — creates 2 orgs + 2 users;
 *     maps User A → Org X, User B → Org Y; returns sessions for both
 *   - `cleanupByPrefix(admin, prefix)` — afterAll cleanup
 *
 * Environment:
 *   SUPABASE_URL              — project URL
 *   SUPABASE_ANON_KEY         — anon key
 *   SUPABASE_SERVICE_ROLE_KEY — service-role key (CI secret)
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? '';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY ?? '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

// Lazy-init admin client (service-role).
// Test-fixture exception: RLS tests need a service-role client to seed cross-tenant scenarios
// (createOrg as admin, then assert User A cannot read Org B as the test subject).
// withOrgScope is the production guard; test setup is its own context and predates RLS evaluation.
let _admin: SupabaseClient | null = null;
export function getAdmin(): SupabaseClient {
  if (!_admin) {
    // eslint-disable-next-line leanshot/no-raw-service-role-client -- test fixture; see comment above
    _admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  }
  return _admin;
}

export const SHOULD_RUN = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY && SUPABASE_SERVICE_ROLE_KEY);

/**
 * File-scoped slug prefix factory.
 * Call once at module top: `const PREFIX = makeSlugPrefix(__filename);`
 *
 * Derived from test filename + Date.now() so parallel vitest workers
 * cannot clobber each other's fixtures.
 */
export function makeSlugPrefix(testFilename: string): string {
  const base = testFilename.split('/').pop()!.replace('.test.ts', '');
  const ts = Date.now().toString(36); // base-36 shortens 13-digit ms timestamp to ~8 chars
  // Truncate base to 20 chars so org names stay within the 60-char orgs_name_check
  // constraint: "P28 Test Org X (" (16) + prefix + ")" (1) = 17 + prefix ≤ 60 → prefix ≤ 43.
  // "p28-" (4) + base (≤20) + "-" (1) + ts (≤9) = ≤34 chars (safe).
  const truncatedBase = base.slice(0, 20);
  return `p28-${truncatedBase}-${ts}`;
}

export interface Session {
  access_token: string;
  user_id: string;
  email: string;
  client: SupabaseClient;
}

/**
 * Mint a session for a user identified by email.
 * Uses `admin.auth.admin.generateLink({ type: 'magiclink', email })` +
 * `client.auth.verifyOtp({ type: 'magiclink', token_hash })`.
 * This is ES256-compat (per [[reference_rls_fixture_gotrueclient_flake]]).
 * Never calls `signInWithPassword` (avoids cross-contamination under vitest).
 */
export async function sessionFor(email: string): Promise<Session> {
  const admin = getAdmin();
  const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
    type: 'magiclink',
    email,
  });
  if (linkErr || !linkData)
    throw new Error(`generateLink failed for ${email}: ${linkErr?.message}`);

  const tokenHash = linkData.properties?.hashed_token;
  if (!tokenHash) throw new Error(`no hashed_token in generateLink response for ${email}`);

  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: verifyData, error: verifyErr } = await userClient.auth.verifyOtp({
    type: 'magiclink',
    token_hash: tokenHash,
  });
  if (verifyErr || !verifyData.session) {
    throw new Error(`verifyOtp failed for ${email}: ${verifyErr?.message}`);
  }

  // Extract user_id from the session
  const userId = verifyData.session.user?.id ?? verifyData.user?.id;
  if (!userId) throw new Error(`no user_id in session for ${email}`);

  return {
    access_token: verifyData.session.access_token,
    user_id: userId,
    email,
    client: userClient,
  };
}

export interface TwoOrgsTwoUsers {
  orgX: string; // org_id for Org X (User A's org)
  orgY: string; // org_id for Org Y (User B's org)
  userA: string; // user_id for User A (admin of Org X)
  userB: string; // user_id for User B (admin of Org Y)
  sessA: Session;
  sessB: Session;
}

/**
 * Creates 2 orgs + 2 users for cross-tenant isolation testing.
 * User A is an admin of Org X; User B is an admin of Org Y.
 * Both are created with `email_confirm: true` (no email needed).
 */
export async function createTwoOrgsTwoUsers(prefix: string): Promise<TwoOrgsTwoUsers> {
  const admin = getAdmin();

  const emailA = `${prefix}-a@leanshot.test`;
  const emailB = `${prefix}-b@leanshot.test`;

  // Create users via admin API (email_confirm: true skips email flow).
  const { data: aData, error: aErr } = await admin.auth.admin.createUser({
    email: emailA,
    email_confirm: true,
    password: `P28-${crypto.randomUUID()}`,
  });
  if (aErr || !aData.user) throw new Error(`createUser A failed: ${aErr?.message}`);
  const userA = aData.user;

  const { data: bData, error: bErr } = await admin.auth.admin.createUser({
    email: emailB,
    email_confirm: true,
    password: `P28-${crypto.randomUUID()}`,
  });
  if (bErr || !bData.user) throw new Error(`createUser B failed: ${bErr?.message}`);
  const userB = bData.user;

  // Mint sessions via generateLink + verifyOtp (ES256-compat).
  const sessA = await sessionFor(emailA);
  const sessB = await sessionFor(emailB);

  // Create organizations via admin client (bypasses RLS for setup).
  // Insert directly: create_org RPC requires an authenticated user — use
  // user-scoped client so auth.uid() resolves correctly inside the SECDEF RPC.
  const clientA = sessA.client;
  const clientB = sessB.client;

  const slugX = `${prefix}-x`;
  const slugY = `${prefix}-y`;

  const { data: orgXData, error: orgXErr } = await clientA.rpc('create_org', {
    p_name: `P28 Test Org X (${prefix})`,
    p_slug: slugX,
    p_description: null,
    p_website_url: null,
  });
  if (orgXErr) throw new Error(`create_org X failed: ${orgXErr.message}`);
  const orgXRow = Array.isArray(orgXData) ? orgXData[0] : orgXData;
  const orgX: string = orgXRow?.id ?? orgXRow?.org_id;
  if (!orgX) throw new Error('create_org X returned no org_id');

  const { data: orgYData, error: orgYErr } = await clientB.rpc('create_org', {
    p_name: `P28 Test Org Y (${prefix})`,
    p_slug: slugY,
    p_description: null,
    p_website_url: null,
  });
  if (orgYErr) throw new Error(`create_org Y failed: ${orgYErr.message}`);
  const orgYRow = Array.isArray(orgYData) ? orgYData[0] : orgYData;
  const orgY: string = orgYRow?.id ?? orgYRow?.org_id;
  if (!orgY) throw new Error('create_org Y returned no org_id');

  // Seed org_members for both users as admin of their org.
  // Direct insert via admin client (bypasses RLS for test seeding).
  const { error: memberAErr } = await admin.from('org_members').insert({
    org_id: orgX,
    user_id: userA.id,
    role: 'owner',
  });
  if (memberAErr) throw new Error(`org_members insert A failed: ${memberAErr.message}`);

  const { error: memberBErr } = await admin.from('org_members').insert({
    org_id: orgY,
    user_id: userB.id,
    role: 'owner',
  });
  if (memberBErr) throw new Error(`org_members insert B failed: ${memberBErr.message}`);

  return {
    orgX,
    orgY,
    userA: userA.id,
    userB: userB.id,
    sessA: { ...sessA, user_id: userA.id },
    sessB: { ...sessB, user_id: userB.id },
  };
}

/**
 * Cleanup helper — call in afterAll.
 * Deletes orgs (cascade to memberships) and users created for this prefix.
 */
export async function cleanupByPrefix(prefix: string): Promise<void> {
  const admin = getAdmin();
  // Delete org_members rows (the orgs themselves will be soft-deleted or
  // left in place — Phase 9 orgs are deleted via delete_org RPC or direct
  // admin delete). Use admin client to bypass RLS.
  try {
    await admin.from('org_members').delete().like('org_id', '%');
    // Simpler: delete users — cascade deletes all user-owned rows.
    const emailA = `${prefix}-a@leanshot.test`;
    const emailB = `${prefix}-b@leanshot.test`;
    // Find user IDs by email and delete.
    for (const email of [emailA, emailB]) {
      try {
        const { data: users } = await admin.auth.admin.listUsers();
        const user = (users?.users ?? []).find((u) => u.email === email);
        if (user) {
          await admin.auth.admin.deleteUser(user.id);
        }
      } catch {
        // best-effort cleanup
      }
    }
    // Also delete any org_invites, org_members, etc. created for these orgs.
    // This is covered by cascade on auth.users delete.
  } catch {
    // best-effort
  }
}
