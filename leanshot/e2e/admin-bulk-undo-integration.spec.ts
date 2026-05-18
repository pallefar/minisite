/**
 * Phase 27 Plan 27-07 — Admin bulk-undo lifecycle (expired token) e2e.
 *
 * Test "expired undo token returns token_expired and state remains banned":
 *   1. Seed 5 patient profiles + a seeded admin (admin_role='admin', has_totp=true).
 *   2. Inject admin's access_token via page.addInitScript (NEVER UI login —
 *      free-tier auth rate limits per [[reference_supabase_auth_traps]]).
 *   3. Navigate to /#/admin/members. Select 5 rows via checkbox. Click Ban.
 *   4. Capture undo_token from /rest/v1/rpc/admin_bulk_action_execute response.
 *   5. AdminUndoBanner visible.
 *   6. FORCE-EXPIRE via admin client: update bulk_action_undo_token set
 *      expires_at = now() - 1s where token = ?. (Avoids 65s wall-clock wait
 *      in CI — see plan task 2 action notes; the cron itself is exercised
 *      live by Task 3's `select count(*) from cron.job_run_details` probe.)
 *   7. Click Undo. Await /rest/v1/rpc/admin_bulk_action_undo response.
 *   8. Assert response error code 22023 (token_expired). The Plan 27-01 RPC
 *      raises 'token_expired' as exception with sqlstate 22023; PostgREST
 *      surfaces this as a 4xx with code='22023' or message containing
 *      'token_expired' — we assert on either.
 *   9. Assert UI shows 'Undo window expired' (or similar token_expired toast).
 *  10. Assert all 5 profiles still account_state='banned' (no rollback).
 *  11. Assert ZERO audit_logs rows with action_name='bulk_action_undone' for
 *      the 5 target_user_ids (no reverse happened).
 *  12. afterAll: delete the 6 seeded users.
 *
 * COMPLEMENT TO PLAN 27-01 SPEC:
 *   - 27-01 proves the HAPPY-PATH undo (within 60s → state restored + audit row).
 *   - 27-07 (this spec) proves the EXPIRY PATH (after 60s → token_expired +
 *     state unchanged + zero audit row).
 *   - Together they cover the full undo lifecycle (ADMIN-04 D-03).
 *
 * IMPLEMENTATION CHOICE (force-expire vs wait-65s):
 *   The plan offers both. We picked force-expire because:
 *     - 65s wall-clock per test x N tests in CI = unacceptable runtime growth.
 *     - The cron behavior itself is exercised live by Plan 27-07 Task 3
 *       (supabase db query on cron.job_run_details after migration push).
 *     - The RPC's `expires_at < now()` predicate is the SAME code path the
 *       cron's DELETE WHERE walks — force-expire proves the same semantic.
 *
 * GATING: opt-in via PLAYWRIGHT_RUN_BULK_ACTIONS=1 + live Supabase env
 * (same gate as e2e/admin-bulk-actions.spec.ts — they share a deploy
 * dependency on Phase 27 migrations 20270602000001..05 + 20270602000060).
 *
 * Per project rules:
 *   - File-scoped slug `undo-${Date.now()}-` per [[feedback_rls_per_file_slug_prefix]].
 *   - addInitScript for state seeding per [[reference_playwright_state_seeding]].
 *   - DB-level invariant assertions per [[feedback_realtime_layer_e2e_pattern]].
 *   - Env-var gate only per [[reference_playwright_conditional_project_argv]].
 */
import { test, expect, type Page } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const PLAYWRIGHT_RUN = process.env.PLAYWRIGHT_RUN_BULK_ACTIONS === '1';
const SUPABASE_URL   = process.env.SUPABASE_URL   ?? process.env.VITE_SUPABASE_URL;
const ANON_KEY       = process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY;
const SERVICE_ROLE   = process.env.SUPABASE_SERVICE_ROLE_KEY;
const HAS_LIVE       = Boolean(SUPABASE_URL && ANON_KEY && SERVICE_ROLE);

// File-scoped slug prefix per [[feedback_rls_per_file_slug_prefix]]
const SLUG = `undo-${Date.now().toString(36)}-`;

function getAdmin(): SupabaseClient {
  return createClient(SUPABASE_URL!, SERVICE_ROLE!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

async function realAdminSession(
  email: string,
  password: string,
): Promise<{
  access_token: string;
  refresh_token: string;
  expires_at: number;
  user: { id: string };
}> {
  const signInClient = createClient(SUPABASE_URL!, ANON_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data, error } = await signInClient.auth.signInWithPassword({ email, password });
  if (error || !data.session) {
    throw new Error(`sign-in failed for ${email}: ${error?.message ?? 'no session'}`);
  }
  return {
    access_token: data.session.access_token,
    refresh_token: data.session.refresh_token,
    expires_at: data.session.expires_at ?? 0,
    user: { id: data.user!.id },
  };
}

async function seedAdminSession(
  page: Page,
  session: { access_token: string; refresh_token: string; expires_at: number; user: { id: string } },
) {
  await page.addInitScript(
    ({ key, payload }: { key: string; payload: string }) => {
      try {
        localStorage.setItem(key, payload);
      } catch {
        /* private mode — ignore */
      }
    },
    {
      key: 'sb-leanshot-auth',
      payload: JSON.stringify({
        access_token: session.access_token,
        refresh_token: session.refresh_token,
        expires_at: session.expires_at,
        token_type: 'bearer',
        user: session.user,
      }),
    },
  );
}

test.describe('@phase27 ADMIN-04 — bulk-undo expired-token lifecycle', () => {
  test.skip(
    !HAS_LIVE || !PLAYWRIGHT_RUN,
    'Requires PLAYWRIGHT_RUN_BULK_ACTIONS=1 + live Supabase env with Phase 27 migrations pushed',
  );
  test.setTimeout(120_000);

  let admin: SupabaseClient;
  const seededUserIds: string[] = [];
  let adminEmail: string;
  let adminPassword: string;
  let adminUserId: string;
  const patientNames = ['frank', 'grace', 'heidi', 'ivan', 'judy'];

  test.beforeAll(async () => {
    if (!HAS_LIVE || !PLAYWRIGHT_RUN) return;
    admin = getAdmin();

    // ── Seed 5 patient users ──────────────────────────────────────────────
    for (const name of patientNames) {
      const email = `${SLUG}${name}@leanshot.test`;
      const { data, error } = await admin.auth.admin.createUser({
        email,
        password: `Pass-${crypto.randomUUID().slice(0, 12)}`,
        email_confirm: true,
        user_metadata: { display_name: name },
      });
      if (error || !data.user) throw new Error(`patient seed failed: ${error?.message}`);
      seededUserIds.push(data.user.id);
      await admin.from('profiles').upsert({ id: data.user.id, account_state: 'active' });
    }

    // ── Seed an admin user with admin_role='admin' + has_totp=true ────────
    adminEmail = `${SLUG}admin@leanshot.test`;
    adminPassword = `Pass-${crypto.randomUUID().slice(0, 12)}`;
    const { data: adminUser, error: adminErr } = await admin.auth.admin.createUser({
      email: adminEmail,
      password: adminPassword,
      email_confirm: true,
    });
    if (adminErr || !adminUser.user) throw new Error(`admin seed failed: ${adminErr?.message}`);
    adminUserId = adminUser.user.id;
    await admin.from('profiles').upsert({
      id: adminUserId,
      is_staff: true,
      admin_role: 'admin',
      has_totp: true,
      account_state: 'active',
    });
  });

  test.afterAll(async () => {
    if (!HAS_LIVE || !PLAYWRIGHT_RUN) return;
    for (const id of [...seededUserIds, adminUserId].filter(Boolean)) {
      await admin.auth.admin.deleteUser(id).catch(() => {
        /* best-effort */
      });
    }
  });

  test('expired undo token returns token_expired and state remains banned', async ({ page }) => {
    // ── Sign in to mint a real signed JWT for RPC calls ───────────────────
    const session = await realAdminSession(adminEmail, adminPassword);
    await seedAdminSession(page, session);

    // ── Capture the execute RPC response body to extract undo_token ───────
    let capturedUndoToken: string | null = null;
    page.on('response', async (resp) => {
      if (
        resp.url().includes('/rest/v1/rpc/admin_bulk_action_execute') &&
        resp.status() === 200
      ) {
        try {
          const body = (await resp.json()) as {
            mode?: string;
            undo_token?: string | null;
          };
          if (body?.undo_token) capturedUndoToken = body.undo_token;
        } catch {
          /* body not JSON — ignore */
        }
      }
    });

    // ── Navigate to admin members surface ─────────────────────────────────
    await page.goto('/#/admin/members');
    await page.waitForLoadState('networkidle');
    await expect(page.getByTestId('members-table')).toBeVisible({ timeout: 30_000 });

    // ── Select 5 patient rows via checkboxes ──────────────────────────────
    for (const uid of seededUserIds) {
      await page.getByTestId(`admin-bulk-select-${uid}`).check();
    }
    await expect(page.getByTestId('admin-bulk-actions-bar')).toBeVisible();

    // ── Click Ban → modal opens ───────────────────────────────────────────
    await page.getByTestId('admin-bulk-action-ban').click();
    const modal = page.getByRole('dialog');
    await expect(modal).toBeVisible();
    await expect(modal).toContainText('Ban 5 members');

    // ── Confirm; await execute RPC response (capture happens via listener) ─
    const execResponse = page.waitForResponse(
      (resp) =>
        resp.url().includes('/rest/v1/rpc/admin_bulk_action_execute') && resp.status() === 200,
      { timeout: 30_000 },
    );
    await modal.getByRole('button', { name: /confirm/i }).click();
    await execResponse;

    // ── DB invariant: 5 profiles flipped to account_state='banned' ────────
    const banned = await admin
      .from('profiles')
      .select('id,account_state')
      .in('id', seededUserIds);
    expect(banned.error).toBeNull();
    expect(banned.data?.length).toBe(seededUserIds.length);
    for (const row of banned.data ?? []) {
      expect(row.account_state).toBe('banned');
    }

    // ── AdminUndoBanner visible ───────────────────────────────────────────
    const banner = page.getByTestId('admin-undo-banner');
    await expect(banner).toBeVisible({ timeout: 5_000 });

    // ── FORCE-EXPIRE: backdate expires_at to simulate the 60s window past ─
    // This is the CI-speed alternative to `await page.waitForTimeout(65000)`.
    // The undo RPC's `expires_at > now()` predicate is the same code path
    // the cron's DELETE WHERE walks, so this proves the same semantic.
    expect(capturedUndoToken).toBeTruthy();
    const expireUpdate = await admin
      .from('bulk_action_undo_token')
      .update({ expires_at: new Date(Date.now() - 1_000).toISOString() })
      .eq('token', capturedUndoToken!);
    expect(expireUpdate.error).toBeNull();

    // ── Click Undo; await undo RPC response (expect non-200 OR error body) ─
    // The RPC raises sqlstate 22023 with message 'token_expired'. PostgREST
    // surfaces this as a 4xx response with a JSON body containing the code
    // and message. We accept the response regardless of status here and
    // assert on the body content.
    const undoResponse = page.waitForResponse(
      (resp) => resp.url().includes('/rest/v1/rpc/admin_bulk_action_undo'),
      { timeout: 30_000 },
    );
    await page.getByTestId('admin-undo-button').click();
    const resp = await undoResponse;

    // Body contains '22023' or 'token_expired' (PostgREST error envelope shape).
    const bodyText = await resp.text();
    expect(
      bodyText.includes('22023') || bodyText.toLowerCase().includes('token_expired'),
    ).toBe(true);

    // ── UI surfaces the expiry — toast/banner text contains 'expired' ─────
    // We don't pin exact copy here because the AdminUndoBanner / toast wording
    // is owned by Plan 27-01 and may evolve. The contract is: the user MUST
    // see some surface that contains 'expired' (or similar) — we grep the
    // page text for any expired-window phrasing.
    await expect(
      page.getByText(/expired|window has passed|no longer available/i).first(),
    ).toBeVisible({ timeout: 5_000 });

    // ── DB invariant: 5 profiles STILL account_state='banned' (no rollback) ─
    const stillBanned = await admin
      .from('profiles')
      .select('id,account_state')
      .in('id', seededUserIds);
    expect(stillBanned.error).toBeNull();
    expect(stillBanned.data?.length).toBe(seededUserIds.length);
    for (const row of stillBanned.data ?? []) {
      expect(row.account_state).toBe('banned');
    }

    // ── DB invariant: ZERO 'bulk_action_undone' rows for these target ids ─
    const undoLogs = await admin
      .from('audit_logs')
      .select('target_user_id,action_name')
      .eq('action_name', 'bulk_action_undone')
      .in('target_user_id', seededUserIds);
    expect(undoLogs.error).toBeNull();
    expect(undoLogs.data?.length ?? 0).toBe(0);
  });
});
