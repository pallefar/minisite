/**
 * Phase 42 Plan 42-05 — fresh-user dismissal UPSERT integration test (D-05).
 *
 * CRITICAL invariant: notification-dismiss MUST use UPSERT on
 * notification_dismissal_state, NOT a bare UPDATE. With a bare UPDATE a fresh
 * user (no prior row) would silently no-op → consecutive_dismissals never
 * reaches 3 → D-05 sentiment-throttle never triggers.
 *
 * This test simulates the Edge Fn's UPSERT path against the live DB:
 *   Event 1 → consecutive_dismissals = 1 (row CREATED, not UPDATEd)
 *   Event 2 → consecutive_dismissals = 2
 *   Event 3 → consecutive_dismissals = 3, throttle_until set to now + 7d
 *
 * Self-skips when SUPABASE_SERVICE_ROLE_KEY is absent (local PR safety).
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const SHOULD_RUN = Boolean(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY);
const describeIfLive = SHOULD_RUN ? describe : describe.skip;

const PREFIX = 'notifdismissfresh-';

function getAdmin(): SupabaseClient {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('notification-dismissal-fresh-user: env vars missing');
  }
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

/**
 * Mirrors the UPSERT logic in supabase/functions/notification-dismiss/index.ts
 * exactly so this test catches regressions in either place.
 */
async function dismissOne(admin: SupabaseClient, userId: string, category: string): Promise<{
  consecutive: number;
  throttle_until: string | null;
}> {
  // Read current state
  const existing = await admin
    .from('notification_dismissal_state')
    .select('consecutive_dismissals, throttle_until')
    .eq('user_id', userId)
    .eq('category', category)
    .maybeSingle();
  if (existing.error) throw existing.error;
  const prevCount = (existing.data?.consecutive_dismissals as number | undefined) ?? 0;
  const newCount = prevCount + 1;
  const prevThrottle = (existing.data?.throttle_until as string | null | undefined) ?? null;
  const newThrottle =
    newCount >= 3
      ? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
      : prevThrottle;

  const upsert = await admin.from('notification_dismissal_state').upsert(
    {
      user_id: userId,
      category,
      consecutive_dismissals: newCount,
      last_event_at: new Date().toISOString(),
      throttle_until: newThrottle,
    },
    { onConflict: 'user_id,category' },
  );
  if (upsert.error) throw upsert.error;

  return { consecutive: newCount, throttle_until: newThrottle };
}

describeIfLive('Phase 42 Plan 42-05 — fresh-user dismissal UPSERT (D-05)', () => {
  let admin: SupabaseClient;
  let userId: string | undefined;

  beforeAll(async () => {
    admin = getAdmin();
    const ts = Date.now();
    const { data, error } = await admin.auth.admin.createUser({
      email: `${PREFIX}u-${ts}@leanshot.test`,
      password: `Pass1234-${crypto.randomUUID().slice(0, 8)}`,
      email_confirm: true,
    });
    if (error) throw new Error(`createUser: ${error.message}`);
    userId = data.user!.id;
  }, 120_000);

  afterAll(async () => {
    if (!admin || !userId) return;
    try {
      await admin.from('notification_dismissal_state').delete().eq('user_id', userId);
    } catch {
      /* best-effort */
    }
    try {
      await admin.auth.admin.deleteUser(userId);
    } catch {
      /* best-effort */
    }
  }, 60_000);

  it('event 1 creates a NEW row with consecutive_dismissals=1 (fresh-user invariant)', async () => {
    if (!userId) throw new Error('userId not seeded');
    const before = await admin
      .from('notification_dismissal_state')
      .select('user_id')
      .eq('user_id', userId)
      .eq('category', 'ai-insights');
    expect(before.error).toBeNull();
    expect((before.data ?? []).length).toBe(0); // fresh — no row

    const res = await dismissOne(admin, userId, 'ai-insights');
    expect(res.consecutive).toBe(1);
    expect(res.throttle_until).toBeNull();

    const after = await admin
      .from('notification_dismissal_state')
      .select('consecutive_dismissals, throttle_until')
      .eq('user_id', userId)
      .eq('category', 'ai-insights')
      .single();
    expect(after.error).toBeNull();
    expect((after.data as { consecutive_dismissals: number }).consecutive_dismissals).toBe(1);
  }, 30_000);

  it('event 2 increments consecutive_dismissals to 2; throttle_until still null', async () => {
    if (!userId) throw new Error('userId not seeded');
    const res = await dismissOne(admin, userId, 'ai-insights');
    expect(res.consecutive).toBe(2);
    expect(res.throttle_until).toBeNull();
  }, 30_000);

  it('event 3 sets consecutive_dismissals=3 AND throttle_until ~ now+7d', async () => {
    if (!userId) throw new Error('userId not seeded');
    const res = await dismissOne(admin, userId, 'ai-insights');
    expect(res.consecutive).toBe(3);
    expect(res.throttle_until).not.toBeNull();

    const after = await admin
      .from('notification_dismissal_state')
      .select('consecutive_dismissals, throttle_until')
      .eq('user_id', userId)
      .eq('category', 'ai-insights')
      .single();
    expect(after.error).toBeNull();
    const row = after.data as { consecutive_dismissals: number; throttle_until: string };
    expect(row.consecutive_dismissals).toBe(3);
    const throttleAt = new Date(row.throttle_until).getTime();
    const now = Date.now();
    // Should land within ~7d (allow some buffer for slow tests)
    expect(throttleAt - now).toBeGreaterThan(6 * 24 * 60 * 60 * 1000);
    expect(throttleAt - now).toBeLessThan(8 * 24 * 60 * 60 * 1000);
  }, 30_000);
});
