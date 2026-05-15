/**
 * Phase 15 Plan 15-10 — pricing-page seed fixture.
 *
 * Exports `seedStaffAndPricingPage` — creates an `is_staff = true` Supabase
 * auth user, inserts a `landing_pages` row with slug `pricing`, inserts the
 * matching `landing_page_revisions` row whose `block_tree` JSONB is the
 * authored pricing block tree from `src/lib/page-builder/pricing-page-content`,
 * and re-points `published_revision_id` to that revision so the e2e can
 * `goto /pricing` straight away.
 *
 * Returns `{ userId, email, password, pageId, revisionId, cleanup }`. The
 * `cleanup()` helper deletes the page (cascades the revision) and the auth
 * user — call it from `test.afterAll` for hygiene.
 *
 * Memory references applied:
 *   - [[reference_supabase_auth_traps]] — uses `admin.auth.admin.createUser`,
 *     NEVER public email signup (free-tier 2/hour rate limit).
 *   - Service-role admin client is constructed inside this Node-only fixture
 *     module and is NEVER passed to a browser context (security per T-14-08-03).
 */

import { createClient } from '@supabase/supabase-js';

import { PRICING_PAGE_BLOCKS, PRICING_PAGE_SEO } from '../../../src/lib/page-builder/pricing-page-content';

// ─── Environment (server-side fixture — no VITE_ prefix preferred) ───────────
const SUPABASE_URL =
  process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

function getAdmin() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error(
      'seedStaffAndPricingPage: SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY env vars are required',
    );
  }
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export interface SeedPricingPageResult {
  /** Supabase auth.users UUID for the seeded is_staff user. */
  userId: string;
  /** Login email — the e2e uses this with `password` to sign in. */
  email: string;
  /** Login password — the e2e uses this with `email` to sign in. */
  password: string;
  /** landing_pages.id of the seeded /pricing page. */
  pageId: string;
  /** landing_page_revisions.id of the published revision. */
  revisionId: string;
  /** Best-effort cleanup: deletes page (cascades revision) + auth user. */
  cleanup: () => Promise<void>;
}

/**
 * Seed an is_staff Supabase user + a published `pricing` landing page that
 * carries the canonical PRICING_PAGE_BLOCKS tree (two Checkout buttons bound
 * to plus_monthly + plus_yearly via `checkoutPlan`).
 *
 * IMPORTANT: this fixture is HAS_LIVE-only — callers MUST guard the test
 * describe with `test.skip(!HAS_LIVE, ...)` (see pricing-checkout-flow.spec.ts).
 */
export async function seedStaffAndPricingPage(): Promise<SeedPricingPageResult> {
  const admin = getAdmin();

  const ts = Date.now();
  const email = `pw-pricing-${ts}@leanshot.test`;
  const password = `Pass1234-${ts}`;

  // 1. Create staff auth user (admin.createUser → bypasses email rate limit).
  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (createErr || !created.user) {
    throw new Error(
      `seedStaffAndPricingPage: admin.createUser failed: ${createErr?.message ?? 'unknown'}`,
    );
  }
  const userId = created.user.id;

  // 2. Flip is_staff = true on the profile row (trigger inserts row on signup).
  //    Upsert in case the trigger hasn't fired yet in some test environments.
  {
    const { error: profErr } = await admin
      .from('profiles')
      .upsert(
        { id: userId, is_staff: true },
        { onConflict: 'id' },
      );
    if (profErr) {
      throw new Error(
        `seedStaffAndPricingPage: profiles upsert is_staff failed: ${profErr.message}`,
      );
    }
  }

  // 3. Insert landing_pages row. Slug is unique — if a prior test left a
  //    `pricing` row, delete it first (best-effort) so this insert succeeds.
  await admin.from('landing_pages').delete().eq('slug', 'pricing');

  const { data: pageRow, error: pageErr } = await admin
    .from('landing_pages')
    .insert({
      slug: 'pricing',
      title: 'Pricing',
      status: 'published',
      seo_title: PRICING_PAGE_SEO.title,
      seo_description: PRICING_PAGE_SEO.description,
      seo_schema_type: PRICING_PAGE_SEO.schemaType,
      created_by: userId,
    })
    .select('id')
    .single();
  if (pageErr || !pageRow) {
    throw new Error(
      `seedStaffAndPricingPage: landing_pages insert failed: ${pageErr?.message ?? 'unknown'}`,
    );
  }
  const pageId = pageRow.id as string;

  // 4. Insert the published revision carrying the authored block tree.
  const { data: revRow, error: revErr } = await admin
    .from('landing_page_revisions')
    .insert({
      page_id: pageId,
      block_tree: PRICING_PAGE_BLOCKS,
      created_by: userId,
    })
    .select('id')
    .single();
  if (revErr || !revRow) {
    throw new Error(
      `seedStaffAndPricingPage: landing_page_revisions insert failed: ${revErr?.message ?? 'unknown'}`,
    );
  }
  const revisionId = revRow.id as string;

  // 5. Re-point published_revision_id so /pricing serves this revision.
  const { error: pubErr } = await admin
    .from('landing_pages')
    .update({ published_revision_id: revisionId, status: 'published' })
    .eq('id', pageId);
  if (pubErr) {
    throw new Error(
      `seedStaffAndPricingPage: re-point published_revision_id failed: ${pubErr.message}`,
    );
  }

  // 6. Return cleanup closure. Deleting the page cascades the revision rows
  //    (FK on delete cascade in migration 02).
  const cleanup = async (): Promise<void> => {
    try {
      await admin.from('landing_pages').delete().eq('id', pageId);
    } catch {
      // best-effort
    }
    try {
      await admin.auth.admin.deleteUser(userId);
    } catch {
      // best-effort
    }
  };

  return { userId, email, password, pageId, revisionId, cleanup };
}
