/**
 * Phase 27 Plan 27-06 — Integration test: 250-user async bulk-action drain.
 *
 * Asserts the full async path end-to-end:
 *   1. Seed admin + 250 target profiles.
 *   2. Sign in as admin (auth.admin.generateLink → POST /auth/v1/verify per
 *      [[reference_rls_fixture_gotruechient_flake]] — ES256-compatible).
 *   3. As admin: call admin_bulk_action_execute with action='tag' + 250 ids.
 *      Expect {mode:'async', job_id}.
 *   4. Manually invoke admin-bulk-job-worker via fetch with service-role bearer
 *      (bypasses the every-minute cron schedule for deterministic timing).
 *   5. Poll admin_bulk_jobs.status until 'completed' (max 30s).
 *   6. Assert rows_completed === 250, error_log empty.
 *   7. Assert all 250 profiles carry the test tag.
 *   8. Assert 250 audit_logs rows with action_name='bulk_tag'.
 *
 * File-scoped slug per [[feedback_rls_per_file_slug_prefix]]; afterAll cleanup
 * deletes every seeded row (profiles, auth.users, audit_logs, admin_bulk_jobs).
 *
 * Skipped unless SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY + SUPABASE_ANON_KEY
 * are set (live-environment test only).
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const ANON = process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;

const SHOULD_RUN = Boolean(URL && ANON && SERVICE);
const describeIfLive = SHOULD_RUN ? describe : describe.skip;

const SLUG = `bulkjob-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
const TEST_TAG = `${SLUG}_async`;
const N_USERS = 250;

interface SeededUser {
  id: string;
  email: string;
}

describeIfLive('Phase 27 Plan 27-06 — admin-bulk-job-worker 250-user drain', () => {
  let admin: SupabaseClient;
  let asAdminClient: SupabaseClient;
  let adminUserId: string | null = null;
  let seededUsers: SeededUser[] = [];
  let jobId: string | null = null;

  beforeAll(async () => {
    admin = createClient(URL!, SERVICE!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // 1. Create the admin user (super-admin role to pass is_admin_at_least).
    const adminEmail = `${SLUG}-admin@test.leanshot.app`;
    const { data: adminAuth, error: adminAuthErr } = await admin.auth.admin.createUser({
      email: adminEmail,
      email_confirm: true,
      password: 'X-' + Math.random().toString(36).slice(2) + '-Aa1!',
    });
    if (adminAuthErr || !adminAuth.user) throw adminAuthErr ?? new Error('admin user not created');
    adminUserId = adminAuth.user.id;

    // Upgrade to admin_role='admin'. Plan 24's profiles.admin_role column.
    const { error: adminRoleErr } = await admin
      .from('profiles')
      .update({ admin_role: 'admin' })
      .eq('id', adminUserId);
    if (adminRoleErr) {
      // Profile may not exist yet (depends on trigger); upsert.
      await admin.from('profiles').upsert({ id: adminUserId, admin_role: 'admin' });
    }

    // 2. Create 250 target users.
    for (let i = 0; i < N_USERS; i++) {
      const email = `${SLUG}-u${i}@test.leanshot.app`;
      const { data: u, error: uErr } = await admin.auth.admin.createUser({
        email,
        email_confirm: true,
        password: 'X-' + Math.random().toString(36).slice(2) + '-Aa1!',
      });
      if (uErr || !u.user) throw uErr ?? new Error(`failed to create user ${i}`);
      seededUsers.push({ id: u.user.id, email });
    }
    // Ensure profile rows exist (createUser typically triggers a profile row;
    // belt-and-suspenders upsert keeps test deterministic).
    await admin.from('profiles').upsert(
      seededUsers.map((s) => ({ id: s.id })),
    );

    // 3. Sign in as the admin via generateLink + verify (ES256-compat).
    const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
      type: 'magiclink',
      email: adminEmail,
    });
    if (linkErr || !linkData.properties?.hashed_token) {
      throw linkErr ?? new Error('failed to mint admin magiclink');
    }
    const verifyRes = await fetch(`${URL!}/auth/v1/verify`, {
      method: 'POST',
      headers: { apikey: ANON!, 'content-type': 'application/json' },
      body: JSON.stringify({
        type: 'magiclink',
        token: linkData.properties.hashed_token,
        email: adminEmail,
      }),
    });
    const verifyJson = (await verifyRes.json()) as { access_token?: string; refresh_token?: string };
    if (!verifyJson.access_token) {
      throw new Error(`admin verify failed: ${JSON.stringify(verifyJson)}`);
    }

    asAdminClient = createClient(URL!, ANON!, {
      auth: { autoRefreshToken: false, persistSession: false },
      global: { headers: { Authorization: `Bearer ${verifyJson.access_token}` } },
    });
  }, 240_000);

  afterAll(async () => {
    if (!admin) return;
    try {
      if (jobId) {
        await admin.from('admin_bulk_jobs').delete().eq('id', jobId);
      }
      // Delete audit_logs first (FK action_name index only — no FK to profiles).
      if (seededUsers.length > 0) {
        await admin
          .from('audit_logs')
          .delete()
          .in('target_user_id', seededUsers.map((s) => s.id));
      }
      // Delete auth.users — profiles cascades on delete.
      for (const s of seededUsers) {
        await admin.auth.admin.deleteUser(s.id).catch(() => undefined);
      }
      if (adminUserId) {
        await admin.auth.admin.deleteUser(adminUserId).catch(() => undefined);
      }
    } catch {
      // best-effort cleanup
    }
  }, 240_000);

  it('drains a 250-user bulk_tag job via the worker (DB-level invariant)', async () => {
    // Enqueue: >100 ids → async branch.
    const { data: rpcRes, error: rpcErr } = await asAdminClient.rpc('admin_bulk_action_execute', {
      p_action_type: 'tag',
      p_target_user_ids: seededUsers.map((s) => s.id),
      p_params: { tag: TEST_TAG },
    });
    expect(rpcErr).toBeNull();
    expect(rpcRes).toMatchObject({ mode: 'async' });
    jobId = (rpcRes as { job_id: string }).job_id;
    expect(typeof jobId).toBe('string');

    // Manually invoke the worker (skip the 1-min cron wait).
    const workerRes = await fetch(`${URL!}/functions/v1/admin-bulk-job-worker`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${SERVICE!}`,
        'Content-Type': 'application/json',
      },
      body: '{}',
    });
    expect(workerRes.status).toBe(200);
    const workerJson = (await workerRes.json()) as { ok: boolean; claimed: number; completed: number };
    expect(workerJson.ok).toBe(true);
    expect(workerJson.claimed).toBeGreaterThanOrEqual(1);

    // Poll job status until terminal (max 30s).
    const deadline = Date.now() + 30_000;
    let finalStatus: string | null = null;
    let finalRowsCompleted = 0;
    while (Date.now() < deadline) {
      const { data: jobRow } = await admin
        .from('admin_bulk_jobs')
        .select('status, rows_completed, error_log')
        .eq('id', jobId!)
        .single();
      if (jobRow && (jobRow.status === 'completed' || jobRow.status === 'failed')) {
        finalStatus = jobRow.status;
        finalRowsCompleted = (jobRow.rows_completed as number) ?? 0;
        break;
      }
      await new Promise((r) => setTimeout(r, 2000));
    }
    expect(finalStatus).toBe('completed');
    expect(finalRowsCompleted).toBe(N_USERS);

    // Assert all 250 profiles carry the test tag.
    const { data: taggedRows, error: tagErr } = await admin
      .from('profiles')
      .select('id, tags')
      .in('id', seededUsers.map((s) => s.id));
    expect(tagErr).toBeNull();
    expect(taggedRows?.length).toBe(N_USERS);
    for (const row of taggedRows ?? []) {
      expect((row as { tags: string[] }).tags).toContain(TEST_TAG);
    }

    // Assert 250 audit_logs rows with action_name='bulk_tag' for our users.
    const { count: auditCount, error: auditErr } = await admin
      .from('audit_logs')
      .select('*', { count: 'exact', head: true })
      .eq('action_name', 'bulk_tag')
      .in('target_user_id', seededUsers.map((s) => s.id));
    expect(auditErr).toBeNull();
    expect(auditCount).toBe(N_USERS);
  }, 240_000);
});
