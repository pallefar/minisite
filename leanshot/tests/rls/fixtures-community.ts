/**
 * Shared fixtures helpers for Phase 44 community RLS test suites.
 *
 * REQUIRES: supabase db push --linked completed (Wave 3 plan 44-10)
 *
 * Design:
 *   - Each helper is called with a slug prefix to namespace rows.
 *   - Uses admin client (service_role) for seeding — never supabase-js GoTrueClient
 *     signInWithPassword (avoids ES256 flake per reference_rls_fixture_gotrueclient_flake).
 *   - Auth tokens are minted via getUserAccessToken (admin.generateLink + /auth/v1/verify).
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { getUserAccessToken } from './helpers/admin-session';

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? '';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY ?? '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

// ---------------------------------------------------------------------------
// Admin client factory
// ---------------------------------------------------------------------------

export function buildAdmin(): SupabaseClient {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('fixtures-community: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY required');
  }
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

// ---------------------------------------------------------------------------
// Anon client factory (for user-context requests)
// ---------------------------------------------------------------------------

export function buildAnonClient(storageKey: string): SupabaseClient {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    throw new Error('fixtures-community: SUPABASE_URL and SUPABASE_ANON_KEY required');
  }
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false, storageKey },
  });
}

// ---------------------------------------------------------------------------
// Environment availability check
// ---------------------------------------------------------------------------

export const SHOULD_RUN = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY && SUPABASE_SERVICE_ROLE_KEY);

// ---------------------------------------------------------------------------
// User creation + token helper
// ---------------------------------------------------------------------------

export interface TestUser {
  id: string;
  email: string;
  accessToken: () => Promise<string>;
}

/**
 * createOrgScopedUser — creates an auth user and optionally seeds them as an
 * org_member of the given org.
 *
 * @param admin - Service-role client for setup
 * @param email - Unique email for this test user
 * @param orgId - If provided, inserts an org_members row linking user to this org
 * @returns TestUser with id, email, and accessToken() helper
 */
export async function createOrgScopedUser(
  admin: SupabaseClient,
  email: string,
  orgId?: string,
): Promise<TestUser> {
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: `Pass1234-${crypto.randomUUID().slice(0, 8)}`,
    email_confirm: true,
  });
  if (error) throw new Error(`createOrgScopedUser ${email}: ${error.message}`);
  const userId = data.user!.id;

  // Seed org_members row if orgId provided
  if (orgId) {
    const { error: omErr } = await admin.from('org_members').insert({
      org_id: orgId,
      user_id: userId,
      role: 'member',
    });
    if (omErr) throw new Error(`org_members insert for ${email}: ${omErr.message}`);
  }

  return {
    id: userId,
    email,
    accessToken: () => getUserAccessToken(email),
  };
}

// ---------------------------------------------------------------------------
// Space + post seeding
// ---------------------------------------------------------------------------

export interface SpaceParams {
  name: string;
  minTier?: 'free' | 'pro' | 'lifetime';
  orgId?: string;
}

export interface SeededSpaceAndPost {
  spaceId: string;
  postId: string;
}

/**
 * seedSpaceAndPost — creates a community_spaces row and one community_posts row.
 * Uses the admin (service_role) client which bypasses RLS for setup.
 *
 * @param admin - Service-role client
 * @param authorId - user_id for the post author
 * @param spaceParams - space configuration
 * @returns seeded spaceId + postId
 */
export async function seedSpaceAndPost(
  admin: SupabaseClient,
  authorId: string,
  spaceParams: SpaceParams,
): Promise<SeededSpaceAndPost> {
  // Insert space
  const { data: spaceData, error: spaceErr } = await admin
    .from('community_spaces')
    .insert({
      name: spaceParams.name,
      org_id: spaceParams.orgId ?? null,
      min_tier: spaceParams.minTier ?? 'free',
    })
    .select('id')
    .single();
  if (spaceErr) throw new Error(`seedSpaceAndPost space insert: ${spaceErr.message}`);
  const spaceId = (spaceData as { id: string }).id;

  // Insert post
  const { data: postData, error: postErr } = await admin
    .from('community_posts')
    .insert({
      space_id: spaceId,
      author_id: authorId,
      body: 'Test post body for RLS fixture',
    })
    .select('id')
    .single();
  if (postErr) throw new Error(`seedSpaceAndPost post insert: ${postErr.message}`);
  const postId = (postData as { id: string }).id;

  return { spaceId, postId };
}

// ---------------------------------------------------------------------------
// Tier seeding helper
// ---------------------------------------------------------------------------

export type TierLabel = 'free' | 'trial' | 'pro' | 'lifetime';

/**
 * seedUserTier — seeds a subscription row to set the user's effective tier.
 *
 * Uses the `subscriptions` table (source for tier_effective view, Phase 43).
 * Status mapping:
 *   'free'     → no subscription row (tier_effective returns 'free' by default)
 *   'trial'    → status='trialing'
 *   'pro'      → status='active'
 *   'lifetime' → inserts into lifetime_purchases
 *
 * @param admin - Service-role client
 * @param userId - user to set tier for
 * @param tier - desired tier label
 * @returns subscription id (for cleanup) or null for 'free'
 */
export async function seedUserTier(
  admin: SupabaseClient,
  userId: string,
  tier: TierLabel,
  slugPrefix: string,
): Promise<string | null> {
  if (tier === 'free') return null; // No row needed — tier_effective defaults to 'free'

  if (tier === 'lifetime') {
    const { data, error } = await admin
      .from('lifetime_purchases')
      .insert({ user_id: userId, refunded_at: null })
      .select('id')
      .single();
    if (error) throw new Error(`seedUserTier lifetime for ${userId}: ${error.message}`);
    return (data as { id: string }).id;
  }

  // 'trial' → status='trialing'; 'pro' → status='active'
  const status = tier === 'trial' ? 'trialing' : 'active';
  const { data, error } = await admin
    .from('subscriptions')
    .insert({
      id: `sub_${slugPrefix}_${userId.slice(0, 8)}`,
      provider: 'stripe',
      user_id: userId,
      status,
      plan_id: 'price_test_community',
      current_period_end: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    })
    .select('id')
    .single();
  if (error) throw new Error(`seedUserTier ${tier} for ${userId}: ${error.message}`);
  return (data as { id: string }).id;
}
