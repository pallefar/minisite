/**
 * Phase 27 Plan 27-01 — Admin bulk-actions ban + 60s undo round-trip e2e.
 *
 * Test "admin bans 5 members and undoes within 60s":
 *   1. Seed 5 patient profiles + a seeded admin (admin_role='admin', has_totp=true).
 *   2. Inject admin's access_token via page.addInitScript (NEVER UI login —
 *      free-tier auth rate limits per [[reference_supabase_auth_traps]]).
 *   3. Navigate to /#/admin/members. Select 5 rows via checkbox. Click Ban.
 *   4. Confirm modal renders "Ban 5 members — alice, bob, carol, +2 more".
 *   5. Click Confirm. Await response on /rest/v1/rpc/admin_bulk_action_execute.
 *   6. Query supabase admin client: assert 5 profiles flipped to account_state='banned'.
 *   7. AdminUndoBanner visible with role="status". Click Undo.
 *   8. Await response on /rest/v1/rpc/admin_bulk_action_undo.
 *   9. Re-query: 5 profiles restored to account_state='active' AND audit_logs has
 *      5 rows with action_name='bulk_action_undone' for the seeded user ids.
 *   10. afterAll: delete the 6 seeded users.
 *
 * GATING: opt-in via PLAYWRIGHT_RUN_BULK_ACTIONS=1 + live Supabase env. Default
 * `playwright test` SKIPS this spec because it depends on Phase 27 migrations
 * (20270602000001..05) being pushed to the linked project AND a live admin
 * session that has stepped up to aal2. CI gates that env explicitly.
 *
 * Per project rules:
 *   - File-scoped slug `bulk-${Date.now()}-` per [[feedback_rls_per_file_slug_prefix]].
 *   - addInitScript for state seeding per [[reference_playwright_state_seeding]].
 *   - DB-level invariant assertion per [[feedback_realtime_layer_e2e_pattern]]
 *     (we query supabase admin client directly — not UI text — to confirm
 *     account_state flips + audit_logs rows).
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
const SLUG = `bulk-${Date.now().toString(36)}-`;

function getAdmin(): SupabaseClient {
  return createClient(SUPABASE_URL!, SERVICE_ROLE!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

/** Build a fake JWT with aal2 claim for UI-level admin gate (signed by Supabase NOT required for client-side gate, but RPC calls WILL require a real signed JWT). */
async function realAdminSession(
  admin: SupabaseClient,
  email: string,
  password: string,
): Promise<{ access_token: string; refresh_token: string; expires_at: number; user: { id: string } }> {
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

test.describe('@phase27 ADMIN-04 — bulk ban + 60s undo round-trip', () => {
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
  const patientNames = ['alice', 'bob', 'carol', 'dave', 'eve'];

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

  test('bans 5 members and undoes within 60s — DB invariant', async ({ page }) => {
    // ── Sign in to mint a real signed JWT for RPC calls ───────────────────
    const session = await realAdminSession(admin, adminEmail, adminPassword);
    await seedAdminSession(page, session);

    // ── Navigate to admin members surface ─────────────────────────────────
    await page.goto('/#/admin/members');
    await page.waitForLoadState('networkidle');
    await expect(page.getByTestId('members-table')).toBeVisible({ timeout: 30_000 });

    // ── Select 5 patient rows via checkboxes ──────────────────────────────
    for (const uid of seededUserIds) {
      await page.getByTestId(`admin-bulk-select-${uid}`).check();
    }

    // Bulk-actions bar appears
    await expect(page.getByTestId('admin-bulk-actions-bar')).toBeVisible();

    // ── Click Ban → modal opens with preview line ─────────────────────────
    await page.getByTestId('admin-bulk-action-ban').click();
    const modal = page.getByRole('dialog');
    await expect(modal).toBeVisible();
    await expect(modal).toContainText('Ban 5 members');
    // Names truncated to first 3 + "+2 more"
    await expect(modal).toContainText('+2 more');

    // ── Confirm; await execute RPC response ───────────────────────────────
    const execResponse = page.waitForResponse(
      (resp) => resp.url().includes('/rest/v1/rpc/admin_bulk_action_execute') && resp.status() === 200,
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

    // ── AdminUndoBanner visible (role=status) ─────────────────────────────
    const banner = page.getByTestId('admin-undo-banner');
    await expect(banner).toBeVisible({ timeout: 5_000 });
    await expect(banner).toHaveAttribute('role', 'status');

    // ── Click Undo; await undo RPC response ───────────────────────────────
    const undoResponse = page.waitForResponse(
      (resp) => resp.url().includes('/rest/v1/rpc/admin_bulk_action_undo') && resp.status() === 200,
      { timeout: 30_000 },
    );
    await page.getByTestId('admin-undo-button').click();
    await undoResponse;

    // ── DB invariant: 5 profiles restored to account_state='active' ───────
    const restored = await admin
      .from('profiles')
      .select('id,account_state')
      .in('id', seededUserIds);
    for (const row of restored.data ?? []) {
      expect(row.account_state).toBe('active');
    }

    // ── DB invariant: audit_logs has 5 'bulk_action_undone' rows for these ids ─
    const undoLogs = await admin
      .from('audit_logs')
      .select('target_user_id,action_name')
      .eq('action_name', 'bulk_action_undone')
      .in('target_user_id', seededUserIds);
    expect(undoLogs.error).toBeNull();
    expect(undoLogs.data?.length).toBe(seededUserIds.length);
  });
});
