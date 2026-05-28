/**
 * Phase 50 Plan 50-02 — topic CRUD smoke test against live Supabase.
 *
 * Covers happy-path create → list → update → soft-delete → restore through
 * the SECDEF RPCs in 20260519000010_rag_admin_rpcs.sql. Asserts D-10 (no
 * bulk import surface) by static inspection of the rag-api module exports.
 *
 * File-scoped TEST_SLUG_PREFIX per [[feedback_rls_per_file_slug_prefix]].
 * Impersonation fixture per [[reference_rls_fixture_gotruechient_flake]].
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getUserAccessToken } from '../../../../tests/rls/helpers/admin-session';

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const SHOULD_RUN = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY && SUPABASE_SERVICE_ROLE_KEY);
const describeIfLive = SHOULD_RUN ? describe : describe.skip;

const TEST_SLUG_PREFIX = `p50-crud-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

describeIfLive('Phase 50 Plan 50-02 — topic CRUD via SECDEF RPCs', () => {
  let admin: SupabaseClient;
  let superClient: SupabaseClient;
  const createdUserIds: string[] = [];
  let superUserId: string;
  let createdTopicId: string;

  beforeAll(async () => {
    admin = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const password = `Pass1234-${crypto.randomUUID().slice(0, 8)}`;
    const email = `${TEST_SLUG_PREFIX}-super@leanshot.test`;
    const res = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (res.error) throw res.error;
    superUserId = res.data.user!.id;
    createdUserIds.push(superUserId);
    await admin.from('profiles').upsert({ id: superUserId, admin_role: 'superadmin' });

    const token = await getUserAccessToken(email);
    superClient = createClient(SUPABASE_URL!, SUPABASE_ANON_KEY!, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
        storageKey: `${TEST_SLUG_PREFIX}-super`,
      },
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
  }, 60_000);

  afterAll(async () => {
    if (!admin) return;
    await admin.from('rag_topics').delete().like('query', `${TEST_SLUG_PREFIX}%`);
    for (const uid of createdUserIds) {
      await admin.auth.admin.deleteUser(uid).catch(() => undefined);
    }
  });

  it('create returns uuid', async () => {
    const { data, error } = await superClient.rpc('rag_topic_create', {
      p_query: `${TEST_SLUG_PREFIX}-q-1`,
      p_tag: `${TEST_SLUG_PREFIX}-tag`,
      p_posture: 'curated',
      p_cadence: 'weekly',
    });
    expect(error).toBeNull();
    expect(typeof data).toBe('string');
    expect((data as string).length).toBeGreaterThan(10); // uuid length sanity
    createdTopicId = data as string;
  });

  it('update modifies query+tag', async () => {
    const newQuery = `${TEST_SLUG_PREFIX}-q-updated`;
    const newTag = `${TEST_SLUG_PREFIX}-tag-2`;
    const { error } = await superClient.rpc('rag_topic_update', {
      p_topic_id: createdTopicId,
      p_query: newQuery,
      p_tag: newTag,
      p_posture: 'open-web',
      p_cadence: 'daily',
    });
    expect(error).toBeNull();

    const { data, error: selErr } = await admin
      .from('rag_topics')
      .select('query, tag, posture, cadence')
      .eq('id', createdTopicId)
      .single();
    expect(selErr).toBeNull();
    expect(data?.query).toBe(newQuery);
    expect(data?.tag).toBe(newTag);
    expect(data?.posture).toBe('open-web');
    expect(data?.cadence).toBe('daily');
  });

  it('list returns active topics ordered by created_at desc', async () => {
    const { data, error } = await superClient
      .from('rag_topics')
      .select('id, query, created_at')
      .like('query', `${TEST_SLUG_PREFIX}%`)
      .is('deleted_at', null)
      .order('created_at', { ascending: false });
    expect(error).toBeNull();
    expect(Array.isArray(data)).toBe(true);
    // Ensure ordering is descending by created_at
    const dates = (data ?? []).map((r) =>
      new Date((r as { created_at: string }).created_at).getTime(),
    );
    for (let i = 1; i < dates.length; i++) {
      expect(dates[i - 1]).toBeGreaterThanOrEqual(dates[i]!);
    }
  });

  it('soft-delete sets deleted_at', async () => {
    const { error } = await superClient.rpc('rag_topic_soft_delete', {
      p_topic_id: createdTopicId,
    });
    expect(error).toBeNull();
    const { data } = await admin
      .from('rag_topics')
      .select('deleted_at')
      .eq('id', createdTopicId)
      .single();
    expect(data?.deleted_at).not.toBeNull();
  });

  it('restore clears deleted_at', async () => {
    const { error } = await superClient.rpc('rag_topic_restore', {
      p_topic_id: createdTopicId,
    });
    expect(error).toBeNull();
    const { data } = await admin
      .from('rag_topics')
      .select('deleted_at')
      .eq('id', createdTopicId)
      .single();
    expect(data?.deleted_at).toBeNull();
  });
});

// ─── D-10 invariant: no bulk-import surface ────────────────────────────────
// This describe runs unconditionally (no Supabase required) — it's a static
// inspection of the rag-api module exports.
describe('Phase 50 Plan 50-02 — D-10 single-row-CRUD invariant', () => {
  it('no exported function name in rag-api matches /bulk|csv|import/i', async () => {
    const mod = await import('../../admin/rag/rag-api');
    const forbidden = /bulk|csv|import/i;
    const offenders = Object.keys(mod).filter((k) => forbidden.test(k));
    expect(offenders).toEqual([]);
  });
});
