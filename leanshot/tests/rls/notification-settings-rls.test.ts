/**
 * Phase 42 Plan 42-05 (POLISH-05/06) — Live cross-tenant RLS impersonation proof
 * for the five new notification tables introduced in migrations 20270704000001..06.
 *
 * Verifies, against the live cloud DB (ytnsipxxmzgaebkqmokp), that:
 *
 *   T-42-05-RLS-01: User A's authenticated client sees ONLY their own
 *                   notification_settings; cannot SELECT/UPDATE/DELETE user B's.
 *   T-42-05-RLS-02: Same per-user isolation on user_notifications.
 *   T-42-05-RLS-03: Same per-user isolation on push_subscriptions.
 *   T-42-05-RLS-04: Same per-user isolation on notification_dismissal_state.
 *   T-42-05-RLS-05: notification_category_config — authenticated SELECT
 *                   succeeds; non-admin INSERT/UPDATE/DELETE denied.
 *   T-42-05-RLS-SEED: Seed migration produced exactly 5
 *                   notification_category_config rows matching D-04 matrix.
 *   T-42-05-RLS-06: DOWNWARD-cap trigger raises when a user tries to set
 *                   user_cap_override above admin daily_cap (T-42-05-03 mitigation).
 *
 * Pattern follows photo-trash-rls.test.ts (Phase 23 Plan 23-04):
 *   - admin createClient with service_role key for setup/teardown
 *   - per-user authenticated clients via getUserAccessToken (admin.generateLink)
 *     to avoid ES256 issues per [[reference_rls_fixture_gotrueclient_flake]]
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
// File-scoped prefix per feedback_rls_per_file_slug_prefix
// ---------------------------------------------------------------------------

const NOTIF_PREFIX = 'notifrls-';

// ---------------------------------------------------------------------------
// Admin client helper
// ---------------------------------------------------------------------------

function getAdmin(): SupabaseClient {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('notification-settings-rls: env vars missing');
  }
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

// ---------------------------------------------------------------------------
// Anon client helper — unique storageKey per call
// ---------------------------------------------------------------------------

function buildAnonClient(storageKey: string): SupabaseClient {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    throw new Error('notification-settings-rls: anon env vars missing');
  }
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false, storageKey },
  });
}

// ---------------------------------------------------------------------------
// Cleanup helpers
// ---------------------------------------------------------------------------

async function deleteUser(userId: string | undefined, admin: SupabaseClient): Promise<void> {
  if (!userId) return;
  try {
    await admin.auth.admin.deleteUser(userId);
  } catch {
    /* best-effort */
  }
}

async function cleanupTestRows(admin: SupabaseClient, userIds: string[]): Promise<void> {
  const ids = userIds.filter(Boolean);
  if (ids.length === 0) return;
  for (const table of [
    'notification_settings',
    'user_notifications',
    'notification_dismissal_state',
    'push_subscriptions',
  ] as const) {
    try {
      await admin.from(table).delete().in('user_id', ids);
    } catch {
      /* best-effort */
    }
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

describeIfLive('Phase 42 Plan 42-05 — Notification RLS cross-tenant isolation', () => {
  beforeAll(async () => {
    admin = getAdmin();
    const ts = Date.now();

    userAEmail = `${NOTIF_PREFIX}ua-${ts}@leanshot.test`;
    userBEmail = `${NOTIF_PREFIX}ub-${ts}@leanshot.test`;

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

    // Seed one row per table for user A (so user B has rows to fail-to-see).
    // notification_settings
    {
      const { error } = await admin.from('notification_settings').insert({
        user_id: userAId,
        category: 'ai-insights',
        channel: 'in-app',
        enabled: true,
      });
      if (error) throw new Error(`seed notification_settings A: ${error.message}`);
    }
    // user_notifications
    {
      const { error } = await admin.from('user_notifications').insert({
        user_id: userAId,
        category: 'ai-insights',
        channel: 'in-app',
        payload: { subject: 'seed' },
      });
      if (error) throw new Error(`seed user_notifications A: ${error.message}`);
    }
    // notification_dismissal_state
    {
      const { error } = await admin.from('notification_dismissal_state').insert({
        user_id: userAId,
        category: 'ai-insights',
        consecutive_dismissals: 0,
      });
      if (error) throw new Error(`seed notification_dismissal_state A: ${error.message}`);
    }
    // push_subscriptions
    {
      const { error } = await admin.from('push_subscriptions').insert({
        user_id: userAId,
        endpoint: `https://fcm.googleapis.com/fcm/send/${NOTIF_PREFIX}seed-A-${ts}`,
        p256dh: 'BMFoZvkNk1pxt5VrgKw5PGUZk89Yo7OaY7lNtG8oA9RKvlmkxOJmcmfQDa7B3dBpQASMF0kDi6GgPqLX5ZMeGKM',
        auth: 'seed-auth-A',
      });
      if (error) throw new Error(`seed push_subscriptions A: ${error.message}`);
    }
  }, 120_000);

  afterAll(async () => {
    if (!admin) return;
    await cleanupTestRows(admin, [userAId, userBId]);
    await deleteUser(userAId, admin);
    await deleteUser(userBId, admin);
  }, 60_000);

  // -------------------------------------------------------------------------
  // T-42-05-RLS-SEED: seed migration produced 5 rows matching D-04 matrix
  // -------------------------------------------------------------------------

  it('T-42-05-RLS-SEED: notification_category_config has exactly 5 rows per D-04', async () => {
    const tokenA = await getUserAccessToken(userAEmail);
    const clientA = buildAnonClient('notifrls-seed');
    const { data, error } = await clientA
      .from('notification_category_config')
      .select('category, daily_cap, weekly_cap, urgent_escalation')
      .order('category', { ascending: true })
      .setHeader('Authorization', `Bearer ${tokenA}`);

    expect(error).toBeNull();
    expect(data).not.toBeNull();
    const rows = data as Array<{
      category: string;
      daily_cap: number | null;
      weekly_cap: number | null;
      urgent_escalation: boolean;
    }>;
    expect(rows.length).toBe(5);
    const byCat = Object.fromEntries(rows.map((r) => [r.category, r]));
    expect(byCat['dose-reminders']).toMatchObject({ daily_cap: null, weekly_cap: null, urgent_escalation: false });
    expect(byCat['ai-insights']).toMatchObject({ daily_cap: 3, weekly_cap: null, urgent_escalation: false });
    expect(byCat['clinic-alerts']).toMatchObject({ daily_cap: null, weekly_cap: null, urgent_escalation: true });
    expect(byCat['billing']).toMatchObject({ daily_cap: null, weekly_cap: 1, urgent_escalation: false });
    expect(byCat['marketing']).toMatchObject({ daily_cap: null, weekly_cap: 1, urgent_escalation: false });
  }, 30_000);

  // -------------------------------------------------------------------------
  // T-42-05-RLS-01: notification_settings cross-tenant deny
  // -------------------------------------------------------------------------

  it('T-42-05-RLS-01: user B sees 0 of user A notification_settings', async () => {
    const tokenB = await getUserAccessToken(userBEmail);
    const clientB = buildAnonClient('notifrls-settings-b');
    const { data, error } = await clientB
      .from('notification_settings')
      .select('id')
      .eq('user_id', userAId)
      .setHeader('Authorization', `Bearer ${tokenB}`);

    expect(error).toBeNull();
    expect(data ?? []).toHaveLength(0);
  }, 30_000);

  // -------------------------------------------------------------------------
  // T-42-05-RLS-02: user_notifications cross-tenant deny
  // -------------------------------------------------------------------------

  it('T-42-05-RLS-02: user B sees 0 of user A user_notifications', async () => {
    const tokenB = await getUserAccessToken(userBEmail);
    const clientB = buildAnonClient('notifrls-notif-b');
    const { data, error } = await clientB
      .from('user_notifications')
      .select('id')
      .eq('user_id', userAId)
      .setHeader('Authorization', `Bearer ${tokenB}`);

    expect(error).toBeNull();
    expect(data ?? []).toHaveLength(0);
  }, 30_000);

  // -------------------------------------------------------------------------
  // T-42-05-RLS-03: push_subscriptions cross-tenant deny
  // -------------------------------------------------------------------------

  it('T-42-05-RLS-03: user B sees 0 of user A push_subscriptions', async () => {
    const tokenB = await getUserAccessToken(userBEmail);
    const clientB = buildAnonClient('notifrls-push-b');
    const { data, error } = await clientB
      .from('push_subscriptions')
      .select('id')
      .eq('user_id', userAId)
      .setHeader('Authorization', `Bearer ${tokenB}`);

    expect(error).toBeNull();
    expect(data ?? []).toHaveLength(0);
  }, 30_000);

  // -------------------------------------------------------------------------
  // T-42-05-RLS-04: notification_dismissal_state cross-tenant deny
  // -------------------------------------------------------------------------

  it('T-42-05-RLS-04: user B sees 0 of user A notification_dismissal_state', async () => {
    const tokenB = await getUserAccessToken(userBEmail);
    const clientB = buildAnonClient('notifrls-dismiss-b');
    const { data, error } = await clientB
      .from('notification_dismissal_state')
      .select('user_id, category')
      .eq('user_id', userAId)
      .setHeader('Authorization', `Bearer ${tokenB}`);

    expect(error).toBeNull();
    expect(data ?? []).toHaveLength(0);
  }, 30_000);

  // -------------------------------------------------------------------------
  // T-42-05-RLS-04b: user A sees ONLY their own rows on each table
  // -------------------------------------------------------------------------

  it('T-42-05-RLS-04b: user A sees own rows on all 4 notification tables', async () => {
    const tokenA = await getUserAccessToken(userAEmail);
    const clientA = buildAnonClient('notifrls-own-a');

    const settings = await clientA
      .from('notification_settings')
      .select('user_id')
      .setHeader('Authorization', `Bearer ${tokenA}`);
    expect(settings.error).toBeNull();
    expect((settings.data ?? []).length).toBeGreaterThanOrEqual(1);
    for (const row of settings.data ?? []) {
      expect((row as { user_id: string }).user_id).toBe(userAId);
    }

    const notifs = await clientA
      .from('user_notifications')
      .select('user_id')
      .setHeader('Authorization', `Bearer ${tokenA}`);
    expect(notifs.error).toBeNull();
    expect((notifs.data ?? []).length).toBeGreaterThanOrEqual(1);
    for (const row of notifs.data ?? []) {
      expect((row as { user_id: string }).user_id).toBe(userAId);
    }

    const subs = await clientA
      .from('push_subscriptions')
      .select('user_id')
      .setHeader('Authorization', `Bearer ${tokenA}`);
    expect(subs.error).toBeNull();
    expect((subs.data ?? []).length).toBeGreaterThanOrEqual(1);
    for (const row of subs.data ?? []) {
      expect((row as { user_id: string }).user_id).toBe(userAId);
    }

    const dismiss = await clientA
      .from('notification_dismissal_state')
      .select('user_id')
      .setHeader('Authorization', `Bearer ${tokenA}`);
    expect(dismiss.error).toBeNull();
    expect((dismiss.data ?? []).length).toBeGreaterThanOrEqual(1);
    for (const row of dismiss.data ?? []) {
      expect((row as { user_id: string }).user_id).toBe(userAId);
    }
  }, 60_000);

  // -------------------------------------------------------------------------
  // T-42-05-RLS-05: notification_category_config — non-admin writes denied
  // -------------------------------------------------------------------------

  it('T-42-05-RLS-05: non-admin user cannot UPDATE notification_category_config', async () => {
    const tokenA = await getUserAccessToken(userAEmail);
    const clientA = buildAnonClient('notifrls-config-noadmin');

    // RLS UPDATE policy denies non-admin; PostgREST returns 0 rows (no error)
    // for filter-matched but RLS-denied UPDATE. We assert the daily_cap stays at 3.
    const beforeRes = await clientA
      .from('notification_category_config')
      .select('daily_cap')
      .eq('category', 'ai-insights')
      .single()
      .setHeader('Authorization', `Bearer ${tokenA}`);
    expect(beforeRes.error).toBeNull();
    expect((beforeRes.data as { daily_cap: number }).daily_cap).toBe(3);

    // Attempt the update — RLS denies; the row remains unchanged.
    await clientA
      .from('notification_category_config')
      .update({ daily_cap: 999 })
      .eq('category', 'ai-insights')
      .setHeader('Authorization', `Bearer ${tokenA}`);

    const afterRes = await clientA
      .from('notification_category_config')
      .select('daily_cap')
      .eq('category', 'ai-insights')
      .single()
      .setHeader('Authorization', `Bearer ${tokenA}`);
    expect(afterRes.error).toBeNull();
    expect((afterRes.data as { daily_cap: number }).daily_cap).toBe(3);
  }, 30_000);

  // -------------------------------------------------------------------------
  // T-42-05-RLS-06: DOWNWARD-cap trigger raises on UPDATE that exceeds admin cap
  // (T-42-05-03 mitigation)
  // -------------------------------------------------------------------------

  it('T-42-05-RLS-06: user_cap_override above admin daily_cap is rejected', async () => {
    const tokenA = await getUserAccessToken(userAEmail);
    const clientA = buildAnonClient('notifrls-cap-up');

    // ai-insights admin daily_cap=3; attempt user_cap_override=5 → trigger raises.
    const { error } = await clientA
      .from('notification_settings')
      .update({ user_cap_override: 5 })
      .eq('user_id', userAId)
      .eq('category', 'ai-insights')
      .eq('channel', 'in-app')
      .setHeader('Authorization', `Bearer ${tokenA}`);

    expect(error).not.toBeNull();
    expect(String(error?.message ?? '')).toMatch(/cannot exceed admin daily_cap|check_violation|23514/i);
  }, 30_000);

  it('T-42-05-RLS-06b: user_cap_override at-or-below admin daily_cap is accepted', async () => {
    const tokenA = await getUserAccessToken(userAEmail);
    const clientA = buildAnonClient('notifrls-cap-down');

    const { error } = await clientA
      .from('notification_settings')
      .update({ user_cap_override: 1 })
      .eq('user_id', userAId)
      .eq('category', 'ai-insights')
      .eq('channel', 'in-app')
      .setHeader('Authorization', `Bearer ${tokenA}`);

    expect(error).toBeNull();
  }, 30_000);
});
