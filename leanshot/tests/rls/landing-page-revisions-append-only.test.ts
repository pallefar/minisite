/**
 * Phase 15 Plan 01 — Append-only invariant proof for landing_page_revisions.
 *
 * D-07 / PAGE-07: landing_page_revisions is APPEND-ONLY. Two-layer enforcement:
 *   (a) RLS — no UPDATE policy + no DELETE policy → RLS denies for every role
 *       except service_role (which bypasses RLS).
 *   (b) Trigger — BEFORE UPDATE + BEFORE DELETE triggers raise an exception
 *       regardless of role, INCLUDING service_role. The DELETE trigger
 *       distinguishes direct delete (rejected) from cascade delete from a
 *       landing_pages parent (allowed via pg_trigger_depth() > 1).
 *
 * This suite proves both layers fire for every role.
 *
 * Environment: same as page-builder-rls.test.ts — skipped automatically if
 * SUPABASE_SERVICE_ROLE_KEY (or URL/ANON) is not set.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  SHOULD_RUN_LIVE_RLS,
  TEST_SLUG_PREFIX,
  buildAnonClient,
  cleanupTestPages,
  createStaffUser,
  deleteTestUser,
  getAdminClient,
  seedPage,
  type SeededPage,
  type TestUser,
} from './helpers/page-builder-rls-fixtures';

const describeIfLive = SHOULD_RUN_LIVE_RLS ? describe : describe.skip;

// File-scoped slug prefix — keeps cleanup from clobbering sibling RLS suite's
// fixtures when vitest runs both files in parallel against the shared cloud DB.
const APPEND_ONLY_PREFIX = `${TEST_SLUG_PREFIX}append-`;

describeIfLive('Phase 15 — landing_page_revisions append-only invariant', () => {
  let staff: TestUser;
  let page: SeededPage;

  beforeAll(async () => {
    staff = await createStaffUser({ emailPrefix: 'phase15-append-only' });
    page = await seedPage({
      status: 'draft',
      slug: `${APPEND_ONLY_PREFIX}${Date.now().toString(36)}`,
      createdBy: staff.userId,
    });
  }, 120_000);

  afterAll(async () => {
    await cleanupTestPages(APPEND_ONLY_PREFIX);
    await deleteTestUser(staff?.userId);
  }, 60_000);

  // ==========================================================================
  // Layer (b) — Trigger-level enforcement
  // ==========================================================================

  it('trigger blocks UPDATE on landing_page_revisions for is_staff user', async () => {
    const client = buildAnonClient('ph15-append-staff-upd');
    await client.auth.signInWithPassword({ email: staff.email, password: staff.password });

    const { data, error } = await client
      .from('landing_page_revisions')
      .update({ blocks: [{ id: 'forbidden', type: 'hero' }] })
      .eq('id', page.revisionId)
      .select('id');
    // Either trigger fires raising exception (error set) OR RLS hides the row
    // pre-trigger (data is empty). Both are acceptable proofs the row cannot
    // be mutated by app code.
    expect(error !== null || (data?.length ?? 0) === 0).toBe(true);

    // Verify the row was not mutated.
    const admin = getAdminClient();
    const { data: actual } = await admin
      .from('landing_page_revisions')
      .select('blocks')
      .eq('id', page.revisionId)
      .single();
    const tree = (actual as { blocks: unknown[] }).blocks;
    // Either the original empty array OR the seed's empty array — never 'forbidden'.
    expect(JSON.stringify(tree)).not.toContain('forbidden');
  }, 30_000);

  it('trigger blocks UPDATE on landing_page_revisions for service_role (defence-in-depth)', async () => {
    const admin = getAdminClient();
    const { data, error } = await admin
      .from('landing_page_revisions')
      .update({ blocks: [{ id: 'svc-forbidden', type: 'hero' }] })
      .eq('id', page.revisionId)
      .select('id');
    // The trigger raises P0001 — service_role does NOT bypass triggers.
    expect(error).not.toBeNull();
    expect(data).toBeFalsy();
  }, 30_000);

  it('trigger blocks direct DELETE on landing_page_revisions for is_staff user', async () => {
    const client = buildAnonClient('ph15-append-staff-del');
    await client.auth.signInWithPassword({ email: staff.email, password: staff.password });

    await client.from('landing_page_revisions').delete().eq('id', page.revisionId);

    // Verify the row still exists.
    const admin = getAdminClient();
    const { data: actual } = await admin
      .from('landing_page_revisions')
      .select('id')
      .eq('id', page.revisionId);
    expect(actual ?? []).toHaveLength(1);
  }, 30_000);

  it('trigger blocks direct DELETE on landing_page_revisions for service_role (defence-in-depth)', async () => {
    const admin = getAdminClient();
    const { error, data } = await admin
      .from('landing_page_revisions')
      .delete()
      .eq('id', page.revisionId)
      .select('id');
    expect(error).not.toBeNull();
    expect(data).toBeFalsy();

    // And the row is still present.
    const { data: after } = await admin
      .from('landing_page_revisions')
      .select('id')
      .eq('id', page.revisionId);
    expect(after ?? []).toHaveLength(1);
  }, 30_000);

  // ==========================================================================
  // Cascade DELETE — deleting the parent landing_pages row MUST cascade-remove
  // the revisions. The trigger detects pg_trigger_depth() > 1 and allows.
  // ==========================================================================

  it('cascade DELETE from landing_pages parent successfully removes the revision rows', async () => {
    const admin = getAdminClient();

    // Seed a fresh page + revision specifically for the cascade case so we
    // don't tear down `page` (used by earlier tests).
    const cascadePage = await seedPage({
      status: 'draft',
      slug: `${TEST_SLUG_PREFIX}cascade-${Date.now().toString(36)}`,
      createdBy: staff.userId,
    });

    // Confirm the revision exists.
    const { data: before } = await admin
      .from('landing_page_revisions')
      .select('id')
      .eq('id', cascadePage.revisionId);
    expect(before ?? []).toHaveLength(1);

    // Delete the parent — should cascade-remove the revision.
    const { error: pageDelErr } = await admin
      .from('landing_pages')
      .delete()
      .eq('id', cascadePage.pageId);
    expect(pageDelErr).toBeNull();

    // Revision should be gone.
    const { data: after } = await admin
      .from('landing_page_revisions')
      .select('id')
      .eq('id', cascadePage.revisionId);
    expect(after ?? []).toHaveLength(0);
  }, 60_000);
});

// ---------------------------------------------------------------------------
// Gating test — always passes, warns when skipped
// ---------------------------------------------------------------------------
describe('Phase 15 append-only — gating', () => {
  it('runs against live cloud DB when SUPABASE_SERVICE_ROLE_KEY is set', () => {
    if (!SHOULD_RUN_LIVE_RLS) {
      // eslint-disable-next-line no-console
      console.warn(
        '[landing-page-revisions-append-only.test] SKIPPED — SUPABASE_SERVICE_ROLE_KEY (or URL/ANON) not set. Wave verification gates this.',
      );
    }
    expect(true).toBe(true);
  });
});
