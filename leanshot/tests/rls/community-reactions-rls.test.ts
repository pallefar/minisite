/**
 * Phase 44 Plan 01 — Community Reactions RLS: toggle idempotency + UNIQUE constraint.
 *
 * REQUIRES: supabase db push --linked completed (Wave 3 plan 44-10)
 *
 * Verifies, against the live cloud DB (ytnsipxxmzgaebkqmokp), that:
 *
 *   T-44-01 / COMMUNITY-02 (reaction toggle idempotency):
 *
 *   1. toggle_community_reaction is idempotent:
 *      - First call: INSERT; returns count=1, reacted_by_me=true.
 *      - Second call: ON CONFLICT DO DELETE removes the row; returns count=0, reacted_by_me=false.
 *      This proves the SECDEF RPC D-02 contract.
 *
 *   2. Raw INSERT with duplicate (user_id, target_type, target_id, emoji) returns
 *      Postgres error code 23505 (unique_violation).
 *      This proves the UNIQUE constraint acts as the authoritative idempotency gate.
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
let testUser: TestUser;
let spaceId: string;
let postId: string;

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describeIfLive('Phase 44 Plan 01 — Community Reactions RLS: toggle idempotency', () => {
  beforeAll(async () => {
    admin = buildAdmin();
    const ts = Date.now();

    // Create a test user with a free global space + post
    testUser = await createOrgScopedUser(
      admin,
      `${TEST_SLUG_PREFIX}-react-user-${ts}@leanshot.test`,
    );

    const seeded = await seedSpaceAndPost(admin, testUser.id, {
      name: `${TEST_SLUG_PREFIX}-reaction-space`,
      minTier: 'free',
    });
    spaceId = seeded.spaceId;
    postId = seeded.postId;
  }, 120_000);

  afterAll(async () => {
    if (!admin) return;
    // Clean up reactions first (FK dependency on community_posts)
    try {
      await admin
        .from('community_reactions')
        .delete()
        .eq('target_type', 'post')
        .eq('target_id', postId);
    } catch { /* best-effort */ }
    try { await admin.from('community_posts').delete().eq('id', postId); } catch { /* best-effort */ }
    try { await admin.from('community_spaces').delete().eq('id', spaceId); } catch { /* best-effort */ }
    if (testUser?.id) {
      try { await admin.auth.admin.deleteUser(testUser.id); } catch { /* best-effort */ }
    }
  }, 60_000);

  // ---------------------------------------------------------------------------
  // T-44-01 / COMMUNITY-02: toggle_community_reaction is idempotent
  // First call → inserts (count=1, reacted_by_me=true)
  // Second call → deletes (count=0, reacted_by_me=false)
  // ---------------------------------------------------------------------------

  it('toggle_community_reaction is idempotent — first call inserts, second call deletes', async () => {
    const token = await testUser.accessToken();
    const client = buildAnonClient(`${TEST_SLUG_PREFIX}-toggle-rpc`);

    // --- First call: INSERT ---
    const { data: call1Data, error: call1Err } = await client
      .rpc('toggle_community_reaction', {
        p_target_type: 'post',
        p_target_id: postId,
        p_emoji: 'like',
      })
      .setHeader('Authorization', `Bearer ${token}`);

    expect(call1Err).toBeNull();
    const call1Rows = call1Data as Array<{ emoji: string; count: number; reacted_by_me: boolean }>;
    const likeRow1 = call1Rows.find((r) => r.emoji === 'like');
    expect(likeRow1).toBeDefined();
    expect(likeRow1!.count).toBe(1);         // reaction was added
    expect(likeRow1!.reacted_by_me).toBe(true);

    // --- Second call: DELETE (toggle off) ---
    const { data: call2Data, error: call2Err } = await client
      .rpc('toggle_community_reaction', {
        p_target_type: 'post',
        p_target_id: postId,
        p_emoji: 'like',
      })
      .setHeader('Authorization', `Bearer ${token}`);

    expect(call2Err).toBeNull();
    const call2Rows = call2Data as Array<{ emoji: string; count: number; reacted_by_me: boolean }>;
    // After toggle-off: no 'like' row in aggregate (count=0), OR row has count=0
    const likeRow2 = call2Rows.find((r) => r.emoji === 'like');
    if (likeRow2) {
      // Row returned with count=0 if implementation returns zeros
      expect(likeRow2.count).toBe(0);
      expect(likeRow2.reacted_by_me).toBe(false);
    } else {
      // Row absent from aggregate (most likely: empty result set = count=0)
      expect(call2Rows.length).toBe(0);
    }
  }, 30_000);

  // ---------------------------------------------------------------------------
  // COMMUNITY-02: UNIQUE constraint rejects duplicate raw INSERT
  // Second INSERT with same (user_id, target_type, target_id, emoji) → 23505
  // ---------------------------------------------------------------------------

  it('Reactions UNIQUE constraint rejects duplicate raw INSERT with 23505', async () => {
    const token = await testUser.accessToken();
    const client = buildAnonClient(`${TEST_SLUG_PREFIX}-unique-chk`);

    const reactionPayload = {
      user_id: testUser.id,
      target_type: 'post' as const,
      target_id: postId,
      emoji: 'heart',
    };

    // First INSERT should succeed
    const { error: firstErr } = await client
      .from('community_reactions')
      .insert(reactionPayload)
      .setHeader('Authorization', `Bearer ${token}`);
    expect(firstErr).toBeNull();

    // Second INSERT with identical (user_id, target_type, target_id, emoji) → unique_violation
    const { error: secondErr } = await client
      .from('community_reactions')
      .insert(reactionPayload)
      .setHeader('Authorization', `Bearer ${token}`);

    expect(secondErr).not.toBeNull();
    // PostgreSQL error code 23505 = unique_violation
    // PostgREST surfaces this in error.code or within error.message
    const errStr = JSON.stringify(secondErr);
    expect(errStr).toMatch(/23505|unique_violation|duplicate key/i);

    // Cleanup: remove the heart reaction that was inserted
    try {
      await admin
        .from('community_reactions')
        .delete()
        .eq('user_id', testUser.id)
        .eq('target_type', 'post')
        .eq('target_id', postId)
        .eq('emoji', 'heart');
    } catch { /* best-effort */ }
  }, 30_000);
});

// ---------------------------------------------------------------------------
// Gating test — always passes, warns when skipped
// ---------------------------------------------------------------------------

describe('Phase 44 community-reactions-rls — gating', () => {
  it('runs against live cloud DB when SUPABASE_SERVICE_ROLE_KEY is set', () => {
    if (!SHOULD_RUN) {
      // eslint-disable-next-line no-console
      console.warn(
        '[community-reactions-rls.test] SKIPPED — SUPABASE_SERVICE_ROLE_KEY (or URL/ANON) not set. Wave 3 plan 44-10 gates this.',
      );
    }
    expect(true).toBe(true);
  });
});

