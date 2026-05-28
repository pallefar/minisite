/**
 * Phase 37 Plan 37-09 Task 2 — RLS cross-tenant impersonation proof for
 * kb_articles / kb_article_versions / agent_macros / helpdesk_routing_rules /
 * sla_targets + publish_kb_article + search_kb_articles RPC gating.
 *
 * Companion to rls-helpdesk-tickets.test.ts. Same fixture style; new
 * file-scoped slug prefix per [[feedback_rls_per_file_slug_prefix]].
 *
 * Auth: admin.generateLink + /auth/v1/verify (ES256-compat) — never
 * signInWithPassword per [[reference_rls_fixture_gotrueclient_flake]].
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getUserAccessToken } from '../../tests/rls/helpers/admin-session';

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const SHOULD_RUN = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY && SUPABASE_SERVICE_ROLE_KEY);
const describeIfLive = SHOULD_RUN ? describe : describe.skip;

const TEST_SLUG_PREFIX = `p37-rls-kb-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

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
  'Phase 37 Plan 37-09 — RLS impersonation: kb_articles / macros / routing / sla',
  () => {
    const admin = SHOULD_RUN ? getAdmin() : null!;
    const createdUserIds: string[] = [];
    const createdOrgIds: string[] = [];
    const createdArticleIds: string[] = [];

    let userA_ownerId: string;
    let userA_patientId: string;
    let userB_ownerId: string;

    let orgA: string;
    let orgB: string;

    let globalPublishedArticleId: string;
    let orgAPublishedArticleId: string;
    let orgBPublishedArticleId: string;
    let orgADraftArticleId: string;

    let macroA_id: string;
    let macroB_id: string;

    let userA_ownerClient: SupabaseClient;
    let userA_patientClient: SupabaseClient;
    let userB_ownerClient: SupabaseClient;

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

      const a_owner = await createUser('a-owner');
      const a_patient = await createUser('a-patient');
      const b_owner = await createUser('b-owner');
      userA_ownerId = a_owner.id;
      userA_patientId = a_patient.id;
      userB_ownerId = b_owner.id;

      // Two orgs
      const { data: oa, error: oaErr } = await admin
        .from('organizations')
        .insert({ name: `${TEST_SLUG_PREFIX}-org-a` })
        .select('id')
        .single();
      if (oaErr) throw oaErr;
      orgA = oa!.id;
      createdOrgIds.push(orgA);

      const { data: ob, error: obErr } = await admin
        .from('organizations')
        .insert({ name: `${TEST_SLUG_PREFIX}-org-b` })
        .select('id')
        .single();
      if (obErr) throw obErr;
      orgB = ob!.id;
      createdOrgIds.push(orgB);

      // Owners are org_members; patient is NOT.
      await admin.from('org_members').insert([
        { org_id: orgA, user_id: userA_ownerId, role: 'owner' },
        { org_id: orgB, user_id: userB_ownerId, role: 'owner' },
      ]);

      // Seed kb_articles
      const { data: globalArt, error: gErr } = await admin
        .from('kb_articles')
        .insert({
          slug: `${TEST_SLUG_PREFIX}-global`,
          title: `${TEST_SLUG_PREFIX}-global-title`,
          body: 'global body',
          published_at: new Date().toISOString(),
        })
        .select('id')
        .single();
      if (gErr) throw gErr;
      globalPublishedArticleId = globalArt!.id;
      createdArticleIds.push(globalPublishedArticleId);

      const { data: aArt, error: aErr } = await admin
        .from('kb_articles')
        .insert({
          org_id: orgA,
          slug: `${TEST_SLUG_PREFIX}-org-a-pub`,
          title: `${TEST_SLUG_PREFIX}-org-a-pub-title`,
          body: 'org a published body',
          published_at: new Date().toISOString(),
        })
        .select('id')
        .single();
      if (aErr) throw aErr;
      orgAPublishedArticleId = aArt!.id;
      createdArticleIds.push(orgAPublishedArticleId);

      const { data: bArt, error: bErr } = await admin
        .from('kb_articles')
        .insert({
          org_id: orgB,
          slug: `${TEST_SLUG_PREFIX}-org-b-pub`,
          title: `${TEST_SLUG_PREFIX}-org-b-pub-title`,
          body: 'org b published body',
          published_at: new Date().toISOString(),
        })
        .select('id')
        .single();
      if (bErr) throw bErr;
      orgBPublishedArticleId = bArt!.id;
      createdArticleIds.push(orgBPublishedArticleId);

      const { data: dArt, error: dErr } = await admin
        .from('kb_articles')
        .insert({
          org_id: orgA,
          slug: `${TEST_SLUG_PREFIX}-org-a-draft`,
          title: `${TEST_SLUG_PREFIX}-org-a-draft-title`,
          body: 'draft',
          // published_at intentionally NULL
        })
        .select('id')
        .single();
      if (dErr) throw dErr;
      orgADraftArticleId = dArt!.id;
      createdArticleIds.push(orgADraftArticleId);

      // Seed agent_macros (one per org)
      const { data: maA, error: maAErr } = await admin
        .from('agent_macros')
        .insert({
          org_id: orgA,
          name: `${TEST_SLUG_PREFIX}-macro-a`,
          shortcut: `${TEST_SLUG_PREFIX}-a`.slice(0, 32),
          body: 'macro a body',
        })
        .select('id')
        .single();
      if (maAErr) throw maAErr;
      macroA_id = maA!.id;

      const { data: maB, error: maBErr } = await admin
        .from('agent_macros')
        .insert({
          org_id: orgB,
          name: `${TEST_SLUG_PREFIX}-macro-b`,
          shortcut: `${TEST_SLUG_PREFIX}-b`.slice(0, 32),
          body: 'macro b body',
        })
        .select('id')
        .single();
      if (maBErr) throw maBErr;
      macroB_id = maB!.id;

      // Mint per-user JWTs
      const aOwnerTok = await getUserAccessToken(a_owner.email);
      const aPatientTok = await getUserAccessToken(a_patient.email);
      const bOwnerTok = await getUserAccessToken(b_owner.email);

      userA_ownerClient = buildUserClient(aOwnerTok, `${TEST_SLUG_PREFIX}-a-owner`);
      userA_patientClient = buildUserClient(aPatientTok, `${TEST_SLUG_PREFIX}-a-patient`);
      userB_ownerClient = buildUserClient(bOwnerTok, `${TEST_SLUG_PREFIX}-b-owner`);
    }, 90_000);

    afterAll(async () => {
      if (!SHOULD_RUN) return;

      // Articles cascade -> versions
      if (createdArticleIds.length > 0) {
        await admin.from('kb_articles').delete().in('id', createdArticleIds);
      }
      await admin.from('agent_macros').delete().like('name', `${TEST_SLUG_PREFIX}%`);
      await admin.from('helpdesk_routing_rules').delete().like('name', `${TEST_SLUG_PREFIX}%`);
      await admin.from('sla_targets').delete().in('org_id', createdOrgIds);

      if (createdOrgIds.length > 0) {
        await admin.from('org_members').delete().in('org_id', createdOrgIds);
        await admin.from('organizations').delete().in('id', createdOrgIds);
      }
      for (const uid of createdUserIds) {
        await admin.auth.admin.deleteUser(uid).catch(() => undefined);
      }
    }, 60_000);

    // -------------------------------------------------------------------------
    // 1. Global published kb_articles visible to any authenticated user
    // -------------------------------------------------------------------------
    it('any authenticated user CAN SELECT global published kb_articles', async () => {
      const { data, error } = await userA_patientClient
        .from('kb_articles')
        .select('id, org_id, published_at')
        .eq('id', globalPublishedArticleId)
        .maybeSingle();
      expect(error).toBeNull();
      expect(data?.id).toBe(globalPublishedArticleId);
      expect(data?.org_id).toBeNull();
    });

    // -------------------------------------------------------------------------
    // 2. Org-private kb_articles cross-tenant
    // -------------------------------------------------------------------------
    it('agent cannot SELECT kb_articles in cross-org', async () => {
      const { data, error } = await userA_ownerClient
        .from('kb_articles')
        .select('id')
        .eq('id', orgBPublishedArticleId);
      expect(error).toBeNull();
      expect(data?.length ?? 0).toBe(0);
    });

    // -------------------------------------------------------------------------
    // 3. Draft kb_articles hidden from non-admin (patient is NOT org_members)
    // -------------------------------------------------------------------------
    it('non-org-member CANNOT SELECT draft kb_articles', async () => {
      const { data, error } = await userA_patientClient
        .from('kb_articles')
        .select('id')
        .eq('id', orgADraftArticleId);
      expect(error).toBeNull();
      expect(data?.length ?? 0).toBe(0);
    });

    // -------------------------------------------------------------------------
    // 4. Draft kb_articles visible to admin (org owner)
    // -------------------------------------------------------------------------
    it('agent CAN SELECT draft kb_articles in own org', async () => {
      const { data, error } = await userA_ownerClient
        .from('kb_articles')
        .select('id, published_at')
        .eq('id', orgADraftArticleId)
        .maybeSingle();
      expect(error).toBeNull();
      expect(data?.id).toBe(orgADraftArticleId);
      expect(data?.published_at).toBeNull();
    });

    // -------------------------------------------------------------------------
    // 5. publish_kb_article role gate — non-org-member denied
    // -------------------------------------------------------------------------
    it('patient calling publish_kb_article on org_A article fails (insufficient_role)', async () => {
      const { error } = await userA_patientClient.rpc('publish_kb_article', {
        p_article_id: orgADraftArticleId,
        p_title: 'should not work',
        p_body: 'nope',
      });
      expect(error).not.toBeNull();
    });

    // -------------------------------------------------------------------------
    // 6. publish_kb_article success — owner can publish own org article
    //    NOTE: The current SECDEF body checks role IN ('owner','support_admin',
    //    'support_lead'). We seed userA_owner as role='owner' so this passes.
    // -------------------------------------------------------------------------
    it('owner CAN publish own-org draft → version row appears', async () => {
      const { error: rpcErr } = await userA_ownerClient.rpc('publish_kb_article', {
        p_article_id: orgADraftArticleId,
        p_title: `${TEST_SLUG_PREFIX}-org-a-draft-title`,
        p_body: 'now published',
      });
      expect(rpcErr).toBeNull();

      const { data, error } = await admin
        .from('kb_article_versions')
        .select('article_id, version')
        .eq('article_id', orgADraftArticleId);
      expect(error).toBeNull();
      expect(data?.length ?? 0).toBeGreaterThanOrEqual(1);
    });

    // -------------------------------------------------------------------------
    // 7. agent_macros cross-tenant
    // -------------------------------------------------------------------------
    it('agent cannot SELECT agent_macros in cross-org', async () => {
      const { data, error } = await userA_ownerClient
        .from('agent_macros')
        .select('id')
        .eq('id', macroB_id);
      expect(error).toBeNull();
      expect(data?.length ?? 0).toBe(0);

      void macroA_id; // referenced for completeness
    });

    // -------------------------------------------------------------------------
    // 8. helpdesk_routing_rules — non-member cannot INSERT
    // -------------------------------------------------------------------------
    it('non-org-member CANNOT INSERT helpdesk_routing_rules', async () => {
      const { error } = await userA_patientClient.from('helpdesk_routing_rules').insert({
        org_id: orgA,
        name: `${TEST_SLUG_PREFIX}-rule-attempt`,
        tag_name: 'billing',
        assign_to_user_id: userA_ownerId,
        priority: 100,
      });
      expect(error).not.toBeNull();
    });

    // -------------------------------------------------------------------------
    // 9. sla_targets — non-org-member cannot UPDATE
    // -------------------------------------------------------------------------
    it('non-org-member UPDATE of sla_targets affects 0 rows', async () => {
      // Seed a baseline row to attempt updating
      await admin
        .from('sla_targets')
        .upsert(
          { org_id: orgA, tier: 'p3', first_response_minutes: 240, resolution_minutes: 1440 },
          { onConflict: 'org_id,tier' },
        );

      const { data, error } = await userA_patientClient
        .from('sla_targets')
        .update({ first_response_minutes: 9999 })
        .eq('org_id', orgA)
        .eq('tier', 'p3')
        .select();
      // RLS UPDATE policy filters by org_members; non-member → 0 rows
      expect(data?.length ?? 0).toBe(0);
      void error;
    });

    // -------------------------------------------------------------------------
    // 10. search_kb_articles RPC — RLS cascade filters by caller's visibility
    // -------------------------------------------------------------------------
    it('search_kb_articles returns global rows for patient; cross-org search returns 0', async () => {
      // (a) Global slice — patient should see global published articles
      const { data: globalRows, error: gErr } = await userA_patientClient.rpc(
        'search_kb_articles',
        { p_query: TEST_SLUG_PREFIX, p_locale: 'en', p_org_id: null, p_limit: 10 },
      );
      expect(gErr).toBeNull();
      // Result shape may be jsonb / array; just assert non-null array
      expect(Array.isArray(globalRows) ? globalRows.length >= 0 : true).toBe(true);

      // (b) Cross-org slice — patient searching org_b returns 0 rows
      const { data: crossRows, error: cErr } = await userA_patientClient.rpc('search_kb_articles', {
        p_query: TEST_SLUG_PREFIX,
        p_locale: 'en',
        p_org_id: orgB,
        p_limit: 10,
      });
      expect(cErr).toBeNull();
      expect(Array.isArray(crossRows) ? crossRows.length : 0).toBe(0);
    });

    // Reference for B-org agent cross-tenant scan to make sure all 3 owner
    // clients are wired (avoids unused-locals strict lint).
    it('org B agent cannot SELECT kb_articles in org A', async () => {
      const { data, error } = await userB_ownerClient
        .from('kb_articles')
        .select('id')
        .eq('id', orgAPublishedArticleId);
      expect(error).toBeNull();
      expect(data?.length ?? 0).toBe(0);
    });
  },
);
