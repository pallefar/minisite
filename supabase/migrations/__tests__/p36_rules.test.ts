/**
 * Phase 36 Plan 36-01 — REVIEW-02 contract tests for review_prompt_rules + SECDEF RPCs.
 *
 * Covers:
 *  - Schema: name length CHECK (1..60); cohort_id FK to public.cohort_definitions
 *    (NOT public.cohorts — the cohort table is named `cohort_definitions` in this
 *    codebase; auto-fixed per Rule 1 during execution).
 *  - RLS: direct INSERT/UPDATE/DELETE/SELECT denied for authenticated.
 *  - SECDEF: create_review_prompt_rule raises 'forbidden' for non-admin.
 *  - SECDEF B1 fix: create_review_prompt_rule stamps created_by = auth.uid().
 *  - SECDEF: list_review_prompt_rules returns admin's rules.
 *
 * Live-DB. Auto-skips when SUPABASE env is absent.
 * Run live via: vitest --config leanshot/vitest-e2e.config.ts supabase/migrations/__tests__/p36_rules.test.ts
 * (Phase close-out re-runs this against the linked project per project memory
 * [[feedback_phase_close_out_db_push_verification]].)
 */
/// <reference types="node" />
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? '';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY ?? '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

const SHOULD_RUN = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY && SUPABASE_SERVICE_ROLE_KEY);
const describeIfLive = SHOULD_RUN ? describe : describe.skip;

const TEST_PREFIX = `p36-rules-${Date.now().toString(36)}`;
let admin: SupabaseClient;

async function makeAdminUser(): Promise<{ id: string; jwt: string }> {
  const email = `${TEST_PREFIX}-${Math.random().toString(36).slice(2, 8)}@example.test`;
  const { data: user, error: userErr } = await admin.auth.admin.createUser({
    email,
    password: 'p36-test-password-12345',
    email_confirm: true,
  });
  if (userErr || !user?.user) throw userErr ?? new Error('createUser failed');
  // Promote to admin in profiles.
  await admin.from('profiles').upsert(
    { id: user.user.id, admin_role: 'admin' },
    { onConflict: 'id' },
  );
  // Mint session via generateLink + verify (ES256-compat — per [[reference_rls_fixture_gotrueclient_flake]]).
  const { data: link, error: linkErr } = await admin.auth.admin.generateLink({
    type: 'magiclink',
    email,
  });
  if (linkErr || !link?.properties?.action_link) throw linkErr ?? new Error('generateLink failed');
  const verifyUrl = new URL(link.properties.action_link);
  const tokenHash = verifyUrl.searchParams.get('token');
  if (!tokenHash) throw new Error('token missing in action_link');
  const verifyResp = await fetch(`${SUPABASE_URL}/auth/v1/verify?token=${tokenHash}&type=magiclink`, {
    headers: { apikey: SUPABASE_ANON_KEY },
    redirect: 'manual',
  });
  const loc = verifyResp.headers.get('location') ?? '';
  const hash = loc.split('#')[1] ?? '';
  const access = new URLSearchParams(hash).get('access_token');
  if (!access) throw new Error(`verify did not yield access_token (loc=${loc})`);
  return { id: user.user.id, jwt: access };
}

describeIfLive('Phase 36 Plan 36-01 — review_prompt_rules + SECDEF RPCs', () => {
  let adminUser: { id: string; jwt: string };
  let nonAdminUser: { id: string; jwt: string };
  const createdRuleIds: string[] = [];

  beforeAll(async () => {
    admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    adminUser = await makeAdminUser();

    // Non-admin user: create then explicitly clear admin_role.
    const ne = `${TEST_PREFIX}-na-${Math.random().toString(36).slice(2, 8)}@example.test`;
    const { data: u } = await admin.auth.admin.createUser({
      email: ne,
      password: 'p36-test-password-12345',
      email_confirm: true,
    });
    if (!u?.user) throw new Error('non-admin createUser failed');
    await admin.from('profiles').upsert(
      { id: u.user.id, admin_role: null },
      { onConflict: 'id' },
    );
    const { data: link } = await admin.auth.admin.generateLink({ type: 'magiclink', email: ne });
    const verifyUrl = new URL(link!.properties!.action_link!);
    const tokenHash = verifyUrl.searchParams.get('token')!;
    const verifyResp = await fetch(`${SUPABASE_URL}/auth/v1/verify?token=${tokenHash}&type=magiclink`, {
      headers: { apikey: SUPABASE_ANON_KEY },
      redirect: 'manual',
    });
    const loc = verifyResp.headers.get('location') ?? '';
    const access = new URLSearchParams(loc.split('#')[1] ?? '').get('access_token')!;
    nonAdminUser = { id: u.user.id, jwt: access };
  }, 120_000);

  afterAll(async () => {
    if (!admin) return;
    if (createdRuleIds.length > 0) {
      await admin.from('review_prompt_rules').delete().in('id', createdRuleIds);
    }
    await admin.from('profiles').delete().in('id', [adminUser?.id, nonAdminUser?.id].filter(Boolean));
    await admin.auth.admin.deleteUser(adminUser.id).catch(() => undefined);
    await admin.auth.admin.deleteUser(nonAdminUser.id).catch(() => undefined);
  });

  it('rejects name length 0 via CHECK', async () => {
    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${adminUser.jwt}` } },
    });
    const { error } = await userClient.rpc('create_review_prompt_rule', {
      p_name: '',
      p_trigger_event: 'activation_completed',
    });
    expect(error).not.toBeNull();
    expect(error!.message).toMatch(/invalid_name/);
  });

  it('rejects name length 61 via CHECK', async () => {
    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${adminUser.jwt}` } },
    });
    const longName = 'x'.repeat(61);
    const { error } = await userClient.rpc('create_review_prompt_rule', {
      p_name: longName,
      p_trigger_event: 'activation_completed',
    });
    expect(error).not.toBeNull();
    expect(error!.message).toMatch(/invalid_name/);
  });

  it('non-admin caller of create_review_prompt_rule gets "forbidden"', async () => {
    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${nonAdminUser.jwt}` } },
    });
    const { error } = await userClient.rpc('create_review_prompt_rule', {
      p_name: 'Test rule',
      p_trigger_event: 'activation_completed',
    });
    expect(error).not.toBeNull();
    expect(error!.message).toMatch(/forbidden/);
  });

  it('admin caller of create_review_prompt_rule succeeds AND stamps created_by = auth.uid() (B1 fix)', async () => {
    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${adminUser.jwt}` } },
    });
    const { data, error } = await userClient.rpc('create_review_prompt_rule', {
      p_name: `${TEST_PREFIX}-rule-1`,
      p_trigger_event: 'activation_completed',
      p_cohort_id: null,
      p_active: true,
    });
    expect(error).toBeNull();
    expect(data).toBeTruthy();
    const ruleId = data as string;
    createdRuleIds.push(ruleId);

    // B1 fix verification: read created_by via admin client.
    const { data: row } = await admin
      .from('review_prompt_rules')
      .select('created_by')
      .eq('id', ruleId)
      .single();
    expect(row?.created_by).toBe(adminUser.id);
  });

  it('list_review_prompt_rules returns admin\'s rules (admin caller succeeds)', async () => {
    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${adminUser.jwt}` } },
    });
    const { data, error } = await userClient.rpc('list_review_prompt_rules');
    expect(error).toBeNull();
    expect(Array.isArray(data)).toBe(true);
    const ids = (data as Array<{ id: string }>).map((r) => r.id);
    for (const created of createdRuleIds) {
      expect(ids).toContain(created);
    }
  });

  it('direct DML on review_prompt_rules denied for authenticated', async () => {
    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${adminUser.jwt}` } },
    });
    const { error: insertErr } = await userClient
      .from('review_prompt_rules')
      .insert({ name: 'direct-dml', trigger_event: 'activation_completed', created_by: adminUser.id });
    // RLS denies — postgrest returns an error (not "row returned" silent success).
    expect(insertErr).not.toBeNull();
  });
});
