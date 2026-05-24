/**
 * Phase 45 Plan 01 — community_reports RLS: write-only consumer + staff-read-via-digest.
 *
 * REQUIRES: supabase db push --linked completed (plan 45-09 close-out).
 *
 * Verifies, against the live cloud DB (ytnsipxxmzgaebkqmokp), that:
 *
 *   D-11 write-only consumer:
 *     A consumer user can INSERT a community_reports row (reporter_user_id = self).
 *     A consumer user SELECT on community_reports returns 0 rows (RLS hides own row).
 *
 *   Staff read-via-digest:
 *     A user with profiles.is_staff = true can SELECT the consumer's report row
 *     (community_reports_select_staff fires via public.is_staff()).
 *
 *   Reporter spoof prevention:
 *     A consumer cannot INSERT with reporter_user_id pointing at a different user
 *     (RLS WITH CHECK fires, 42501 / row-level security).
 *
 * Pattern: file-scoped slug + admin.generateLink + /auth/v1/verify per
 * reference_rls_fixture_gotrueclient_flake.
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

const TEST_SLUG_PREFIX = `p45_${new URL(import.meta.url).pathname.split('/').pop()}_${Date.now()}`;

const describeIfLive = SHOULD_RUN ? describe : describe.skip;

let admin: SupabaseClient;
let consumerUser: TestUser;
let staffUser: TestUser;
let targetUser: TestUser; // a dummy profile we'll "report"
let insertedReportId: string | null = null;

describeIfLive('Phase 45 Plan 01 — community_reports RLS: write-only consumer + staff read', () => {
  beforeAll(async () => {
    admin = buildAdmin();
    const ts = Date.now();

    consumerUser = await createOrgScopedUser(admin, `${TEST_SLUG_PREFIX}-consumer-${ts}@leanshot.test`);
    staffUser    = await createOrgScopedUser(admin, `${TEST_SLUG_PREFIX}-staff-${ts}@leanshot.test`);
    targetUser   = await createOrgScopedUser(admin, `${TEST_SLUG_PREFIX}-target-${ts}@leanshot.test`);

    // Flip staffUser's profiles.is_staff to true (consumed by public.is_staff()).
    const { error: staffErr } = await admin
      .from('profiles')
      .update({ is_staff: true })
      .eq('id', staffUser.id);
    if (staffErr) throw new Error(`set is_staff: ${staffErr.message}`);
  }, 120_000);

  afterAll(async () => {
    if (!admin) return;
    const userIds = [consumerUser?.id, staffUser?.id, targetUser?.id].filter(Boolean) as string[];
    try { await admin.from('community_reports').delete().in('reporter_user_id', userIds); } catch { /* best-effort */ }
    for (const id of userIds) {
      try { await admin.auth.admin.deleteUser(id); } catch { /* best-effort */ }
    }
  }, 60_000);

  // -------------------------------------------------------------------------
  // D-11: consumer INSERT works (reporter_user_id = self)
  // -------------------------------------------------------------------------

  it('Consumer CAN INSERT community_reports with reporter_user_id = self', async () => {
    const tokenConsumer = await consumerUser.accessToken();
    const client = buildAnonClient(`${TEST_SLUG_PREFIX}-insert-self`);

    const { data, error } = await client
      .from('community_reports')
      .insert({
        reporter_user_id: consumerUser.id,
        target_type: 'profile',
        target_id: targetUser.id,
        reason: 'p45 RLS test — write-only proof',
      })
      .select('id')
      .single()
      .setHeader('Authorization', `Bearer ${tokenConsumer}`);

    expect(error).toBeNull();
    expect(data?.id).toBeTruthy();
    insertedReportId = (data as { id: string }).id;
  }, 30_000);

  // -------------------------------------------------------------------------
  // D-11: consumer SELECT returns 0 (own row hidden — write-only)
  // -------------------------------------------------------------------------

  it('Consumer SELECT on community_reports returns 0 rows (RLS hides own row)', async () => {
    const tokenConsumer = await consumerUser.accessToken();
    const client = buildAnonClient(`${TEST_SLUG_PREFIX}-select-consumer`);

    const { data, error } = await client
      .from('community_reports')
      .select('id')
      .setHeader('Authorization', `Bearer ${tokenConsumer}`);

    expect(error).toBeNull();
    expect(data ?? []).toHaveLength(0);
  }, 30_000);

  // -------------------------------------------------------------------------
  // Staff CAN SELECT consumer reports (digest path)
  // -------------------------------------------------------------------------

  it('Staff user CAN SELECT the consumer report (community_reports_select_staff fires)', async () => {
    const tokenStaff = await staffUser.accessToken();
    const client = buildAnonClient(`${TEST_SLUG_PREFIX}-select-staff`);

    const { data, error } = await client
      .from('community_reports')
      .select('id, reporter_user_id, target_type, target_id')
      .eq('id', insertedReportId!)
      .setHeader('Authorization', `Bearer ${tokenStaff}`);

    expect(error).toBeNull();
    expect(data ?? []).toHaveLength(1);
  }, 30_000);

  // -------------------------------------------------------------------------
  // Reporter spoof prevention: cannot INSERT with reporter_user_id != self
  // -------------------------------------------------------------------------

  it('Consumer CANNOT INSERT community_reports with reporter_user_id of a different user', async () => {
    const tokenConsumer = await consumerUser.accessToken();
    const client = buildAnonClient(`${TEST_SLUG_PREFIX}-spoof`);

    const { error } = await client
      .from('community_reports')
      .insert({
        reporter_user_id: staffUser.id, // spoofed identity
        target_type: 'profile',
        target_id: targetUser.id,
        reason: 'p45 RLS test — spoof attempt',
      })
      .setHeader('Authorization', `Bearer ${tokenConsumer}`);

    expect(error).not.toBeNull();
    expect(error?.code === '42501' || /row-level security/i.test(error?.message ?? '')).toBe(true);
  }, 30_000);
});
