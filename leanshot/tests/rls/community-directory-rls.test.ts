/**
 * Phase 45 Plan 01 — Community directory RLS: two-mode visibility + cross-tenant proof.
 *
 * REQUIRES: supabase db push --linked completed (plan 45-09 close-out).
 *
 * Verifies, against the live cloud DB (ytnsipxxmzgaebkqmokp), that:
 *
 *   T-45-01 / COMMUNITY-08 (cross-tenant clinic-org isolation):
 *     Two clinic-org users in DIFFERENT orgs, both opted-in to the directory,
 *     CANNOT see each other's profile rows (RLS hides the row silently, 0 rows).
 *
 *   D-02 two-mode positive proof (consumer):
 *     A consumer user (no org_members rows) opted-in to the directory IS visible
 *     to both clinic-org users — consumer profiles are community-wide.
 *
 *   Privacy default proof:
 *     A profile with directory_opt_in=false is NEVER visible via the
 *     directory_members_select policy (0 rows from any caller).
 *
 * Pattern follows community-spaces-rls.test.ts (Phase 44):
 *   - admin createClient with service_role key for setup/teardown
 *   - getUserAccessToken (admin.generateLink + /auth/v1/verify) per
 *     reference_rls_fixture_gotrueclient_flake
 *   - file-scoped TEST_SLUG_PREFIX per feedback_rls_per_file_slug_prefix
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
const TEST_SLUG_PREFIX = `p45_${new URL(import.meta.url).pathname.split('/').pop()}_${Date.now()}`;

const describeIfLive = SHOULD_RUN ? describe : describe.skip;

let admin: SupabaseClient;
let clinicAUser: TestUser;
let clinicBUser: TestUser;
let consumerUser: TestUser;
let optedOutUser: TestUser;
let orgAId: string;
let orgBId: string;

describeIfLive('Phase 45 Plan 01 — directory RLS: cross-tenant + two-mode visibility', () => {
  beforeAll(async () => {
    admin = buildAdmin();
    const ts = Date.now();

    // Create two orgs.
    const { data: orgA, error: orgAErr } = await admin
      .from('organizations')
      .insert({ name: `${TEST_SLUG_PREFIX}-org-a`, slug: `${TEST_SLUG_PREFIX}-a` })
      .select('id')
      .single();
    if (orgAErr) throw new Error(`create org A: ${orgAErr.message}`);
    orgAId = (orgA as { id: string }).id;

    const { data: orgB, error: orgBErr } = await admin
      .from('organizations')
      .insert({ name: `${TEST_SLUG_PREFIX}-org-b`, slug: `${TEST_SLUG_PREFIX}-b` })
      .select('id')
      .single();
    if (orgBErr) throw new Error(`create org B: ${orgBErr.message}`);
    orgBId = (orgB as { id: string }).id;

    // Two clinic-org users in different orgs.
    clinicAUser = await createOrgScopedUser(
      admin,
      `${TEST_SLUG_PREFIX}-clinic-a-${ts}@leanshot.test`,
      orgAId,
    );
    clinicBUser = await createOrgScopedUser(
      admin,
      `${TEST_SLUG_PREFIX}-clinic-b-${ts}@leanshot.test`,
      orgBId,
    );
    // Consumer user — NO org_members row.
    consumerUser = await createOrgScopedUser(
      admin,
      `${TEST_SLUG_PREFIX}-consumer-${ts}@leanshot.test`,
    );
    // Opted-out user — never visible regardless of caller.
    optedOutUser = await createOrgScopedUser(
      admin,
      `${TEST_SLUG_PREFIX}-optedout-${ts}@leanshot.test`,
    );

    // Opt the first three into the directory; leave optedOutUser at default (false).
    const { error: optErr } = await admin
      .from('profiles')
      .update({ directory_opt_in: true })
      .in('id', [clinicAUser.id, clinicBUser.id, consumerUser.id]);
    if (optErr) throw new Error(`opt-in update: ${optErr.message}`);
  }, 120_000);

  afterAll(async () => {
    if (!admin) return;
    const userIds = [clinicAUser?.id, clinicBUser?.id, consumerUser?.id, optedOutUser?.id]
      .filter(Boolean) as string[];
    try { await admin.from('org_members').delete().in('user_id', userIds); } catch { /* best-effort */ }
    try { await admin.from('organizations').delete().in('id', [orgAId, orgBId].filter(Boolean) as string[]); } catch { /* best-effort */ }
    for (const id of userIds) {
      try { await admin.auth.admin.deleteUser(id); } catch { /* best-effort */ }
    }
  }, 60_000);

  // ---------------------------------------------------------------------------
  // T-45-01 cross-tenant impersonation proof (PROJECT RULE 2)
  // ---------------------------------------------------------------------------

  it('Clinic-org A user CANNOT see Clinic-org B user via directory (different orgs)', async () => {
    const tokenA = await clinicAUser.accessToken();
    const clientA = buildAnonClient(`${TEST_SLUG_PREFIX}-xtenant-a`);

    const { data, error } = await clientA
      .from('profiles')
      .select('id')
      .eq('id', clinicBUser.id)
      .setHeader('Authorization', `Bearer ${tokenA}`);

    expect(error).toBeNull();
    // RLS hides clinic-org-private directory entry from cross-tenant caller (0 rows).
    expect(data ?? []).toHaveLength(0);
  }, 30_000);

  // ---------------------------------------------------------------------------
  // D-02 positive proof: consumer (no org) visible to clinic-org users
  // ---------------------------------------------------------------------------

  it('Consumer (no org) IS visible to clinic-org users (community-wide mode)', async () => {
    const tokenA = await clinicAUser.accessToken();
    const clientA = buildAnonClient(`${TEST_SLUG_PREFIX}-consumer-vis-a`);

    const { data, error } = await clientA
      .from('profiles')
      .select('id')
      .eq('id', consumerUser.id)
      .setHeader('Authorization', `Bearer ${tokenA}`);

    expect(error).toBeNull();
    expect(data ?? []).toHaveLength(1);
  }, 30_000);

  // ---------------------------------------------------------------------------
  // Privacy default: directory_opt_in=false hides the row entirely
  // ---------------------------------------------------------------------------

  it('Opted-out user is NOT visible via directory policy (privacy default)', async () => {
    const tokenConsumer = await consumerUser.accessToken();
    const client = buildAnonClient(`${TEST_SLUG_PREFIX}-optedout`);

    const { data, error } = await client
      .from('profiles')
      .select('id')
      .eq('id', optedOutUser.id)
      .setHeader('Authorization', `Bearer ${tokenConsumer}`);

    expect(error).toBeNull();
    expect(data ?? []).toHaveLength(0);
  }, 30_000);
});
