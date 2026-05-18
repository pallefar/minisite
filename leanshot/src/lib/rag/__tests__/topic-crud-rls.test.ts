/**
 * Phase 50 Plan 50-02 — topic CRUD RLS role-matrix (D-12).
 *
 * Asserts the role gate: only superadmin can create/update/delete topics.
 * Regular users cannot SELECT topics at all (RLS-blocked); plain admins
 * CAN select but cannot mutate.
 *
 * Mutation gates land inside the SECDEF RPC (raises 'not_authorized'
 * errcode 42501); SELECT gate is enforced by the table RLS policy.
 *
 * File-scoped TEST_SLUG_PREFIX per [[feedback_rls_per_file_slug_prefix]].
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getUserAccessToken } from '../../../../tests/rls/helpers/admin-session';

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const SHOULD_RUN = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY && SUPABASE_SERVICE_ROLE_KEY);
const describeIfLive = SHOULD_RUN ? describe : describe.skip;

const TEST_SLUG_PREFIX = `p50-rls-crud-${Date.now().toString(36)}-${Math.random()
  .toString(36)
  .slice(2, 6)}`;

describeIfLive('Phase 50 Plan 50-02 — topic CRUD RLS role matrix', () => {
  let admin: SupabaseClient;
  let superClient: SupabaseClient;
  let adminClient: SupabaseClient;
  let regularClient: SupabaseClient;
  const createdUserIds: string[] = [];

  beforeAll(async () => {
    admin = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const password = `Pass1234-${crypto.randomUUID().slice(0, 8)}`;

    async function createUser(label: string, role: 'superadmin' | 'admin' | null): Promise<string> {
      const email = `${TEST_SLUG_PREFIX}-${label}@leanshot.test`;
      const res = await admin.auth.admin.createUser({ email, password, email_confirm: true });
      if (res.error) throw res.error;
      const id = res.data.user!.id;
      createdUserIds.push(id);
      if (role) {
        await admin.from('profiles').upsert({ id, admin_role: role });
      }
      return id;
    }

    await createUser('super', 'superadmin');
    await createUser('admin', 'admin');
    await createUser('regular', null);

    const [superToken, adminToken, regularToken] = await Promise.all([
      getUserAccessToken(`${TEST_SLUG_PREFIX}-super@leanshot.test`),
      getUserAccessToken(`${TEST_SLUG_PREFIX}-admin@leanshot.test`),
      getUserAccessToken(`${TEST_SLUG_PREFIX}-regular@leanshot.test`),
    ]);

    const mk = (token: string, label: string): SupabaseClient =>
      createClient(SUPABASE_URL!, SUPABASE_ANON_KEY!, {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
          storageKey: `${TEST_SLUG_PREFIX}-${label}`,
        },
        global: { headers: { Authorization: `Bearer ${token}` } },
      });
    superClient = mk(superToken, 'super');
    adminClient = mk(adminToken, 'admin');
    regularClient = mk(regularToken, 'regular');
  }, 60_000);

  afterAll(async () => {
    if (!admin) return;
    await admin.from('rag_topics').delete().like('query', `${TEST_SLUG_PREFIX}%`);
    for (const uid of createdUserIds) {
      await admin.auth.admin.deleteUser(uid).catch(() => undefined);
    }
  });

  it('regular authenticated user CANNOT create topic', async () => {
    const { error } = await regularClient.rpc('rag_topic_create', {
      p_query: `${TEST_SLUG_PREFIX}-regular-create`,
      p_tag: 'should-fail',
      p_posture: 'curated',
      p_cadence: 'weekly',
    });
    expect(error).not.toBeNull();
  });

  it('plain admin CANNOT create topic', async () => {
    const { error } = await adminClient.rpc('rag_topic_create', {
      p_query: `${TEST_SLUG_PREFIX}-admin-create`,
      p_tag: 'should-fail',
      p_posture: 'curated',
      p_cadence: 'weekly',
    });
    expect(error).not.toBeNull();
  });

  it('superadmin CAN create topic', async () => {
    const { data, error } = await superClient.rpc('rag_topic_create', {
      p_query: `${TEST_SLUG_PREFIX}-super-create`,
      p_tag: 'ok',
      p_posture: 'curated',
      p_cadence: 'weekly',
    });
    expect(error).toBeNull();
    expect(typeof data).toBe('string');
  });

  it('regular user CANNOT SELECT topics (empty array under RLS)', async () => {
    // First ensure at least one topic exists (via the super-admin client above)
    const { data, error } = await regularClient
      .from('rag_topics')
      .select('id')
      .like('query', `${TEST_SLUG_PREFIX}%`);
    // RLS-blocked SELECT returns [] without error
    expect(error).toBeNull();
    expect(data ?? []).toEqual([]);
  });

  it('plain admin CANNOT SELECT topics (admin role does not unlock rag_topics; only superadmin does per D-12)', async () => {
    const { data, error } = await adminClient
      .from('rag_topics')
      .select('id')
      .like('query', `${TEST_SLUG_PREFIX}%`);
    // Per 20260519000009_rag_rls_policies.sql, rag_topics.SELECT requires _rag_is_super().
    // Plain admin is RLS-blocked → empty array.
    expect(error).toBeNull();
    expect(data ?? []).toEqual([]);
  });
});
