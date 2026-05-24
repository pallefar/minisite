/**
 * Phase 51 Plan 51-10 Task 1 — Cross-tenant RLS deny proof for the 4 traffic
 * SECDEF accessor RPCs (TRAFFIC-10).
 *
 * REQUIRES (close-out gate, OPERATOR-DRIVEN per Plan 51-10 Task 4 + memory
 * `feedback_autonomous_false_close_out_partial_execution`):
 *
 *   - `supabase db push --linked` against the 15 Phase 51 migrations
 *     (20271102000001..20271102000015). The autonomous executor that built
 *     this file does NOT push migrations or deploy Edge Fns — see
 *     `51-CARRY-OVER.md` for the operator runbook + S4 resume token
 *     (`approved:S4`) covering this test.
 *
 *   - Env vars (live linked project ytnsipxxmzgaebkqmokp):
 *       SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY.
 *
 * Behavior under test (per PLAN 51-10 Task 1 §rls + plan signal S4):
 *
 *   The 4 SECDEF accessors land in migration 20271102000012:
 *     - `public.get_traffic_channel_rollup(p_org_id, p_start_date, p_end_date, p_touch_mode)`
 *     - `public.get_traffic_funnel_rollup(p_org_id, p_start_date, p_end_date, p_audience)`
 *     - `public.get_traffic_landing_page_rollup(p_org_id, p_start_date, p_end_date, p_audience, p_top_n)`
 *   And in migration 20271102000011:
 *     - `public.get_realtime_traffic_summary(p_minutes, p_org_id)`
 *
 *   All four authorize via:
 *     - `public.is_admin_at_least('admin'::public.admin_role)`   → all orgs OR specific org
 *     - `public._is_org_clinician(p_org_id, auth.uid())`         → only their org
 *     - else                                                       → raise 42501 forbidden
 *
 *   Cross-tenant test fixture:
 *     1. Two orgs (A + B) with one clinician each (U_A and U_B). U_A is
 *        seeded as `org_members(role='clinician')` in org A only.
 *     2. Two `user_traffic_attribution` rows (one per org) where the
 *        first_touch_channel_group != last_touch_channel_group (B4 D-02
 *        touch-mode toggle proof).
 *     3. U_A reads org A → rows returned (positive proof; same accessor
 *        works in the legitimate path).
 *     4. U_A reads org B → 42501 forbidden (cross-tenant deny).
 *     5. With p_touch_mode='first' the returned rows tag the FIRST-TOUCH
 *        channel_group; with p_touch_mode='last' the returned rows tag
 *        the LAST-TOUCH channel_group — proving the toggle actually moves
 *        data through the matview_first vs matview branch.
 *
 *   D-02 first/last-touch differentiation IS the signal that the matview
 *   twin is wired (channel_rollup_first); a `defer:S4` decision in the
 *   operator runbook explicitly notes that without this assertion the
 *   toggle could be a UI no-op shipping the same rows from a single
 *   matview.
 *
 * Skip semantics:
 *
 *   - When `SUPABASE_URL` + `SUPABASE_ANON_KEY` + `SUPABASE_SERVICE_ROLE_KEY`
 *     are not all present, the suite skips (`describe.skip`) so CI green
 *     stays clean for unit-only test runs. The operator runs this against
 *     the linked project after `supabase db push --linked` succeeds
 *     (Plan 51-10 Task 4 carry-over runbook, signal S4).
 *
 *   - When the 4 SECDEF accessor RPCs are not yet deployed (db push
 *     pending), every RPC call fails with `function does not exist`
 *     (42883) — the test surfaces this as an explicit failure with a
 *     deploy-pending hint, NOT a silent skip. This matches the memory
 *     `reference_supabase_back_dated_migration_blocks_push` posture: the
 *     close-out gate is the operator dispositioning S1/S4 together.
 *
 * Pattern references:
 *   - `reference_rls_fixture_gotrueclient_flake` (admin.generateLink +
 *     /auth/v1/verify pattern, NOT supabase-js signInWithPassword).
 *   - `feedback_rls_per_file_slug_prefix` (file-scoped slug prefix).
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { getUserAccessToken } from './helpers/admin-session';

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? '';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY ?? '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

const SHOULD_RUN = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY && SUPABASE_SERVICE_ROLE_KEY);
const describeIfLive = SHOULD_RUN ? describe : describe.skip;

const TEST_SLUG_PREFIX = `p51_traf_${Date.now()}`;

interface TestUser {
  id: string;
  email: string;
  accessToken: () => Promise<string>;
}

interface TestOrg {
  id: string;
  slug: string;
}

let admin: SupabaseClient;
let orgA: TestOrg;
let orgB: TestOrg;
let userA: TestUser;
let userB: TestUser;

function buildAdmin(): SupabaseClient {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

/**
 * Build a PostgREST-only Supabase client bound to a user-context JWT —
 * RPC calls flow through this client are subject to RLS as that user.
 */
function buildUserClient(token: string, storageKey: string): SupabaseClient {
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false, storageKey },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
}

async function createOrgWithClinician(
  adminClient: SupabaseClient,
  slugPrefix: string,
  ownerEmail: string,
): Promise<{ org: TestOrg; user: TestUser }> {
  // 1. Create the owner user — needed for orgs.owner_user_id FK.
  const { data: userData, error: userErr } = await adminClient.auth.admin.createUser({
    email: ownerEmail,
    password: `Pass1234-${crypto.randomUUID().slice(0, 8)}`,
    email_confirm: true,
  });
  if (userErr) throw new Error(`createUser ${ownerEmail}: ${userErr.message}`);
  const userId = userData.user!.id;

  // 2. Create the org with the user as owner.
  const slug = `${slugPrefix}-${crypto.randomUUID().slice(0, 6)}`.toLowerCase();
  const { data: orgData, error: orgErr } = await adminClient
    .from('orgs')
    .insert({ slug, name: `Test Org ${slug}`, owner_user_id: userId })
    .select('id, slug')
    .single();
  if (orgErr) throw new Error(`orgs insert ${slug}: ${orgErr.message}`);
  const org: TestOrg = { id: (orgData as { id: string }).id, slug: (orgData as { slug: string }).slug };

  // 3. Seed org_members row with role='clinician' so `_is_org_clinician`
  //    returns TRUE for this user against this org. (role is one of
  //    'owner' | 'clinician' per the SECDEF helper body — see
  //    `supabase/migrations/20270601300100_p31_00_enum_rename_and_secdef_ripple.sql`.)
  const { error: omErr } = await adminClient.from('org_members').insert({
    org_id: org.id,
    user_id: userId,
    role: 'clinician',
  });
  if (omErr) throw new Error(`org_members insert ${ownerEmail}: ${omErr.message}`);

  return {
    org,
    user: { id: userId, email: ownerEmail, accessToken: () => getUserAccessToken(ownerEmail) },
  };
}

/**
 * Seed a user_traffic_attribution row with DIFFERENT first/last touch
 * channel groups so the B4 D-02 toggle assertion has something to prove.
 */
async function seedAttributionRow(
  adminClient: SupabaseClient,
  args: {
    anonId: string;
    orgId: string;
    firstChannel: string;
    lastChannel: string;
  },
): Promise<void> {
  const now = new Date().toISOString();
  const { error } = await adminClient.from('user_traffic_attribution').insert({
    anon_id: args.anonId,
    org_id: args.orgId,
    first_touch_source: 'google',
    first_touch_medium: 'organic',
    first_touch_referrer: 'https://google.com/',
    first_touch_landing_path: '/pricing',
    first_touch_channel_group: args.firstChannel,
    first_touch_at: now,
    last_touch_source: 'facebook',
    last_touch_medium: 'paid',
    last_touch_referrer: 'https://facebook.com/',
    last_touch_landing_path: '/pricing',
    last_touch_channel_group: args.lastChannel,
    last_touch_at: now,
  });
  if (error) throw new Error(`seedAttributionRow ${args.anonId}: ${error.message}`);
}

describeIfLive('Phase 51 Plan 51-10 — Traffic SECDEF accessor cross-tenant RLS (TRAFFIC-10 + D-02 toggle proof)', () => {
  beforeAll(async () => {
    admin = buildAdmin();
    const ts = Date.now();
    const A = await createOrgWithClinician(
      admin,
      `${TEST_SLUG_PREFIX}-a`,
      `${TEST_SLUG_PREFIX}-a-${ts}@leanshot.test`,
    );
    const B = await createOrgWithClinician(
      admin,
      `${TEST_SLUG_PREFIX}-b`,
      `${TEST_SLUG_PREFIX}-b-${ts}@leanshot.test`,
    );
    orgA = A.org;
    orgB = B.org;
    userA = A.user;
    userB = B.user;

    // Two rows, one per org. Different first vs last channel groups so the
    // touch-mode toggle has something to differentiate on (B4 D-02).
    await seedAttributionRow(admin, {
      anonId: `${TEST_SLUG_PREFIX}-anon-a-${ts}`,
      orgId: orgA.id,
      firstChannel: 'Organic Search',
      lastChannel: 'Paid Social',
    });
    await seedAttributionRow(admin, {
      anonId: `${TEST_SLUG_PREFIX}-anon-b-${ts}`,
      orgId: orgB.id,
      firstChannel: 'Direct',
      lastChannel: 'Email',
    });
  }, 120_000);

  afterAll(async () => {
    if (!admin) return;
    const orgIds = [orgA?.id, orgB?.id].filter(Boolean) as string[];
    const userIds = [userA?.id, userB?.id].filter(Boolean) as string[];
    try {
      await admin.from('user_traffic_attribution').delete().in('org_id', orgIds);
    } catch { /* best-effort */ }
    try {
      await admin.from('org_members').delete().in('org_id', orgIds);
    } catch { /* best-effort */ }
    try {
      await admin.from('orgs').delete().in('id', orgIds);
    } catch { /* best-effort */ }
    for (const id of userIds) {
      try { await admin.auth.admin.deleteUser(id); } catch { /* best-effort */ }
    }
  }, 60_000);

  // -------------------------------------------------------------------------
  // get_traffic_channel_rollup — D-02 toggle + cross-tenant deny
  // -------------------------------------------------------------------------

  it('U_A → get_traffic_channel_rollup(p_org_id = orgA, last) returns rows tagged with last_touch_channel_group', async () => {
    const token = await userA.accessToken();
    const client = buildUserClient(token, `${TEST_SLUG_PREFIX}-ua-channel-last`);

    const { data, error } = await client.rpc('get_traffic_channel_rollup', {
      p_org_id: orgA.id,
      p_start_date: null,
      p_end_date: null,
      p_touch_mode: 'last',
    });

    // If the SECDEF RPC is missing (db push pending), surface as a
    // deploy-pending failure rather than a silent pass.
    if (error && /function .* does not exist|42883/i.test(error.message)) {
      throw new Error(
        'RPC public.get_traffic_channel_rollup not deployed — operator must run `supabase db push --linked` per 51-CARRY-OVER.md',
      );
    }
    // U_A is org-clinician in org A — should NOT raise 42501.
    expect(error).toBeNull();
    expect(Array.isArray(data)).toBe(true);
    // Last-touch mode returns rows whose channel_group reflects the LAST
    // touch — Paid Social for orgA's seeded row.
    const channels = (data as Array<{ channel_group: string }> | null ?? []).map((r) => r.channel_group);
    expect(channels).toContain('Paid Social');
    expect(channels).not.toContain('Organic Search');
  });

  it('U_A → get_traffic_channel_rollup(p_org_id = orgA, first) returns rows tagged with first_touch_channel_group (D-02 toggle proof)', async () => {
    const token = await userA.accessToken();
    const client = buildUserClient(token, `${TEST_SLUG_PREFIX}-ua-channel-first`);

    const { data, error } = await client.rpc('get_traffic_channel_rollup', {
      p_org_id: orgA.id,
      p_start_date: null,
      p_end_date: null,
      p_touch_mode: 'first',
    });

    if (error && /function .* does not exist|42883/i.test(error.message)) {
      throw new Error('RPC missing — run `supabase db push --linked` per 51-CARRY-OVER.md');
    }
    expect(error).toBeNull();
    const channels = (data as Array<{ channel_group: string }> | null ?? []).map((r) => r.channel_group);
    // First-touch reads traffic_channel_rollup_first matview twin.
    expect(channels).toContain('Organic Search');
    expect(channels).not.toContain('Paid Social');
  });

  it('U_A → get_traffic_channel_rollup(p_org_id = orgB) raises 42501 (cross-tenant deny)', async () => {
    const token = await userA.accessToken();
    const client = buildUserClient(token, `${TEST_SLUG_PREFIX}-ua-channel-deny`);

    const { data, error } = await client.rpc('get_traffic_channel_rollup', {
      p_org_id: orgB.id,
      p_start_date: null,
      p_end_date: null,
      p_touch_mode: 'last',
    });

    if (error && /function .* does not exist|42883/i.test(error.message)) {
      throw new Error('RPC missing — run `supabase db push --linked` per 51-CARRY-OVER.md');
    }
    expect(data).toBeNull();
    expect(error).not.toBeNull();
    // Postgres '42501' = insufficient_privilege (RLS-style deny).
    expect(error!.code === '42501' || /forbidden|permission denied|insufficient/i.test(error!.message)).toBe(true);
  });

  // -------------------------------------------------------------------------
  // get_traffic_funnel_rollup — cross-tenant deny
  // -------------------------------------------------------------------------

  it('U_A → get_traffic_funnel_rollup(p_org_id = orgB) raises 42501 (cross-tenant deny)', async () => {
    const token = await userA.accessToken();
    const client = buildUserClient(token, `${TEST_SLUG_PREFIX}-ua-funnel-deny`);

    const { data, error } = await client.rpc('get_traffic_funnel_rollup', {
      p_org_id: orgB.id,
      p_start_date: null,
      p_end_date: null,
      p_audience: null,
    });

    if (error && /function .* does not exist|42883/i.test(error.message)) {
      throw new Error('RPC missing — run `supabase db push --linked` per 51-CARRY-OVER.md');
    }
    expect(data).toBeNull();
    expect(error).not.toBeNull();
    expect(error!.code === '42501' || /forbidden|permission denied|insufficient/i.test(error!.message)).toBe(true);
  });

  // -------------------------------------------------------------------------
  // get_traffic_landing_page_rollup — cross-tenant deny
  // -------------------------------------------------------------------------

  it('U_A → get_traffic_landing_page_rollup(p_org_id = orgB) raises 42501 (cross-tenant deny)', async () => {
    const token = await userA.accessToken();
    const client = buildUserClient(token, `${TEST_SLUG_PREFIX}-ua-landing-deny`);

    const { data, error } = await client.rpc('get_traffic_landing_page_rollup', {
      p_org_id: orgB.id,
      p_start_date: null,
      p_end_date: null,
      p_audience: null,
      p_top_n: 50,
    });

    if (error && /function .* does not exist|42883/i.test(error.message)) {
      throw new Error('RPC missing — run `supabase db push --linked` per 51-CARRY-OVER.md');
    }
    expect(data).toBeNull();
    expect(error).not.toBeNull();
    expect(error!.code === '42501' || /forbidden|permission denied|insufficient/i.test(error!.message)).toBe(true);
  });

  // -------------------------------------------------------------------------
  // get_realtime_traffic_summary — cross-tenant deny
  // -------------------------------------------------------------------------

  it('U_A → get_realtime_traffic_summary(p_org_id = orgB) raises 42501 (cross-tenant deny)', async () => {
    const token = await userA.accessToken();
    const client = buildUserClient(token, `${TEST_SLUG_PREFIX}-ua-realtime-deny`);

    const { data, error } = await client.rpc('get_realtime_traffic_summary', {
      p_minutes: 60,
      p_org_id: orgB.id,
    });

    if (error && /function .* does not exist|42883/i.test(error.message)) {
      throw new Error('RPC missing — run `supabase db push --linked` per 51-CARRY-OVER.md');
    }
    expect(data).toBeNull();
    expect(error).not.toBeNull();
    expect(error!.code === '42501' || /forbidden|permission denied|insufficient/i.test(error!.message)).toBe(true);
  });

  // -------------------------------------------------------------------------
  // anon role deny (no JWT) — sanity invariant
  // -------------------------------------------------------------------------

  it('Anonymous (no JWT) → all 4 RPCs raise 28000 unauthenticated', async () => {
    const anonClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { autoRefreshToken: false, persistSession: false, storageKey: `${TEST_SLUG_PREFIX}-anon` },
    });

    for (const rpc of [
      { name: 'get_traffic_channel_rollup',      args: { p_org_id: orgA.id, p_touch_mode: 'last' } },
      { name: 'get_traffic_funnel_rollup',       args: { p_org_id: orgA.id } },
      { name: 'get_traffic_landing_page_rollup', args: { p_org_id: orgA.id, p_top_n: 10 } },
      { name: 'get_realtime_traffic_summary',    args: { p_minutes: 60, p_org_id: orgA.id } },
    ]) {
      const { error } = await anonClient.rpc(rpc.name, rpc.args);
      if (error && /function .* does not exist|42883/i.test(error.message)) {
        throw new Error(`RPC ${rpc.name} missing — run \`supabase db push --linked\` per 51-CARRY-OVER.md`);
      }
      expect(error, `anon ${rpc.name} must error`).not.toBeNull();
    }
  });
});
