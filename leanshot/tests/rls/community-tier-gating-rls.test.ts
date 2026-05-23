/**
 * Phase 44 Plan 01 — Community Tier-Gating RLS: Free/Pro/Trial vs min_tier='pro' space.
 *
 * REQUIRES: supabase db push --linked completed (Wave 3 plan 44-10)
 *
 * Verifies, against the live cloud DB (ytnsipxxmzgaebkqmokp), that:
 *
 *   T-44-01 / COMMUNITY-06 (tier gating):
 *
 *   1. Free user CANNOT read community_posts in a min_tier='pro' space.
 *      cpost_select_tier policy joins tier_effective and checks min_tier vs tier_label.
 *      Free user has no subscription → tier_label='free' → 0 rows returned.
 *
 *   2. Pro user CAN read community_posts in a min_tier='pro' space.
 *      tier_label='pro' satisfies the policy condition → 1 row returned.
 *
 *   3. Trial user CAN read min_tier='pro' space (D-06 + Claude's Discretion).
 *      tier_label='trial' is included in the Pro branch of cpost_select_tier.
 *      Trial users get full Pro feature evaluation access.
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
  seedSpaceAndPost,
  seedUserTier,
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
let freeUser: TestUser;
let proUser: TestUser;
let trialUser: TestUser;

let proSpaceId: string;
let postId: string;

// Subscription/lifetime IDs for cleanup
let proSubId: string | null = null;
let trialSubId: string | null = null;

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describeIfLive('Phase 44 Plan 01 — Community Tier-Gating RLS: Free/Pro/Trial', () => {
  beforeAll(async () => {
    admin = buildAdmin();
    const ts = Date.now();

    // Create three users with different tiers
    freeUser = await createOrgScopedUser(
      admin,
      `${TEST_SLUG_PREFIX}-free-${ts}@leanshot.test`,
      // No org for free user — just a plain user
    );
    proUser = await createOrgScopedUser(
      admin,
      `${TEST_SLUG_PREFIX}-pro-${ts}@leanshot.test`,
    );
    trialUser = await createOrgScopedUser(
      admin,
      `${TEST_SLUG_PREFIX}-trial-${ts}@leanshot.test`,
    );

    // Seed tiers: freeUser stays 'free' (no subscription row needed)
    proSubId = await seedUserTier(admin, proUser.id, 'pro', TEST_SLUG_PREFIX);
    trialSubId = await seedUserTier(admin, trialUser.id, 'trial', TEST_SLUG_PREFIX);

    // Create a Pro-only space with one post authored by proUser
    const seeded = await seedSpaceAndPost(admin, proUser.id, {
      name: `${TEST_SLUG_PREFIX}-pro-space`,
      minTier: 'pro',
    });
    proSpaceId = seeded.spaceId;
    postId = seeded.postId;
  }, 120_000);

  afterAll(async () => {
    if (!admin) return;
    // Cleanup in FK-safe order
    try { await admin.from('community_posts').delete().eq('id', postId); } catch { /* best-effort */ }
    try { await admin.from('community_spaces').delete().eq('id', proSpaceId); } catch { /* best-effort */ }
    if (proSubId) {
      try { await admin.from('subscriptions').delete().eq('id', proSubId); } catch { /* best-effort */ }
    }
    if (trialSubId) {
      try { await admin.from('subscriptions').delete().eq('id', trialSubId); } catch { /* best-effort */ }
    }
    const userIds = [freeUser?.id, proUser?.id, trialUser?.id].filter(Boolean) as string[];
    for (const uid of userIds) {
      try { await admin.auth.admin.deleteUser(uid); } catch { /* best-effort */ }
    }
  }, 60_000);

  // ---------------------------------------------------------------------------
  // 1. Free user CANNOT read posts in min_tier='pro' space (0 rows)
  // ---------------------------------------------------------------------------

  it("Free user CANNOT read community_posts in a min_tier='pro' space", async () => {
    const tokenFree = await freeUser.accessToken();
    const clientFree = buildAnonClient(`${TEST_SLUG_PREFIX}-free-blocked`);

    const { data, error } = await clientFree
      .from('community_posts')
      .select('id')
      .eq('space_id', proSpaceId)
      .setHeader('Authorization', `Bearer ${tokenFree}`);

    expect(error).toBeNull();
    // D-08: RLS hides posts in tier-gated spaces from Free users
    expect(data ?? []).toHaveLength(0);
  }, 30_000);

  // ---------------------------------------------------------------------------
  // 2. Pro user CAN read posts in min_tier='pro' space (1 row)
  // ---------------------------------------------------------------------------

  it("Pro user CAN read community_posts in a min_tier='pro' space", async () => {
    const tokenPro = await proUser.accessToken();
    const clientPro = buildAnonClient(`${TEST_SLUG_PREFIX}-pro-allowed`);

    const { data, error } = await clientPro
      .from('community_posts')
      .select('id')
      .eq('space_id', proSpaceId)
      .setHeader('Authorization', `Bearer ${tokenPro}`);

    expect(error).toBeNull();
    expect((data ?? []).length).toBeGreaterThanOrEqual(1);
  }, 30_000);

  // ---------------------------------------------------------------------------
  // 3. Trial user CAN read min_tier='pro' space (D-06 + Claude's Discretion)
  // ---------------------------------------------------------------------------

  it("Trial user CAN read community_posts in a min_tier='pro' space (D-06)", async () => {
    const tokenTrial = await trialUser.accessToken();
    const clientTrial = buildAnonClient(`${TEST_SLUG_PREFIX}-trial-allowed`);

    const { data, error } = await clientTrial
      .from('community_posts')
      .select('id')
      .eq('space_id', proSpaceId)
      .setHeader('Authorization', `Bearer ${tokenTrial}`);

    expect(error).toBeNull();
    // Trial users get Pro feature evaluation access per 44-CONTEXT Claude's Discretion
    expect((data ?? []).length).toBeGreaterThanOrEqual(1);
  }, 30_000);
});

// ---------------------------------------------------------------------------
// Gating test — always passes, warns when skipped
// ---------------------------------------------------------------------------

describe('Phase 44 community-tier-gating-rls — gating', () => {
  it('runs against live cloud DB when SUPABASE_SERVICE_ROLE_KEY is set', () => {
    if (!SHOULD_RUN) {
      // eslint-disable-next-line no-console
      console.warn(
        '[community-tier-gating-rls.test] SKIPPED — SUPABASE_SERVICE_ROLE_KEY (or URL/ANON) not set. Wave 3 plan 44-10 gates this.',
      );
    }
    expect(true).toBe(true);
  });
});

