/**
 * Phase 37 Plan 37-09 Task 1 — RLS cross-tenant impersonation proof for
 * tickets / ticket_messages / ticket_attachments / ticket_ai_suggestions.
 *
 * Per [[reference_supabase_project.md]]: every RLS surface gets a live
 * cross-tenant impersonation proof test.
 *
 * Fixture model (4 users + 2 orgs):
 *   - userA_owner  → org_members(org_a, role='owner')   — agent
 *   - userA_patient → NOT org_members; owns ticket in org_a
 *   - userB_owner  → org_members(org_b, role='owner')   — agent
 *   - userB_patient → NOT org_members; owns ticket in org_b
 *
 * Patients are not org_members; they only see own tickets via
 * `tickets_select_owner` (user_id = auth.uid()). Agents (org_members) see
 * tickets in their org via `tickets_select_agent`. Cross-org never allowed.
 *
 * Auth: admin.generateLink + /auth/v1/verify via plain fetch (ES256-compat
 * per [[reference_rls_fixture_gotrueclient_flake]]). NEVER signInWithPassword.
 *
 * File-scoped slug prefix per [[feedback_rls_per_file_slug_prefix]].
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getUserAccessToken } from '../../tests/rls/helpers/admin-session';

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const SHOULD_RUN = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY && SUPABASE_SERVICE_ROLE_KEY);
const describeIfLive = SHOULD_RUN ? describe : describe.skip;

const TEST_SLUG_PREFIX = `p37-rls-tickets-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

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

describeIfLive('Phase 37 Plan 37-09 — RLS impersonation: tickets / messages / attachments / ai_suggestions', () => {
  const admin = SHOULD_RUN ? getAdmin() : null!;
  const createdUserIds: string[] = [];
  const createdOrgIds: string[] = [];

  let userA_ownerId: string;
  let userA_patientId: string;
  let userB_ownerId: string;
  let userB_patientId: string;

  let orgA: string;
  let orgB: string;

  let ticketA_id: string;
  let ticketB_id: string;
  let messageA_id: string;
  let attachmentA_id: string;
  let aiSuggestionA_id: string;

  let userA_ownerClient: SupabaseClient;
  let userA_patientClient: SupabaseClient;
  let userB_ownerClient: SupabaseClient;
  let userB_patientClient: SupabaseClient;

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
    const b_patient = await createUser('b-patient');
    userA_ownerId = a_owner.id;
    userA_patientId = a_patient.id;
    userB_ownerId = b_owner.id;
    userB_patientId = b_patient.id;

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

    // Owners are org_members; patients are NOT.
    const { error: omErr } = await admin.from('org_members').insert([
      { org_id: orgA, user_id: userA_ownerId, role: 'owner' },
      { org_id: orgB, user_id: userB_ownerId, role: 'owner' },
    ]);
    if (omErr) throw omErr;

    // Seed tickets — one per (org × patient)
    const { data: tA, error: tAErr } = await admin
      .from('tickets')
      .insert({
        org_id: orgA,
        user_id: userA_patientId,
        subject: `${TEST_SLUG_PREFIX}-ticket-a`,
        source: 'widget',
      })
      .select('id')
      .single();
    if (tAErr) throw tAErr;
    ticketA_id = tA!.id;

    const { data: tB, error: tBErr } = await admin
      .from('tickets')
      .insert({
        org_id: orgB,
        user_id: userB_patientId,
        subject: `${TEST_SLUG_PREFIX}-ticket-b`,
        source: 'widget',
      })
      .select('id')
      .single();
    if (tBErr) throw tBErr;
    ticketB_id = tB!.id;

    // First user message per ticket
    const { data: msgA, error: msgAErr } = await admin
      .from('ticket_messages')
      .insert({
        ticket_id: ticketA_id,
        author_user_id: userA_patientId,
        author_kind: 'user',
        body: `${TEST_SLUG_PREFIX}-msg-a`,
        via: 'widget',
      })
      .select('id')
      .single();
    if (msgAErr) throw msgAErr;
    messageA_id = msgA!.id;

    await admin
      .from('ticket_messages')
      .insert({
        ticket_id: ticketB_id,
        author_user_id: userB_patientId,
        author_kind: 'user',
        body: `${TEST_SLUG_PREFIX}-msg-b`,
        via: 'widget',
      });

    // Attachments
    const { data: attA, error: attAErr } = await admin
      .from('ticket_attachments')
      .insert({
        ticket_id: ticketA_id,
        message_id: messageA_id,
        storage_path: `${TEST_SLUG_PREFIX}/a/file.pdf`,
        mime_type: 'application/pdf',
        byte_size: 1024,
        original_filename: `${TEST_SLUG_PREFIX}-a.pdf`,
      })
      .select('id')
      .single();
    if (attAErr) throw attAErr;
    attachmentA_id = attA!.id;

    // AI suggestion for ticket A
    const { data: sugA, error: sugAErr } = await admin
      .from('ticket_ai_suggestions')
      .insert({
        ticket_id: ticketA_id,
        message_id: messageA_id,
        suggested_tags: [{ tag: 'shipping', confidence: 0.9 }],
        draft_reply: 'mock draft',
        sentiment_score: 0.1,
        model_id: 'claude-sonnet-4-6',
        is_clinical_scope: false,
      })
      .select('id')
      .single();
    if (sugAErr) throw sugAErr;
    aiSuggestionA_id = sugA!.id;

    // Mint per-user JWTs (ES256 via admin.generateLink + verify)
    const aOwnerTok = await getUserAccessToken(a_owner.email);
    const aPatientTok = await getUserAccessToken(a_patient.email);
    const bOwnerTok = await getUserAccessToken(b_owner.email);
    const bPatientTok = await getUserAccessToken(b_patient.email);

    userA_ownerClient = buildUserClient(aOwnerTok, `${TEST_SLUG_PREFIX}-a-owner`);
    userA_patientClient = buildUserClient(aPatientTok, `${TEST_SLUG_PREFIX}-a-patient`);
    userB_ownerClient = buildUserClient(bOwnerTok, `${TEST_SLUG_PREFIX}-b-owner`);
    userB_patientClient = buildUserClient(bPatientTok, `${TEST_SLUG_PREFIX}-b-patient`);
  }, 90_000);

  afterAll(async () => {
    if (!SHOULD_RUN) return;

    // Phi access log rows created during test 9
    await admin
      .from('phi_access_log')
      .delete()
      .like('reason', `${TEST_SLUG_PREFIX}%`);

    // Tickets cascade -> messages, attachments, ai_suggestions
    if (ticketA_id) await admin.from('tickets').delete().eq('id', ticketA_id);
    if (ticketB_id) await admin.from('tickets').delete().eq('id', ticketB_id);

    if (createdOrgIds.length > 0) {
      await admin.from('org_members').delete().in('org_id', createdOrgIds);
      await admin.from('organizations').delete().in('id', createdOrgIds);
    }
    for (const uid of createdUserIds) {
      await admin.auth.admin.deleteUser(uid).catch(() => undefined);
    }
  }, 60_000);

  // -------------------------------------------------------------------------
  // 1. Patient cross-user (same org) — patient only sees own ticket
  // -------------------------------------------------------------------------
  it('patient sees own ticket but NOT another patient/owner ticket in same org', async () => {
    const { data, error } = await userA_patientClient
      .from('tickets')
      .select('id, user_id, org_id')
      .like('subject', `${TEST_SLUG_PREFIX}%`);
    expect(error).toBeNull();
    expect(data?.length ?? 0).toBe(1);
    expect(data![0].id).toBe(ticketA_id);
    expect(data![0].user_id).toBe(userA_patientId);
  });

  // -------------------------------------------------------------------------
  // 2. Patient cross-org — patient cannot see any org_b ticket
  // -------------------------------------------------------------------------
  it('patient cannot see any ticket in cross-org', async () => {
    const { data, error } = await userA_patientClient
      .from('tickets')
      .select('id')
      .eq('org_id', orgB);
    expect(error).toBeNull();
    expect(data?.length ?? 0).toBe(0);
  });

  // -------------------------------------------------------------------------
  // 3. Agent within org — owner sees all tickets in their org
  // -------------------------------------------------------------------------
  it('agent sees all tickets in own org (patient tickets included)', async () => {
    const { data, error } = await userA_ownerClient
      .from('tickets')
      .select('id, org_id')
      .like('subject', `${TEST_SLUG_PREFIX}%`);
    expect(error).toBeNull();
    expect(data?.length ?? 0).toBeGreaterThanOrEqual(1);
    expect(data!.every((r) => r.org_id === orgA)).toBe(true);
  });

  // -------------------------------------------------------------------------
  // 4. Agent cross-org — owner cannot SELECT tickets in cross-org
  // -------------------------------------------------------------------------
  it('agent cannot SELECT tickets in cross-org', async () => {
    const { data, error } = await userA_ownerClient
      .from('tickets')
      .select('id')
      .eq('org_id', orgB);
    expect(error).toBeNull();
    expect(data?.length ?? 0).toBe(0);
  });

  // -------------------------------------------------------------------------
  // 5. ticket_messages append-only — authenticated UPDATE fails
  // -------------------------------------------------------------------------
  it('agent cannot UPDATE ticket_messages (append-only, no UPDATE policy)', async () => {
    const { data, error } = await userA_ownerClient
      .from('ticket_messages')
      .update({ body: 'should not work' })
      .eq('id', messageA_id)
      .select();
    // RLS-blocked UPDATE returns 0 rows; error may be null on policy violation.
    expect((data?.length ?? 0)).toBe(0);
    void error;
  });

  // -------------------------------------------------------------------------
  // 6. ticket_messages — service_role also denied UPDATE (revoked in 20270707000001)
  // -------------------------------------------------------------------------
  it('service_role cannot UPDATE ticket_messages (privilege revoked)', async () => {
    const { error } = await admin
      .from('ticket_messages')
      .update({ body: 'service-role tampering' })
      .eq('id', messageA_id);
    // Either error (insufficient privilege 42501) or PostgREST surfaces as
    // a perm error in the response. Both shapes are acceptable.
    expect(error).not.toBeNull();
  });

  // -------------------------------------------------------------------------
  // 7. ticket_attachments cross-tenant
  // -------------------------------------------------------------------------
  it('agent cannot SELECT attachments tied to cross-org tickets', async () => {
    // Owner of org B querying attachment A (org A)
    const { data, error } = await userB_ownerClient
      .from('ticket_attachments')
      .select('id')
      .eq('id', attachmentA_id);
    expect(error).toBeNull();
    expect(data?.length ?? 0).toBe(0);
  });

  // -------------------------------------------------------------------------
  // 8. ticket_ai_suggestions — agent-only SELECT
  // -------------------------------------------------------------------------
  it('patient CANNOT SELECT ticket_ai_suggestions for own ticket (agent-only)', async () => {
    const { data, error } = await userA_patientClient
      .from('ticket_ai_suggestions')
      .select('id')
      .eq('id', aiSuggestionA_id);
    expect(error).toBeNull();
    expect(data?.length ?? 0).toBe(0);
  });

  it('agent CAN SELECT ticket_ai_suggestions in own org', async () => {
    const { data, error } = await userA_ownerClient
      .from('ticket_ai_suggestions')
      .select('id')
      .eq('id', aiSuggestionA_id)
      .maybeSingle();
    expect(error).toBeNull();
    expect(data?.id).toBe(aiSuggestionA_id);
  });

  // -------------------------------------------------------------------------
  // 9. PHI ticket open fires log_phi_access — end-to-end verification
  // -------------------------------------------------------------------------
  it('agent invocation of log_phi_access RPC writes a row visible to service_role', async () => {
    const reason = `${TEST_SLUG_PREFIX}-agent-inbox-open`;
    const { error: rpcErr } = await userA_ownerClient.rpc('log_phi_access', {
      p_accessed_user_id: userA_patientId,
      p_accessed_fields: ['ticket.subject', 'ticket.body'],
      p_reason: reason,
      p_accessed_org_id: orgA,
    });
    expect(rpcErr).toBeNull();

    const { data, error } = await admin
      .from('phi_access_log')
      .select('actor_user_id, accessed_user_id, reason')
      .eq('reason', reason)
      .limit(1)
      .maybeSingle();
    expect(error).toBeNull();
    expect(data?.actor_user_id).toBe(userA_ownerId);
    expect(data?.accessed_user_id).toBe(userA_patientId);
  });

  // -------------------------------------------------------------------------
  // 10. Patient cannot UPDATE ticket → status='closed' (RLS WITH CHECK filter)
  // -------------------------------------------------------------------------
  it('patient cannot UPDATE ticket to status=closed (RLS WITH CHECK rejects)', async () => {
    const { data, error } = await userA_patientClient
      .from('tickets')
      .update({ status: 'closed' })
      .eq('id', ticketA_id)
      .select();
    // WITH CHECK rejects → 0 rows affected (and possibly RLS violation error)
    expect((data?.length ?? 0)).toBe(0);
    void error;

    // Verify ticket status still NOT 'closed' (service_role read-back)
    const { data: t } = await admin
      .from('tickets')
      .select('status')
      .eq('id', ticketA_id)
      .single();
    expect(t?.status).not.toBe('closed');
  });
});
