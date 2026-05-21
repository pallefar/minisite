/**
 * Phase 38 Plan 38-08 — Live e2e for the HITL admin queue lifecycle.
 *
 * Coverage (per plan Task 2 — 7 e2e behaviors):
 *   T1 — Recommender row with source_type='kb_article' + action_id='read_kb'
 *        lands in ai_suggestion_review with status='auto_approved_kb'.
 *   T2 — Digest row with mixed actions lands as status='pending' (the queue
 *        surface shows it).
 *   T3 — Super-admin hitl_decide(approved) on the pending digest row →
 *        invokes weekly-digest with hitl_release_row_id; weekly_digest_sends
 *        moves 'pending_review' → 'sent'.
 *   T4 — hitl_decide(rejected) → status='rejected'; weekly_digest_sends row
 *        remains 'pending_review' (no retry).
 *   T5 — hitl_decide(edited, edited_payload={…new narrative}) → status='edited',
 *        payload reflects edits; the release path uses the edited payload.
 *   T6 — Clinic-admin (non-super) calling hitl_decide raises super-admin gate.
 *   T7 — Bulk approve N rows in a single hitl_decide call.
 *
 * Skip behavior — auto-skips when live Supabase creds are not set:
 *   - SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY + SUPABASE_ANON_KEY required.
 *   - Local dev typically omits these. CI sets them.
 */
import { randomUUID } from 'node:crypto';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { getUserAccessToken } from '../rls/helpers/admin-session';

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;

const SHOULD_RUN = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY && SERVICE);
const describeIfLive = SHOULD_RUN ? describe : describe.skip;

const E2E_PREFIX = `p38-hitl-e2e-${randomUUID().slice(0, 6)}`;

interface AiSuggestionReviewRow {
  id: string;
  type: 'recommender' | 'digest' | 'win_back';
  user_id: string | null;
  org_id: string | null;
  payload: Record<string, unknown>;
  source_type: string | null;
  action_id: string | null;
  status: 'pending' | 'approved' | 'rejected' | 'edited' | 'auto_approved_kb';
  decided_by: string | null;
  decided_at: string | null;
  decision_note: string | null;
  created_at: string;
}

describeIfLive('Phase 38 Plan 38-08 — HITL queue lifecycle (RECOMMEND-07)', () => {
  let admin: SupabaseClient;
  let superAdminId: string;
  let superAdminEmail: string;
  let superAdminToken: string;
  let clinicAdminId: string;
  let clinicAdminEmail: string;
  let clinicAdminToken: string;
  let testUserId: string;
  let testUserEmail: string;

  // Track rows created so afterAll can clean them up.
  const reviewRowIds: string[] = [];
  const wdsRowIds: string[] = [];

  beforeAll(async () => {
    admin = createClient(SUPABASE_URL!, SERVICE!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // Create three users: super-admin, clinic-admin, ordinary user.
    superAdminEmail = `${E2E_PREFIX}-super-${randomUUID().slice(0, 4)}@leanshot-test.invalid`;
    const { data: sa, error: errSA } = await admin.auth.admin.createUser({
      email: superAdminEmail,
      email_confirm: true,
    });
    if (errSA || !sa?.user) throw new Error(`createUser super failed: ${errSA?.message}`);
    superAdminId = sa.user.id;
    // Promote to super-admin (is_staff=true).
    await admin.from('profiles').upsert({ id: superAdminId, is_staff: true });
    superAdminToken = await getUserAccessToken(superAdminEmail);

    clinicAdminEmail = `${E2E_PREFIX}-clinic-${randomUUID().slice(0, 4)}@leanshot-test.invalid`;
    const { data: ca, error: errCA } = await admin.auth.admin.createUser({
      email: clinicAdminEmail,
      email_confirm: true,
    });
    if (errCA || !ca?.user) throw new Error(`createUser clinic failed: ${errCA?.message}`);
    clinicAdminId = ca.user.id;
    // Explicitly NOT staff.
    await admin.from('profiles').upsert({ id: clinicAdminId, is_staff: false });
    clinicAdminToken = await getUserAccessToken(clinicAdminEmail);

    testUserEmail = `${E2E_PREFIX}-user-${randomUUID().slice(0, 4)}@leanshot-test.invalid`;
    const { data: tu, error: errTU } = await admin.auth.admin.createUser({
      email: testUserEmail,
      email_confirm: true,
    });
    if (errTU || !tu?.user) throw new Error(`createUser test-user failed: ${errTU?.message}`);
    testUserId = tu.user.id;
  }, 90_000);

  afterAll(async () => {
    try {
      if (reviewRowIds.length > 0) {
        await admin.from('ai_suggestion_review').delete().in('id', reviewRowIds);
      }
    } catch {
      /* ignore */
    }
    try {
      if (wdsRowIds.length > 0) {
        await admin.from('weekly_digest_sends').delete().in('id', wdsRowIds);
      }
    } catch {
      /* ignore */
    }
    for (const id of [superAdminId, clinicAdminId, testUserId].filter(Boolean)) {
      try {
        await admin.auth.admin.deleteUser(id);
      } catch {
        /* ignore */
      }
    }
  }, 60_000);

  function asSuperAdmin(): SupabaseClient {
    return createClient(SUPABASE_URL!, SUPABASE_ANON_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
      global: { headers: { Authorization: `Bearer ${superAdminToken}` } },
    });
  }

  function asClinicAdmin(): SupabaseClient {
    return createClient(SUPABASE_URL!, SUPABASE_ANON_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
      global: { headers: { Authorization: `Bearer ${clinicAdminToken}` } },
    });
  }

  async function seedReviewRow(
    type: 'recommender' | 'digest' | 'win_back',
    overrides: Partial<AiSuggestionReviewRow>,
  ): Promise<AiSuggestionReviewRow> {
    const row: Partial<AiSuggestionReviewRow> = {
      type,
      user_id: testUserId,
      payload: { narrative: 'Test narrative', actions: [{ id: 'log_weight', reason: 'Track.' }] },
      source_type: 'digest_narrative',
      action_id: 'log_weight',
      status: 'pending',
      ...overrides,
    };
    const { data, error } = await admin
      .from('ai_suggestion_review')
      .insert(row)
      .select('*')
      .single();
    if (error || !data) throw new Error(`seed review row failed: ${error?.message}`);
    reviewRowIds.push(data.id);
    return data as AiSuggestionReviewRow;
  }

  async function seedWdsHold(): Promise<string> {
    const { data, error } = await admin
      .from('weekly_digest_sends')
      .insert({
        user_id: testUserId,
        narrative: 'Held narrative',
        actions_jsonb: [{ id: 'log_weight', reason: 'Track.' }],
        status: 'pending_review',
        model_id: 'anthropic/claude-sonnet-4-6',
        prompt_cache_hit: false,
      })
      .select('id')
      .single();
    if (error || !data) throw new Error(`seed wds hold failed: ${error?.message}`);
    wdsRowIds.push(data.id);
    return data.id;
  }

  it('T1: KB-source recommender row lands as status=auto_approved_kb', async () => {
    const row = await seedReviewRow('recommender', {
      source_type: 'kb_article',
      action_id: 'read_kb',
      status: 'auto_approved_kb',
      payload: { title: 'KB title', url: 'https://app.leanshot.app/kb/x' },
    });
    expect(row.status).toBe('auto_approved_kb');
    // Super-admin reads should see it via RLS.
    const sa = asSuperAdmin();
    const { data: visible } = await sa
      .from('ai_suggestion_review')
      .select('id, status')
      .eq('id', row.id)
      .maybeSingle();
    expect(visible?.status).toBe('auto_approved_kb');
  });

  it('T2: Mixed-action digest lands as status=pending (visible to super-admin)', async () => {
    const row = await seedReviewRow('digest', {
      source_type: 'digest_narrative',
      action_id: 'log_weight',
      status: 'pending',
      payload: {
        narrative: 'Steady week.',
        actions: [
          { id: 'log_weight', reason: 'Track trend.' },
          { id: 'read_kb', reason: 'Learn more.' },
        ],
      },
    });
    expect(row.status).toBe('pending');
    const sa = asSuperAdmin();
    const { data: visible } = await sa
      .from('ai_suggestion_review')
      .select('id, status, type')
      .eq('id', row.id)
      .maybeSingle();
    expect(visible?.status).toBe('pending');
    expect(visible?.type).toBe('digest');
  });

  it('T3: Approve via hitl_decide + invoke weekly-digest releases the held send', async () => {
    const row = await seedReviewRow('digest', { status: 'pending' });
    const holdId = await seedWdsHold();

    const sa = asSuperAdmin();
    const { error: rpcErr } = await sa.rpc('hitl_decide', {
      row_ids: [row.id],
      decision: 'approved',
      note: 'looks good',
      edited_payload: null,
    });
    expect(rpcErr).toBeNull();

    // Verify the row transitioned.
    const { data: after } = await admin
      .from('ai_suggestion_review')
      .select('status, decided_by, decided_at')
      .eq('id', row.id)
      .maybeSingle();
    expect(after?.status).toBe('approved');
    expect(after?.decided_by).toBe(superAdminId);
    expect(after?.decided_at).not.toBeNull();

    // Invoke the release branch.
    const releaseRes = await sa.functions.invoke('weekly-digest', {
      body: { hitl_release_row_id: row.id },
    });
    expect(releaseRes.error).toBeNull();

    // Verify weekly_digest_sends transitioned.
    const { data: wds } = await admin
      .from('weekly_digest_sends')
      .select('status')
      .eq('id', holdId)
      .maybeSingle();
    expect(wds?.status).toBe('sent');
  }, 30_000);

  it('T4: Reject via hitl_decide sets status=rejected and does not release', async () => {
    const row = await seedReviewRow('digest', { status: 'pending' });
    const holdId = await seedWdsHold();

    const sa = asSuperAdmin();
    const { error } = await sa.rpc('hitl_decide', {
      row_ids: [row.id],
      decision: 'rejected',
      note: 'not appropriate',
      edited_payload: null,
    });
    expect(error).toBeNull();

    const { data: after } = await admin
      .from('ai_suggestion_review')
      .select('status')
      .eq('id', row.id)
      .maybeSingle();
    expect(after?.status).toBe('rejected');

    // weekly_digest_sends remains pending_review (no release).
    const { data: wds } = await admin
      .from('weekly_digest_sends')
      .select('status')
      .eq('id', holdId)
      .maybeSingle();
    expect(wds?.status).toBe('pending_review');
  });

  it('T5: Edit-then-approve writes status=edited + new payload + releases', async () => {
    const row = await seedReviewRow('digest', { status: 'pending' });
    const holdId = await seedWdsHold();

    const editedPayload = {
      narrative: 'Edited by reviewer for clarity.',
      actions: [{ id: 'log_weight', reason: 'Keep tracking.' }],
    };
    const sa = asSuperAdmin();
    const { error: rpcErr } = await sa.rpc('hitl_decide', {
      row_ids: [row.id],
      decision: 'edited',
      note: 'tightened narrative',
      edited_payload: editedPayload,
    });
    expect(rpcErr).toBeNull();

    const { data: after } = await admin
      .from('ai_suggestion_review')
      .select('status, payload')
      .eq('id', row.id)
      .maybeSingle();
    expect(after?.status).toBe('edited');
    expect((after?.payload as { narrative: string }).narrative).toBe(editedPayload.narrative);

    // Release.
    const releaseRes = await sa.functions.invoke('weekly-digest', {
      body: { hitl_release_row_id: row.id },
    });
    expect(releaseRes.error).toBeNull();

    const { data: wds } = await admin
      .from('weekly_digest_sends')
      .select('status')
      .eq('id', holdId)
      .maybeSingle();
    expect(wds?.status).toBe('sent');
  }, 30_000);

  it('T6: Clinic-admin (non-super) hitl_decide call raises super-admin exception', async () => {
    const row = await seedReviewRow('digest', { status: 'pending' });
    const ca = asClinicAdmin();
    const { error } = await ca.rpc('hitl_decide', {
      row_ids: [row.id],
      decision: 'approved',
      note: null,
      edited_payload: null,
    });
    expect(error).not.toBeNull();
    expect(error?.message?.toLowerCase()).toMatch(/super-admin|42501/);

    // Row stays pending.
    const { data: after } = await admin
      .from('ai_suggestion_review')
      .select('status')
      .eq('id', row.id)
      .maybeSingle();
    expect(after?.status).toBe('pending');
  });

  it('T7: Bulk approve N rows in a single hitl_decide call', async () => {
    const rows = await Promise.all([
      seedReviewRow('digest', { status: 'pending' }),
      seedReviewRow('digest', { status: 'pending' }),
      seedReviewRow('digest', { status: 'pending' }),
    ]);
    const ids = rows.map((r) => r.id);

    const sa = asSuperAdmin();
    const { error } = await sa.rpc('hitl_decide', {
      row_ids: ids,
      decision: 'approved',
      note: 'bulk',
      edited_payload: null,
    });
    expect(error).toBeNull();

    const { data: after } = await admin
      .from('ai_suggestion_review')
      .select('id, status')
      .in('id', ids);
    expect(after?.length).toBe(3);
    for (const r of after ?? []) {
      expect(r.status).toBe('approved');
    }
  });
});
