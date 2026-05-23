// REQUIRES: 44-10 supabase db push --linked + supabase functions deploy + MUX_TOKEN_ID/MUX_TOKEN_SECRET set in Function Secrets
/**
 * Phase 44 Plan 44-05 — COMMUNITY-03 integration test.
 *
 * Verifies, against the live cloud DB (ytnsipxxmzgaebkqmokp), that:
 *
 *   T-44-05-I-01: notify-community with toggle=true → user_notifications row created for bob
 *   T-44-05-I-02: notify-community with toggle=false → no new notification row for bob
 *   T-44-05-I-03: notify-community with ALICE's user JWT + mentioned_by_user_id===alice.id → fan-out proceeds
 *   T-44-05-I-04: notify-community with ALICE's user JWT + mentioned_by_user_id===bob.id → 403 identity_mismatch (T-44-08)
 *   T-44-05-I-05: Self-mention (alice mentions alice) → fanout_count=0
 *
 * Pattern follows notification-settings-rls.test.ts (Phase 42):
 *   - admin createClient with service_role for setup/teardown
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

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { getUserAccessToken } from '../rls/helpers/admin-session';

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? '';
const SUPABASE_ANON_KEY =
  process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY ?? '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

const SHOULD_RUN = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY && SUPABASE_SERVICE_ROLE_KEY);
const describeIfLive = SHOULD_RUN ? describe : describe.skip;

// ---------------------------------------------------------------------------
// File-scoped prefix per feedback_rls_per_file_slug_prefix
// ---------------------------------------------------------------------------

const TEST_SLUG_PREFIX = `p44notif_${Date.now()}`;

// ---------------------------------------------------------------------------
// Admin client helper
// ---------------------------------------------------------------------------

function buildAdmin(): SupabaseClient {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('buildAdmin: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY required');
  }
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

// ---------------------------------------------------------------------------
// Module-level state
// ---------------------------------------------------------------------------

let admin: SupabaseClient;

interface TestUser {
  id: string;
  email: string;
}

let alice: TestUser;
let bob: TestUser;

let spaceId: string;
let postId: string;

// IDs for cleanup
const cleanupNotificationIds: string[] = [];

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/**
 * Calls the notify-community Edge Fn with the provided bearer and body.
 * Returns the parsed JSON response and HTTP status.
 */
async function callNotifyCommunity(
  bearer: string,
  body: Record<string, unknown>,
): Promise<{ status: number; json: unknown }> {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/notify-community`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${bearer}`,
    },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  return { status: res.status, json };
}

/**
 * Count user_notifications rows for a user/category added AFTER the given time.
 */
async function countNotifications(
  userId: string,
  category: string,
  afterMs: number,
): Promise<number> {
  const afterIso = new Date(afterMs).toISOString();
  const { count, error } = await (admin.from('user_notifications') as unknown as {
    select(cols: string, opts: object): {
      eq(col: string, val: string): {
        gte(col: string, val: string): Promise<{ count: number | null; error: unknown }>;
      };
    };
  })
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('category', category)
    .gte('created_at', afterIso);

  if (error) throw new Error(`countNotifications error: ${JSON.stringify(error)}`);
  return count ?? 0;
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describeIfLive('COMMUNITY-03: notify-community integration', () => {
  beforeAll(async () => {
    admin = buildAdmin();
    const ts = Date.now();

    // Create alice (pro tier sender) and bob (free tier recipient)
    const aliceEmail = `${TEST_SLUG_PREFIX}_alice_${ts}@test.leanshot.app`;
    const bobEmail = `${TEST_SLUG_PREFIX}_bob_${ts}@test.leanshot.app`;

    const { data: aliceData, error: aliceErr } = await admin.auth.admin.createUser({
      email: aliceEmail,
      password: `Pass1234-${crypto.randomUUID().slice(0, 8)}`,
      email_confirm: true,
    });
    if (aliceErr) throw new Error(`alice create: ${aliceErr.message}`);
    alice = { id: aliceData.user!.id, email: aliceEmail };

    const { data: bobData, error: bobErr } = await admin.auth.admin.createUser({
      email: bobEmail,
      password: `Pass1234-${crypto.randomUUID().slice(0, 8)}`,
      email_confirm: true,
    });
    if (bobErr) throw new Error(`bob create: ${bobErr.message}`);
    bob = { id: bobData.user!.id, email: bobEmail };

    // Create a free community space
    const { data: spaceData, error: spaceErr } = await admin
      .from('community_spaces')
      .insert({
        name: `${TEST_SLUG_PREFIX} Test Space`,
        org_id: null,
        min_tier: 'free',
      })
      .select('id')
      .single();
    if (spaceErr) throw new Error(`space insert: ${spaceErr.message}`);
    spaceId = (spaceData as { id: string }).id;

    // Create a post by alice mentioning bob
    const { data: postData, error: postErr } = await admin
      .from('community_posts')
      .insert({
        space_id: spaceId,
        author_id: alice.id,
        body: `Hello @${TEST_SLUG_PREFIX}_bob`,
      })
      .select('id')
      .single();
    if (postErr) throw new Error(`post insert: ${postErr.message}`);
    postId = (postData as { id: string }).id;

    // Insert community_post_mentions row for bob
    const { error: mentionErr } = await admin
      .from('community_post_mentions')
      .insert({ post_id: postId, user_id: bob.id });
    if (mentionErr) throw new Error(`mention insert: ${mentionErr.message}`);

    // Ensure bob has community_mentions ENABLED (default) via notification_settings upsert
    await admin.from('notification_settings').upsert(
      { user_id: bob.id, category: 'community-mentions', channel: 'in-app', enabled: true },
      { onConflict: 'user_id,category,channel' },
    );
  });

  afterAll(async () => {
    if (!admin) return;

    // Cleanup: notifications
    for (const id of cleanupNotificationIds) {
      await admin.from('user_notifications').delete().eq('id', id);
    }

    // Cleanup: mention rows
    if (postId) {
      await admin.from('community_post_mentions').delete().eq('post_id', postId);
    }

    // Cleanup: posts, spaces
    if (postId) await admin.from('community_posts').delete().eq('id', postId);
    if (spaceId) await admin.from('community_spaces').delete().eq('id', spaceId);

    // Cleanup: notification_settings
    if (bob?.id) {
      await admin
        .from('notification_settings')
        .delete()
        .eq('user_id', bob.id)
        .eq('category', 'community-mentions');
    }

    // Cleanup: users
    if (alice?.id) await admin.auth.admin.deleteUser(alice.id);
    if (bob?.id) await admin.auth.admin.deleteUser(bob.id);
  });

  it('T-44-05-I-01: toggle=true → user_notifications row created for bob', async () => {
    const beforeMs = Date.now();

    const { status, json } = await callNotifyCommunity(SUPABASE_SERVICE_ROLE_KEY, {
      kind: 'mention',
      target_type: 'post',
      target_id: postId,
      space_id: spaceId,
      mentioned_by_user_id: alice.id,
      mentioned_by_name: 'alice',
    });

    expect(status).toBe(200);
    expect((json as { fanout_count: number }).fanout_count).toBe(1);

    // Wait up to 5s for the notification to appear
    let rowCount = 0;
    for (let i = 0; i < 10; i++) {
      rowCount = await countNotifications(bob.id, 'community-mentions', beforeMs);
      if (rowCount >= 1) break;
      await new Promise((r) => setTimeout(r, 500));
    }
    expect(rowCount).toBeGreaterThanOrEqual(1);
  });

  it('T-44-05-I-02: toggle=false → no new notification row for bob', async () => {
    // Disable community-mentions for bob
    await admin.from('notification_settings').upsert(
      { user_id: bob.id, category: 'community-mentions', channel: 'in-app', enabled: false },
      { onConflict: 'user_id,category,channel' },
    );

    // Insert a new post + mention for this test
    const { data: postData2, error: postErr2 } = await admin
      .from('community_posts')
      .insert({
        space_id: spaceId,
        author_id: alice.id,
        body: `Another mention @${TEST_SLUG_PREFIX}_bob (toggle=false)`,
      })
      .select('id')
      .single();
    if (postErr2) throw new Error(`post2 insert: ${postErr2.message}`);
    const postId2 = (postData2 as { id: string }).id;

    await admin
      .from('community_post_mentions')
      .insert({ post_id: postId2, user_id: bob.id });

    const beforeMs = Date.now();
    const countBefore = await countNotifications(bob.id, 'community-mentions', 0);

    const { status } = await callNotifyCommunity(SUPABASE_SERVICE_ROLE_KEY, {
      kind: 'mention',
      target_type: 'post',
      target_id: postId2,
      space_id: spaceId,
      mentioned_by_user_id: alice.id,
      mentioned_by_name: 'alice',
    });
    expect(status).toBe(200);

    // Wait a moment for any async processing
    await new Promise((r) => setTimeout(r, 2000));
    const countAfter = await countNotifications(bob.id, 'community-mentions', beforeMs);
    expect(countAfter).toBe(0);

    // Cleanup
    await admin.from('community_post_mentions').delete().eq('post_id', postId2);
    await admin.from('community_posts').delete().eq('id', postId2);

    // Re-enable for later tests
    await admin.from('notification_settings').upsert(
      { user_id: bob.id, category: 'community-mentions', channel: 'in-app', enabled: true },
      { onConflict: 'user_id,category,channel' },
    );
  });

  it('T-44-05-I-03: ALICE user JWT + mentioned_by_user_id===alice.id → fan-out proceeds', async () => {
    // Get alice's access token
    const aliceToken = await getUserAccessToken(alice.email);

    // Insert a new post + mention for this test
    const { data: postData3, error: postErr3 } = await admin
      .from('community_posts')
      .insert({
        space_id: spaceId,
        author_id: alice.id,
        body: `JWT auth test mention @${TEST_SLUG_PREFIX}_bob`,
      })
      .select('id')
      .single();
    if (postErr3) throw new Error(`post3 insert: ${postErr3.message}`);
    const postId3 = (postData3 as { id: string }).id;

    await admin
      .from('community_post_mentions')
      .insert({ post_id: postId3, user_id: bob.id });

    const { status, json } = await callNotifyCommunity(aliceToken, {
      kind: 'mention',
      target_type: 'post',
      target_id: postId3,
      space_id: spaceId,
      mentioned_by_user_id: alice.id, // JWT.sub === alice.id — should pass
      mentioned_by_name: 'alice',
    });

    expect(status).toBe(200);
    expect((json as { fanout_count: number }).fanout_count).toBe(1);

    // Cleanup
    await admin.from('community_post_mentions').delete().eq('post_id', postId3);
    await admin.from('community_posts').delete().eq('id', postId3);
  });

  it('T-44-05-I-04: ALICE user JWT + mentioned_by_user_id===bob.id → 403 identity_mismatch', async () => {
    // Alice's token but body claims Bob sent it — impersonation (T-44-08)
    const aliceToken = await getUserAccessToken(alice.email);

    const { status, json } = await callNotifyCommunity(aliceToken, {
      kind: 'mention',
      target_type: 'post',
      target_id: postId,
      space_id: spaceId,
      mentioned_by_user_id: bob.id, // JWT.sub=alice but claims bob → identity_mismatch
      mentioned_by_name: 'bob',
    });

    expect(status).toBe(403);
    expect((json as { error: string }).error).toBe('identity_mismatch');
  });

  it('T-44-05-I-05: self-mention (alice mentions alice) → fanout_count=0', async () => {
    // Insert a mention row where alice mentions herself
    const { data: selfPostData, error: selfPostErr } = await admin
      .from('community_posts')
      .insert({
        space_id: spaceId,
        author_id: alice.id,
        body: 'Self mention test',
      })
      .select('id')
      .single();
    if (selfPostErr) throw new Error(`self-post insert: ${selfPostErr.message}`);
    const selfPostId = (selfPostData as { id: string }).id;

    // Insert mention row where user_id === alice (self-mention)
    await admin
      .from('community_post_mentions')
      .insert({ post_id: selfPostId, user_id: alice.id });

    const { status, json } = await callNotifyCommunity(SUPABASE_SERVICE_ROLE_KEY, {
      kind: 'mention',
      target_type: 'post',
      target_id: selfPostId,
      space_id: spaceId,
      mentioned_by_user_id: alice.id, // alice is both sender and recipient
      mentioned_by_name: 'alice',
    });

    expect(status).toBe(200);
    expect((json as { fanout_count: number }).fanout_count).toBe(0);

    // Cleanup
    await admin.from('community_post_mentions').delete().eq('post_id', selfPostId);
    await admin.from('community_posts').delete().eq('id', selfPostId);
  });
});
