// REQUIRES: 44-10 supabase db push --linked + supabase functions deploy + MUX_TOKEN_ID/MUX_TOKEN_SECRET set in Function Secrets
/**
 * Phase 44 Plan 44-05 — COMMUNITY-04 integration test (T-44-02).
 *
 * Verifies, against the live cloud DB (ytnsipxxmzgaebkqmokp), that:
 *
 *   T-44-05-MUX-01: Free-tier user calling mux-create-upload → 403 VIDEO_TIER_REQUIRED
 *   T-44-05-MUX-02: Pro-tier user calling mux-create-upload → 200 (url + upload_id in body)
 *   T-44-05-MUX-03: Missing bearer → 401
 *   T-44-05-MUX-04: Trial-tier user calling mux-create-upload → 200 (Claude's Discretion)
 *
 * Pattern follows notification-settings-rls.test.ts (Phase 42):
 *   - admin createClient with service_role for setup/teardown
 *   - getUserAccessToken (admin.generateLink + /auth/v1/verify) per
 *     reference_rls_fixture_gotrueclient_flake (NOT signInWithPassword)
 *   - file-scoped TEST_SLUG_PREFIX per feedback_rls_per_file_slug_prefix
 *
 * Test 2 (Pro 200) body assertions are gated behind MUX_REAL_KEY env var
 * so CI can run this with a sandbox key without triggering real Mux upload.
 *
 * Environment:
 *   SUPABASE_URL              — public
 *   SUPABASE_ANON_KEY         — public
 *   SUPABASE_SERVICE_ROLE_KEY — PRIVATE (CI secret)
 *   MUX_REAL_KEY              — optional; set in post-44-10 env to assert upload URL
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

const TEST_SLUG_PREFIX = `p44mux_${Date.now()}`;

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

let charlie: TestUser; // Free-tier
let dave: TestUser;    // Pro-tier
let evan: TestUser;    // Trial-tier

// Subscription IDs for cleanup
let daveSubId: string | null = null;
let evanSubId: string | null = null;

// A real post ID for the request body (mux-create-upload requires a valid post_id)
let testPostId: string;
let testSpaceId: string;

// ---------------------------------------------------------------------------
// Test helper
// ---------------------------------------------------------------------------

/**
 * Calls the mux-create-upload Edge Fn with the provided bearer and body.
 */
async function callMuxCreateUpload(
  bearerOrNull: string | null,
  body: Record<string, unknown>,
): Promise<{ status: number; json: unknown }> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (bearerOrNull !== null) {
    headers['Authorization'] = `Bearer ${bearerOrNull}`;
  }
  const res = await fetch(`${SUPABASE_URL}/functions/v1/mux-create-upload`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  let json: unknown;
  try {
    json = await res.json();
  } catch {
    json = null;
  }
  return { status: res.status, json };
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describeIfLive('COMMUNITY-04: mux-create-upload tier gate', () => {
  beforeAll(async () => {
    admin = buildAdmin();
    const ts = Date.now();

    // Create charlie (free), dave (pro), evan (trial)
    const charlieEmail = `${TEST_SLUG_PREFIX}_charlie_${ts}@test.leanshot.app`;
    const daveEmail = `${TEST_SLUG_PREFIX}_dave_${ts}@test.leanshot.app`;
    const evanEmail = `${TEST_SLUG_PREFIX}_evan_${ts}@test.leanshot.app`;

    const { data: charlieData, error: charlieErr } = await admin.auth.admin.createUser({
      email: charlieEmail,
      password: `Pass1234-${crypto.randomUUID().slice(0, 8)}`,
      email_confirm: true,
    });
    if (charlieErr) throw new Error(`charlie create: ${charlieErr.message}`);
    charlie = { id: charlieData.user!.id, email: charlieEmail };

    const { data: daveData, error: daveErr } = await admin.auth.admin.createUser({
      email: daveEmail,
      password: `Pass1234-${crypto.randomUUID().slice(0, 8)}`,
      email_confirm: true,
    });
    if (daveErr) throw new Error(`dave create: ${daveErr.message}`);
    dave = { id: daveData.user!.id, email: daveEmail };

    const { data: evanData, error: evanErr } = await admin.auth.admin.createUser({
      email: evanEmail,
      password: `Pass1234-${crypto.randomUUID().slice(0, 8)}`,
      email_confirm: true,
    });
    if (evanErr) throw new Error(`evan create: ${evanErr.message}`);
    evan = { id: evanData.user!.id, email: evanEmail };

    // Seed dave as pro (status='active')
    const { data: daveSubData, error: daveSubErr } = await admin
      .from('subscriptions')
      .insert({
        id: `sub_${TEST_SLUG_PREFIX}_${dave.id.slice(0, 8)}`,
        provider: 'stripe',
        user_id: dave.id,
        status: 'active',
        plan_id: 'price_test_community',
        current_period_end: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      })
      .select('id')
      .single();
    if (daveSubErr) throw new Error(`dave sub insert: ${daveSubErr.message}`);
    daveSubId = (daveSubData as { id: string }).id;

    // Seed evan as trial (status='trialing')
    const { data: evanSubData, error: evanSubErr } = await admin
      .from('subscriptions')
      .insert({
        id: `sub_${TEST_SLUG_PREFIX}_${evan.id.slice(0, 8)}`,
        provider: 'stripe',
        user_id: evan.id,
        status: 'trialing',
        plan_id: 'price_test_community',
        current_period_end: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      })
      .select('id')
      .single();
    if (evanSubErr) throw new Error(`evan sub insert: ${evanSubErr.message}`);
    evanSubId = (evanSubData as { id: string }).id;

    // Create a space + post for dave (so we have a real post_id to send)
    const { data: spaceData, error: spaceErr } = await admin
      .from('community_spaces')
      .insert({ name: `${TEST_SLUG_PREFIX} Mux Test Space`, org_id: null, min_tier: 'free' })
      .select('id')
      .single();
    if (spaceErr) throw new Error(`space insert: ${spaceErr.message}`);
    testSpaceId = (spaceData as { id: string }).id;

    const { data: postData, error: postErr } = await admin
      .from('community_posts')
      .insert({ space_id: testSpaceId, author_id: dave.id, body: 'Video post placeholder' })
      .select('id')
      .single();
    if (postErr) throw new Error(`post insert: ${postErr.message}`);
    testPostId = (postData as { id: string }).id;
  });

  afterAll(async () => {
    if (!admin) return;

    // Cleanup: posts, spaces
    if (testPostId) await admin.from('community_posts').delete().eq('id', testPostId);
    if (testSpaceId) await admin.from('community_spaces').delete().eq('id', testSpaceId);

    // Cleanup: subscriptions
    if (daveSubId) await admin.from('subscriptions').delete().eq('id', daveSubId);
    if (evanSubId) await admin.from('subscriptions').delete().eq('id', evanSubId);

    // Cleanup: users
    if (charlie?.id) await admin.auth.admin.deleteUser(charlie.id);
    if (dave?.id) await admin.auth.admin.deleteUser(dave.id);
    if (evan?.id) await admin.auth.admin.deleteUser(evan.id);
  });

  it('T-44-05-MUX-01: Free user → 403 VIDEO_TIER_REQUIRED', async () => {
    const charlieToken = await getUserAccessToken(charlie.email);

    const { status, json } = await callMuxCreateUpload(charlieToken, {
      post_id: testPostId,
    });

    expect(status).toBe(403);
    expect((json as { error: string }).error).toBe('VIDEO_TIER_REQUIRED');
  });

  it('T-44-05-MUX-02: Pro user → 200 with url and upload_id', async () => {
    const daveToken = await getUserAccessToken(dave.email);

    const { status, json } = await callMuxCreateUpload(daveToken, {
      post_id: testPostId,
    });

    expect(status).toBe(200);

    // Gated behind MUX_REAL_KEY per plan spec: only assert body shape when real key is present
    if (process.env.MUX_REAL_KEY) {
      const body = json as { url?: string; upload_id?: string };
      expect(typeof body.url).toBe('string');
      expect(typeof body.upload_id).toBe('string');
    }
  });

  it('T-44-05-MUX-03: Missing bearer → 401', async () => {
    const { status } = await callMuxCreateUpload(null, { post_id: testPostId });
    expect(status).toBe(401);
  });

  it('T-44-05-MUX-04: Trial user → 200 (Claude\'s Discretion — trial = Pro access)', async () => {
    const evanToken = await getUserAccessToken(evan.email);

    const { status } = await callMuxCreateUpload(evanToken, { post_id: testPostId });
    expect(status).toBe(200);
  });
});
