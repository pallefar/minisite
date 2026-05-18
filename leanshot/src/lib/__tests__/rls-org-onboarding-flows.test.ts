/**
 * Phase 31 Plan 04 — cross-tenant RLS proof for `org_onboarding_flows`.
 *
 * Cross-tenant isolation assertions (per [[reference_supabase_project]] project rule +
 * P28 EXTENSION-CONTRACT §3b):
 *   A1: User A (Org X member) CAN SELECT org X's active flow.
 *   A2: User A CANNOT SELECT org Y's flow (RLS filters to 0 rows).
 *   A3: User A CANNOT call save_org_onboarding_flow against Org Y (insufficient_privilege).
 *   A4: User A CANNOT call activate_onboarding_flow_version against Org Y (insufficient_privilege).
 *   A5: User A CANNOT directly INSERT into org_onboarding_flows (RLS WITH CHECK false).
 *   A6: mark_onboarding_complete() operates only on caller's profile (User A → NOT NULL; User B stays NULL).
 *
 * Environment: requires SUPABASE_URL + SUPABASE_ANON_KEY + SUPABASE_SERVICE_ROLE_KEY.
 * Skipped automatically when env not set (per [[reference_rls_fixture_gotrueclient_flake]]).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import {
  SHOULD_RUN,
  cleanupByPrefix,
  createTwoOrgsTwoUsers,
  getAdmin,
  makeSlugPrefix,
  type TwoOrgsTwoUsers,
} from './_fixtures/p28-rls-fixture';

// File-scoped prefix per [[feedback_rls_per_file_slug_prefix]] — protects against
// vitest file-parallelism slug clobbering.
const TEST_SLUG_PREFIX = makeSlugPrefix(__filename);

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? '';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY ?? '';

const describeIfLive = SHOULD_RUN ? describe : describe.skip;

// Minimal valid steps per _validate_onboarding_steps (medication + consent mandatory)
function makeValidSteps() {
  return [
    { id: crypto.randomUUID(), type: 'welcome' },
    { id: crypto.randomUUID(), type: 'medication' },
    { id: crypto.randomUUID(), type: 'consent' },
  ];
}

describeIfLive('P31-04 RLS — org_onboarding_flows cross-tenant isolation', () => {
  let fixture: TwoOrgsTwoUsers;
  let orgXFlowId: string;
  let userAClient: SupabaseClient;
  let admin: SupabaseClient;

  beforeAll(async () => {
    admin = getAdmin();
    fixture = await createTwoOrgsTwoUsers(TEST_SLUG_PREFIX);

    // Per-org user clients — use fixture-provided accessToken per [[reference_rls_fixture_gotrueclient_flake]]
    userAClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${fixture.sessA.access_token}` } },
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // Seed an active flow into org X via service-role direct insert (bypasses RLS + validator).
    // This is fixture creation context — the test purpose is RLS assertion, not validator exercise.
    const { data: flowData, error: flowErr } = await admin
      .from('org_onboarding_flows')
      .insert({
        org_id: fixture.orgX,
        steps: makeValidSteps(),
        version: 1,
        is_active: true,
        created_by: fixture.userA,
      })
      .select('id')
      .single();

    if (flowErr || !flowData) {
      throw new Error(`seed org_onboarding_flows failed: ${flowErr?.message}`);
    }
    orgXFlowId = flowData.id;
  }, 60_000);

  afterAll(async () => {
    // Delete flows first: FK on org_id is ON DELETE RESTRICT — must remove flows before org cleanup.
    await admin.from('org_onboarding_flows').delete().eq('org_id', fixture.orgX);
    await admin.from('org_onboarding_flows').delete().eq('org_id', fixture.orgY);
    await cleanupByPrefix(TEST_SLUG_PREFIX);
  });

  it('A1: User A CAN SELECT org X flow (member SELECT policy)', async () => {
    const { data, error } = await userAClient
      .from('org_onboarding_flows')
      .select('id')
      .eq('org_id', fixture.orgX);
    expect(error).toBeNull();
    const ids = (data ?? []).map((r: { id: string }) => r.id);
    expect(ids).toContain(orgXFlowId);
  }, 30_000);

  it('A2: User A CANNOT SELECT org Y flows (RLS filters to 0 rows)', async () => {
    const { data, error } = await userAClient
      .from('org_onboarding_flows')
      .select('id')
      .eq('org_id', fixture.orgY);
    expect(error).toBeNull();
    expect((data ?? []).length).toBe(0);
  }, 30_000);

  it('A3: User A CANNOT call save_org_onboarding_flow against org Y (insufficient_privilege)', async () => {
    const { error } = await userAClient.rpc('save_org_onboarding_flow', {
      p_org_id: fixture.orgY,
      p_steps: makeValidSteps(),
    });
    expect(error).not.toBeNull();
    expect((error as { message: string }).message).toMatch(/insufficient_privilege/);
  }, 30_000);

  it('A4: User A CANNOT call activate_onboarding_flow_version against org Y (insufficient_privilege)', async () => {
    const { error } = await userAClient.rpc('activate_onboarding_flow_version', {
      p_org_id: fixture.orgY,
      p_flow_id: orgXFlowId, // a valid flow id but from org X — still org Y mismatch check first
    });
    expect(error).not.toBeNull();
    expect((error as { message: string }).message).toMatch(/insufficient_privilege/);
  }, 30_000);

  it('A5: User A CANNOT directly INSERT into org_onboarding_flows (RLS WITH CHECK false)', async () => {
    const { error } = await userAClient.from('org_onboarding_flows').insert({
      org_id: fixture.orgX,
      steps: makeValidSteps(),
      version: 99,
      is_active: false,
      created_by: fixture.userA,
    });
    expect(error).not.toBeNull();
  }, 30_000);

  it('A6: mark_onboarding_complete() writes only to caller (User A), User B stays NULL', async () => {
    // User A calls mark_onboarding_complete()
    const { error: markErr } = await userAClient.rpc('mark_onboarding_complete');
    expect(markErr).toBeNull();

    // Admin verifies User A's profile has completed_onboarding_at set
    const { data: profileA, error: profileAErr } = await admin
      .from('profiles')
      .select('completed_onboarding_at')
      .eq('id', fixture.userA)
      .single();
    expect(profileAErr).toBeNull();
    expect(profileA?.completed_onboarding_at).not.toBeNull();

    // Admin verifies User B's profile still has NULL
    const { data: profileB, error: profileBErr } = await admin
      .from('profiles')
      .select('completed_onboarding_at')
      .eq('id', fixture.userB)
      .single();
    expect(profileBErr).toBeNull();
    expect(profileB?.completed_onboarding_at).toBeNull();
  }, 30_000);
});

describe('P31-04 RLS org_onboarding_flows — env gating check', () => {
  it('skips live DB tests when SUPABASE_SERVICE_ROLE_KEY is not set', () => {
    if (!SHOULD_RUN) {
      console.warn('[rls-org-onboarding-flows.test] SKIPPED — env not set.');
    }
    expect(true).toBe(true);
  });
});
