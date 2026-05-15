/**
 * Phase 15 Plan 01 — Live cross-tenant RLS impersonation proof for all 4 new
 * page-builder surfaces (landing_pages, landing_page_revisions, leads,
 * site_settings) + the page-assets Storage bucket.
 *
 * Project rule (MEMORY.md): every RLS surface (table OR Storage bucket) gets
 * a live cross-tenant impersonation proof test — not just policy SQL.
 *
 * Schema state required: migrations 20261101000001 .. 20261101000010 applied
 * to the live project (project ref ytnsipxxmzgaebkqmokp). Before
 * `supabase db push` runs in Task 2, this entire suite is expected to FAIL —
 * that is the RED-phase TDD evidence.
 *
 * Environment:
 *   SUPABASE_URL              — public (also VITE_SUPABASE_URL)
 *   SUPABASE_ANON_KEY         — public (also VITE_SUPABASE_ANON_KEY)
 *   SUPABASE_SERVICE_ROLE_KEY — PRIVATE (CI secret; never commit)
 *
 * Skipped automatically if any required env var is absent (default local +
 * PR-from-fork safety). Wave verification runs this against the live cloud DB
 * with the secret injected.
 *
 * Test-slug namespace: every seeded page slug starts with the `phase15-test-`
 * prefix (TEST_SLUG_PREFIX) so cleanupTestPages() can safely wipe via
 * `slug LIKE 'phase15-test-%'` without touching real production rows. The
 * prefix is also reserved-slug-clean (does not collide with the D-10 denylist:
 * clinic, admin, share, api, auth, assets, sitemap.xml, robots.txt).
 */
import { createClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  SHOULD_RUN_LIVE_RLS,
  SUPABASE_ANON_KEY,
  SUPABASE_URL,
  TEST_SLUG_PREFIX,
  buildAnonClient,
  cleanupTestPages,
  createNonStaffUser,
  createStaffUser,
  deleteTestUser,
  getAdminClient,
  seedPage,
  type SeededPage,
  type TestUser,
} from './helpers/page-builder-rls-fixtures';

const describeIfLive = SHOULD_RUN_LIVE_RLS ? describe : describe.skip;

describeIfLive('Phase 15 RLS — cross-tenant impersonation proof (4 surfaces + bucket)', () => {
  let staff: TestUser;
  let nonStaff: TestUser;
  let draftPage: SeededPage;
  let publishedPage: SeededPage;

  beforeAll(async () => {
    // 1) Two users — one staff, one not.
    staff = await createStaffUser();
    nonStaff = await createNonStaffUser();

    // 2) Two pages — one draft (only staff can see), one published (anyone can see).
    draftPage = await seedPage({
      status: 'draft',
      slug: `${TEST_SLUG_PREFIX}draft-${Date.now().toString(36)}`,
      createdBy: staff.userId,
    });
    publishedPage = await seedPage({
      status: 'published',
      slug: `${TEST_SLUG_PREFIX}pub-${Date.now().toString(36)}`,
      createdBy: staff.userId,
    });
  }, 120_000);

  afterAll(async () => {
    await cleanupTestPages(TEST_SLUG_PREFIX);
    await deleteTestUser(staff?.userId);
    await deleteTestUser(nonStaff?.userId);
  }, 60_000);

  // ==========================================================================
  // landing_pages
  // ==========================================================================

  it('landing_pages: anon CAN SELECT only status=published rows', async () => {
    const anon = createClient(SUPABASE_URL!, SUPABASE_ANON_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false, storageKey: 'ph15-anon-lp' },
    });

    const { data: published, error: errPub } = await anon
      .from('landing_pages')
      .select('id')
      .eq('id', publishedPage.pageId);
    expect(errPub).toBeNull();
    expect(published).toHaveLength(1);

    const { data: drafts, error: errDraft } = await anon
      .from('landing_pages')
      .select('id')
      .eq('id', draftPage.pageId);
    expect(errDraft).toBeNull();
    expect(drafts).toHaveLength(0);
  }, 30_000);

  it('landing_pages: non-staff user CAN SELECT only published rows; CANNOT see drafts', async () => {
    const client = buildAnonClient('ph15-ns-lp-select');
    await client.auth.signInWithPassword({ email: nonStaff.email, password: nonStaff.password });

    const { data: drafts } = await client
      .from('landing_pages')
      .select('id')
      .eq('id', draftPage.pageId);
    expect(drafts).toHaveLength(0);

    const { data: published } = await client
      .from('landing_pages')
      .select('id')
      .eq('id', publishedPage.pageId);
    expect(published).toHaveLength(1);
  }, 30_000);

  it('landing_pages: non-staff user CANNOT INSERT', async () => {
    const client = buildAnonClient('ph15-ns-lp-ins');
    await client.auth.signInWithPassword({ email: nonStaff.email, password: nonStaff.password });

    const { data, error } = await client
      .from('landing_pages')
      .insert({ slug: `${TEST_SLUG_PREFIX}ns-insert-${Date.now()}`, status: 'draft' })
      .select('id');
    // RLS denies — either error is set OR data is empty (Postgrest returns
    // either depending on policy match shape).
    expect(error !== null || (data?.length ?? 0) === 0).toBe(true);
  }, 30_000);

  it('landing_pages: non-staff user CANNOT UPDATE', async () => {
    const client = buildAnonClient('ph15-ns-lp-upd');
    await client.auth.signInWithPassword({ email: nonStaff.email, password: nonStaff.password });

    const { data } = await client
      .from('landing_pages')
      .update({ title: 'hijacked' })
      .eq('id', publishedPage.pageId)
      .select('id');
    // RLS hides the row from the non-staff user; update affects 0 rows.
    expect(data ?? []).toHaveLength(0);

    // Verify the row was not actually mutated.
    const admin = getAdminClient();
    const { data: actual } = await admin
      .from('landing_pages')
      .select('title')
      .eq('id', publishedPage.pageId)
      .single();
    expect((actual as { title: string }).title).not.toBe('hijacked');
  }, 30_000);

  it('landing_pages: non-staff user CANNOT DELETE', async () => {
    const client = buildAnonClient('ph15-ns-lp-del');
    await client.auth.signInWithPassword({ email: nonStaff.email, password: nonStaff.password });

    await client.from('landing_pages').delete().eq('id', publishedPage.pageId);

    // Verify the row still exists.
    const admin = getAdminClient();
    const { data: actual } = await admin
      .from('landing_pages')
      .select('id')
      .eq('id', publishedPage.pageId);
    expect(actual ?? []).toHaveLength(1);
  }, 30_000);

  it('landing_pages: is_staff user CAN INSERT / UPDATE / DELETE', async () => {
    const client = buildAnonClient('ph15-st-lp');
    await client.auth.signInWithPassword({ email: staff.email, password: staff.password });

    const slug = `${TEST_SLUG_PREFIX}st-crud-${Date.now()}`;
    const { data: inserted, error: insErr } = await client
      .from('landing_pages')
      .insert({ slug, status: 'draft' })
      .select('id')
      .single();
    expect(insErr).toBeNull();
    expect(inserted).toBeTruthy();
    const newId = inserted!.id as string;

    const { error: updErr } = await client
      .from('landing_pages')
      .update({ title: 'staff-updated' })
      .eq('id', newId);
    expect(updErr).toBeNull();

    const { error: delErr } = await client.from('landing_pages').delete().eq('id', newId);
    expect(delErr).toBeNull();
  }, 30_000);

  // ==========================================================================
  // landing_page_revisions
  // ==========================================================================

  it('landing_page_revisions: non-staff CANNOT SELECT a revision of a DRAFT page', async () => {
    const client = buildAnonClient('ph15-ns-rev-draft');
    await client.auth.signInWithPassword({ email: nonStaff.email, password: nonStaff.password });

    const { data } = await client
      .from('landing_page_revisions')
      .select('id')
      .eq('id', draftPage.revisionId);
    expect(data ?? []).toHaveLength(0);
  }, 30_000);

  it('landing_page_revisions: non-staff CAN SELECT the published revision of a PUBLISHED page', async () => {
    const client = buildAnonClient('ph15-ns-rev-pub');
    await client.auth.signInWithPassword({ email: nonStaff.email, password: nonStaff.password });

    const { data, error } = await client
      .from('landing_page_revisions')
      .select('id')
      .eq('id', publishedPage.revisionId);
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
  }, 30_000);

  it('landing_page_revisions: anon can read the published revision; cannot read a draft revision', async () => {
    const anon = createClient(SUPABASE_URL!, SUPABASE_ANON_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false, storageKey: 'ph15-anon-rev' },
    });

    const { data: pubRev } = await anon
      .from('landing_page_revisions')
      .select('id')
      .eq('id', publishedPage.revisionId);
    expect(pubRev).toHaveLength(1);

    const { data: draftRev } = await anon
      .from('landing_page_revisions')
      .select('id')
      .eq('id', draftPage.revisionId);
    expect(draftRev ?? []).toHaveLength(0);
  }, 30_000);

  it('landing_page_revisions: is_staff CAN INSERT a new revision', async () => {
    const client = buildAnonClient('ph15-st-rev-ins');
    await client.auth.signInWithPassword({ email: staff.email, password: staff.password });

    const { data, error } = await client
      .from('landing_page_revisions')
      .insert({ page_id: draftPage.pageId, block_tree: [{ id: 'b1', type: 'hero' }] })
      .select('id')
      .single();
    expect(error).toBeNull();
    expect(data).toBeTruthy();
  }, 30_000);

  it('landing_page_revisions: non-staff CANNOT INSERT a revision', async () => {
    const client = buildAnonClient('ph15-ns-rev-ins');
    await client.auth.signInWithPassword({ email: nonStaff.email, password: nonStaff.password });

    const { data, error } = await client
      .from('landing_page_revisions')
      .insert({ page_id: draftPage.pageId, block_tree: [] })
      .select('id');
    expect(error !== null || (data?.length ?? 0) === 0).toBe(true);
  }, 30_000);

  // ==========================================================================
  // leads
  // ==========================================================================

  it('leads: anon CANNOT INSERT directly', async () => {
    const anon = createClient(SUPABASE_URL!, SUPABASE_ANON_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false, storageKey: 'ph15-anon-leads' },
    });

    const { data, error } = await anon
      .from('leads')
      .insert({ email: `${TEST_SLUG_PREFIX}anon@leanshot.test`, page_id: publishedPage.pageId })
      .select('id');
    expect(error !== null || (data?.length ?? 0) === 0).toBe(true);
  }, 30_000);

  it('leads: non-staff authenticated CANNOT INSERT directly', async () => {
    const client = buildAnonClient('ph15-ns-leads-ins');
    await client.auth.signInWithPassword({ email: nonStaff.email, password: nonStaff.password });

    const { data, error } = await client
      .from('leads')
      .insert({ email: `${TEST_SLUG_PREFIX}ns@leanshot.test`, page_id: publishedPage.pageId })
      .select('id');
    expect(error !== null || (data?.length ?? 0) === 0).toBe(true);
  }, 30_000);

  it('leads: service-role CAN INSERT a lead row', async () => {
    const admin = getAdminClient();
    const email = `${TEST_SLUG_PREFIX}service@leanshot.test`;
    const { data, error } = await admin
      .from('leads')
      .insert({ email, page_id: publishedPage.pageId })
      .select('id')
      .single();
    expect(error).toBeNull();
    expect(data).toBeTruthy();
  }, 30_000);

  it('leads: non-staff authenticated CANNOT SELECT', async () => {
    const client = buildAnonClient('ph15-ns-leads-sel');
    await client.auth.signInWithPassword({ email: nonStaff.email, password: nonStaff.password });

    const { data } = await client.from('leads').select('id').limit(5);
    expect(data ?? []).toHaveLength(0);
  }, 30_000);

  it('leads: is_staff CAN SELECT', async () => {
    const client = buildAnonClient('ph15-st-leads-sel');
    await client.auth.signInWithPassword({ email: staff.email, password: staff.password });

    const { data, error } = await client.from('leads').select('id').limit(50);
    expect(error).toBeNull();
    // At least one row (the service-role insert from the prior test).
    expect((data ?? []).length).toBeGreaterThan(0);
  }, 30_000);

  // ==========================================================================
  // site_settings
  // ==========================================================================

  it('site_settings: anon CAN SELECT', async () => {
    const anon = createClient(SUPABASE_URL!, SUPABASE_ANON_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false, storageKey: 'ph15-anon-ss' },
    });
    const { data, error } = await anon.from('site_settings').select('id, site_name');
    expect(error).toBeNull();
    expect((data ?? []).length).toBeGreaterThanOrEqual(1);
  }, 30_000);

  it('site_settings: non-staff CAN SELECT but CANNOT UPDATE', async () => {
    const client = buildAnonClient('ph15-ns-ss');
    await client.auth.signInWithPassword({ email: nonStaff.email, password: nonStaff.password });

    const { data: rows } = await client.from('site_settings').select('id, site_name');
    expect((rows ?? []).length).toBeGreaterThanOrEqual(1);

    const { data: updated } = await client
      .from('site_settings')
      .update({ site_name: 'hijacked' })
      .eq('id', (rows![0] as { id: string }).id)
      .select('id');
    expect(updated ?? []).toHaveLength(0);

    // Verify the row was NOT mutated.
    const admin = getAdminClient();
    const { data: actual } = await admin
      .from('site_settings')
      .select('site_name')
      .eq('id', (rows![0] as { id: string }).id)
      .single();
    expect((actual as { site_name: string }).site_name).not.toBe('hijacked');
  }, 30_000);

  it('site_settings: is_staff CAN UPDATE', async () => {
    const client = buildAnonClient('ph15-st-ss');
    await client.auth.signInWithPassword({ email: staff.email, password: staff.password });

    const { data: rows } = await client.from('site_settings').select('id, site_name');
    const id = (rows![0] as { id: string }).id;

    const newName = `LeanShot-${Date.now()}`;
    const { error } = await client
      .from('site_settings')
      .update({ site_name: newName })
      .eq('id', id);
    expect(error).toBeNull();

    // Reset to a stable value for any subsequent reads.
    await client.from('site_settings').update({ site_name: 'LeanShot' }).eq('id', id);
  }, 30_000);

  it('site_settings: inserting a second row is rejected by the singleton unique index', async () => {
    const admin = getAdminClient();
    const { data, error } = await admin
      .from('site_settings')
      .insert({ site_name: 'should-fail' })
      .select('id');
    // 23505 unique-violation OR PostgREST surfaces a generic conflict error.
    expect(error).not.toBeNull();
    expect(data).toBeFalsy();
  }, 30_000);

  // ==========================================================================
  // page-assets bucket (storage.objects)
  // ==========================================================================

  it('page-assets: non-staff CANNOT upload (INSERT rejected)', async () => {
    const client = buildAnonClient('ph15-ns-storage');
    await client.auth.signInWithPassword({ email: nonStaff.email, password: nonStaff.password });

    const path = `${TEST_SLUG_PREFIX}ns-${Date.now()}.png`;
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]); // PNG sig
    const { data, error } = await client.storage
      .from('page-assets')
      .upload(path, bytes, { contentType: 'image/png' });
    expect(error !== null || data === null).toBe(true);
  }, 30_000);

  it('page-assets: is_staff CAN upload and delete a test image', async () => {
    const client = buildAnonClient('ph15-st-storage');
    await client.auth.signInWithPassword({ email: staff.email, password: staff.password });

    const path = `${TEST_SLUG_PREFIX}st-${Date.now()}.png`;
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const { error: upErr } = await client.storage
      .from('page-assets')
      .upload(path, bytes, { contentType: 'image/png' });
    expect(upErr).toBeNull();

    const { error: delErr } = await client.storage.from('page-assets').remove([path]);
    expect(delErr).toBeNull();
  }, 30_000);

  it('page-assets: anon CAN download a known public path', async () => {
    // First upload as staff so there's a deterministic object.
    const admin = getAdminClient();
    const path = `${TEST_SLUG_PREFIX}public-${Date.now()}.png`;
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const { error: upErr } = await admin.storage
      .from('page-assets')
      .upload(path, bytes, { contentType: 'image/png' });
    expect(upErr).toBeNull();

    try {
      const anon = createClient(SUPABASE_URL!, SUPABASE_ANON_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false, storageKey: 'ph15-anon-storage' },
      });
      const { data, error } = await anon.storage.from('page-assets').download(path);
      expect(error).toBeNull();
      expect(data).toBeTruthy();
    } finally {
      await admin.storage.from('page-assets').remove([path]);
    }
  }, 30_000);
});

// ---------------------------------------------------------------------------
// Gating test — always passes, warns when skipped (matches Phase 14 pattern)
// ---------------------------------------------------------------------------
describe('Phase 15 RLS — gating', () => {
  it('runs against live cloud DB when SUPABASE_SERVICE_ROLE_KEY is set', () => {
    if (!SHOULD_RUN_LIVE_RLS) {
      // eslint-disable-next-line no-console
      console.warn(
        '[page-builder-rls.test] SKIPPED — SUPABASE_SERVICE_ROLE_KEY (or URL/ANON) not set. Wave verification gates this.',
      );
    }
    expect(true).toBe(true);
  });
});
