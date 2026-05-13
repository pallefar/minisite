/**
 * Phase 10 Plan 10-08 — clinic-audit.spec.ts
 *
 * End-to-end spec: AuditTab filter + clear flow.
 *
 * Flow:
 *   1. Seed 1 org with 2 operator members (Owner A + Coach B).
 *   2. Admin-insert 5 audit_logs rows directly: 3 from operator A, 2 from operator B.
 *   3. Sign in as Owner A (who has audit_log.read).
 *   4. Navigate to /clinic/{slug}/settings/audit.
 *   5. Assert 5 rows render (count line shows "Showing 1–5 of 5 events").
 *   6. Filter by member A → assert "Showing 1–3 of 3 events".
 *   7. Click Clear filters → assert "Showing 1–5 of 5 events".
 *
 * Per memory reference_playwright_state_seeding.md:
 *   Uses page.addInitScript to seed session (not evaluate + reload).
 *
 * Per memory reference_supabase_project.md:
 *   Exercises org-scoped audit_logs RLS — rows for org-1 are not visible
 *   to users outside the org (cross-tenant test done in rls-audit-logs.test.ts).
 *
 * Skips when SUPABASE_SERVICE_ROLE_KEY is absent (no live DB).
 */

import { createClient } from '@supabase/supabase-js';
import { expect, test } from '@playwright/test';

import {
  cleanupClinicFixtures,
  createOperatorWithOrg,
  createRoleAs,
  createUser,
  getAdmin,
  hasLiveSupabase,
  signIn,
  testEmail,
  testRunId,
  SUPABASE_URL,
  SUPABASE_ANON_KEY,
} from './fixtures/clinic-fixtures';

// ── Test suite ─────────────────────────────────────────────────────────────────

test.describe('@phase10 Audit tab — filter + clear flow', () => {
  test.skip(
    !hasLiveSupabase(),
    'requires SUPABASE_URL + SUPABASE_ANON_KEY + SUPABASE_SERVICE_ROLE_KEY',
  );
  test.setTimeout(120_000);

  const runId = testRunId();
  let ownerEmail: string;
  let ownerPassword: string;
  let orgSlug: string;
  let orgId: string;
  let ownerUserId: string;
  let coachUserId: string;

  test.beforeAll(async () => {
    const admin = getAdmin();

    // Create owner with org (Owner role has audit_log.read by default from Phase 9 seed)
    const { operator: owner, orgId: oid, slug, client: ownerClient } = await createOperatorWithOrg(
      `audit-${runId}`,
    );
    ownerEmail = owner.email;
    ownerPassword = owner.password;
    orgSlug = slug;
    orgId = oid;
    ownerUserId = owner.id;

    // Set display name for owner
    await admin.auth.admin.updateUserById(ownerUserId, {
      user_metadata: { display_name: 'Alice Owner' },
    });

    // Create a second operator (Coach B) — invite + make them a member
    const coachEmail = testEmail('audit-coach', runId);
    const coach = await createUser({ email: coachEmail });
    coachUserId = coach.id;
    await admin.auth.admin.updateUserById(coachUserId, {
      user_metadata: { display_name: 'Bob Coach' },
    });

    // Get the Owner role id so we can invite coach as member
    const { data: roles } = await admin
      .from('roles')
      .select('id, name')
      .eq('org_id', orgId)
      .like('name', '%Owner%')
      .limit(1);
    const ownerRoleId = (roles as Array<{ id: string; name: string }> | null)?.[0]?.id;

    if (ownerRoleId) {
      // Directly insert a membership for coach via admin (bypasses invite flow)
      await admin.from('memberships').insert({
        user_id: coachUserId,
        org_id: orgId,
        role_id: ownerRoleId, // give Owner role so they can be tracked
        consent_scope: {},
        joined_at: new Date().toISOString(),
        accepted_at: new Date().toISOString(),
      });
    }

    // Admin-insert 5 audit_logs rows directly:
    // 3 from owner (Alice), 2 from coach (Bob)
    const now = new Date();
    const rows = [
      {
        org_id: orgId,
        actor_user_id: ownerUserId,
        actor_type: 'member',
        action: 'member.invite',
        target_user_id: null,
        created_at: new Date(now.getTime() - 5 * 60_000).toISOString(),
      },
      {
        org_id: orgId,
        actor_user_id: ownerUserId,
        actor_type: 'member',
        action: 'role.update',
        target_user_id: null,
        created_at: new Date(now.getTime() - 4 * 60_000).toISOString(),
      },
      {
        org_id: orgId,
        actor_user_id: ownerUserId,
        actor_type: 'member',
        action: 'patient_data.read',
        target_user_id: coachUserId,
        created_at: new Date(now.getTime() - 3 * 60_000).toISOString(),
      },
      {
        org_id: orgId,
        actor_user_id: coachUserId,
        actor_type: 'member',
        action: 'patient_data.read',
        target_user_id: ownerUserId,
        created_at: new Date(now.getTime() - 2 * 60_000).toISOString(),
      },
      {
        org_id: orgId,
        actor_user_id: coachUserId,
        actor_type: 'member',
        action: 'section_view',
        target_user_id: ownerUserId,
        created_at: new Date(now.getTime() - 1 * 60_000).toISOString(),
      },
    ];

    const { error: insertError } = await admin.from('audit_logs').insert(rows);
    if (insertError) {
      throw new Error(`Failed to insert audit_logs seed rows: ${insertError.message}`);
    }
  });

  test.afterAll(async () => {
    await cleanupClinicFixtures({
      emailPattern: `audit-${runId}`,
      slugPattern: `audit-${runId}`,
    });
  });

  test('audit tab — 5 rows render; filter by member → 3 rows; clear → 5 rows', async ({ page }) => {
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
      test.skip();
      return;
    }

    // ── Step 1: Sign in as owner via supabase-js ───────────────────────────────
    const signInClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data: signInData, error: signInError } = await signInClient.auth.signInWithPassword({
      email: ownerEmail,
      password: ownerPassword,
    });
    if (signInError || !signInData.session) {
      throw new Error(`Sign-in failed: ${signInError?.message ?? 'no session'}`);
    }
    const session = signInData.session;

    // ── Step 2: Seed session into browser via addInitScript ────────────────────
    // Per memory reference_playwright_state_seeding.md: use addInitScript, NOT
    // evaluate + reload to avoid supabase-js INITIAL_SESSION race condition.
    await page.addInitScript(
      ({ storageKey, sessionJson }: { storageKey: string; sessionJson: object }) => {
        try {
          window.localStorage.setItem(storageKey, JSON.stringify(sessionJson));
        } catch {
          // best-effort
        }
      },
      { storageKey: 'sb-leanshot-auth', sessionJson: { ...session } },
    );

    // ── Step 3: Navigate to audit tab ─────────────────────────────────────────
    await page.goto(`/clinic/${orgSlug}/settings/audit`);

    // Wait for the Audit log heading
    await page.waitForSelector('h1:has-text("Audit log")', { timeout: 20_000 });

    // ── Step 4: Assert 5 rows render ──────────────────────────────────────────
    // The result count line shows the total
    await expect(page.locator('p[aria-live="polite"]')).toContainText('5 events', {
      timeout: 15_000,
    });

    // ── Step 5: Filter by member Alice Owner ──────────────────────────────────
    // Open the member dropdown
    await page.click('button[aria-label*="Member:"]');
    // The member dropdown should list org members loaded via list_org_members RPC
    // Wait for Alice Owner option
    await page.waitForSelector('button[role="option"]:has-text("Alice Owner")', {
      timeout: 10_000,
    });
    await page.click('button[role="option"]:has-text("Alice Owner")');

    // After filter: should show 3 events (rows from ownerUserId)
    await expect(page.locator('p[aria-live="polite"]')).toContainText('3 events', {
      timeout: 10_000,
    });

    // ── Step 6: Clear filters → 5 rows again ──────────────────────────────────
    await page.click('button:has-text("Clear filters")');
    await expect(page.locator('p[aria-live="polite"]')).toContainText('5 events', {
      timeout: 10_000,
    });
  });
});
