/**
 * Phase 44 Plan 01 — Community Spaces RLS: cross-tenant isolation + global-space visibility.
 *
 * REQUIRES: supabase db push --linked completed (Wave 3 plan 44-10)
 *
 * Verifies, against the live cloud DB (ytnsipxxmzgaebkqmokp), that:
 *
 *   T-44-01 / COMMUNITY-06 (cross-tenant org-private space):
 *     User A in org_A CANNOT read community_spaces rows owned by org_B.
 *     SELECT returns 0 rows (not 403) — RLS hides the row silently.
 *     This proves D-09: non-org users cannot probe org-private space existence.
 *
 *   Sanity check (global space visible to all):
 *     A global space (org_id IS NULL) is visible to both User A and User B.
 *     This confirms the cspace_select_global policy fires correctly.
 *
 * Pattern follows notification-settings-rls.test.ts (Phase 42):
 *   - admin createClient with service_role key for setup/teardown
 *   - getUserAccessToken (admin.generateLink + /auth/v1/verify) per
 *     reference_rls_fixture_gotrueclient_flake (NOT signInWithPassword)
 *   - file-scoped TEST_SLUG_PREFIX per feedback_rls_per_file_slug_prefix
 *
 * Environment:
 *   SUPABASE_URL              — public
 *   SUPABASE_ANON_KEY         — public
 *   SUPABASE_SERVICE_ROLE_KEY — PRIVATE (CI secret)
 *
 * Self-skips when any required env var is absent.
 */

import { type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  buildAdmin,
  buildAnonClient,
  createOrgScopedUser,
  SHOULD_RUN,
  type TestUser,
} from './fixtures-community';

// ---------------------------------------------------------------------------
// File-scoped slug prefix — unique per file per feedback_rls_per_file_slug_prefix
// ---------------------------------------------------------------------------
const TEST_SLUG_PREFIX = `p44_${new URL(import.meta.url).pathname.split('/').pop()}_${Date.now()}`;

const describeIfLive = SHOULD_RUN ? describe : describe.skip;

// ---------------------------------------------------------------------------
// Module-level state
// ---------------------------------------------------------------------------

let admin: SupabaseClient;
let userA: TestUser;
let userB: TestUser;
let orgAId: string;
let orgBId: string;
let spaceBId: string;   // org-private space belonging to org_B
let globalSpaceId: string; // global space (org_id IS NULL)

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describeIfLive('Phase 44 Plan 01 — Community Spaces RLS: cross-tenant isolation', () => {
  beforeAll(async () => {
    admin = buildAdmin();
    const ts = Date.now();

    // Create org_A and org_B via service-role direct insert
    const { data: orgAData, error: orgAErr } = await admin
      .from('organizations')
      .insert({ name: `${TEST_SLUG_PREFIX}-org-a`, slug: `${TEST_SLUG_PREFIX}-a` })
      .select('id')
      .single();
    if (orgAErr) throw new Error(`create org_A: ${orgAErr.message}`);
    orgAId = (orgAData as { id: string }).id;

    const { data: orgBData, error: orgBErr } = await admin
      .from('organizations')
      .insert({ name: `${TEST_SLUG_PREFIX}-org-b`, slug: `${TEST_SLUG_PREFIX}-b` })
      .select('id')
      .single();
    if (orgBErr) throw new Error(`create org_B: ${orgBErr.message}`);
    orgBId = (orgBData as { id: string }).id;

    // Create User A (member of org_A) and User B (member of org_B)
    userA = await createOrgScopedUser(
      admin,
      `${TEST_SLUG_PREFIX}-ua-${ts}@leanshot.test`,
      orgAId,
    );
    userB = await createOrgScopedUser(
      admin,
      `${TEST_SLUG_PREFIX}-ub-${ts}@leanshot.test`,
      orgBId,
    );

    // Create org_B private space
    const { data: spaceBData, error: spaceBErr } = await admin
      .from('community_spaces')
      .insert({
        name: `${TEST_SLUG_PREFIX}-space-b`,
        org_id: orgBId,
        min_tier: 'free',
      })
      .select('id')
      .single();
    if (spaceBErr) throw new Error(`create space_B: ${spaceBErr.message}`);
    spaceBId = (spaceBData as { id: string }).id;

    // Create a global space (org_id IS NULL) — should be visible to all
    const { data: globalData, error: globalErr } = await admin
      .from('community_spaces')
      .insert({
        name: `${TEST_SLUG_PREFIX}-global-space`,
        org_id: null,
        min_tier: 'free',
      })
      .select('id')
      .single();
    if (globalErr) throw new Error(`create global_space: ${globalErr.message}`);
    globalSpaceId = (globalData as { id: string }).id;
  }, 120_000);

  afterAll(async () => {
    if (!admin) return;
    // Best-effort cleanup — order matters for FK constraints
    try { await admin.from('community_spaces').delete().in('id', [spaceBId, globalSpaceId].filter(Boolean)); } catch { /* best-effort */ }
    try { await admin.from('org_members').delete().in('user_id', [userA?.id, userB?.id].filter(Boolean)); } catch { /* best-effort */ }
    try { await admin.from('organizations').delete().in('id', [orgAId, orgBId].filter(Boolean)); } catch { /* best-effort */ }
    if (userA?.id) { try { await admin.auth.admin.deleteUser(userA.id); } catch { /* best-effort */ } }
    if (userB?.id) { try { await admin.auth.admin.deleteUser(userB.id); } catch { /* best-effort */ } }
  }, 60_000);

  // ---------------------------------------------------------------------------
  // T-44-01 / D-09 cross-tenant isolation: User A cannot see org_B space
  // ---------------------------------------------------------------------------

  it("User A in org_A cannot see community_spaces row owned by org_B", async () => {
    const tokenA = await userA.accessToken();
    const clientA = buildAnonClient(`${TEST_SLUG_PREFIX}-cross-tenant-a`);

    const { data, error } = await clientA
      .from('community_spaces')
      .select('id')
      .eq('id', spaceBId)
      .setHeader('Authorization', `Bearer ${tokenA}`);

    expect(error).toBeNull();
    // D-09: RLS hides org-private space entirely for non-org-members (0 rows, not 403)
    expect(data ?? []).toHaveLength(0);
  }, 30_000);

  // ---------------------------------------------------------------------------
  // Sanity: User B can read their own org_B space
  // ---------------------------------------------------------------------------

  it('User B in org_B can read their own org_B private space', async () => {
    const tokenB = await userB.accessToken();
    const clientB = buildAnonClient(`${TEST_SLUG_PREFIX}-own-space-b`);

    const { data, error } = await clientB
      .from('community_spaces')
      .select('id')
      .eq('id', spaceBId)
      .setHeader('Authorization', `Bearer ${tokenB}`);

    expect(error).toBeNull();
    expect(data ?? []).toHaveLength(1);
  }, 30_000);

  // ---------------------------------------------------------------------------
  // Global space (org_id IS NULL) is visible to both users
  // ---------------------------------------------------------------------------

  it('Global space (org_id IS NULL) is visible to both User A and User B', async () => {
    const [tokenA, tokenB] = await Promise.all([
      userA.accessToken(),
      userB.accessToken(),
    ]);

    const clientA = buildAnonClient(`${TEST_SLUG_PREFIX}-global-a`);
    const resA = await clientA
      .from('community_spaces')
      .select('id')
      .eq('id', globalSpaceId)
      .setHeader('Authorization', `Bearer ${tokenA}`);
    expect(resA.error).toBeNull();
    expect(resA.data ?? []).toHaveLength(1);

    const clientB = buildAnonClient(`${TEST_SLUG_PREFIX}-global-b`);
    const resB = await clientB
      .from('community_spaces')
      .select('id')
      .eq('id', globalSpaceId)
      .setHeader('Authorization', `Bearer ${tokenB}`);
    expect(resB.error).toBeNull();
    expect(resB.data ?? []).toHaveLength(1);
  }, 30_000);
});

// ---------------------------------------------------------------------------
// Gating test — always passes, warns when skipped
// ---------------------------------------------------------------------------

describe('Phase 44 community-spaces-rls — gating', () => {
  it('runs against live cloud DB when SUPABASE_SERVICE_ROLE_KEY is set', () => {
    if (!SHOULD_RUN) {
      // eslint-disable-next-line no-console
      console.warn(
        '[community-spaces-rls.test] SKIPPED — SUPABASE_SERVICE_ROLE_KEY (or URL/ANON) not set. Wave 3 plan 44-10 gates this.',
      );
    }
    expect(true).toBe(true);
  });
});

