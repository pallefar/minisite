/**
 * Phase 15 Plan 01 — Test fixture helpers for the page-builder RLS suites.
 *
 * Exports:
 *   - createStaffUser()       — service-role admin creates an auth.users row;
 *                               sets profiles.is_staff = true.
 *   - createNonStaffUser()    — service-role admin creates an auth.users row;
 *                               leaves profiles.is_staff at default false.
 *   - seedPage(opts)          — admin inserts a landing_pages row + a single
 *                               landing_page_revisions row; if opts.status =
 *                               'published', also sets published_revision_id
 *                               (single transaction, exercises deferred FK).
 *   - cleanupTestPages(prefix)— service-role wipe of all rows whose slug
 *                               starts with prefix (idempotent).
 *
 * Reserved-slug rule (D-10): the prefix used for tests is `phase15-test-`,
 * which does NOT collide with the reserved-slug list (clinic, admin, share,
 * api, auth, assets, sitemap.xml, robots.txt). Every helper that creates a
 * page uses this prefix or a caller-supplied non-reserved slug.
 *
 * Env vars (same pattern as `subscriptions-impersonation.test.ts`):
 *   SUPABASE_URL              — public (also VITE_SUPABASE_URL)
 *   SUPABASE_ANON_KEY         — public (also VITE_SUPABASE_ANON_KEY)
 *   SUPABASE_SERVICE_ROLE_KEY — PRIVATE (CI secret; never commit)
 *
 * If any required env var is missing, the RLS suite uses describe.skip so
 * local PRs and PR-from-fork builds do not fail.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
export const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY;
export const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

export const SHOULD_RUN_LIVE_RLS = Boolean(
  SUPABASE_URL && SUPABASE_ANON_KEY && SUPABASE_SERVICE_ROLE_KEY,
);

/** Reserved-slug-clean prefix for test pages. Avoids the D-10 denylist. */
export const TEST_SLUG_PREFIX = 'phase15-test-';

/**
 * Lazily build a service-role admin client. Throws if env vars are missing
 * — callers should gate on `SHOULD_RUN_LIVE_RLS` first.
 */
export function getAdminClient(): SupabaseClient {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error(
      'page-builder-rls-fixtures: SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY missing',
    );
  }
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

/**
 * Build a fresh anon client per session — caller signs in immediately.
 * Each call gets a unique storageKey so concurrent sign-ins don't clobber
 * one another inside a single test process (vitest may parallelize).
 */
export function buildAnonClient(storageKey: string): SupabaseClient {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    throw new Error('page-builder-rls-fixtures: SUPABASE_URL or SUPABASE_ANON_KEY missing');
  }
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false, storageKey },
  });
}

export interface TestUser {
  userId: string;
  email: string;
  password: string;
}

/** Create an auth.users row + flip profiles.is_staff = true. */
export async function createStaffUser(opts?: { emailPrefix?: string }): Promise<TestUser> {
  const admin = getAdminClient();
  const ts = Date.now();
  const rand = crypto.randomUUID().slice(0, 8);
  const email = `${opts?.emailPrefix ?? 'phase15-staff'}-${ts}-${rand}@leanshot.test`;
  const password = `Pass1234-${rand}`;

  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error) throw new Error(`createStaffUser: createUser failed: ${error.message}`);
  const userId = data.user!.id;

  // The handle_new_user() trigger creates a profiles row automatically; we
  // upsert here defensively so the test is independent of trigger timing.
  const { error: upsertErr } = await admin
    .from('profiles')
    .upsert({ id: userId, is_staff: true }, { onConflict: 'id' });
  if (upsertErr) throw new Error(`createStaffUser: profiles upsert failed: ${upsertErr.message}`);

  // Read-back guard — when the test suite runs in parallel against the
  // shared cloud DB, the upsert's commit can race the subsequent
  // signInWithPassword + RLS evaluation. Loop until the row reflects
  // is_staff=true (or fail loudly after ~3s) so downstream RLS tests are not
  // testing a stale row.
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const { data: probe } = await admin
      .from('profiles')
      .select('is_staff')
      .eq('id', userId)
      .single();
    if (probe?.is_staff === true) break;
    await new Promise((r) => setTimeout(r, 500));
    if (attempt === 5) {
      throw new Error(`createStaffUser: profiles.is_staff=true did not propagate for ${userId}`);
    }
  }

  return { userId, email, password };
}

/** Create an auth.users row + ensure profiles.is_staff = false. */
export async function createNonStaffUser(opts?: { emailPrefix?: string }): Promise<TestUser> {
  const admin = getAdminClient();
  const ts = Date.now();
  const rand = crypto.randomUUID().slice(0, 8);
  const email = `${opts?.emailPrefix ?? 'phase15-non-staff'}-${ts}-${rand}@leanshot.test`;
  const password = `Pass1234-${rand}`;

  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error) throw new Error(`createNonStaffUser: createUser failed: ${error.message}`);
  const userId = data.user!.id;

  const { error: upsertErr } = await admin
    .from('profiles')
    .upsert({ id: userId, is_staff: false }, { onConflict: 'id' });
  if (upsertErr) throw new Error(`createNonStaffUser: profiles upsert failed: ${upsertErr.message}`);

  return { userId, email, password };
}

export interface SeededPage {
  pageId: string;
  revisionId: string;
  slug: string;
}

/**
 * Seed a landing_pages row + one landing_page_revisions row.
 *
 * If opts.status === 'published', additionally set published_revision_id to
 * the new revision (single transaction would be ideal, but supabase-js v2
 * does not expose explicit transactions — we approximate via two sequential
 * admin writes; the deferred FK still permits this ordering because the
 * revision is inserted BEFORE the update to landing_pages, so the deferred
 * constraint is satisfied at every visible state).
 */
export async function seedPage(opts: {
  status: 'draft' | 'published';
  slug?: string;
  createdBy?: string;
}): Promise<SeededPage> {
  const admin = getAdminClient();
  const rand = crypto.randomUUID().slice(0, 8);
  const slug = opts.slug ?? `${TEST_SLUG_PREFIX}${rand}`;

  // 1. Insert the page (no published_revision_id yet)
  const { data: pageRow, error: pageErr } = await admin
    .from('landing_pages')
    .insert({
      slug,
      title: `Test page ${rand}`,
      status: opts.status,
      created_by: opts.createdBy ?? null,
    })
    .select('id')
    .single();
  if (pageErr) throw new Error(`seedPage: landing_pages insert failed: ${pageErr.message}`);
  const pageId = pageRow.id as string;

  // 2. Insert the revision (FK page_id → landing_pages is satisfied)
  const { data: revRow, error: revErr } = await admin
    .from('landing_page_revisions')
    .insert({
      page_id: pageId,
      block_tree: [],
      created_by: opts.createdBy ?? null,
    })
    .select('id')
    .single();
  if (revErr) throw new Error(`seedPage: landing_page_revisions insert failed: ${revErr.message}`);
  const revisionId = revRow.id as string;

  // 3. If publishing, point published_revision_id at the new revision.
  if (opts.status === 'published') {
    const { error: pubErr } = await admin
      .from('landing_pages')
      .update({ published_revision_id: revisionId })
      .eq('id', pageId);
    if (pubErr) {
      throw new Error(`seedPage: published_revision_id update failed: ${pubErr.message}`);
    }
  }

  return { pageId, revisionId, slug };
}

/**
 * Service-role cleanup: delete any landing_pages whose slug starts with the
 * given prefix. CASCADE removes the revisions (and the append-only DELETE
 * trigger correctly allows cascade via pg_trigger_depth() > 1).
 *
 * Also cleans up leads orphaned by page-deletion's ON DELETE SET NULL (we
 * delete leads whose email matches the test prefix to keep the table tidy).
 */
export async function cleanupTestPages(slugPrefix: string = TEST_SLUG_PREFIX): Promise<void> {
  const admin = getAdminClient();
  try {
    await admin.from('landing_pages').delete().like('slug', `${slugPrefix}%`);
  } catch {
    /* best-effort */
  }
  try {
    await admin.from('leads').delete().like('email', `${slugPrefix}%`);
  } catch {
    /* best-effort */
  }
}

/** Cleanup helper for test users — best-effort by id. */
export async function deleteTestUser(userId: string | undefined): Promise<void> {
  if (!userId) return;
  const admin = getAdminClient();
  try {
    await admin.auth.admin.deleteUser(userId);
  } catch {
    /* best-effort */
  }
}
