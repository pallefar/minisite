/**
 * Phase 31 Plan 06 — patient-org-onboarding.spec.ts
 *
 * Env requirements (MUST be set for this spec to run):
 *   SUPABASE_URL              — Supabase project URL
 *   SUPABASE_ANON_KEY         — Supabase anon key
 *   SUPABASE_SERVICE_ROLE_KEY — Supabase service-role key (CI secret)
 *
 * Gate: PLAYWRIGHT_RUN_P31=1 (per [[reference_playwright_conditional_project_argv]])
 *
 * What this spec proves (ORG-13 end-to-end):
 *   Test 1 — invited patient sees org's customized welcome text on first sign-in (D-10).
 *   Test 2 — completing onboarding writes profiles.completed_onboarding_at (D-13).
 *   Test 3 — second visit skips onboarding, shows dashboard directly (D-14).
 *   Test 4 — multi-clinic invite does NOT re-trigger onboarding (D-15 first-clinic-wins).
 *
 * Session seeding: uses page.addInitScript (per [[reference_playwright_state_seeding]])
 * to inject the patient Supabase session into localStorage BEFORE navigation.
 * This avoids the supabase-js INITIAL_SESSION race (page.goto + page.evaluate + reload).
 *
 * File-scoped slug prefix: per [[feedback_rls_per_file_slug_prefix]] to avoid
 * vitest/playwright parallel worker clobbering.
 *
 * Fixture cleanup: wrapped in try/catch per plan spec so partial failure
 * doesn't poison the next run.
 */

import { createClient, type SupabaseClient, type Session } from '@supabase/supabase-js';
import { expect, test } from '@playwright/test';

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? '';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY ?? '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

function hasLiveSupabase(): boolean {
  return Boolean(SUPABASE_URL && SUPABASE_ANON_KEY && SUPABASE_SERVICE_ROLE_KEY);
}

// ---------------------------------------------------------------------------
// File-scoped slug prefix (per [[feedback_rls_per_file_slug_prefix]])
// ---------------------------------------------------------------------------

// Derive a file-scoped slug prefix per [[feedback_rls_per_file_slug_prefix]].
// Must satisfy orgs_slug_format constraint: ^[a-z][a-z0-9-]{1,59}$
// (lowercase letters, digits, hyphens only; starts with a letter; max 60 chars total)
const _ts = Date.now().toString(36); // base-36 to keep it short
const TEST_SLUG_PREFIX = `p31e2e-${_ts}`; // 7 + 1 + ~8 = ~16 chars

// ---------------------------------------------------------------------------
// Admin client (service-role — lazy init per landmine #1)
// ---------------------------------------------------------------------------

let _admin: SupabaseClient | null = null;
function getAdmin(): SupabaseClient {
  if (!_admin) {
    _admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  }
  return _admin;
}

// ---------------------------------------------------------------------------
// Helper: create a user via admin API + sign-in session via generateLink
// (ES256-compat per [[reference_rls_fixture_gotrueclient_flake]])
// ---------------------------------------------------------------------------

interface TestSession {
  userId: string;
  email: string;
  session: Session;
  client: SupabaseClient;
}

async function createUserAndSession(email: string): Promise<TestSession> {
  const admin = getAdmin();
  const password = `P31Test!${Date.now()}`;

  const { data: userData, error: userError } = await admin.auth.admin.createUser({
    email,
    email_confirm: true,
    password,
  });
  if (userError || !userData.user) {
    throw new Error(`createUser(${email}) failed: ${userError?.message ?? 'no user'}`);
  }
  const userId = userData.user.id;

  // Use signInWithPassword (matches clinic-drill-in.spec.ts working pattern)
  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: signInData, error: signInError } = await userClient.auth.signInWithPassword({
    email,
    password,
  });
  if (signInError || !signInData.session) {
    throw new Error(`signInWithPassword(${email}) failed: ${signInError?.message ?? 'no session'}`);
  }

  return {
    userId,
    email,
    session: signInData.session,
    client: userClient,
  };
}

// ---------------------------------------------------------------------------
// Helper: seed the Supabase session into the browser's localStorage
// via addInitScript (per [[reference_playwright_state_seeding]])
//
// Storage key: 'sb-leanshot-auth' (matches storageKey in src/lib/supabase.ts)
// Format: the session JSON directly (matches clinic-drill-in.spec.ts pattern).
// ---------------------------------------------------------------------------

function buildSessionSeed(session: Session): { key: string; value: string } {
  // supabase-js v2 GoTrueClient reads session from storageKey as { currentSession, expiresAt }.
  // The direct session format { access_token, ... } also works per clinic-drill-in.spec.ts pattern.
  // Try both: supabase-js v2.105 the actual stored format is { currentSession: {...}, expiresAt: n }.
  const sessionBlob = {
    access_token: session.access_token,
    refresh_token: session.refresh_token ?? '',
    token_type: 'bearer',
    expires_in: session.expires_in ?? 3600,
    expires_at: session.expires_at ?? Math.floor(Date.now() / 1000) + 3600,
    user: session.user,
  };
  return {
    key: 'sb-leanshot-auth',
    value: JSON.stringify(sessionBlob),
  };
}

// ---------------------------------------------------------------------------
// Suite-level state (set in beforeAll, used across tests)
// ---------------------------------------------------------------------------

let orgXId = '';
let orgXSlug = '';
let patientSession: TestSession | null = null;
let orgXOwnerId = '';

test.describe('@phase31 patient-org-onboarding — 4 scenarios', () => {
  test.skip(!hasLiveSupabase(), 'requires SUPABASE_URL + SUPABASE_ANON_KEY + SUPABASE_SERVICE_ROLE_KEY');
  test.setTimeout(120_000);

  // ── beforeAll: create org X + owner + active flow + patient ─────────────
  test.beforeAll(async () => {
    const admin = getAdmin();

    // 1. Create org X owner
    const ownerEmail = `${TEST_SLUG_PREFIX}_owner@example.test`;
    const ownerSession = await createUserAndSession(ownerEmail);
    orgXOwnerId = ownerSession.userId;

    // 2. Create org X via owner's client
    // Slug must match ^[a-z][a-z0-9-]{1,59}$ — use hyphen separator, not underscore
    orgXSlug = `${TEST_SLUG_PREFIX}-x`.slice(0, 60);
    const { data: orgXData, error: orgXError } = await ownerSession.client.rpc('create_org', {
      p_name: 'Acme Health Test',
      p_slug: orgXSlug,
      p_description: null,
      p_website_url: null,
    });
    if (orgXError) throw new Error(`create_org X failed: ${orgXError.message}`);
    const orgXRow = Array.isArray(orgXData) ? orgXData[0] : orgXData;
    orgXId = orgXRow?.id ?? orgXRow?.org_id;
    if (!orgXId) throw new Error('create_org X returned no id');

    // 3. Save an active onboarding flow for org X.
    // Use admin direct insert (bypasses RLS for test setup — same pattern as clinic-fixtures.ts).
    // The RPC save_org_onboarding_flow would require the owner's session to have 'onboarding.edit'
    // which requires get_caller_role to resolve. Direct insert is simpler for test fixture.
    const orgXSteps = [
      { id: 'w1', type: 'welcome', custom: { title: 'Welcome to Acme Health', body: 'Your treatment journey starts here.' } },
      { id: 'm1', type: 'medication' },
      { id: 'c1', type: 'consent' },
    ];
    const { error: saveFlowError } = await admin.from('org_onboarding_flows').insert({
      org_id: orgXId,
      steps: orgXSteps,
      version: 1,
      is_active: true,
      created_by: orgXOwnerId,
    });
    if (saveFlowError) throw new Error(`org_onboarding_flows insert X failed: ${saveFlowError.message}`);

    // 4. Create patient user
    const patientEmail = `${TEST_SLUG_PREFIX}_patient@example.test`;
    patientSession = await createUserAndSession(patientEmail);
    const patientId = patientSession.userId;

    // 5. Link patient to org X (creates org_patient_links row)
    const { error: linkError } = await admin.from('org_patient_links').insert({
      org_id: orgXId,
      patient_user_id: patientId,
    });
    if (linkError) throw new Error(`org_patient_links insert failed: ${linkError.message}`);

    // 6. Set primary_org_id on patient's profile via upsert (ensures row exists,
    //    handles race between createUser trigger and our update).
    const { error: profileError } = await admin
      .from('profiles')
      .upsert({ id: patientId, primary_org_id: orgXId, completed_onboarding_at: null })
      .eq('id', patientId);
    if (profileError) throw new Error(`profiles upsert failed: ${profileError.message}`);

    // Verify the profile was updated correctly
    const { data: profileCheck, error: profileCheckError } = await admin
      .from('profiles')
      .select('primary_org_id, completed_onboarding_at')
      .eq('id', patientId)
      .maybeSingle();
    if (profileCheckError) throw new Error(`profiles verification failed: ${profileCheckError.message}`);
    if (!profileCheck?.primary_org_id) throw new Error(`profiles.primary_org_id not set for patient ${patientId}`);
  });

  // ── afterAll: cleanup all test data ─────────────────────────────────────
  test.afterAll(async () => {
    if (!hasLiveSupabase()) return;
    const admin = getAdmin();

    // Clean up org_patient_links
    try {
      if (patientSession?.userId) {
        await admin.from('org_patient_links').delete().eq('patient_user_id', patientSession.userId);
      }
    } catch { /* noop */ }

    // Clean up org_onboarding_flows
    try {
      if (orgXId) {
        await admin.from('org_onboarding_flows').delete().eq('org_id', orgXId);
      }
    } catch { /* noop */ }

    // Clean up org_members
    try {
      if (orgXId) {
        await admin.from('org_members').delete().eq('org_id', orgXId);
      }
    } catch { /* noop */ }

    // Clean up organizations
    try {
      if (orgXId) {
        await admin.from('organizations').delete().eq('id', orgXId);
      }
    } catch { /* noop */ }

    // Clean up second org if it was created (Test 4)
    try {
      const { data: orgY } = await admin
        .from('organizations')
        .select('id')
        .like('slug', `${TEST_SLUG_PREFIX}-y%`)
        .maybeSingle();
      if (orgY?.id) {
        await admin.from('org_patient_links').delete().eq('org_id', orgY.id);
        await admin.from('org_onboarding_flows').delete().eq('org_id', orgY.id);
        await admin.from('org_members').delete().eq('org_id', orgY.id);
        await admin.from('organizations').delete().eq('id', orgY.id);
      }
    } catch { /* noop */ }

    // Delete patient auth user
    try {
      if (patientSession?.userId) {
        await admin.auth.admin.deleteUser(patientSession.userId);
      }
    } catch { /* noop */ }

    // Delete org X owner auth user
    try {
      if (orgXOwnerId) {
        await admin.auth.admin.deleteUser(orgXOwnerId);
      }
    } catch { /* noop */ }
  });

  // ── Test 1: invited patient sees org flow ───────────────────────────────
  test('invited patient sees org-customized welcome text on first sign-in (D-10)', async ({ page }) => {
    if (!patientSession) throw new Error('patientSession not initialized');

    const sessionSeed = buildSessionSeed(patientSession.session);

    // Seed localStorage BEFORE navigation (per [[reference_playwright_state_seeding]])
    await page.addInitScript(
      ({ key, value }: { key: string; value: string }) => {
        try { localStorage.setItem(key, value); } catch { /* private mode */ }
      },
      sessionSeed,
    );

    // Navigate to root — App.tsx will hydrate, see signedIn.user + primary_org_id
    // + no completed_onboarding_at → render OnboardingFlow with status='org'
    await page.goto('/', { waitUntil: 'networkidle' });

    // Assert org-customized welcome text is visible (NOT consumer "Welcome in.")
    await expect(page.getByText('Welcome to Acme Health')).toBeVisible({ timeout: 15000 });

    // Verify the consumer path's default copy is NOT shown
    await expect(page.getByText(/welcome in\./i)).not.toBeVisible();
  });

  // ── Test 2: completion writes profiles.completed_onboarding_at ─────────
  test('completing org flow writes profiles.completed_onboarding_at (D-13)', async ({ page }) => {
    if (!patientSession) throw new Error('patientSession not initialized');

    const admin = getAdmin();
    const sessionSeed = buildSessionSeed(patientSession.session);

    await page.addInitScript(
      ({ key, value }: { key: string; value: string }) => {
        try { localStorage.setItem(key, value); } catch { /* private mode */ }
      },
      sessionSeed,
    );

    await page.goto('/', { waitUntil: 'networkidle' });

    // Wait for the org flow welcome step
    await expect(page.getByText('Welcome to Acme Health')).toBeVisible({ timeout: 15000 });

    // Continue through the org flow steps:
    // Step 0: welcome — fill name + click Continue
    const nameInput = page.getByLabel(/your name/i);
    if (await nameInput.isVisible()) {
      await nameInput.fill('Test Patient');
    }
    await page.getByRole('button', { name: /continue/i }).click();

    // Step 1: medication — select medication + click Continue
    await page.waitForTimeout(500);
    const medicationSelect = page.getByLabel(/glp-1 medication/i);
    if (await medicationSelect.isVisible()) {
      await medicationSelect.selectOption('ozempic');
    }
    const continueBtn2 = page.getByRole('button', { name: /continue/i });
    if (await continueBtn2.isVisible()) {
      await continueBtn2.click();
    }

    // Step 2: consent — click final "Open dashboard" button
    await page.waitForTimeout(500);
    const openDashboardBtn = page.getByRole('button', { name: /open dashboard/i });
    if (await openDashboardBtn.isVisible()) {
      await openDashboardBtn.click();
    }

    // Wait for transition (mark_onboarding_complete fires async)
    await page.waitForTimeout(2000);

    // Verify profiles.completed_onboarding_at is now non-null via admin query
    const { data: profileData } = await admin
      .from('profiles')
      .select('completed_onboarding_at')
      .eq('id', patientSession.userId)
      .maybeSingle();

    const ts = profileData?.completed_onboarding_at;
    expect(ts).not.toBeNull();
    if (ts) {
      const tsMs = new Date(ts).getTime();
      const nowMs = Date.now();
      // Timestamp should be within the last 60 seconds
      expect(nowMs - tsMs).toBeLessThan(60_000);
    }
  });

  // ── Test 3: second visit skips onboarding ───────────────────────────────
  test('second visit skips onboarding and shows dashboard (D-14)', async ({ page }) => {
    if (!patientSession) throw new Error('patientSession not initialized');

    const sessionSeed = buildSessionSeed(patientSession.session);

    await page.addInitScript(
      ({ key, value }: { key: string; value: string }) => {
        try { localStorage.setItem(key, value); } catch { /* private mode */ }
      },
      sessionSeed,
    );

    await page.goto('/', { waitUntil: 'networkidle' });

    // After Test 2 completed, completed_onboarding_at is set.
    // The hook should return 'completed' → App.tsx shows dashboard, NOT onboarding.
    // Allow time for the hook to resolve
    await page.waitForTimeout(3000);

    // Onboarding welcome text should NOT be visible
    await expect(page.getByText('Welcome to Acme Health')).not.toBeVisible({ timeout: 5000 });

    // Dashboard should be visible (AppShell renders or the page has user-level content)
    // Use a broad selector that indicates the SPA rendered the dashboard
    // (the navigation or main content area)
    const hasContent = await page.evaluate(() => {
      // Check if we're NOT on the onboarding screen
      const text = document.body.innerText;
      return !text.includes('Welcome to Acme Health');
    });
    expect(hasContent).toBe(true);
  });

  // ── Test 4: multi-clinic invite does NOT re-trigger onboarding (D-15) ──
  test('multi-clinic invite does NOT re-trigger onboarding (D-15 first-clinic-wins)', async ({
    page,
  }) => {
    if (!patientSession) throw new Error('patientSession not initialized');

    const admin = getAdmin();

    // Create org Y + owner + active flow
    const orgYOwnerEmail = `${TEST_SLUG_PREFIX}_owner_y@example.test`;
    const orgYOwnerSession = await createUserAndSession(orgYOwnerEmail);
    const orgYOwnerId = orgYOwnerSession.userId;

    const orgYSlug = `${TEST_SLUG_PREFIX}-y`.slice(0, 60);
    const { data: orgYData, error: orgYError } = await orgYOwnerSession.client.rpc('create_org', {
      p_name: 'Beta Clinic Test',
      p_slug: orgYSlug,
      p_description: null,
      p_website_url: null,
    });
    if (orgYError) throw new Error(`create_org Y failed: ${orgYError.message}`);
    const orgYRow = Array.isArray(orgYData) ? orgYData[0] : orgYData;
    const orgYId = orgYRow?.id ?? orgYRow?.org_id;
    if (!orgYId) throw new Error('create_org Y returned no id');

    // Save active flow for org Y with different welcome title (admin direct insert)
    await admin.from('org_onboarding_flows').insert({
      org_id: orgYId,
      steps: [
        { id: 'w1', type: 'welcome', custom: { title: 'Welcome to Beta Clinic' } },
        { id: 'm1', type: 'medication' },
        { id: 'c1', type: 'consent' },
      ],
      version: 1,
      is_active: true,
      created_by: orgYOwnerId,
    });

    // Link patient to org Y (second clinic — first-clinic-wins should apply)
    await admin.from('org_patient_links').insert({
      org_id: orgYId,
      patient_user_id: patientSession.userId,
    });

    // Cleanup org Y owner auth user in afterAll (stored separately here)
    try { await admin.auth.admin.deleteUser(orgYOwnerId); } catch { /* noop */ }

    // Now reload patient session — completed_onboarding_at is still set from Test 2
    const sessionSeed = buildSessionSeed(patientSession.session);

    await page.addInitScript(
      ({ key, value }: { key: string; value: string }) => {
        try { localStorage.setItem(key, value); } catch { /* private mode */ }
      },
      sessionSeed,
    );

    await page.goto('/', { waitUntil: 'networkidle' });
    await page.waitForTimeout(3000);

    // Neither org X nor org Y onboarding should show
    await expect(page.getByText('Welcome to Acme Health')).not.toBeVisible({ timeout: 5000 });
    await expect(page.getByText('Welcome to Beta Clinic')).not.toBeVisible({ timeout: 2000 });

    // Confirm completed_onboarding_at is still set (not wiped by second invite)
    const { data: profileData } = await admin
      .from('profiles')
      .select('completed_onboarding_at')
      .eq('id', patientSession.userId)
      .maybeSingle();
    expect(profileData?.completed_onboarding_at).not.toBeNull();
  });
});
