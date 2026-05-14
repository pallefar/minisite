/**
 * Phase 14 Plan 01 — Cross-tenant RLS impersonation proof for all 4 Stripe tables.
 *
 * Verifies, against the live cloud DB (post `supabase db push` of
 * migration 20260601000019_stripe_subscriptions.sql), that:
 *
 *   T-14-01: User A cannot read User B's subscriptions row (user-tier).
 *   T-14-02: Clinic A's Owner cannot read Clinic B's subscriptions row (clinic-tier).
 *   T-14-03: User A cannot read User B's stripe_customers row.
 *   T-14-04 (variant): Clinic A's Owner cannot read Clinic B's clinic_stripe_customers row.
 *
 * Schema note: The live DB uses public.orgs (not clinics) and public.memberships
 * (not clinic_memberships). Active membership = revoked_at IS NULL.
 *
 * Environment:
 *   SUPABASE_URL              — public (also VITE_SUPABASE_URL)
 *   SUPABASE_ANON_KEY         — public (also VITE_SUPABASE_ANON_KEY)
 *   SUPABASE_SERVICE_ROLE_KEY — PRIVATE (CI secret; never commit)
 *
 * Skipped automatically if any required env var is absent (default local +
 * PR-from-fork safety). Wave verification runs this against the live cloud
 * DB with the secret injected.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const ANON = process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;

const SHOULD_RUN = Boolean(URL && ANON && SERVICE);
const describeIfLive = SHOULD_RUN ? describe : describe.skip;

// ---------------------------------------------------------------------------
// Module-scoped state — populated in beforeAll, cleaned in afterAll
// ---------------------------------------------------------------------------
let admin: SupabaseClient;

let userAId: string;
let userBId: string;
let userAEmail: string;
let userBEmail: string;
let userAPassword: string;
let userBPassword: string;

let orgAId: string;
let orgBId: string;

let subAId: string;
let subBId: string;
let subClinicAId: string;
let subClinicBId: string;

describeIfLive('Phase 14 Plan 01 — Stripe RLS cross-tenant impersonation proof', () => {
  beforeAll(async () => {
    admin = createClient(URL!, SERVICE!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const ts = Date.now();
    userAEmail = `sub-imp-a-${ts}@leanshot.test`;
    userBEmail = `sub-imp-b-${ts}@leanshot.test`;
    userAPassword = `Pass1234-${crypto.randomUUID().slice(0, 8)}`;
    userBPassword = `Pass1234-${crypto.randomUUID().slice(0, 8)}`;

    // --- Create 2 users ---
    const { data: aRes, error: aErr } = await admin.auth.admin.createUser({
      email: userAEmail, password: userAPassword, email_confirm: true,
    });
    if (aErr) throw new Error(`createUser A: ${aErr.message}`);
    userAId = aRes.user!.id;

    const { data: bRes, error: bErr } = await admin.auth.admin.createUser({
      email: userBEmail, password: userBPassword, email_confirm: true,
    });
    if (bErr) throw new Error(`createUser B: ${bErr.message}`);
    userBId = bRes.user!.id;

    // --- Create 2 orgs (one per user) via authenticated clients ---
    // User A signs in and creates their org via create_org RPC.
    const clientA = createClient(URL!, ANON!, {
      auth: { autoRefreshToken: false, persistSession: false, storageKey: 'sub-impersonation-a' },
    });
    const { error: signInAErr } = await clientA.auth.signInWithPassword({
      email: userAEmail, password: userAPassword,
    });
    if (signInAErr) throw new Error(`signIn A: ${signInAErr.message}`);

    const slugA = `sub-imp-a-${ts.toString(36)}`;
    const { data: orgAData, error: orgAErr } = await clientA.rpc('create_org', {
      p_name: 'Sub Imp Org A', p_slug: slugA, p_description: null, p_website_url: null,
    });
    if (orgAErr) throw new Error(`create_org A: ${orgAErr.message}`);
    orgAId = (orgAData as Array<{ org_id: string }>)[0]!.org_id;

    const clientB = createClient(URL!, ANON!, {
      auth: { autoRefreshToken: false, persistSession: false, storageKey: 'sub-impersonation-b' },
    });
    const { error: signInBErr } = await clientB.auth.signInWithPassword({
      email: userBEmail, password: userBPassword,
    });
    if (signInBErr) throw new Error(`signIn B: ${signInBErr.message}`);

    const slugB = `sub-imp-b-${ts.toString(36)}`;
    const { data: orgBData, error: orgBErr } = await clientB.rpc('create_org', {
      p_name: 'Sub Imp Org B', p_slug: slugB, p_description: null, p_website_url: null,
    });
    if (orgBErr) throw new Error(`create_org B: ${orgBErr.message}`);
    orgBId = (orgBData as Array<{ org_id: string }>)[0]!.org_id;

    // --- Seed stripe_customers rows (1 per user) via service-role ---
    subAId = `sub_test_user_a_${ts}`;
    subBId = `sub_test_user_b_${ts}`;
    subClinicAId = `sub_test_clinic_a_${ts}`;
    subClinicBId = `sub_test_clinic_b_${ts}`;

    const { error: scAErr } = await admin.from('stripe_customers').insert({
      user_id: userAId,
      stripe_customer_id: `cus_test_a_${ts}`,
    });
    if (scAErr) throw new Error(`insert stripe_customers A: ${scAErr.message}`);

    const { error: scBErr } = await admin.from('stripe_customers').insert({
      user_id: userBId,
      stripe_customer_id: `cus_test_b_${ts}`,
    });
    if (scBErr) throw new Error(`insert stripe_customers B: ${scBErr.message}`);

    // --- Seed clinic_stripe_customers (1 per org) ---
    const { error: cscAErr } = await admin.from('clinic_stripe_customers').insert({
      clinic_id: orgAId,
      stripe_customer_id: `cus_test_org_a_${ts}`,
    });
    if (cscAErr) throw new Error(`insert clinic_stripe_customers A: ${cscAErr.message}`);

    const { error: cscBErr } = await admin.from('clinic_stripe_customers').insert({
      clinic_id: orgBId,
      stripe_customer_id: `cus_test_org_b_${ts}`,
    });
    if (cscBErr) throw new Error(`insert clinic_stripe_customers B: ${cscBErr.message}`);

    // --- Seed user-tier subscriptions (1 per user) ---
    const { error: subAErr } = await admin.from('subscriptions').insert({
      id: subAId,
      provider: 'stripe',
      user_id: userAId,
      clinic_id: null,
      stripe_customer_id: `cus_test_a_${ts}`,
      status: 'active',
      ux_tier: 'paid',
      plan_id: 'price_test',
      current_period_end: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    });
    if (subAErr) throw new Error(`insert subscriptions A: ${subAErr.message}`);

    const { error: subBErr } = await admin.from('subscriptions').insert({
      id: subBId,
      provider: 'stripe',
      user_id: userBId,
      clinic_id: null,
      stripe_customer_id: `cus_test_b_${ts}`,
      status: 'active',
      ux_tier: 'paid',
      plan_id: 'price_test',
      current_period_end: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    });
    if (subBErr) throw new Error(`insert subscriptions B: ${subBErr.message}`);

    // --- Seed clinic-tier subscriptions (1 per org) ---
    const { error: subClinicAErr } = await admin.from('subscriptions').insert({
      id: subClinicAId,
      provider: 'stripe',
      user_id: null,
      clinic_id: orgAId,
      stripe_customer_id: `cus_test_org_a_${ts}`,
      status: 'active',
      ux_tier: 'paid',
      plan_id: 'price_test_clinic',
      current_period_end: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    });
    if (subClinicAErr) throw new Error(`insert subscriptions clinic A: ${subClinicAErr.message}`);

    const { error: subClinicBErr } = await admin.from('subscriptions').insert({
      id: subClinicBId,
      provider: 'stripe',
      user_id: null,
      clinic_id: orgBId,
      stripe_customer_id: `cus_test_org_b_${ts}`,
      status: 'active',
      ux_tier: 'paid',
      plan_id: 'price_test_clinic',
      current_period_end: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    });
    if (subClinicBErr) throw new Error(`insert subscriptions clinic B: ${subClinicBErr.message}`);
  }, 120_000);

  afterAll(async () => {
    if (!admin) return;
    // Best-effort cleanup — order matters for FK constraints.
    try { await admin.from('subscriptions').delete().in('id', [subAId, subBId, subClinicAId, subClinicBId]); } catch { /* best-effort */ }
    try { await admin.from('stripe_customers').delete().in('user_id', [userAId, userBId]); } catch { /* best-effort */ }
    try { await admin.from('clinic_stripe_customers').delete().in('clinic_id', [orgAId, orgBId]); } catch { /* best-effort */ }
    // delete_org cascade-removes memberships; auth user cascade removes injections etc.
    try { await admin.from('orgs').delete().in('id', [orgAId, orgBId]); } catch { /* best-effort */ }
    if (userAId) { try { await admin.auth.admin.deleteUser(userAId); } catch { /* best-effort */ } }
    if (userBId) { try { await admin.auth.admin.deleteUser(userBId); } catch { /* best-effort */ } }
  }, 60_000);

  // ---------------------------------------------------------------------------
  // T-14-01: subscriptions (user-tier) — User A cannot read User B's row
  // ---------------------------------------------------------------------------
  it('T-14-01: User A cannot read User B user-tier subscription (subscriptions RLS)', async () => {
    const clientA = createClient(URL!, ANON!, {
      auth: { autoRefreshToken: false, persistSession: false, storageKey: 'sub-imp-t01-a' },
    });
    await clientA.auth.signInWithPassword({ email: userAEmail, password: userAPassword });

    const { data, error } = await clientA
      .from('subscriptions')
      .select('id')
      .eq('id', subBId);

    expect(error).toBeNull();
    expect(data).toHaveLength(0);
  }, 30_000);

  // ---------------------------------------------------------------------------
  // T-14-02: subscriptions (clinic-tier) — Clinic A Owner cannot read Clinic B's row
  // ---------------------------------------------------------------------------
  it('T-14-02: Clinic A Owner cannot read Clinic B clinic-tier subscription (subscriptions RLS)', async () => {
    const clientA = createClient(URL!, ANON!, {
      auth: { autoRefreshToken: false, persistSession: false, storageKey: 'sub-imp-t02-a' },
    });
    await clientA.auth.signInWithPassword({ email: userAEmail, password: userAPassword });

    // User A is the Owner of orgA — verify they cannot read orgB's clinic subscription.
    const { data, error } = await clientA
      .from('subscriptions')
      .select('id')
      .eq('id', subClinicBId);

    expect(error).toBeNull();
    expect(data).toHaveLength(0);
  }, 30_000);

  // ---------------------------------------------------------------------------
  // T-14-03: stripe_customers — User A cannot read User B's stripe customer row
  // ---------------------------------------------------------------------------
  it('T-14-03: User A cannot read User B stripe_customers row', async () => {
    const clientA = createClient(URL!, ANON!, {
      auth: { autoRefreshToken: false, persistSession: false, storageKey: 'sub-imp-t03-a' },
    });
    await clientA.auth.signInWithPassword({ email: userAEmail, password: userAPassword });

    const { data, error } = await clientA
      .from('stripe_customers')
      .select('user_id')
      .eq('user_id', userBId);

    expect(error).toBeNull();
    expect(data).toHaveLength(0);
  }, 30_000);

  // ---------------------------------------------------------------------------
  // T-14-04: clinic_stripe_customers — Clinic A Owner cannot read Clinic B's row
  // ---------------------------------------------------------------------------
  it('T-14-04: Clinic A Owner cannot read Clinic B clinic_stripe_customers row', async () => {
    const clientA = createClient(URL!, ANON!, {
      auth: { autoRefreshToken: false, persistSession: false, storageKey: 'sub-imp-t04-a' },
    });
    await clientA.auth.signInWithPassword({ email: userAEmail, password: userAPassword });

    const { data, error } = await clientA
      .from('clinic_stripe_customers')
      .select('clinic_id')
      .eq('clinic_id', orgBId);

    expect(error).toBeNull();
    expect(data).toHaveLength(0);
  }, 30_000);
});

// ---------------------------------------------------------------------------
// Gating test — always passes, warns when skipped
// ---------------------------------------------------------------------------
describe('Phase 14 RLS subscriptions — gating', () => {
  it('runs against live cloud DB when SUPABASE_SERVICE_ROLE_KEY is set', () => {
    if (!SHOULD_RUN) {
      // eslint-disable-next-line no-console
      console.warn(
        '[subscriptions-impersonation.test] SKIPPED — SUPABASE_SERVICE_ROLE_KEY (or URL/ANON) not set. Wave verification gates this.',
      );
    }
    expect(true).toBe(true);
  });
});
