/**
 * Phase 50 Plan 50-02 — rag_topic_audit trigger coverage (D-14).
 *
 * The rag_topic_audit trigger fires AFTER INSERT/UPDATE/DELETE on rag_topics
 * and classifies the action as create / update / delete (soft) / restore by
 * inspecting old vs new deleted_at. This test covers all four classifications.
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

const TEST_SLUG_PREFIX = `p50-audit-${Date.now().toString(36)}-${Math.random()
  .toString(36)
  .slice(2, 6)}`;

describeIfLive('Phase 50 Plan 50-02 — rag_topic_audit trigger', () => {
  let admin: SupabaseClient;
  let superClient: SupabaseClient;
  const createdUserIds: string[] = [];
  let topicId: string;

  beforeAll(async () => {
    admin = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const password = `Pass1234-${crypto.randomUUID().slice(0, 8)}`;
    const email = `${TEST_SLUG_PREFIX}-super@leanshot.test`;
    const res = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (res.error) throw res.error;
    createdUserIds.push(res.data.user!.id);
    await admin.from('profiles').upsert({ id: res.data.user!.id, admin_role: 'superadmin' });
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

  it('rag_topic_audit row written on create', async () => {
    const { data, error } = await superClient.rpc('rag_topic_create', {
      p_query: `${TEST_SLUG_PREFIX}-audit-create`,
      p_tag: 'audit-tag',
      p_posture: 'curated',
      p_cadence: 'weekly',
    });
    expect(error).toBeNull();
    topicId = data as string;
    const { data: audit, error: audErr } = await admin
      .from('rag_topic_audit')
      .select('action, after_data')
      .eq('topic_id', topicId)
      .eq('action', 'create');
    expect(audErr).toBeNull();
    expect((audit ?? []).length).toBeGreaterThanOrEqual(1);
    expect(audit?.[0]?.after_data).toBeTruthy();
  });

  it('rag_topic_audit captures before+after on update', async () => {
    const { error } = await superClient.rpc('rag_topic_update', {
      p_topic_id: topicId,
      p_query: `${TEST_SLUG_PREFIX}-audit-updated`,
      p_tag: 'audit-tag-2',
      p_posture: 'open-web',
      p_cadence: 'daily',
    });
    expect(error).toBeNull();
    const { data: audit } = await admin
      .from('rag_topic_audit')
      .select('action, before_data, after_data')
      .eq('topic_id', topicId)
      .eq('action', 'update')
      .order('created_at', { ascending: false })
      .limit(1);
    expect((audit ?? []).length).toBe(1);
    const row = audit![0]!;
    expect(row.before_data).toBeTruthy();
    expect(row.after_data).toBeTruthy();
  });

  it('rag_topic_audit row written on soft-delete with action=delete', async () => {
    const { error } = await superClient.rpc('rag_topic_soft_delete', { p_topic_id: topicId });
    expect(error).toBeNull();
    const { data: audit } = await admin
      .from('rag_topic_audit')
      .select('action')
      .eq('topic_id', topicId)
      .eq('action', 'delete');
    expect((audit ?? []).length).toBeGreaterThanOrEqual(1);
  });

  it('rag_topic_audit row written on restore with action=restore', async () => {
    const { error } = await superClient.rpc('rag_topic_restore', { p_topic_id: topicId });
    expect(error).toBeNull();
    const { data: audit } = await admin
      .from('rag_topic_audit')
      .select('action')
      .eq('topic_id', topicId)
      .eq('action', 'restore');
    expect((audit ?? []).length).toBeGreaterThanOrEqual(1);
  });
});
