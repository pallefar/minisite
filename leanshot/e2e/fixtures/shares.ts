/**
 * Phase 8 share-test fixture.
 *
 * Originated in Plan 08-04 Task 2b (createTestShare + happy-path support).
 * Extended in Plan 08-05 Task 1 with:
 *   - revokeTestShare(shareId)           — admin update on shares.revoked_at
 *   - impersonateAsRecipient(ctx, t, c)  — POST /share/redeem + cookie inject
 *   - assertAuditRowCount(shareId, n)    — assert audit_logs share_view count
 *   - cleanupTestShares()                — HI-6 afterAll cleanup (admin DELETE)
 *
 * Design notes:
 *   - HI-6 (concurrent CI runs): every share row created via this fixture
 *     gets a timestamp-suffixed label (`<label>-${Date.now()}-<rand>`) AND is
 *     tracked in a module-level `createdShareIds` Set so `cleanupTestShares()`
 *     can admin-DELETE the lot in `afterAll(...)`.
 *   - Plan-05 callers can pass a stable `patientEmail` (e.g. 'alice@test.com').
 *     We `ensureTestUser(email)` — look-up-or-create — so concurrent runs share
 *     the user but each gets its own share row + timestamped label. Test users
 *     persist between runs per the plan's accepted-threats list.
 *   - Plan-04 callers (share-happy-path.spec.ts) get the legacy behavior: if
 *     no patientEmail is given we mint a unique throw-away user. The returned
 *     `TestShare` still carries `user_id` + `admin` for backward compat AND
 *     adds the new `patient_user_id` + `label` fields for plan-05 callers.
 */

import { type BrowserContext } from '@playwright/test';
import { type SupabaseClient, createClient } from '@supabase/supabase-js';

const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY;

const FN_BASE = SUPABASE_URL ? `${SUPABASE_URL}/functions/v1` : '';

export function hasLiveSupabase(): boolean {
  return Boolean(SERVICE_ROLE && SUPABASE_URL && ANON_KEY);
}

// ─── Module-level share-id tracking (HI-6) ─────────────────────────────────
// Every share created via this fixture is recorded here so `cleanupTestShares`
// can admin-DELETE the lot in `afterAll()`. Idempotent: cleared on each call.
const createdShareIds = new Set<string>();

// Memoise the admin client so we can reuse it from helpers that don't go
// through createTestShare (revokeTestShare, cleanupTestShares, assertAuditRow…).
let cachedAdmin: SupabaseClient | null = null;
function getAdmin(): SupabaseClient {
  if (!cachedAdmin) {
    if (!SUPABASE_URL || !SERVICE_ROLE) {
      throw new Error('admin client requires SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY');
    }
    cachedAdmin = createClient(SUPABASE_URL, SERVICE_ROLE, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  }
  return cachedAdmin;
}

// Stable password for the look-up-or-create test users (alice@test.com etc.).
// Per the plan's accepted-threats list these accounts persist between runs.
const STABLE_TEST_PASSWORD = 'TestPass123!-leanshot-share-fixture';

// ─── Public types ───────────────────────────────────────────────────────────
export interface CreateTestShareOptions {
  /** Email for the test patient. If provided, we ensure-or-create — concurrent
   * runs share the user. If absent we mint a unique throw-away user. */
  patientEmail?: string;
  /** Label for the share row (1..80 chars). Timestamp suffix is appended. */
  label: string;
  /** Hours until the share expires (1..720). */
  expiresInHours: number;
}

export interface TestShare {
  share_id: string;
  raw_token: string;
  raw_code: string;
  /** Patient user-id — same as `user_id`, named for plan-05 readability. */
  patient_user_id: string;
  /** Final, timestamp-suffixed label written to shares.label. */
  label: string;
  /** Legacy alias for backward compat with Plan 08-04 callers. */
  user_id: string;
  /** Admin client for cleanup — Plan 08-04 happy-path uses this in afterAll. */
  admin: SupabaseClient;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
async function ensureTestUser(email: string): Promise<string> {
  const admin = getAdmin();
  // Paginate auth.users until found or exhausted. Phase 70 70-07 fix: previous
  // default listUsers() returned only page 1 (perPage=50). Live auth.users grew
  // past 50 from cumulative CI runs; alice@test.com fell off page 1 → find
  // returned undefined → createUser fired and failed with "already been
  // registered". Pagination keeps lookup-or-create semantics regardless of
  // corpus size.
  const PER_PAGE = 1000;
  for (let page = 1; page <= 100; page++) {
    const { data, error: listErr } = await admin.auth.admin.listUsers({ page, perPage: PER_PAGE });
    if (listErr) throw new Error(`admin.listUsers failed: ${listErr.message}`);
    const found = data?.users.find((u) => u.email === email);
    if (found) return found.id;
    if (!data?.users || data.users.length < PER_PAGE) break;
  }

  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email,
    password: STABLE_TEST_PASSWORD,
    email_confirm: true,
  });
  if (createErr || !created.user) {
    throw new Error(`admin.createUser failed for ${email}: ${createErr?.message ?? 'no user'}`);
  }
  return created.user.id;
}

async function signInAsUser(email: string, password: string): Promise<SupabaseClient> {
  if (!SUPABASE_URL || !ANON_KEY) {
    throw new Error('user client requires SUPABASE_URL + ANON_KEY');
  }
  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error } = await userClient.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`signInWithPassword failed for ${email}: ${error.message}`);
  return userClient;
}

// ─── createTestShare ─────────────────────────────────────────────────────────
/**
 * Create a test share end-to-end:
 *   - ensure-or-create test user (stable email path) OR mint a unique user
 *   - sign in via anon client to obtain a session
 *   - call create_share RPC as the authenticated user
 *
 * The returned share_id is tracked in `createdShareIds` for HI-6 cleanup.
 * Cleanup happens via `cleanupTestShares()` in `afterAll(...)`. Plan 08-04
 * callers that prefer per-test user cleanup can still delete via `share.admin`.
 */
export async function createTestShare(opts: CreateTestShareOptions): Promise<TestShare> {
  if (!hasLiveSupabase()) {
    throw new Error(
      'createTestShare requires SUPABASE_SERVICE_ROLE_KEY + SUPABASE_URL + SUPABASE_ANON_KEY',
    );
  }
  const admin = getAdmin();

  // Two paths:
  //   - Stable email (plan-05 alice@/bob@): ensure-or-create at fixed password.
  //   - No email (plan-04 happy-path): mint a unique throw-away user.
  let email: string;
  let password: string;
  let userId: string;
  if (opts.patientEmail) {
    email = opts.patientEmail;
    password = STABLE_TEST_PASSWORD;
    userId = await ensureTestUser(email);
  } else {
    email = `share-pw-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@leanshot.test`;
    password = `Pass1234-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const { data: createData, error: createErr } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (createErr || !createData.user) {
      throw new Error(`admin.createUser failed: ${createErr?.message ?? 'no user'}`);
    }
    userId = createData.user.id;
  }

  const userClient = await signInAsUser(email, password);

  // HI-6 — always suffix label with timestamp + a short random so concurrent
  // CI runs (and concurrent tests within one run) do not collide.
  const finalLabel = `${opts.label}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const expiresAt = new Date(Date.now() + opts.expiresInHours * 3_600_000).toISOString();

  const { data: rpcData, error: rpcErr } = await userClient.rpc('create_share', {
    p_label: finalLabel,
    p_expires_at: expiresAt,
  });
  if (rpcErr) {
    throw new Error(`create_share RPC failed: ${rpcErr.message}`);
  }
  const row = (Array.isArray(rpcData) ? rpcData[0] : rpcData) as
    | { share_id?: string; raw_token?: string; raw_code?: string }
    | undefined;
  if (!row?.share_id || !row?.raw_token || !row?.raw_code) {
    throw new Error(`create_share returned unexpected shape: ${JSON.stringify(rpcData)}`);
  }

  createdShareIds.add(row.share_id);

  return {
    share_id: row.share_id,
    raw_token: row.raw_token,
    raw_code: row.raw_code,
    patient_user_id: userId,
    user_id: userId,
    label: finalLabel,
    admin,
  };
}

// ─── revokeTestShare ─────────────────────────────────────────────────────────
/**
 * Revoke a share via direct admin UPDATE on shares.revoked_at.
 *
 * We use the admin client directly (NOT the revoke_share RPC) because the RPC
 * is owner-scoped (auth.uid() = user_id) and the drill test doesn't need to
 * exercise the owner-auth path here — the e2e/active-shares.spec.ts already
 * covers that surface. For fixture purposes this gets the row revoked
 * deterministically without requiring us to track the owner's JWT.
 */
export async function revokeTestShare(shareId: string): Promise<void> {
  const admin = getAdmin();
  const { error } = await admin
    .from('shares')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', shareId);
  if (error) throw new Error(`revokeTestShare failed: ${error.message}`);
}

// ─── impersonateAsRecipient ──────────────────────────────────────────────────
/**
 * Drive POST /share/redeem programmatically and inject the resulting cookie
 * into a Playwright BrowserContext so subsequent navigations see the recipient
 * as already-redeemed. Used by the revocation drill to skip the code-entry
 * UI for failure modes that target post-redeem state (a, c).
 *
 * NOTE: this mutates the share — code_consumed_at is set. The drill always
 * uses one share per test, so single-use is not a contention point.
 */
export async function impersonateAsRecipient(
  context: BrowserContext,
  token: string,
  code: string,
): Promise<void> {
  if (!FN_BASE) throw new Error('SUPABASE_URL not set');
  const resp = await fetch(`${FN_BASE}/share/redeem`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      // Match the SPA dev origin — cors.ts allows localhost:5173 by default
      // and the CI env's `SHARE_ALLOWED_ORIGINS` includes it too.
      Origin: 'http://localhost:5173',
    },
    body: JSON.stringify({ token, code }),
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`impersonateAsRecipient redeem failed: ${resp.status} ${text}`);
  }
  const setCookie = resp.headers.get('set-cookie') ?? '';
  const match = setCookie.match(/recipient_session=([^;]+)/);
  if (!match) {
    throw new Error(`impersonateAsRecipient: no recipient_session in Set-Cookie: ${setCookie}`);
  }
  const value = match[1]!;
  const url = new URL(FN_BASE);
  await context.addCookies([
    {
      name: 'recipient_session',
      value,
      domain: url.hostname,
      path: '/',
      httpOnly: true,
      secure: true,
      sameSite: 'Strict',
    },
  ]);
}

// ─── assertAuditRowCount ─────────────────────────────────────────────────────
/**
 * Assert that exactly `expected` audit_logs rows exist for the given share
 * with `actor_type='share_recipient'` and `action='share_view'`. Used by the
 * drill spec to verify SHARE-05.
 */
export async function assertAuditRowCount(shareId: string, expected: number): Promise<void> {
  const admin = getAdmin();
  const { count, error } = await admin
    .from('audit_logs')
    .select('*', { count: 'exact', head: true })
    .eq('share_id', shareId)
    .eq('actor_type', 'share_recipient')
    .eq('action', 'share_view');
  if (error) throw new Error(`assertAuditRowCount query failed: ${error.message}`);
  if (count !== expected) {
    throw new Error(`assertAuditRowCount: expected ${expected} rows, got ${count ?? 'null'}`);
  }
}

// ─── cleanupTestShares ───────────────────────────────────────────────────────
/**
 * HI-6 — afterAll cleanup. Admin-DELETE every share row created during the
 * run. `audit_logs.share_id` is `on delete set null` (Plan 08-01 ME-2) so
 * audit rows are preserved for the audit retention contract, just unlinked
 * from the now-deleted share. Idempotent: safe to call multiple times.
 *
 * Best-effort: a failure here MUST NOT mask a test failure. We log and clear
 * the tracking set regardless.
 */
export async function cleanupTestShares(): Promise<void> {
  if (createdShareIds.size === 0) return;
  const ids = Array.from(createdShareIds);
  try {
    const admin = getAdmin();
    const { error } = await admin.from('shares').delete().in('id', ids);
    if (error) {
      console.error(`[fixtures/shares] cleanupTestShares: ${error.message}`);
    }
  } catch (err) {
    console.error(
      `[fixtures/shares] cleanupTestShares threw: ${err instanceof Error ? err.message : String(err)}`,
    );
  } finally {
    createdShareIds.clear();
  }
}
