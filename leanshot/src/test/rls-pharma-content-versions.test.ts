/**
 * Phase 39 Plan 39-05 Task 2 — RLS cross-tenant + append-only proof for
 * pharma_content_versions (PHARMA-07).
 *
 * Audit-log invariant under test (T-39-05-04 mitigation):
 *   - SELECT: admin-only (pol_pharma_content_versions_admin_select gates
 *     on public.is_admin_at_least('admin')); non-admins see 0 rows.
 *   - INSERT/UPDATE/DELETE: NO POLICIES — denial-by-default. Writes flow
 *     ONLY through future SECDEF RPC (Plan 39-08). Admin browser sessions
 *     cannot UPDATE or DELETE; even admin INSERTs are denied without the
 *     SECDEF RPC. Service-role bypasses RLS and is the only path that can
 *     seed rows in this test until 39-08 ships.
 *
 * Why service-role seeds the row instead of the SECDEF RPC: Plan 39-08
 * (which exposes the RPC) has not yet shipped; we use service-role INSERT
 * here as a stand-in for the future RPC. The RLS invariant under test —
 * that authenticated UPDATE/DELETE always fail and non-admin authenticated
 * SELECT returns 0 rows — is independent of how rows arrive.
 *
 * Auth: admin.generateLink + /auth/v1/verify per [[reference_rls_fixture_gotrueclient_flake]].
 * Per-file slug per [[feedback_rls_per_file_slug_prefix]].
 *
 * Skipped unless SUPABASE_URL + SUPABASE_ANON_KEY + SUPABASE_SERVICE_ROLE_KEY env vars present.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getUserAccessToken } from '../../tests/rls/helpers/admin-session';

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const SHOULD_RUN = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY && SUPABASE_SERVICE_ROLE_KEY);
const describeIfLive = SHOULD_RUN ? describe : describe.skip;

const TEST_SLUG_PREFIX = `p39-rls-pcv-${Date.now().toString(36)}-${Math.random()
  .toString(36)
  .slice(2, 6)}`;

function getAdmin(): SupabaseClient {
  return createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

function buildUserClient(accessToken: string, storageKey: string): SupabaseClient {
  return createClient(SUPABASE_URL!, SUPABASE_ANON_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false, storageKey },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
}

describeIfLive(
  'Phase 39 Plan 39-05 — pharma_content_versions RLS (PHARMA-07 append-only + admin-only SELECT)',
  () => {
    const admin = SHOULD_RUN ? getAdmin() : null!;
    const createdUserIds: string[] = [];
    const createdContentIds: string[] = [];
    const createdVersionIds: string[] = [];

    let adminUserId: string;
    let adminClient: SupabaseClient;
    let regularClient: SupabaseClient;
    let seededContentId: string;
    let seededVersionId: string;

    beforeAll(async () => {
      if (!SHOULD_RUN) return;

      const password = `Pass1234-${crypto.randomUUID().slice(0, 8)}`;

      async function createUser(label: string): Promise<{ id: string; email: string }> {
        const email = `${TEST_SLUG_PREFIX}-${label}@leanshot.test`;
        const res = await admin.auth.admin.createUser({ email, password, email_confirm: true });
        if (res.error) throw res.error;
        const id = res.data.user!.id;
        createdUserIds.push(id);
        return { id, email };
      }

      const adminUser = await createUser('admin');
      const regularUser = await createUser('regular');
      adminUserId = adminUser.id;

      // Promote admin user to admin_role='admin' (so is_admin_at_least('admin') returns true).
      // Profile row is created by an auth trigger; upsert defensively per the project pattern.
      const { error: roleErr } = await admin
        .from('profiles')
        .update({ admin_role: 'admin' })
        .eq('id', adminUserId);
      if (roleErr) {
        await admin.from('profiles').upsert({ id: adminUserId, admin_role: 'admin' });
      }

      // Seed a pharma_content row that the versions row can FK to.
      const contentSlug = `${TEST_SLUG_PREFIX}-content`;
      const { data: contentRow, error: contentErr } = await admin
        .from('pharma_content')
        .insert({
          slug: contentSlug,
          summary: 'test summary',
          full_content: 'test full content',
          safety_category: null,
        })
        .select('id')
        .single();
      if (contentErr || !contentRow) {
        throw contentErr ?? new Error('failed to seed pharma_content');
      }
      seededContentId = contentRow.id as string;
      createdContentIds.push(seededContentId);

      // Seed one versions row via service-role (stand-in for the future Plan 39-08 SECDEF RPC).
      const { data: versionRow, error: versionErr } = await admin
        .from('pharma_content_versions')
        .insert({ content_id: seededContentId, diff: { initial: true }, author_id: adminUserId })
        .select('id')
        .single();
      if (versionErr || !versionRow) {
        throw versionErr ?? new Error('failed to seed pharma_content_versions');
      }
      seededVersionId = versionRow.id as string;
      createdVersionIds.push(seededVersionId);

      // Mint live user-context access tokens (ES256, real session).
      const adminToken = await getUserAccessToken(adminUser.email);
      const regularToken = await getUserAccessToken(regularUser.email);
      adminClient = buildUserClient(adminToken, `${TEST_SLUG_PREFIX}-admin`);
      regularClient = buildUserClient(regularToken, `${TEST_SLUG_PREFIX}-regular`);
    }, 60_000);

    afterAll(async () => {
      if (!SHOULD_RUN) return;
      for (const id of createdVersionIds) {
        await admin.from('pharma_content_versions').delete().eq('id', id);
      }
      for (const id of createdContentIds) {
        await admin.from('pharma_content').delete().eq('id', id);
      }
      for (const id of createdUserIds) {
        await admin.auth.admin.deleteUser(id).catch(() => undefined);
      }
    }, 60_000);

    it('(a) NON-ADMIN authenticated SELECT returns 0 rows (admin-only policy)', async () => {
      const { data, error } = await regularClient
        .from('pharma_content_versions')
        .select('id')
        .eq('id', seededVersionId);
      // PostgREST returns success with empty array under RLS-filtered SELECT, not an error.
      expect(error).toBeNull();
      expect(data).toEqual([]);
    });

    it('(b) ADMIN authenticated SELECT returns the seeded row', async () => {
      const { data, error } = await adminClient
        .from('pharma_content_versions')
        .select('id, content_id')
        .eq('id', seededVersionId);
      expect(error).toBeNull();
      expect(Array.isArray(data)).toBe(true);
      expect(data).not.toBeNull();
      expect(data!.length).toBeGreaterThanOrEqual(1);
      expect(data![0].id).toBe(seededVersionId);
      expect(data![0].content_id).toBe(seededContentId);
    });

    it('(c) ADMIN authenticated UPDATE is DENIED (no UPDATE policy → 0 rows affected)', async () => {
      // Under PostgREST RLS, an UPDATE with no matching policy returns success
      // but affects 0 rows. The data array is empty even though the row exists
      // (service-role can see it; admin browser cannot mutate it).
      const { data, error } = await adminClient
        .from('pharma_content_versions')
        .update({ diff: { tampered: true } })
        .eq('id', seededVersionId)
        .select('id');
      expect(error).toBeNull();
      expect(data).toEqual([]);

      // Service-role verifies the row was NOT mutated.
      const { data: serverRow, error: readErr } = await admin
        .from('pharma_content_versions')
        .select('diff')
        .eq('id', seededVersionId)
        .single();
      expect(readErr).toBeNull();
      expect(serverRow).toBeTruthy();
      // Original `diff` was {initial: true}; must still be unchanged.
      expect(serverRow!.diff).toEqual({ initial: true });
    });

    it('(d) ADMIN authenticated DELETE is DENIED (no DELETE policy → 0 rows affected, row persists)', async () => {
      const { data, error } = await adminClient
        .from('pharma_content_versions')
        .delete()
        .eq('id', seededVersionId)
        .select('id');
      expect(error).toBeNull();
      expect(data).toEqual([]);

      // Confirm via service-role that the row still exists.
      const { data: serverRow, error: readErr } = await admin
        .from('pharma_content_versions')
        .select('id')
        .eq('id', seededVersionId)
        .maybeSingle();
      expect(readErr).toBeNull();
      expect(serverRow).toBeTruthy();
      expect(serverRow!.id).toBe(seededVersionId);
    });

    it('(e) ADMIN authenticated INSERT is DENIED (no INSERT policy — append flows ONLY via SECDEF RPC Plan 39-08)', async () => {
      // Belt-and-suspenders: the denial-by-default also blocks admin-context INSERTs.
      // The future Plan 39-08 SECDEF RPC will bypass RLS to append rows; that surface
      // is the only legitimate write path. Direct admin-table writes must fail.
      const { error } = await adminClient
        .from('pharma_content_versions')
        .insert({ content_id: seededContentId, diff: { unauthorized: true } });
      expect(error).not.toBeNull();
    });

    it('(f) NON-ADMIN authenticated INSERT is DENIED (denial-by-default)', async () => {
      const { error } = await regularClient
        .from('pharma_content_versions')
        .insert({ content_id: seededContentId, diff: { rogue_edit: true } });
      expect(error).not.toBeNull();
    });
  },
);
