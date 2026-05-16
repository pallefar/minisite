/**
 * Phase 22 Plan 22-12 — cron-finalize 7-day window e2e (DEL-02).
 *
 * Mirrors Phase 7's cron-finalize 30-day pattern with the back-date helper
 * updated to `now() - interval '8 days'` to fall outside the new 7-day
 * grace window (plan 22-01 owns the day-7 cron via the
 * `run_finalize_account_deletions_cron_now()` test-hook RPC).
 *
 * Behaviors:
 *   T1 create test user → initiate_account_deletion → back-date initiated_at
 *      to `now() - interval '8 days'` → invoke the test-hook RPC → assert
 *      auth.users row gone.
 *   T2 control: back-date initiated_at only 6 days → invoke RPC → row STILL
 *      present (within grace window).
 *
 * Auto-skips when SUPABASE_SERVICE_ROLE_KEY missing.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const ANON = process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SHOULD_RUN = Boolean(URL && ANON && SERVICE);
const describeIfLive = SHOULD_RUN ? describe : describe.skip;

const CRON_7DAY_PREFIX = 'phase22-cron-7day';

describeIfLive('Phase 22 plan 22-12 — cron-finalize 7-day window', () => {
  let admin: SupabaseClient | null = null;
  const getAdmin = (): SupabaseClient => {
    if (!admin) {
      admin = createClient(URL!, SERVICE!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
    }
    return admin;
  };

  const createdUserIds: string[] = [];

  afterAll(async () => {
    if (!admin) return;
    for (const id of createdUserIds) {
      try {
        await admin.auth.admin.deleteUser(id);
      } catch {
        /* best-effort — user may already be gone */
      }
      try {
        await admin.from('pending_account_deletions').delete().eq('user_id', id);
      } catch {
        /* best-effort */
      }
    }
  });

  it('back-date 8 days → cron-now RPC finalizes; auth.users row gone', async () => {
    const adminClient = getAdmin();
    const stamp = Date.now();
    const email = `${CRON_7DAY_PREFIX}-finalize-${stamp}@leanshot.test`;
    const pw = `Pass1234-${crypto.randomUUID().slice(0, 8)}`;

    const created = await adminClient.auth.admin.createUser({
      email,
      password: pw,
      email_confirm: true,
    });
    if (created.error) throw created.error;
    const uid = created.data.user!.id;
    createdUserIds.push(uid);

    // Sign in to get a JWT so we can call initiate_account_deletion as the user.
    const userClient = createClient(URL!, ANON!, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
        storageKey: `${CRON_7DAY_PREFIX}-finalize`,
      },
    });
    const signin = await userClient.auth.signInWithPassword({ email, password: pw });
    if (signin.error) throw signin.error;

    // Initiate deletion (writes pending_account_deletions row).
    const { error: initErr } = await userClient.rpc('initiate_account_deletion');
    expect(initErr).toBeNull();

    // Back-date initiated_at 8 days via service-role.
    const eightDaysAgo = new Date(Date.now() - 8 * 86400_000).toISOString();
    const { error: updErr } = await adminClient
      .from('pending_account_deletions')
      .update({ initiated_at: eightDaysAgo })
      .eq('user_id', uid);
    expect(updErr).toBeNull();

    // Invoke the cron-now test-hook RPC (service-role only).
    const { error: cronErr } = await adminClient.rpc('run_finalize_account_deletions_cron_now');
    expect(cronErr).toBeNull();

    // Assert auth.users row gone (admin getUserById should 404).
    const probe = await adminClient.auth.admin.getUserById(uid);
    // Supabase returns user=null when not found; some versions error with 404.
    const found = probe.data?.user;
    expect(found).toBeFalsy();
  }, 60_000);

  it('back-date 6 days → row remains within grace; cron-now is no-op', async () => {
    const adminClient = getAdmin();
    const stamp = Date.now();
    const email = `${CRON_7DAY_PREFIX}-grace-${stamp}@leanshot.test`;
    const pw = `Pass1234-${crypto.randomUUID().slice(0, 8)}`;

    const created = await adminClient.auth.admin.createUser({
      email,
      password: pw,
      email_confirm: true,
    });
    if (created.error) throw created.error;
    const uid = created.data.user!.id;
    createdUserIds.push(uid);

    const userClient = createClient(URL!, ANON!, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
        storageKey: `${CRON_7DAY_PREFIX}-grace`,
      },
    });
    const signin = await userClient.auth.signInWithPassword({ email, password: pw });
    if (signin.error) throw signin.error;
    const { error: initErr } = await userClient.rpc('initiate_account_deletion');
    expect(initErr).toBeNull();

    const sixDaysAgo = new Date(Date.now() - 6 * 86400_000).toISOString();
    const { error: updErr } = await adminClient
      .from('pending_account_deletions')
      .update({ initiated_at: sixDaysAgo })
      .eq('user_id', uid);
    expect(updErr).toBeNull();

    const { error: cronErr } = await adminClient.rpc('run_finalize_account_deletions_cron_now');
    expect(cronErr).toBeNull();

    // Auth user STILL exists (within 7-day grace).
    const probe = await adminClient.auth.admin.getUserById(uid);
    expect(probe.data?.user?.id).toBe(uid);
  }, 60_000);
});

describe('Phase 22 plan 22-12 — cron-finalize 7-day gating', () => {
  it('runs against live cloud DB when SUPABASE_SERVICE_ROLE_KEY is set', () => {
    if (!SHOULD_RUN) {
      // eslint-disable-next-line no-console
      console.warn('[cron-finalize-7day] SKIPPED — SUPABASE_SERVICE_ROLE_KEY (or URL/ANON) not set.');
    }
    expect(true).toBe(true);
  });
});
