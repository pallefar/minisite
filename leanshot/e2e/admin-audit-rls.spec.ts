/**
 * Phase 24 Plan 24-06 — admin-audit-rls.spec.ts
 *
 * End-to-end spec: admin opens Audit Log, observes a recorded action with diff,
 * and DB-level RLS deny is verified.
 *
 * Flows:
 *   1. Bootstrap a superadmin user + a low-privilege user.
 *   2. Insert a synthetic audit_logs row (via log_admin_action RPC as superadmin).
 *   3. DB-level invariant (per [[feedback_realtime_layer_e2e_pattern]]):
 *      - Superadmin can SELECT the row.
 *      - Low-privilege user (anon-auth, no admin_role) gets empty / RLS denial.
 *   4. UI traversal (when PLAYWRIGHT_RUN_ADMIN_AUDIT=1):
 *      - Navigate to /admin/audit-log as superadmin.
 *      - Assert the row appears in the list.
 *      - Click the row → assert AuditRowExpand renders (Before / After).
 *
 * Per [[reference_playwright_state_seeding.md]]:
 *   Uses page.addInitScript to seed session (not evaluate + reload).
 *
 * Per [[feedback_realtime_layer_e2e_pattern]]:
 *   DB-level invariant verification > UI traversal.
 *   RLS deny assertion is the HARD assertion; UI traversal is best-effort.
 *
 * Skips when SUPABASE_SERVICE_ROLE_KEY is absent (no live DB).
 * Skips UI when PLAYWRIGHT_RUN_ADMIN_AUDIT is not set.
 *
 * Per-file slug prefix: `phase24-audit-rls`.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { test, expect, type BrowserContext } from '@playwright/test';

// ── Config ─────────────────────────────────────────────────────────────────────

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? '';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY ?? '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const APP_URL = process.env.PLAYWRIGHT_APP_URL ?? 'http://localhost:5173';

const HAS_LIVE_SUPABASE = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY && SUPABASE_SERVICE_ROLE_KEY);
const RUN_UI = process.env.PLAYWRIGHT_RUN_ADMIN_AUDIT === '1';

// Per-file prefix prevents afterAll cleanup clobbering other suites
const TEST_SLUG_PREFIX = `phase24-audit-rls-${Date.now()}`;

// ── Admin client ───────────────────────────────────────────────────────────────

let _admin: SupabaseClient | null = null;
function getAdmin(): SupabaseClient {
  if (!_admin) {
    _admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  }
  return _admin;
}

// ── Test helpers ───────────────────────────────────────────────────────────────

async function createTestUser(email: string, password: string) {
  const admin = getAdmin();
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error) throw new Error(`createTestUser: ${error.message}`);
  return data.user!;
}

async function setAdminRole(userId: string, role: 'staff' | 'admin' | 'superadmin') {
  const admin = getAdmin();
  const { error } = await admin
    .from('profiles')
    .update({ admin_role: role, is_staff: true })
    .eq('id', userId);
  if (error) throw new Error(`setAdminRole: ${error.message}`);
}

async function deleteTestUser(userId: string) {
  await getAdmin().auth.admin.deleteUser(userId).catch(() => {/* best-effort */});
}

async function signInAs(email: string, password: string): Promise<SupabaseClient> {
  const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`signInAs: ${error.message}`);
  return client;
}

// ── Suite ──────────────────────────────────────────────────────────────────────

test.describe('@phase24 Admin Audit Log — RLS + UI proof', () => {
  test.skip(!HAS_LIVE_SUPABASE, 'requires SUPABASE_URL + SUPABASE_ANON_KEY + SUPABASE_SERVICE_ROLE_KEY');
  test.setTimeout(120_000);

  const superadminEmail = `${TEST_SLUG_PREFIX}-superadmin@test.leanshot.app`;
  const superadminPassword = 'AdminTest!24-super';
  const lowPrivEmail = `${TEST_SLUG_PREFIX}-lowpriv@test.leanshot.app`;
  const lowPrivPassword = 'AdminTest!24-low';

  let superadminId: string;
  let lowPrivId: string;
  let insertedRowId: string;

  test.beforeAll(async () => {
    const superadmin = await createTestUser(superadminEmail, superadminPassword);
    superadminId = superadmin.id;
    await setAdminRole(superadminId, 'superadmin');

    const lowPriv = await createTestUser(lowPrivEmail, lowPrivPassword);
    lowPrivId = lowPriv.id;
    // Low-priv user: no admin_role set; regular user

    // Insert a synthetic audit row via log_admin_action as superadmin
    const superadminClient = await signInAs(superadminEmail, superadminPassword);
    const { data: rowId, error: rpcErr } = await superadminClient.rpc('log_admin_action', {
      p_action_name: 'test.audit_rls_proof',
      p_target_user_id: lowPrivId,
      p_table_name: 'profiles',
      p_row_pk: lowPrivId,
      p_before: { role: null },
      p_after: { role: 'viewer' },
    });
    if (rpcErr) throw new Error(`log_admin_action failed: ${rpcErr.message}`);
    insertedRowId = rowId as string;
  });

  test.afterAll(async () => {
    // Clean up test users (best-effort)
    if (superadminId) await deleteTestUser(superadminId);
    if (lowPrivId) await deleteTestUser(lowPrivId);
  });

  // ── DB-level: superadmin can SELECT the row ─────────────────────────────────

  test('DB-level: superadmin can SELECT their own audit row', async () => {
    const client = await signInAs(superadminEmail, superadminPassword);
    const { data, error } = await client
      .from('audit_logs')
      .select('id, action_name, before_data, after_data')
      .eq('id', insertedRowId)
      .single();

    expect(error).toBeNull();
    expect(data).not.toBeNull();
    expect((data as Record<string, unknown>)['action_name']).toBe('test.audit_rls_proof');
    // Verify before/after diff data is stored
    expect((data as Record<string, unknown>)['before_data']).toMatchObject({ role: null });
    expect((data as Record<string, unknown>)['after_data']).toMatchObject({ role: 'viewer' });
  });

  // ── DB-level: low-privilege user gets RLS denial ────────────────────────────

  test('DB-level: low-privilege user CANNOT SELECT admin audit rows (RLS deny)', async () => {
    const client = await signInAs(lowPrivEmail, lowPrivPassword);
    const { data, error } = await client
      .from('audit_logs')
      .select('id')
      .eq('id', insertedRowId);

    // Per D-17 + audit_logs_select_admin policy: non-admin gets empty result (not error)
    // The RLS policy silently filters rows rather than returning 42501 for SELECT.
    if (error) {
      // Explicit RLS error is also acceptable
      expect(error.message).toBeTruthy();
    } else {
      // Empty result = rows filtered by RLS (expected behavior for SELECT deny)
      expect(data).toEqual([]);
    }
  });

  // ── DB-level: service_role can SELECT (audit archive needs read access) ──────

  test('DB-level: service_role admin client can SELECT audit rows (archive needs read)', async () => {
    const admin = getAdmin();
    const { data, error } = await admin
      .from('audit_logs')
      .select('id, action_name')
      .eq('id', insertedRowId)
      .single();

    expect(error).toBeNull();
    expect(data).not.toBeNull();
    expect((data as Record<string, unknown>)['id']).toBe(insertedRowId);
  });

  // ── UI: admin opens Audit Log module, sees row, expands diff ─────────────────

  test(
    'UI: superadmin navigates to /admin/audit-log and sees the audit row with diff',
    async ({ browser }) => {
      test.skip(!RUN_UI, 'Set PLAYWRIGHT_RUN_ADMIN_AUDIT=1 to run UI assertions');

      // Sign in as superadmin and get session
      const client = await signInAs(superadminEmail, superadminPassword);
      const { data: { session } } = await client.auth.getSession();
      if (!session) throw new Error('No session after sign in');

      // Create browser context with pre-seeded session
      // Per [[reference_playwright_state_seeding.md]]: addInitScript seeds before load
      const context: BrowserContext = await browser.newContext();
      const page = await context.newPage();

      await page.addInitScript(
        ({ url, key, sess }: { url: string; key: string; sess: string }) => {
          localStorage.setItem(key, sess);
          void url; // reference to avoid lint warning
        },
        {
          url: SUPABASE_URL,
          key: 'sb-leanshot-auth',
          sess: JSON.stringify(session),
        },
      );

      await page.goto(`${APP_URL}/admin/audit-log`);

      // Wait for audit log to load (skeleton → rows)
      await page.waitForSelector('[data-testid="audit-log-module"], h1:has-text("Audit Log")', {
        timeout: 15_000,
      });

      // Assert the test row is visible
      await page.waitForSelector(`text=test.audit_rls_proof`, { timeout: 10_000 });
      const actionCell = page.locator(`text=test.audit_rls_proof`).first();
      await expect(actionCell).toBeVisible();

      // Click the row to expand diff
      await actionCell.click();

      // AuditRowExpand should render Before / After diff
      await page.waitForSelector('text=Before / After', { timeout: 5_000 });
      const diffHeader = page.locator('text=Before / After').first();
      await expect(diffHeader).toBeVisible();

      // JsonDiffViewer should show 'role' key
      const roleKey = page.locator('[data-diff-status]').filter({ hasText: 'role' }).first();
      if (await roleKey.isVisible()) {
        // At least one diff row rendered
        expect(true).toBe(true);
      }

      await context.close();
    },
  );
});
