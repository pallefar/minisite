/**
 * Phase 8 Plan 08-04 Task 2b — Playwright share fixture.
 *
 * Provides `createTestShare()` which:
 *   1. Creates a fresh test user via the admin client
 *   2. Calls the `create_share` SECURITY DEFINER RPC as that user
 *   3. Returns { share_id, raw_token, raw_code, user_id, admin } so callers
 *      can drive the doctor flow + clean up
 *
 * Plan 08-05 (revocation drill) extends this fixture with a `revokeShare()`
 * helper that calls `revoke_share(share_id)` server-side. Plan 08-06 extends
 * with helpers for the print-mode capture.
 *
 * Skip-gates on SUPABASE_SERVICE_ROLE_KEY / VITE_SUPABASE_URL /
 * VITE_SUPABASE_ANON_KEY (same pattern as e2e/auth-signup-verify-signin.spec.ts).
 * Callers should `test.skip(!hasLiveSupabase(), …)` before invoking.
 */

import { type SupabaseClient, createClient } from '@supabase/supabase-js';

const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY;

export function hasLiveSupabase(): boolean {
  return Boolean(SERVICE_ROLE && SUPABASE_URL && ANON_KEY);
}

export interface CreateTestShareOptions {
  /** Email for the test patient (defaults to a timestamped unique address). */
  patientEmail?: string;
  /** Label for the share row (1..80 chars). */
  label: string;
  /** Hours until the share expires (1..720). */
  expiresInHours: number;
}

export interface TestShare {
  share_id: string;
  raw_token: string;
  raw_code: string;
  user_id: string;
  /** Admin client for cleanup — caller invokes `deleteUser(user_id)` in afterAll. */
  admin: SupabaseClient;
}

/**
 * Create a test share end-to-end:
 *   - Provision a confirmed test user via admin.createUser
 *   - Sign that user in via the anon client to obtain a session
 *   - Call create_share RPC as the authenticated user
 *
 * Returns the share materials. Cleanup is the caller's responsibility:
 *   await afterAll(async () => {
 *     await share.admin.auth.admin.deleteUser(share.user_id).catch(() => {});
 *   });
 */
export async function createTestShare(opts: CreateTestShareOptions): Promise<TestShare> {
  if (!hasLiveSupabase()) {
    throw new Error(
      'createTestShare requires SUPABASE_SERVICE_ROLE_KEY + VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY',
    );
  }
  const email = opts.patientEmail ?? `share-pw-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@leanshot.test`;
  const password = `Pass1234-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const admin = createClient(SUPABASE_URL!, SERVICE_ROLE!, {
    auth: { persistSession: false },
  });

  // Create a confirmed user (email_confirm: true → no verification round-trip)
  const { data: createData, error: createErr } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (createErr || !createData.user) {
    throw new Error(`admin.createUser failed: ${createErr?.message ?? 'no user returned'}`);
  }
  const userId = createData.user.id;

  // Sign in via the anon client so the create_share RPC sees the user as
  // auth.uid() — the RPC's `auth.uid() = user_id` filter is the gate.
  const userClient = createClient(SUPABASE_URL!, ANON_KEY!, {
    auth: { persistSession: false },
  });
  const { error: signInErr } = await userClient.auth.signInWithPassword({ email, password });
  if (signInErr) {
    await admin.auth.admin.deleteUser(userId).catch(() => {});
    throw new Error(`signInWithPassword failed: ${signInErr.message}`);
  }

  // Call create_share — returns share_id, raw_token, raw_code (one-shot)
  const expiresAt = new Date(Date.now() + opts.expiresInHours * 3_600_000).toISOString();
  const { data: rpcData, error: rpcErr } = await userClient.rpc('create_share', {
    p_label: opts.label,
    p_expires_at: expiresAt,
  });
  if (rpcErr) {
    await admin.auth.admin.deleteUser(userId).catch(() => {});
    throw new Error(`create_share RPC failed: ${rpcErr.message}`);
  }
  // The RPC returns a table-valued row; supabase-js wraps it as an array.
  const row = Array.isArray(rpcData) ? rpcData[0] : rpcData;
  if (!row?.share_id || !row?.raw_token || !row?.raw_code) {
    await admin.auth.admin.deleteUser(userId).catch(() => {});
    throw new Error(`create_share returned unexpected shape: ${JSON.stringify(rpcData)}`);
  }

  return {
    share_id: row.share_id,
    raw_token: row.raw_token,
    raw_code: row.raw_code,
    user_id: userId,
    admin,
  };
}
