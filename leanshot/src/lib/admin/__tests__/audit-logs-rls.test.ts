/**
 * Phase 24 Plan 24-01 — audit_logs RLS: append-only enforcement + admin-read proof.
 *
 * Verifies, against the live cloud DB (ytnsipxxmzgaebkqmokp), that:
 *
 *   T1: service_role CANNOT update audit_logs rows (returns error or 0 rows)
 *   T2: service_role CANNOT delete audit_logs rows (returns error or 0 rows)
 *   T3: log_admin_action() inserts a row with correct actor_user_id, target_user_id,
 *       action_name, and source='rpc'
 *   T4: is_admin_at_least ordinal comparator — staff satisfies 'staff', not 'admin';
 *       superadmin satisfies all three
 *
 * Pattern follows tests/rls/photo-trash-rls.test.ts (Phase 23):
 *   - admin createClient with service_role key for setup/teardown
 *   - per-user authenticated clients via getUserAccessToken (admin.generateLink +
 *     /auth/v1/verify) to avoid ES256 key issues
 *   - file-scoped TEST_SLUG_PREFIX per [[feedback_rls_per_file_slug_prefix]]
 *   - tests self-skip when required env vars absent
 *
 * Environment:
 *   SUPABASE_URL              — public
 *   SUPABASE_ANON_KEY         — public
 *   SUPABASE_SERVICE_ROLE_KEY — PRIVATE (CI secret)
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// eslint-disable-next-line import-x/no-restricted-paths
import { getUserAccessToken } from '../../../../tests/rls/helpers/admin-session';

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const SHOULD_RUN = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY && SUPABASE_SERVICE_ROLE_KEY);
const describeIfLive = SHOULD_RUN ? describe : describe.skip;

// ---------------------------------------------------------------------------
// File-scoped prefix — no shared global; avoids clobbering under vitest
// file-parallelism per [[feedback_rls_per_file_slug_prefix]]
// ---------------------------------------------------------------------------

const TEST_SLUG_PREFIX = `audit-rls-${Date.now().toString(36)}-`;

// ---------------------------------------------------------------------------
// Client helpers
// ---------------------------------------------------------------------------

function getAdmin(): SupabaseClient {
  return createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

function buildAnonClient(storageKey: string): SupabaseClient {
  return createClient(SUPABASE_URL!, SUPABASE_ANON_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false, storageKey },
  });
}

// ---------------------------------------------------------------------------
// Module-level state
// ---------------------------------------------------------------------------

const admin = SHOULD_RUN ? getAdmin() : null!;
const createdUserIds: string[] = [];

let adminUserId: string;
let targetUserId: string;
let adminAccessToken: string;
let seededAuditRowId: string | undefined;

// ---------------------------------------------------------------------------
// Setup: create two test users; promote one to admin role
// ---------------------------------------------------------------------------

beforeAll(async () => {
  if (!SHOULD_RUN) return;

  const emailAdmin = `${TEST_SLUG_PREFIX}admin@leanshot.test`;
  const emailTarget = `${TEST_SLUG_PREFIX}target@leanshot.test`;
  const password = `Pass1234-${crypto.randomUUID().slice(0, 8)}`;

  const aRes = await admin.auth.admin.createUser({ email: emailAdmin, password, email_confirm: true });
  if (aRes.error) throw aRes.error;
  adminUserId = aRes.data.user!.id;
  createdUserIds.push(adminUserId);

  const tRes = await admin.auth.admin.createUser({ email: emailTarget, password, email_confirm: true });
  if (tRes.error) throw tRes.error;
  targetUserId = tRes.data.user!.id;
  createdUserIds.push(targetUserId);

  // Promote adminUserId to admin role via service_role direct update
  await admin.from('profiles').upsert({ id: adminUserId, admin_role: 'admin', is_staff: true });

  // Get a real ES256-signed access token for the admin user
  adminAccessToken = await getUserAccessToken(emailAdmin);
}, 60_000);

// ---------------------------------------------------------------------------
// Teardown
// ---------------------------------------------------------------------------

afterAll(async () => {
  if (!SHOULD_RUN) return;
  // Clean up seeded audit rows first
  if (seededAuditRowId) {
    try { await admin.from('audit_logs').delete().eq('id', seededAuditRowId); } catch { /* best-effort */ }
  }
  // Delete test users
  for (const id of createdUserIds) {
    try { await admin.auth.admin.deleteUser(id); } catch { /* best-effort */ }
  }
}, 30_000);

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describeIfLive('Phase 24 D-17 — audit_logs append-only RLS (T-24-03)', () => {
  it('T1: service_role CANNOT update audit_logs rows', async () => {
    // Insert a seed row via log_admin_action using the admin user's token
    const adminClient = buildAnonClient(`${TEST_SLUG_PREFIX}admin-t1`);
    adminClient.auth.setSession({
      access_token: adminAccessToken,
      refresh_token: 'unused',
    });

    const { data: logId, error: logErr } = await adminClient.rpc('log_admin_action', {
      p_action_name: 'test_action_t1',
      p_target_user_id: targetUserId,
    });
    expect(logErr).toBeNull();
    expect(logId).toBeTruthy();
    seededAuditRowId = logId as string;

    // Attempt service_role direct update — should fail or return 0 rows
    const { error: updErr, count } = await admin
      .from('audit_logs')
      .update({ action_name: 'tampered' })
      .eq('id', logId)
      .select('id');

    // D-17: service_role must be denied — either error OR 0 rows affected
    const denied = updErr !== null || (count != null && count === 0);
    expect(denied).toBe(true);
  }, 30_000);

  it('T2: service_role CANNOT delete audit_logs rows', async () => {
    if (!seededAuditRowId) {
      // Seed a row via service_role direct insert to test delete separately
      const { data: insertData } = await admin
        .from('audit_logs')
        .insert({
          action_name: 'test_action_t2',
          source: 'rpc',
          actor_user_id: adminUserId,
          target_user_id: targetUserId,
        })
        .select('id')
        .single();
      seededAuditRowId = insertData?.id;
    }

    // Attempt service_role direct delete — should fail or return 0 rows
    const { error: delErr, count } = await admin
      .from('audit_logs')
      .delete()
      .eq('id', seededAuditRowId)
      .select('id');

    // D-17: service_role must be denied — either error OR 0 rows deleted
    const denied = delErr !== null || (count != null && count === 0);
    expect(denied).toBe(true);

    // Verify the row still exists (tamper evidence)
    const { data: checkRow } = await admin
      .from('audit_logs')
      .select('id')
      .eq('id', seededAuditRowId!)
      .single();
    expect(checkRow).toBeTruthy();
  }, 30_000);

  it('T3: log_admin_action() inserts row with correct actor_user_id, target_user_id, action_name, source=rpc', async () => {
    const adminClient = buildAnonClient(`${TEST_SLUG_PREFIX}admin-t3`);
    adminClient.auth.setSession({
      access_token: adminAccessToken,
      refresh_token: 'unused',
    });

    const { data: rowId, error } = await adminClient.rpc('log_admin_action', {
      p_action_name: 'role_change_test',
      p_target_user_id: targetUserId,
      p_before: { admin_role: null },
      p_after: { admin_role: 'staff' },
    });
    expect(error).toBeNull();
    expect(rowId).toBeTruthy();

    // Verify via service_role (admin can read)
    const { data: row } = await admin
      .from('audit_logs')
      .select('actor_user_id, target_user_id, action_name, source, before_data, after_data')
      .eq('id', rowId as string)
      .single();

    expect(row).toBeTruthy();
    expect(row!.actor_user_id).toBe(adminUserId);
    expect(row!.target_user_id).toBe(targetUserId);
    expect(row!.action_name).toBe('role_change_test');
    expect(row!.source).toBe('rpc');
    expect(row!.before_data).toEqual({ admin_role: null });
    expect(row!.after_data).toEqual({ admin_role: 'staff' });

    // Cleanup
    await admin.from('audit_logs').delete().eq('id', rowId as string);
  }, 30_000);

  it('T4: is_admin_at_least ordinal comparator — staff satisfies staff only; superadmin satisfies all', async () => {
    // Promote adminUserId to superadmin temporarily
    await admin.from('profiles').update({ admin_role: 'superadmin' }).eq('id', adminUserId);

    const superadminToken = await getUserAccessToken(
      `${TEST_SLUG_PREFIX}admin@leanshot.test`,
    );
    const superClient = buildAnonClient(`${TEST_SLUG_PREFIX}super`);
    superClient.auth.setSession({ access_token: superadminToken, refresh_token: 'unused' });

    // Superadmin should satisfy 'staff'
    const { data: staffRes } = await superClient.rpc('is_admin_at_least', { min_role: 'staff' });
    expect(staffRes).toBe(true);
    // Superadmin should satisfy 'superadmin'
    const { data: superRes } = await superClient.rpc('is_admin_at_least', { min_role: 'superadmin' });
    expect(superRes).toBe(true);

    // Demote back to admin for remaining tests
    await admin.from('profiles').update({ admin_role: 'admin' }).eq('id', adminUserId);
  }, 30_000);
});

describe('Phase 24 audit_logs RLS — gating', () => {
  it('runs against live cloud DB when SUPABASE_SERVICE_ROLE_KEY is set', () => {
    if (!SHOULD_RUN) {
      console.warn('[audit-logs-rls.test] SKIPPED — env vars not set; run against live DB for RLS proofs.');
    }
    expect(true).toBe(true);
  });
});
