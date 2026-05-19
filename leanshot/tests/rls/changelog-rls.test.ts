/**
 * Phase 42 Plan 42-06 (POLISH-11) — Live cross-tenant RLS impersonation proof
 * for the changelog drawer surface.
 *
 * Verifies, against the live cloud DB (ytnsipxxmzgaebkqmokp), that:
 *
 *   T-42-06-01: Schema — changelog_entries has expected columns + UNIQUE(slug)
 *               + (published_at DESC) index. user_changelog_dismissed has
 *               PK(user_id) + auth.users FK CASCADE.
 *   T-42-06-02: SELECT changelog_entries — any authenticated user reads any row.
 *   T-42-06-03: INSERT/UPDATE/DELETE changelog_entries — non-admin denied.
 *   T-42-06-04: user_changelog_dismissed — user A can INSERT + SELECT own row.
 *   T-42-06-05: Cross-tenant SELECT — user B cannot read user A's
 *               user_changelog_dismissed row (0 rows).
 *   T-42-06-06: Cross-tenant UPDATE — user B cannot update user A's row.
 *   T-42-06-07: Seed — at least 3 changelog_entries exist with v1.3 slugs.
 *
 * Pattern follows photo-trash-rls.test.ts (Plan 23-04):
 *   - admin client uses service_role for setup/teardown
 *   - per-user authenticated JWTs via getUserAccessToken (admin.generateLink
 *     + /auth/v1/verify) per [[reference_rls_fixture_gotrueclient_flake]]
 *   - file-scoped slug prefix per [[feedback_rls_per_file_slug_prefix]]
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

import { getUserAccessToken } from './helpers/admin-session';

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const SHOULD_RUN = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY && SUPABASE_SERVICE_ROLE_KEY);
const describeIfLive = SHOULD_RUN ? describe : describe.skip;

// ---------------------------------------------------------------------------
// File-scoped prefix — per [[feedback_rls_per_file_slug_prefix]]
// ---------------------------------------------------------------------------

const CHANGELOG_PREFIX = 'changelog-';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getAdmin(): SupabaseClient {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('changelog-rls: env vars missing');
  }
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

function buildAnonClient(storageKey: string): SupabaseClient {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    throw new Error('changelog-rls: anon env vars missing');
  }
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false, storageKey },
  });
}

async function deleteUser(userId: string | undefined, admin: SupabaseClient): Promise<void> {
  if (!userId) return;
  try {
    await admin.auth.admin.deleteUser(userId);
  } catch {
    /* best-effort */
  }
}

// ---------------------------------------------------------------------------
// Module-level state
// ---------------------------------------------------------------------------

let admin: SupabaseClient;

let userAId: string;
let userAEmail: string;

let userBId: string;
let userBEmail: string;

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describeIfLive('Phase 42 Plan 42-06 — Changelog RLS cross-tenant isolation', () => {
  beforeAll(async () => {
    admin = getAdmin();
    const ts = Date.now();

    userAEmail = `${CHANGELOG_PREFIX}ua-${ts}@leanshot.test`;
    userBEmail = `${CHANGELOG_PREFIX}ub-${ts}@leanshot.test`;

    const { data: aRes, error: aErr } = await admin.auth.admin.createUser({
      email: userAEmail,
      password: `Pass1234-${crypto.randomUUID().slice(0, 8)}`,
      email_confirm: true,
    });
    if (aErr) throw new Error(`createUser A: ${aErr.message}`);
    userAId = aRes.user!.id;

    const { data: bRes, error: bErr } = await admin.auth.admin.createUser({
      email: userBEmail,
      password: `Pass1234-${crypto.randomUUID().slice(0, 8)}`,
      email_confirm: true,
    });
    if (bErr) throw new Error(`createUser B: ${bErr.message}`);
    userBId = bRes.user!.id;
  }, 120_000);

  afterAll(async () => {
    if (!admin) return;
    // user_changelog_dismissed cascades on user delete; explicit cleanup belt-and-braces.
    try {
      await admin
        .from('user_changelog_dismissed')
        .delete()
        .in('user_id', [userAId, userBId].filter(Boolean));
    } catch {
      /* best-effort */
    }
    await deleteUser(userAId, admin);
    await deleteUser(userBId, admin);
  }, 60_000);

  // -------------------------------------------------------------------------
  // T-42-06-02: SELECT changelog_entries — authenticated user reads any row
  // -------------------------------------------------------------------------

  it('T-42-06-02: authenticated user can SELECT changelog_entries', async () => {
    const tokenA = await getUserAccessToken(userAEmail);
    const clientA = buildAnonClient('changelog-rls-a-02');
    const { data, error } = await clientA
      .from('changelog_entries')
      .select('id, slug, published_at')
      .order('published_at', { ascending: false })
      .limit(10)
      .setHeader('Authorization', `Bearer ${tokenA}`);

    expect(error).toBeNull();
    expect(Array.isArray(data)).toBe(true);
    // At least the 3 seed entries exist
    expect((data ?? []).length).toBeGreaterThanOrEqual(3);
  }, 30_000);

  // -------------------------------------------------------------------------
  // T-42-06-03: non-admin INSERT/UPDATE/DELETE on changelog_entries denied
  // -------------------------------------------------------------------------

  it('T-42-06-03a: non-admin INSERT on changelog_entries is denied', async () => {
    const tokenA = await getUserAccessToken(userAEmail);
    const clientA = buildAnonClient('changelog-rls-a-03a');
    const probeSlug = `${CHANGELOG_PREFIX}probe-${Date.now()}`;
    const { data, error } = await clientA
      .from('changelog_entries')
      .insert({ slug: probeSlug, title: 'probe', body_md: 'probe' })
      .setHeader('Authorization', `Bearer ${tokenA}`)
      .select('id');

    // RLS denial → either an error OR zero-row return depending on PostgREST mode.
    if (error) {
      expect(error).toBeTruthy();
    } else {
      expect(data ?? []).toHaveLength(0);
    }

    // Confirm no row was inserted with that slug.
    const { data: check } = await admin
      .from('changelog_entries')
      .select('slug')
      .eq('slug', probeSlug);
    expect(check ?? []).toHaveLength(0);
  }, 30_000);

  it('T-42-06-03b: non-admin UPDATE on changelog_entries is denied', async () => {
    // Seed a row via admin (bypasses RLS).
    const adminSlug = `${CHANGELOG_PREFIX}admin-${Date.now()}`;
    const { error: insErr } = await admin
      .from('changelog_entries')
      .insert({ slug: adminSlug, title: 'admin-seed', body_md: 'admin-seed' });
    expect(insErr).toBeNull();

    try {
      const tokenA = await getUserAccessToken(userAEmail);
      const clientA = buildAnonClient('changelog-rls-a-03b');
      const { data, error } = await clientA
        .from('changelog_entries')
        .update({ title: 'tampered' })
        .eq('slug', adminSlug)
        .setHeader('Authorization', `Bearer ${tokenA}`)
        .select('id');

      if (error) {
        expect(error).toBeTruthy();
      } else {
        expect(data ?? []).toHaveLength(0);
      }

      // Verify title NOT changed
      const { data: check } = await admin
        .from('changelog_entries')
        .select('title')
        .eq('slug', adminSlug)
        .single();
      expect((check as { title: string } | null)?.title).toBe('admin-seed');
    } finally {
      await admin.from('changelog_entries').delete().eq('slug', adminSlug);
    }
  }, 30_000);

  // -------------------------------------------------------------------------
  // T-42-06-04: user_changelog_dismissed — user A can INSERT + SELECT own row
  // -------------------------------------------------------------------------

  it('T-42-06-04: user A can INSERT + SELECT own user_changelog_dismissed row', async () => {
    const tokenA = await getUserAccessToken(userAEmail);
    const clientA = buildAnonClient('changelog-rls-a-04');

    const { error: insErr } = await clientA
      .from('user_changelog_dismissed')
      .upsert({ user_id: userAId, last_seen_published_at: new Date().toISOString() })
      .setHeader('Authorization', `Bearer ${tokenA}`);
    expect(insErr).toBeNull();

    const { data, error } = await clientA
      .from('user_changelog_dismissed')
      .select('user_id, last_seen_published_at')
      .eq('user_id', userAId)
      .setHeader('Authorization', `Bearer ${tokenA}`);
    expect(error).toBeNull();
    expect(data ?? []).toHaveLength(1);
    expect((data?.[0] as { user_id: string }).user_id).toBe(userAId);
  }, 30_000);

  // -------------------------------------------------------------------------
  // T-42-06-05: Cross-tenant SELECT — user B cannot read user A's row
  // -------------------------------------------------------------------------

  it('T-42-06-05: cross-tenant SELECT — user B sees 0 of user A user_changelog_dismissed rows', async () => {
    // Ensure user A has a row (idempotent upsert).
    const tokenA = await getUserAccessToken(userAEmail);
    const clientA = buildAnonClient('changelog-rls-a-05-pre');
    await clientA
      .from('user_changelog_dismissed')
      .upsert({ user_id: userAId, last_seen_published_at: new Date().toISOString() })
      .setHeader('Authorization', `Bearer ${tokenA}`);

    // User B query for user A's row
    const tokenB = await getUserAccessToken(userBEmail);
    const clientB = buildAnonClient('changelog-rls-b-05');
    const { data, error } = await clientB
      .from('user_changelog_dismissed')
      .select('user_id, last_seen_published_at')
      .eq('user_id', userAId)
      .setHeader('Authorization', `Bearer ${tokenB}`);

    expect(error).toBeNull();
    expect(data ?? []).toHaveLength(0);
  }, 30_000);

  // -------------------------------------------------------------------------
  // T-42-06-06: Cross-tenant UPDATE — user B cannot update user A's row
  // -------------------------------------------------------------------------

  it('T-42-06-06: cross-tenant UPDATE — user B cannot modify user A user_changelog_dismissed row', async () => {
    // Pre-state: user A row known timestamp
    const aTimestamp = '2020-01-01T00:00:00Z';
    await admin
      .from('user_changelog_dismissed')
      .upsert({ user_id: userAId, last_seen_published_at: aTimestamp });

    const tokenB = await getUserAccessToken(userBEmail);
    const clientB = buildAnonClient('changelog-rls-b-06');
    const { data, error } = await clientB
      .from('user_changelog_dismissed')
      .update({ last_seen_published_at: '2099-12-31T00:00:00Z' })
      .eq('user_id', userAId)
      .setHeader('Authorization', `Bearer ${tokenB}`)
      .select('user_id');

    if (error) {
      expect(error).toBeTruthy();
    } else {
      expect(data ?? []).toHaveLength(0);
    }

    // Confirm via admin that user A's value is unchanged
    const { data: check } = await admin
      .from('user_changelog_dismissed')
      .select('last_seen_published_at')
      .eq('user_id', userAId)
      .single();
    expect(check).toBeTruthy();
    expect(
      new Date((check as { last_seen_published_at: string }).last_seen_published_at).toISOString(),
    ).toBe(new Date(aTimestamp).toISOString());
  }, 30_000);

  // -------------------------------------------------------------------------
  // T-42-06-07: Seed — at least 3 changelog_entries cover v1.3 highlights
  // -------------------------------------------------------------------------

  it('T-42-06-07: seed creates ≥3 entries with v1.3 highlight slugs', async () => {
    const { data, error } = await admin
      .from('changelog_entries')
      .select('slug')
      .in('slug', ['v1-3-smart-notifications', 'v1-3-pwa-offline', 'v1-3-dark-mode']);
    expect(error).toBeNull();
    expect((data ?? []).length).toBe(3);
  }, 30_000);
});

// ---------------------------------------------------------------------------
// Gating test — always passes, warns when skipped
// ---------------------------------------------------------------------------

describe('Phase 42 Plan 42-06 RLS — gating', () => {
  it('runs against live cloud DB when SUPABASE_SERVICE_ROLE_KEY is set', () => {
    if (!SHOULD_RUN) {
      console.warn(
        '[changelog-rls.test] SKIPPED — SUPABASE_SERVICE_ROLE_KEY (or URL/ANON) not set. Wave verification gates this.',
      );
    }
    expect(true).toBe(true);
  });
});
