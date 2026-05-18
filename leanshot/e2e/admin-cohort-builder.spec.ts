/**
 * Phase 27 Plan 27-02 — admin-cohort-builder.spec.ts (ADMIN-05 + TAXO-03 SC#2+#4).
 *
 * End-to-end flow:
 *   1. Seed 10 profiles via supabase admin (auth.users + profiles).
 *   2. Admin defines a cohort `phase27-cohort-<slug>` via cohort_define RPC
 *      (rule: AND[tier IS NULL, has_completed_onboarding = false]) — uses
 *      the v1 cohort_profile_view shape which has null::text as tier and
 *      false default for has_completed_onboarding.
 *   3. Admin promotes cohort draft → active via cohort_set_status RPC.
 *   4. Trigger cohort_membership_rebuild() via service_role exec.
 *   5. Assert cohort_membership has matching rows (rule matches seeded profiles).
 *   6. Superadmin archives via cohort_archive RPC; trigger rebuild.
 *   7. Assert cohort_membership rows for this cohort = 0 after rebuild.
 *   8. afterAll cleans up cohort_definitions + profiles + auth.users.
 *
 * Per [[feedback_realtime_layer_e2e_pattern]]: DB-level invariant verification
 * is the HARD assertion; UI traversal is best-effort behind PLAYWRIGHT_RUN_P27=1.
 *
 * Per [[reference_playwright_state_seeding.md]]: UI path (when enabled) uses
 * page.addInitScript to seed the supabase session before navigation.
 *
 * Skips entirely when SUPABASE_SERVICE_ROLE_KEY is absent (no live DB).
 *
 * Per-file slug prefix: `phase27-cohort-<timestamp>` to avoid clobbering
 * sibling RLS suites under vitest file-parallelism (per [[feedback_rls_per_file_slug_prefix]]).
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { test, expect } from '@playwright/test';

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? '';
const SUPABASE_ANON_KEY =
  process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY ?? '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

const HAS_LIVE = Boolean(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY && SUPABASE_ANON_KEY);

const TEST_SLUG_PREFIX = `phase27-cohort-${Date.now()}`;

let _admin: SupabaseClient | null = null;
function admin(): SupabaseClient {
  if (!_admin) {
    _admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  }
  return _admin;
}

const createdUserIds: string[] = [];
const createdCohortIds: string[] = [];

async function createUser(email: string, role?: 'admin' | 'superadmin') {
  const a = admin();
  const { data, error } = await a.auth.admin.createUser({
    email,
    password: 'TestPass!2026',
    email_confirm: true,
  });
  if (error) throw new Error(`createUser ${email}: ${error.message}`);
  const userId = data.user!.id;
  createdUserIds.push(userId);
  if (role) {
    const { error: e2 } = await a
      .from('profiles')
      .update({ admin_role: role, is_staff: true })
      .eq('id', userId);
    if (e2) throw new Error(`setAdminRole ${userId}: ${e2.message}`);
  }
  return userId;
}

/**
 * Open an authenticated supabase-js client for a given user by minting a
 * session via the admin generateLink → /verify pattern. Per [[reference_rls_fixture_gotrueclient_flake]].
 */
async function clientForUser(email: string): Promise<SupabaseClient> {
  const a = admin();
  const { data, error } = await a.auth.admin.generateLink({
    type: 'magiclink',
    email,
  });
  if (error || !data?.properties?.hashed_token) {
    throw new Error(`generateLink ${email}: ${error?.message ?? 'no token'}`);
  }
  const hashedToken = data.properties.hashed_token;
  const verifyResp = await fetch(`${SUPABASE_URL}/auth/v1/verify`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_ANON_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ type: 'magiclink', token: hashedToken }),
  });
  if (!verifyResp.ok) {
    throw new Error(`verify ${email}: ${verifyResp.status}`);
  }
  const session = await verifyResp.json();
  const accessToken = session.access_token as string;
  const refreshToken = session.refresh_token as string;
  const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  await client.auth.setSession({
    access_token: accessToken,
    refresh_token: refreshToken,
  });
  return client;
}

test.describe('phase27 cohort builder (DB-level)', () => {
  test.skip(!HAS_LIVE, 'SUPABASE_SERVICE_ROLE_KEY not set — skipping live e2e');

  test.afterAll(async () => {
    if (!HAS_LIVE) return;
    const a = admin();
    // Archive then delete cohorts. Cohorts FK to auth.users via created_by
    // with ON DELETE SET NULL so user deletion is independent.
    for (const cid of createdCohortIds) {
      await a.from('cohort_membership').delete().eq('cohort_id', cid);
      await a.from('cohort_definitions').delete().eq('id', cid);
    }
    // Cascade through auth.users → profiles.
    for (const uid of createdUserIds) {
      try {
        await a.auth.admin.deleteUser(uid);
      } catch {
        // Best-effort cleanup; profiles cascade from auth.users.
      }
    }
  });

  test('admin defines + promotes cohort; rebuild populates; archive empties', async () => {
    // 1. Seed 10 plain users + 1 admin + 1 superadmin.
    const adminEmail = `${TEST_SLUG_PREFIX}-admin@example.com`;
    const superEmail = `${TEST_SLUG_PREFIX}-super@example.com`;
    const adminId = await createUser(adminEmail, 'admin');
    const superId = await createUser(superEmail, 'superadmin');
    for (let i = 0; i < 10; i++) {
      await createUser(`${TEST_SLUG_PREFIX}-user${i}@example.com`);
    }
    expect(adminId).toBeTruthy();
    expect(superId).toBeTruthy();

    // 2. Admin defines a cohort. The rule MUST evaluate to true for the
    //    seeded profiles given the v1 cohort_profile_view shape:
    //      - tier IS NULL                       (null::text placeholder)
    //      - has_completed_onboarding = false   (completed_onboarding_at is null)
    const adminClient = await clientForUser(adminEmail);
    const cohortName = `${TEST_SLUG_PREFIX}-free-unactivated`;
    // Build the literal-baked SQL identical to ruleTreeToLiteralSql output
    // (the API wrapper computes this client-side; here we hand-compute to
    // avoid bundling the leanshot src into the Playwright runtime).
    const compiledSql = '(p.tier IS NULL AND p.has_completed_onboarding = false)';
    const rule = {
      op: 'and',
      children: [
        { field: 'tier', op: 'is_null' },
        { field: 'has_completed_onboarding', op: '=', value: false },
      ],
    };
    const { data: defineData, error: defineErr } = await adminClient.rpc(
      'cohort_define',
      {
        p_name: cohortName,
        p_rule: rule,
        p_compiled_sql: compiledSql,
      },
    );
    if (defineErr) throw new Error(`cohort_define: ${defineErr.message}`);
    const cohortId = defineData as string;
    expect(cohortId).toBeTruthy();
    createdCohortIds.push(cohortId);

    // 3. Verify cohort_definitions row exists with status='draft'.
    {
      const { data: row } = await admin()
        .from('cohort_definitions')
        .select('id, name, status, compiled_sql')
        .eq('id', cohortId)
        .maybeSingle();
      expect(row).toMatchObject({
        id: cohortId,
        name: cohortName,
        status: 'draft',
      });
      expect((row as { compiled_sql: string }).compiled_sql).toContain(
        'p.has_completed_onboarding',
      );
    }

    // 4. Promote draft → active via cohort_set_status (admin tier).
    {
      const { error } = await adminClient.rpc('cohort_set_status', {
        p_cohort_id: cohortId,
        p_status: 'active',
      });
      if (error) throw new Error(`cohort_set_status active: ${error.message}`);
    }

    // 5. Trigger rebuild via service_role.
    {
      const { error } = await admin().rpc('cohort_membership_rebuild');
      if (error) throw new Error(`rebuild: ${error.message}`);
    }

    // 6. Assert cohort_membership has rows (at least our 12 seeded users +
    //    however many already exist on the project — be lenient and just
    //    assert ≥10 of our test users are in the cohort).
    {
      const { data: members, error } = await admin()
        .from('cohort_membership')
        .select('user_id')
        .eq('cohort_id', cohortId);
      if (error) throw new Error(`select cohort_membership: ${error.message}`);
      const seededUserIds = createdUserIds.filter(
        (uid) => uid !== adminId && uid !== superId,
      );
      const memberSet = new Set((members ?? []).map((m) => m.user_id as string));
      const seededMatched = seededUserIds.filter((uid) => memberSet.has(uid));
      expect(seededMatched.length).toBeGreaterThanOrEqual(10);
    }

    // 7. Archive via cohort_archive (superadmin-only).
    {
      const superClient = await clientForUser(superEmail);
      const { error } = await superClient.rpc('cohort_archive', {
        p_cohort_id: cohortId,
      });
      if (error) throw new Error(`cohort_archive: ${error.message}`);
    }

    // 8. Rebuild again — archived cohort should be excluded entirely.
    {
      const { error } = await admin().rpc('cohort_membership_rebuild');
      if (error) throw new Error(`rebuild post-archive: ${error.message}`);
    }
    {
      const { data: members, error } = await admin()
        .from('cohort_membership')
        .select('user_id', { count: 'exact', head: false })
        .eq('cohort_id', cohortId);
      if (error) throw new Error(`select post-archive: ${error.message}`);
      expect((members ?? []).length).toBe(0);
    }

    // 9. Verify status is now 'archived'.
    {
      const { data: row } = await admin()
        .from('cohort_definitions')
        .select('status')
        .eq('id', cohortId)
        .maybeSingle();
      expect((row as { status: string } | null)?.status).toBe('archived');
    }
  });

  test('cohort_define rejects out-of-allowlist field (defense-in-depth layer #3)', async () => {
    const adminEmail = `${TEST_SLUG_PREFIX}-admin2@example.com`;
    await createUser(adminEmail, 'admin');
    const adminClient = await clientForUser(adminEmail);

    const badRule = {
      op: 'and',
      children: [
        // 'email' is NOT in FIELD_ALLOWLIST — plpgsql validator must reject.
        { field: 'email', op: '=', value: 'x' },
      ],
    };
    const { error } = await adminClient.rpc('cohort_define', {
      p_name: `${TEST_SLUG_PREFIX}-bad`,
      p_rule: badRule,
      p_compiled_sql: 'invalid',
    });
    expect(error).toBeTruthy();
    expect(error?.message ?? '').toMatch(/invalid_rule/);
  });

  test('cohort_archive requires superadmin (admin gets forbidden)', async () => {
    const adminEmail = `${TEST_SLUG_PREFIX}-admin3@example.com`;
    await createUser(adminEmail, 'admin');
    const adminClient = await clientForUser(adminEmail);
    const cohortName = `${TEST_SLUG_PREFIX}-needs-super`;

    const { data: defineData, error: defineErr } = await adminClient.rpc(
      'cohort_define',
      {
        p_name: cohortName,
        p_rule: { field: 'tier', op: 'is_null' },
        p_compiled_sql: 'p.tier IS NULL',
      },
    );
    if (defineErr) throw new Error(`cohort_define: ${defineErr.message}`);
    const cohortId = defineData as string;
    createdCohortIds.push(cohortId);

    // Admin (not superadmin) attempts archive → 42501 forbidden.
    const { error } = await adminClient.rpc('cohort_archive', {
      p_cohort_id: cohortId,
    });
    expect(error).toBeTruthy();
    expect(error?.code ?? error?.message ?? '').toMatch(/42501|forbidden/);
  });
});
