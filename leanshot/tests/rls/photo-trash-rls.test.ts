/**
 * Phase 23 Plan 23-04 (DEBT-03) — Live cross-tenant RLS impersonation proof
 * for the photo trash flow surface.
 *
 * Verifies, against the live cloud DB (ytnsipxxmzgaebkqmokp), that:
 *
 *   T-23-04-01: Main-grid SELECT (trashed_at IS NULL filter) — user A sees
 *               only their active photos; soft-deleted photo is excluded.
 *   T-23-04-02: Trash-view SELECT (trashed_at IS NOT NULL) — user A sees
 *               the trashed photo in the Trash view.
 *   T-23-04-03: Cross-tenant SELECT — user B cannot SELECT user A's trashed row.
 *   T-23-04-04: Cross-tenant UPDATE — user B cannot restore user A's photo
 *               (SET trashed_at = NULL) — 0 rows affected.
 *   T-23-04-05: Cross-tenant DELETE — user B cannot hard-delete user A's photo.
 *
 * Pattern follows patient-activity-modal-rls.test.ts (Phase 23 Plan 23-03):
 *   - admin createClient with service_role key for setup/teardown
 *   - per-user authenticated clients via getUserAccessToken (admin.generateLink)
 *     to avoid ES256 key issues per [[reference-rls-fixture-gotruclient-flake]]
 *   - file-scoped slug prefix per [[feedback-rls-per-file-slug-prefix]]
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
// File-scoped prefix — avoids clobbering sibling RLS fixtures in parallel runs
// per [[feedback-rls-per-file-slug-prefix]]
// ---------------------------------------------------------------------------

const PHOTO_TRASH_PREFIX = 'phototrash-';

// ---------------------------------------------------------------------------
// Admin client helper
// ---------------------------------------------------------------------------

function getAdmin(): SupabaseClient {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('photo-trash-rls: env vars missing');
  }
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

// ---------------------------------------------------------------------------
// Anon client helper — unique storageKey per call prevents GoTrueClient
// cross-contamination in jsdom per [[reference-rls-fixture-gotruclient-flake]]
// ---------------------------------------------------------------------------

function buildAnonClient(storageKey: string): SupabaseClient {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    throw new Error('photo-trash-rls: anon env vars missing');
  }
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false, storageKey },
  });
}

// ---------------------------------------------------------------------------
// Cleanup helper
// ---------------------------------------------------------------------------

async function cleanupTestPhotos(prefix: string, admin: SupabaseClient): Promise<void> {
  try {
    // Delete photos whose photo_id starts with prefix
    await admin.from('photos').delete().like('photo_id', `${prefix}%`);
  } catch { /* best-effort */ }
}

async function deleteUser(userId: string | undefined, admin: SupabaseClient): Promise<void> {
  if (!userId) return;
  try {
    await admin.auth.admin.deleteUser(userId);
  } catch { /* best-effort */ }
}

// ---------------------------------------------------------------------------
// Module-level state
// ---------------------------------------------------------------------------

let admin: SupabaseClient;

let userAId: string;
let userAEmail: string;

let userBId: string;
let userBEmail: string;

// Actual UUID photo_ids — generated per-run so they don't collide
let PHOTO_ACTIVE: string;
let PHOTO_TRASHED: string;

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describeIfLive('Phase 23 Plan 23-04 — Photo Trash RLS cross-tenant isolation', () => {
  beforeAll(async () => {
    admin = getAdmin();
    const ts = Date.now();

    // Generate deterministic UUIDs for this test run
    PHOTO_ACTIVE = crypto.randomUUID();
    PHOTO_TRASHED = crypto.randomUUID();

    userAEmail = `${PHOTO_TRASH_PREFIX}ua-${ts}@leanshot.test`;
    userBEmail = `${PHOTO_TRASH_PREFIX}ub-${ts}@leanshot.test`;

    // Create user A
    const { data: aRes, error: aErr } = await admin.auth.admin.createUser({
      email: userAEmail,
      password: `Pass1234-${crypto.randomUUID().slice(0, 8)}`,
      email_confirm: true,
    });
    if (aErr) throw new Error(`createUser A: ${aErr.message}`);
    userAId = aRes.user!.id;

    // Create user B
    const { data: bRes, error: bErr } = await admin.auth.admin.createUser({
      email: userBEmail,
      password: `Pass1234-${crypto.randomUUID().slice(0, 8)}`,
      email_confirm: true,
    });
    if (bErr) throw new Error(`createUser B: ${bErr.message}`);
    userBId = bRes.user!.id;

    // Seed one active photo + one trashed photo for user A
    const { error: insertErr } = await admin.from('photos').insert([
      {
        user_id: userAId,
        photo_id: PHOTO_ACTIVE,
        date: '2026-05-01',
        storage_path: `${userAId}/photos/${PHOTO_ACTIVE}.jpg`,
        mime_type: 'image/jpeg',
        trashed_at: null,
      },
      {
        user_id: userAId,
        photo_id: PHOTO_TRASHED,
        date: '2026-04-01',
        storage_path: `${userAId}/photos/${PHOTO_TRASHED}.jpg`,
        mime_type: 'image/jpeg',
        trashed_at: new Date('2026-05-01T00:00:00Z').toISOString(),
      },
    ]);
    if (insertErr) throw new Error(`seed photos: ${insertErr.message}`);
  }, 120_000);

  afterAll(async () => {
    if (!admin) return;
    // Delete the test photos by explicit UUIDs + any prefix-named storage paths
    if (PHOTO_ACTIVE || PHOTO_TRASHED) {
      try {
        await admin
          .from('photos')
          .delete()
          .in('photo_id', [PHOTO_ACTIVE, PHOTO_TRASHED].filter(Boolean));
      } catch { /* best-effort */ }
    }
    await cleanupTestPhotos(PHOTO_TRASH_PREFIX, admin);
    await deleteUser(userAId, admin);
    await deleteUser(userBId, admin);
  }, 60_000);

  // -------------------------------------------------------------------------
  // T-23-04-01: Main-grid SELECT excludes trashed photo
  // -------------------------------------------------------------------------

  it('T-23-04-01: Main-grid SELECT (IS NULL) returns active photo, excludes trashed', async () => {
    const tokenA = await getUserAccessToken(userAEmail);
    const clientA = buildAnonClient('phototrash-rls-a-01');
    // Use token directly in headers
    const { data, error } = await clientA
      .from('photos')
      .select('photo_id, trashed_at')
      .is('trashed_at', null)
      .setHeader('Authorization', `Bearer ${tokenA}`);

    expect(error).toBeNull();
    const ids = (data as Array<{ photo_id: string }>).map((r) => r.photo_id);
    expect(ids).toContain(PHOTO_ACTIVE);
    expect(ids).not.toContain(PHOTO_TRASHED);
  }, 30_000);

  // -------------------------------------------------------------------------
  // T-23-04-02: Trash-view SELECT returns trashed photo
  // -------------------------------------------------------------------------

  it('T-23-04-02: Trash-view SELECT (IS NOT NULL) returns trashed photo', async () => {
    const tokenA = await getUserAccessToken(userAEmail);
    const clientA = buildAnonClient('phototrash-rls-a-02');
    const { data, error } = await clientA
      .from('photos')
      .select('photo_id, trashed_at')
      .not('trashed_at', 'is', null)
      .setHeader('Authorization', `Bearer ${tokenA}`);

    expect(error).toBeNull();
    const ids = (data as Array<{ photo_id: string }>).map((r) => r.photo_id);
    expect(ids).toContain(PHOTO_TRASHED);
    expect(ids).not.toContain(PHOTO_ACTIVE);
  }, 30_000);

  // -------------------------------------------------------------------------
  // T-23-04-03: Cross-tenant SELECT — user B sees 0 of user A's photos
  // -------------------------------------------------------------------------

  it('T-23-04-03: Cross-tenant SELECT — user B sees 0 rows from user A', async () => {
    const tokenB = await getUserAccessToken(userBEmail);
    const clientB = buildAnonClient('phototrash-rls-b-03');
    const { data, error } = await clientB
      .from('photos')
      .select('photo_id')
      .in('photo_id', [PHOTO_ACTIVE, PHOTO_TRASHED])
      .setHeader('Authorization', `Bearer ${tokenB}`);

    expect(error).toBeNull();
    expect(data ?? []).toHaveLength(0);
  }, 30_000);

  // -------------------------------------------------------------------------
  // T-23-04-04: Cross-tenant UPDATE — user B cannot restore user A's photo
  // -------------------------------------------------------------------------

  it('T-23-04-04: Cross-tenant UPDATE (restore) — user B gets 0 rows affected', async () => {
    const tokenB = await getUserAccessToken(userBEmail);
    const clientB = buildAnonClient('phototrash-rls-b-04');
    const { data, error } = await clientB
      .from('photos')
      .update({ trashed_at: null })
      .eq('photo_id', PHOTO_TRASHED)
      .setHeader('Authorization', `Bearer ${tokenB}`)
      .select('photo_id');

    // RLS denies: either error or 0 rows returned
    if (error) {
      // PostgREST may return 403 or a policy violation error
      expect(error).toBeTruthy();
    } else {
      expect(data ?? []).toHaveLength(0);
    }

    // Confirm user A's trashed photo is still trashed (not restored by B)
    const { data: checkData } = await admin
      .from('photos')
      .select('trashed_at')
      .eq('photo_id', PHOTO_TRASHED)
      .single();
    expect(checkData).toBeTruthy();
    expect((checkData as { trashed_at: string | null }).trashed_at).not.toBeNull();
  }, 30_000);

  // -------------------------------------------------------------------------
  // T-23-04-05: Cross-tenant DELETE — user B cannot delete user A's photo
  // -------------------------------------------------------------------------

  it('T-23-04-05: Cross-tenant DELETE — user B gets 0 rows affected', async () => {
    const tokenB = await getUserAccessToken(userBEmail);
    const clientB = buildAnonClient('phototrash-rls-b-05');
    const { data, error } = await clientB
      .from('photos')
      .delete()
      .eq('photo_id', PHOTO_ACTIVE)
      .setHeader('Authorization', `Bearer ${tokenB}`)
      .select('photo_id');

    // RLS denies: either error or 0 rows returned
    if (error) {
      expect(error).toBeTruthy();
    } else {
      expect(data ?? []).toHaveLength(0);
    }

    // Confirm user A's active photo still exists
    const { data: checkData } = await admin
      .from('photos')
      .select('photo_id')
      .eq('photo_id', PHOTO_ACTIVE)
      .single();
    expect(checkData).toBeTruthy();
  }, 30_000);
});

// ---------------------------------------------------------------------------
// Gating test — always passes, warns when skipped
// ---------------------------------------------------------------------------

describe('Phase 23 Plan 23-04 RLS — gating', () => {
  it('runs against live cloud DB when SUPABASE_SERVICE_ROLE_KEY is set', () => {
    if (!SHOULD_RUN) {
      console.warn(
        '[photo-trash-rls.test] SKIPPED — SUPABASE_SERVICE_ROLE_KEY (or URL/ANON) not set. Wave verification gates this.',
      );
    }
    expect(true).toBe(true);
  });
});
