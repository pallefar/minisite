/**
 * Phase 9 Plan 09-09 — shared clinic test fixtures.
 *
 * Provides the SQL-level scaffolding the 7 clinic specs depend on:
 *   - createOperatorWithOrg(slugPrefix): mint operator + their first org via
 *     create_org RPC, return operator + orgId + slug.
 *   - createPatient(email?): mint a patient auth.users row (no memberships).
 *   - createInvite({orgId, operator, patientEmail, requestedScope?}):
 *     call send_invite RPC and return invite_id + rawToken + tokenHash.
 *     Resend dispatch is bypassed — we extract the token deterministically
 *     by hashing a known seed (Pitfall #7 — preserves Resend free-tier quota).
 *   - acceptInviteAs({patient, tokenHash, consentScope}): sign in as patient
 *     and call accept_invite_existing RPC.
 *   - revokeMembershipAs({user, membershipId}): call revoke_membership.
 *   - expireInvite(inviteId): admin UPDATE to set expires_at past now() (D-17).
 *   - cleanupClinicFixtures(emailPattern, slugPrefix): afterAll best-effort.
 *   - getAuditRows({orgId}): admin SELECT helper.
 *
 * Design notes:
 *   - The fixture NEVER calls the public Resend-dispatching Edge Function;
 *     it calls the `send_invite` RPC directly (via service-role admin OR
 *     an operator-scoped anon client when auth.uid() needs to resolve).
 *     This is the project-rule pattern from memory
 *     `reference_supabase_auth_traps.md`: never call public auth-email
 *     endpoints from e2e.
 *   - All test data uses `*@test.leanshot.app` emails + `t{ts}-*` org slugs
 *     so the cleanup helper can reliably scope deletes (T-09-48).
 *   - The fixture works against the LIVE Supabase project ref `ytnsipxxmzgaebkqmokp`
 *     via the same env vars the rls-*.test.ts files use.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { createHash, randomBytes } from 'node:crypto';

import type { ConsentScope } from '@/types/clinic';

export const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
export const SUPABASE_ANON_KEY =
  process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY;
export const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

export function hasLiveSupabase(): boolean {
  return Boolean(SUPABASE_URL && SUPABASE_ANON_KEY && SUPABASE_SERVICE_ROLE_KEY);
}

// ─── admin client (singleton) ────────────────────────────────────────────────
let cachedAdmin: SupabaseClient | null = null;
export function getAdmin(): SupabaseClient {
  if (!cachedAdmin) {
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      throw new Error(
        'getAdmin requires SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY env vars',
      );
    }
    cachedAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  }
  return cachedAdmin;
}

// ─── unique IDs + email helpers ──────────────────────────────────────────────
const TEST_PASSWORD_PREFIX = 'ClinicTest!1-';

export function testRunId(): string {
  return `t${Date.now()}${Math.random().toString(36).slice(2, 8)}`;
}

export function testEmail(prefix: string, runId: string): string {
  return `${prefix}-${runId}@test.leanshot.app`;
}

export function fullConsentScope(): ConsentScope {
  return {
    injections: true,
    weights: true,
    photos: true,
    symptoms: true,
    meals: true,
    workouts: true,
    supplements: true,
    mood: true,
    sleep: true,
    doctor_report: true,
  };
}

// ─── auth user creation ──────────────────────────────────────────────────────
export interface TestUser {
  id: string;
  email: string;
  password: string;
}

export async function createUser(opts: {
  email: string;
  password?: string;
}): Promise<TestUser> {
  const admin = getAdmin();
  const password = opts.password ?? `${TEST_PASSWORD_PREFIX}${testRunId()}`;
  const { data, error } = await admin.auth.admin.createUser({
    email: opts.email,
    password,
    email_confirm: true,
  });
  if (error || !data.user) {
    throw new Error(
      `createUser(${opts.email}) failed: ${error?.message ?? 'no user returned'}`,
    );
  }
  return { id: data.user.id, email: opts.email, password };
}

/** Sign in as a user → return a per-user anon client carrying the JWT. */
export async function signIn(user: TestUser): Promise<SupabaseClient> {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    throw new Error('signIn requires SUPABASE_URL + SUPABASE_ANON_KEY');
  }
  const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      storageKey: `clinic-fixtures-${user.id}`,
    },
  });
  const { error } = await client.auth.signInWithPassword({
    email: user.email,
    password: user.password,
  });
  if (error) throw new Error(`signIn(${user.email}) failed: ${error.message}`);
  return client;
}

// ─── operator + org creation ─────────────────────────────────────────────────
export interface OperatorWithOrg {
  operator: TestUser;
  client: SupabaseClient;
  orgId: string;
  slug: string;
}

export async function createOperatorWithOrg(slugPrefix: string): Promise<OperatorWithOrg> {
  const runId = testRunId();
  const operator = await createUser({ email: testEmail(`op-${slugPrefix}`, runId) });
  const client = await signIn(operator);

  const slug = `${slugPrefix}-${runId}`;
  const { data, error } = await client.rpc('create_org', {
    p_name: `Test Clinic ${slugPrefix}`,
    p_slug: slug,
    p_description: null,
    p_website_url: null,
  });
  if (error) {
    throw new Error(`create_org(${slug}) failed: ${error.message}`);
  }
  const row = (Array.isArray(data) ? data[0] : data) as {
    id?: string;
    org_id?: string;
    slug?: string;
  } | null;
  const orgId = row?.id ?? row?.org_id;
  if (!orgId) {
    throw new Error(`create_org returned unexpected shape: ${JSON.stringify(data)}`);
  }
  return { operator, client, orgId, slug };
}

// ─── invite lifecycle ────────────────────────────────────────────────────────
export interface CreatedInvite {
  inviteId: string;
  rawToken: string;
  tokenHash: string;
  email: string;
}

function sha256Hex(buf: Buffer | string): string {
  const h = createHash('sha256');
  h.update(buf);
  return h.digest('hex');
}

/**
 * Generate a raw token + hash matching the Edge Function's format:
 *   raw = 32-hex-char (16 random bytes hex-encoded)
 *   hash = sha256(raw) as hex
 *
 * We bypass the public clinic-invite/send Edge Function (and therefore Resend)
 * by calling the underlying send_invite RPC as the operator. The RPC accepts
 * an already-hashed token (`p_invite_token_hash`); we keep the raw token for
 * any spec that wants to simulate the patient clicking the email URL.
 */
export function makeInviteToken(): { rawToken: string; tokenHash: string } {
  const rawToken = randomBytes(16).toString('hex');
  return { rawToken, tokenHash: sha256Hex(rawToken) };
}

export async function createInviteViaRpc(opts: {
  operatorClient: SupabaseClient;
  orgId: string;
  email: string;
  requestedScope?: ConsentScope;
}): Promise<CreatedInvite> {
  const { rawToken, tokenHash } = makeInviteToken();
  const requestedScope = opts.requestedScope ?? fullConsentScope();
  const { data, error } = await opts.operatorClient.rpc('send_invite', {
    p_email: opts.email.trim().toLowerCase(),
    p_org_id: opts.orgId,
    p_invite_token_hash: tokenHash,
    p_requested_scope: requestedScope,
  });
  if (error) {
    throw new Error(`send_invite(${opts.email}) failed: ${error.message}`);
  }
  const row = (Array.isArray(data) ? data[0] : data) as { invite_id?: string } | null;
  const inviteId = row?.invite_id;
  if (!inviteId) {
    throw new Error(`send_invite returned unexpected shape: ${JSON.stringify(data)}`);
  }
  return { inviteId, rawToken, tokenHash, email: opts.email.trim().toLowerCase() };
}

export async function acceptInviteAs(opts: {
  patient: TestUser;
  tokenHash: string;
  consentScope?: ConsentScope;
}): Promise<{ membershipId: string; orgId: string }> {
  const patientClient = await signIn(opts.patient);
  const consentScope = opts.consentScope ?? fullConsentScope();
  const { data, error } = await patientClient.rpc('accept_invite_existing', {
    p_invite_token_hash: opts.tokenHash,
    p_consent_scope: consentScope,
  });
  if (error) {
    throw new Error(`accept_invite_existing failed: ${error.message}`);
  }
  const row = (Array.isArray(data) ? data[0] : data) as {
    membership_id?: string;
    org_id?: string;
  } | null;
  if (!row?.membership_id || !row?.org_id) {
    throw new Error(
      `accept_invite_existing returned unexpected shape: ${JSON.stringify(data)}`,
    );
  }
  return { membershipId: row.membership_id, orgId: row.org_id };
}

export async function revokeMembershipAs(opts: {
  patient: TestUser;
  membershipId: string;
}): Promise<void> {
  const client = await signIn(opts.patient);
  const { error } = await client.rpc('revoke_membership', {
    p_membership_id: opts.membershipId,
  });
  if (error) throw new Error(`revoke_membership failed: ${error.message}`);
}

/** D-17: expire an invite by direct admin UPDATE (sets expires_at to past). */
export async function expireInvite(inviteId: string): Promise<void> {
  const admin = getAdmin();
  const { error } = await admin
    .from('invites')
    .update({ expires_at: new Date(Date.now() - 86400_000).toISOString() })
    .eq('id', inviteId);
  if (error) throw new Error(`expireInvite(${inviteId}) failed: ${error.message}`);
}

// ─── role + permission helpers (clinic-role-permission-grid) ─────────────────
export async function createRoleAs(opts: {
  operatorClient: SupabaseClient;
  orgId: string;
  name: string;
  permissionKeys: string[];
}): Promise<{ roleId: string }> {
  const { data, error } = await opts.operatorClient.rpc('create_role', {
    p_org_id: opts.orgId,
    p_name: opts.name,
    p_description: null,
    p_permission_keys: opts.permissionKeys,
  });
  if (error) throw new Error(`create_role(${opts.name}) failed: ${error.message}`);
  const row = (Array.isArray(data) ? data[0] : data) as { role_id?: string } | null;
  if (!row?.role_id) {
    throw new Error(`create_role returned unexpected shape: ${JSON.stringify(data)}`);
  }
  return { roleId: row.role_id };
}

export async function updateMemberRoleAs(opts: {
  operatorClient: SupabaseClient;
  membershipId: string;
  roleId: string;
}): Promise<void> {
  const { error } = await opts.operatorClient.rpc('update_member_role', {
    p_membership_id: opts.membershipId,
    p_role_id: opts.roleId,
  });
  if (error) throw new Error(`update_member_role failed: ${error.message}`);
}

// ─── DB inspection helpers ───────────────────────────────────────────────────
export async function countAuthUsersWithEmail(email: string): Promise<number> {
  const admin = getAdmin();
  // admin.auth.admin.listUsers returns paginated; for our test corpus (single
  // email per scenario) page 1 of 50 is more than enough.
  const { data, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
  if (error) throw new Error(`listUsers failed: ${error.message}`);
  const want = email.trim().toLowerCase();
  return (data?.users ?? []).filter((u) => (u.email ?? '').toLowerCase() === want).length;
}

export async function countMemberships(opts: {
  userId: string;
  orgId?: string;
  activeOnly?: boolean;
}): Promise<number> {
  const admin = getAdmin();
  let q = admin.from('memberships').select('id, revoked_at', { count: 'exact', head: false }).eq(
    'user_id',
    opts.userId,
  );
  if (opts.orgId) q = q.eq('org_id', opts.orgId);
  if (opts.activeOnly) q = q.is('revoked_at', null);
  const { data, error } = await q;
  if (error) throw new Error(`countMemberships failed: ${error.message}`);
  return data?.length ?? 0;
}

export async function getMembership(opts: {
  userId: string;
  orgId: string;
}): Promise<{
  id: string;
  revoked_at: string | null;
  consent_scope: ConsentScope;
} | null> {
  const admin = getAdmin();
  const { data, error } = await admin
    .from('memberships')
    .select('id, revoked_at, consent_scope')
    .eq('user_id', opts.userId)
    .eq('org_id', opts.orgId)
    .maybeSingle();
  if (error) throw new Error(`getMembership failed: ${error.message}`);
  return data as { id: string; revoked_at: string | null; consent_scope: ConsentScope } | null;
}

export async function getInvite(inviteId: string): Promise<{
  id: string;
  accepted_at: string | null;
  rejected_at: string | null;
  consumed_at: string | null;
  expires_at: string;
  consent_scope_at_acceptance: ConsentScope | null;
} | null> {
  const admin = getAdmin();
  const { data, error } = await admin
    .from('invites')
    .select(
      'id, accepted_at, rejected_at, consumed_at, expires_at, consent_scope_at_acceptance',
    )
    .eq('id', inviteId)
    .maybeSingle();
  if (error) throw new Error(`getInvite failed: ${error.message}`);
  return data as {
    id: string;
    accepted_at: string | null;
    rejected_at: string | null;
    consumed_at: string | null;
    expires_at: string;
    consent_scope_at_acceptance: ConsentScope | null;
  } | null;
}

export interface AuditRow {
  action: string;
  actor_type: string;
  actor_user_id: string | null;
  org_id: string | null;
  target_user_id: string | null;
  row_id: string | null;
  created_at: string;
}

export async function getAuditRows(opts: { orgId: string }): Promise<AuditRow[]> {
  const admin = getAdmin();
  const { data, error } = await admin
    .from('audit_logs')
    .select('action, actor_type, actor_user_id, org_id, target_user_id, row_id, created_at')
    .eq('org_id', opts.orgId)
    .order('created_at', { ascending: true });
  if (error) throw new Error(`getAuditRows failed: ${error.message}`);
  return (data ?? []) as AuditRow[];
}

// ─── cleanup ─────────────────────────────────────────────────────────────────
/**
 * Best-effort cleanup. Deletes any auth.users matching the email pattern
 * (which cascades to memberships, invites, etc. via existing FK on-delete-cascade)
 * AND any orgs with slugs matching the slug pattern.
 *
 * Idempotent + swallows errors. NEVER throws (would mask a test failure).
 */
export async function cleanupClinicFixtures(opts: {
  emailPattern?: string;
  slugPattern?: string;
}): Promise<void> {
  if (!hasLiveSupabase()) return;
  const admin = getAdmin();
  if (opts.emailPattern) {
    try {
      const { data } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
      for (const u of data?.users ?? []) {
        if ((u.email ?? '').includes(opts.emailPattern)) {
          try {
            await admin.auth.admin.deleteUser(u.id);
          } catch {
            // best-effort
          }
        }
      }
    } catch {
      // best-effort
    }
  }
  if (opts.slugPattern) {
    try {
      await admin.from('orgs').delete().like('slug', `%${opts.slugPattern}%`);
    } catch {
      // best-effort
    }
  }
}
