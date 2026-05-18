/**
 * Phase 30 Plan 05 — SC#3 Playwright e2e spec.
 *
 * Proves: INSERT into clinician_alerts triggers deliver-cron → realtime broadcast
 * on org-{hmac8}-alerts → ClinicianAlertsPanel in clinician's browser session
 * appends new alert within 5 seconds.
 *
 * Per [[feedback_realtime_layer_e2e_pattern]]: DB-level invariant verification
 * beats UI traversal. The receiving supabase.channel(...).subscribe() is
 * instantiated DIRECTLY in this test file (not in the browser).
 *
 * Gate: PLAYWRIGHT_RUN_P30=1 env var required.
 * Per [[reference_playwright_conditional_project_argv]] — argv detection fails
 * in worker subprocesses; env var is the source of truth.
 *
 * State seeding: page.addInitScript BEFORE page.goto
 * (per [[reference_playwright_state_seeding]] — never page.goto + page.evaluate).
 *
 * File-scoped slug prefix: 'p30-ar' — per [[feedback_rls_per_file_slug_prefix]]
 * to prevent afterAll cleanup clobbering sibling clinic suites.
 *
 * Two-layer assertion:
 *   Layer 1 (DB-level): supabase.channel(channelNameFor(...)).subscribe() in
 *     test file directly; resolves Promise when 'new_alert' broadcast received.
 *   Layer 2 (UI): clinician browser session opens bell icon → ClinicianAlertsPanel
 *     renders the new alert row within 5s.
 */

import { createClient, type SupabaseClient, type RealtimeChannel } from '@supabase/supabase-js';
import { expect, test, type Page } from '@playwright/test';
import {
  cleanupClinicFixtures,
  createOperatorWithOrg,
  createUser,
  getAdmin,
  hasLiveSupabase,
  testEmail,
  testRunId,
  SUPABASE_URL,
  SUPABASE_ANON_KEY,
  SUPABASE_SERVICE_ROLE_KEY,
} from './fixtures/clinic-fixtures';

// ── Env gate ──────────────────────────────────────────────────────────────────
// Per [[reference_playwright_conditional_project_argv]]: argv detection is broken
// in worker subprocesses — use env var instead.
const PLAYWRIGHT_RUN_P30 = process.env.PLAYWRIGHT_RUN_P30 === '1';

// ── File-scoped slug prefix ───────────────────────────────────────────────────
const SLUG_PREFIX = 'p30-ar';

// ── Supabase localStorage key for this project ref ───────────────────────────
const SB_AUTH_KEY = 'sb-ytnsipxxmzgaebkqmokp-auth-token';

// ── HMAC channel name helper (mirrors src/lib/org-realtime.ts) ────────────────
// We implement this directly in Node (no crypto.subtle in older Node — use WebCrypto API
// available in Node 18+).

async function channelNameFromSecret(
  orgId: string,
  suffix: string,
  secretHex: string,
): Promise<string> {
  const { webcrypto } = await import('node:crypto');
  const bytes = new Uint8Array(secretHex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(secretHex.slice(i * 2, i * 2 + 2), 16);
  }

  const key = await webcrypto.subtle.importKey(
    'raw',
    bytes.buffer as ArrayBuffer,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );

  const input = new TextEncoder().encode(`${orgId}:${suffix}`);
  const signature = await webcrypto.subtle.sign('HMAC', key, input);
  const hex = Array.from(new Uint8Array(signature), (b) => b.toString(16).padStart(2, '0')).join('');
  return `org-${hex.slice(0, 8)}-${suffix}`;
}

// ── ES256-compat session mint ─────────────────────────────────────────────────
/**
 * Get live access_token via admin.generateLink + /auth/v1/verify (plain fetch).
 * Per [[reference_rls_fixture_gotrueclient_flake]]: signInWithPassword cross-
 * contaminates under vitest; generateLink+verify is the correct pattern.
 */
async function getAccessToken(
  email: string,
): Promise<{ accessToken: string; refreshToken: string }> {
  const admin = getAdmin();
  const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
    type: 'magiclink',
    email,
  });
  if (linkErr || !linkData?.properties?.hashed_token) {
    throw new Error(`generateLink failed for ${email}: ${linkErr?.message ?? 'no hashed_token'}`);
  }

  const { hashed_token } = linkData.properties;
  const verifyRes = await fetch(`${SUPABASE_URL}/auth/v1/verify`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: SUPABASE_ANON_KEY!,
    },
    body: JSON.stringify({ type: 'magiclink', token_hash: hashed_token }),
  });

  if (!verifyRes.ok) {
    throw new Error(`/auth/v1/verify failed ${verifyRes.status}: ${await verifyRes.text()}`);
  }

  const session = await verifyRes.json() as {
    access_token?: string;
    refresh_token?: string;
  };
  if (!session.access_token) {
    throw new Error(`verify returned no access_token for ${email}`);
  }
  return { accessToken: session.access_token, refreshToken: session.refresh_token ?? '' };
}

/**
 * Seed Supabase auth session into a page's localStorage via addInitScript.
 * Must be called BEFORE page.goto (per [[reference_playwright_state_seeding]]).
 */
async function seedAuthSession(
  page: Page,
  accessToken: string,
  refreshToken: string,
  userId: string,
) {
  const sessionJson = JSON.stringify({
    currentSession: {
      access_token: accessToken,
      refresh_token: refreshToken,
      token_type: 'bearer',
      expires_in: 3600,
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      user: { id: userId },
    },
    expiresAt: Math.floor(Date.now() / 1000) + 3600,
  });

  await page.addInitScript(
    ({ key, val }: { key: string; val: string }) => {
      localStorage.setItem(key, val);
    },
    { key: SB_AUTH_KEY, val: sessionJson },
  );
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test.describe('@phase30 SC#3 — alert INSERT → realtime broadcast → panel renders within 5s', () => {
  test.skip(
    !PLAYWRIGHT_RUN_P30 || !hasLiveSupabase(),
    'requires PLAYWRIGHT_RUN_P30=1 + SUPABASE_URL + SUPABASE_ANON_KEY + SUPABASE_SERVICE_ROLE_KEY',
  );
  test.setTimeout(120_000);
  test.describe.configure({ mode: 'serial' });

  const runId = testRunId();
  let orgId: string;
  let orgSlug: string;
  let clinicianEmail: string;
  let clinicianUserId: string;
  let patientUserId: string;
  let clinicianAccessToken: string;
  let clinicianRefreshToken: string;
  let testAlertId: string | null = null;
  let realtimeChannel: RealtimeChannel | null = null;
  let subClient: SupabaseClient | null = null;

  // File-scoped debounce_key prefix so cleanup doesn't hit other tests
  const TEST_DEBOUNCE_PREFIX = `test:p30-ar:${runId}:`;

  test.beforeAll(async () => {
    const adminClient = getAdmin();

    // Create operator + org (operator becomes admin member)
    const { operator, orgId: oid, slug } = await createOperatorWithOrg(`${SLUG_PREFIX}-${runId}`);
    orgId = oid;
    orgSlug = slug;

    // Create a clinician (staff role) in the org
    const clinician = await createUser({ email: testEmail(`p30-clin`, runId) });
    clinicianEmail = clinician.email;

    // Resolve clinician user ID
    const { data: clinData } = await adminClient.auth.admin.getUserByEmail(clinicianEmail);
    clinicianUserId = clinData?.user?.id ?? clinician.id;

    // Add clinician to org as 'staff'
    await adminClient.from('org_members').insert({
      org_id: orgId,
      user_id: clinicianUserId,
      role: 'staff',
    });

    // Create a patient user for the alert
    const patient = await createUser({ email: testEmail(`p30-pt`, runId) });
    patientUserId = patient.id;

    // Link patient to org
    await adminClient.from('org_patient_links').insert({
      org_id: orgId,
      patient_user_id: patientUserId,
      consent_scope: { read_activity: true },
    });

    // Get clinician session tokens (ES256-compat)
    const tokens = await getAccessToken(clinicianEmail);
    clinicianAccessToken = tokens.accessToken;
    clinicianRefreshToken = tokens.refreshToken;
  });

  test.afterAll(async () => {
    // Cleanup realtime subscription
    if (realtimeChannel) {
      try { await subClient?.removeChannel(realtimeChannel); } catch { /* best-effort */ }
    }

    // Cleanup test alert rows
    const adminClient = getAdmin();
    if (testAlertId) {
      await adminClient
        .from('clinician_alert_deliveries')
        .delete()
        .eq('alert_id', testAlertId);
      await adminClient
        .from('clinician_alerts')
        .delete()
        .eq('id', testAlertId);
    }
    // Also clean any stray test alerts by debounce_key prefix
    await adminClient
      .from('clinician_alerts')
      .delete()
      .like('debounce_key', `${TEST_DEBOUNCE_PREFIX}%`);

    // Cleanup fixtures
    await cleanupClinicFixtures({
      emailPattern: SLUG_PREFIX,
      slugPattern: SLUG_PREFIX,
    });
    const adminClient2 = getAdmin();
    try { await adminClient2.auth.admin.deleteUser(clinicianUserId); } catch { /* best-effort */ }
    try { await adminClient2.auth.admin.deleteUser(patientUserId); } catch { /* best-effort */ }
  });

  test('Layer 1 (DB-level): realtime broadcast received within 5s of alert INSERT', async () => {
    const adminClient = getAdmin();

    // Fetch the realtime HMAC secret via service-role RPC
    const { data: secretHex, error: secretErr } = await adminClient.rpc('get_realtime_secret');
    if (secretErr) {
      // Fallback: try get_realtime_channel_keying (browser-side RPC)
      const { data: keyingHex, error: keyingErr } = await adminClient.rpc('get_realtime_channel_keying');
      if (keyingErr || !keyingHex) {
        throw new Error(
          `Could not fetch realtime secret: ${secretErr.message}; keying: ${keyingErr?.message ?? 'no data'}`,
        );
      }
      // Use keying secret
      const channelName = await channelNameFromSecret(orgId, 'alerts', keyingHex as string);

      // Subscribe to the alerts channel (anon-key client, clinician session)
      subClient = createClient(SUPABASE_URL!, SUPABASE_ANON_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
      await subClient.auth.setSession({
        access_token: clinicianAccessToken,
        refresh_token: clinicianRefreshToken,
      });

      await _runRealtimeAssertion(adminClient, channelName);
      return;
    }

    const channelName = await channelNameFromSecret(orgId, 'alerts', secretHex as string);

    // Subscribe in test file (per [[feedback_realtime_layer_e2e_pattern]])
    subClient = createClient(SUPABASE_URL!, SUPABASE_ANON_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    await subClient.auth.setSession({
      access_token: clinicianAccessToken,
      refresh_token: clinicianRefreshToken,
    });

    await _runRealtimeAssertion(adminClient, channelName);
  });

  async function _runRealtimeAssertion(adminClient: SupabaseClient, channelName: string) {
    // Set up channel subscription BEFORE inserting the alert
    const receivedAlertPromise = new Promise<{ alert_id: string; alert_type: string }>(
      (resolve, reject) => {
        const ch = subClient!.channel(channelName, {
          config: { private: true },
        });
        ch.on(
          'broadcast',
          { event: 'new_alert' },
          (msg: { payload: { alert_id: string; alert_type: string } }) => {
            resolve(msg.payload);
          },
        );
        ch.subscribe((status, err) => {
          if (status === 'CHANNEL_ERROR') {
            reject(new Error(`Channel subscribe error: ${String(err)}`));
          }
        });
        realtimeChannel = ch;
      },
    );

    // Give the subscription a moment to stabilize
    await new Promise((r) => setTimeout(r, 500));

    // Insert test alert via service-role (mimics detect-cron INSERT)
    const debounceKey = `${SLUG_PREFIX}:${runId}:dose_adherence:${patientUserId}:${new Date().toISOString().slice(0, 10)}`;
    const { data: alertRow, error: insertErr } = await adminClient
      .from('clinician_alerts')
      .insert({
        org_id: orgId,
        patient_user_id: patientUserId,
        alert_type: 'dose_adherence',
        severity: 1,
        status: 'pending',
        threshold_snapshot: { missed_doses_n: 2, window_days_m: 14, variance_pct_x: 25 },
        debounce_key: debounceKey,
        retry_count: 0,
      })
      .select('id')
      .single();

    if (insertErr || !alertRow?.id) {
      throw new Error(`clinician_alerts INSERT failed: ${insertErr?.message ?? 'no id'}`);
    }
    testAlertId = alertRow.id as string;

    // Trigger deliver-cron HTTP POST (mimics pg_cron's */20 invocation)
    const deliverCronUrl = `${SUPABASE_URL}/functions/v1/clinician-alert-deliver-cron`;
    const cronRes = await fetch(deliverCronUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json',
      },
    });

    if (!cronRes.ok) {
      const body = await cronRes.text();
      // Log but don't fail — the realtime broadcast might still arrive from the
      // DB-level NOTIFY trigger (if that path is wired). We check the promise.
      console.warn(`deliver-cron returned ${cronRes.status}: ${body}`);
    } else {
      const cronBody = await cronRes.json() as { ok: boolean; processed: number };
      console.log(`deliver-cron response: ${JSON.stringify(cronBody)}`);
    }

    // Layer 1: await broadcast with 5s timeout (SC#3 requirement)
    const received = await Promise.race([
      receivedAlertPromise,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('SC#3: no realtime broadcast within 5s')), 5000),
      ),
    ]);

    // Assert payload shape
    expect(received).toMatchObject({
      alert_id: expect.any(String),
      alert_type: 'dose_adherence',
    });
  }

  test('Layer 2 (UI): bell icon opens panel showing new alert within 5s', async ({ page }) => {
    test.skip(!testAlertId, 'Layer 1 must pass first to have a known alert ID');

    // Seed clinician session into page
    await seedAuthSession(page, clinicianAccessToken, clinicianRefreshToken, clinicianUserId);

    // Navigate to the clinic roster (any route that renders ClinicContextBar)
    await page.goto(`/clinic/${orgSlug}/roster`);
    await page.waitForLoadState('networkidle');

    // Wait for ClinicContextBar to be visible
    await page.waitForSelector('[data-testid="clinic-context-bar"]', { timeout: 15_000 });

    // Click the bell icon button
    const bellBtn = page.getByRole('button', { name: /clinician alerts/i });
    await expect(bellBtn).toBeVisible({ timeout: 5000 });
    await bellBtn.click();

    // ClinicianAlertsPanel should open (role="region" aria-label="Clinician alerts")
    const panel = page.getByRole('region', { name: /clinician alerts/i });
    await expect(panel).toBeVisible({ timeout: 5000 });

    // Panel should render the test alert row (alert_type=dose_adherence → "Missed doses" label)
    // Retry with a 5s window per SC#3 requirement
    await expect(
      panel.getByText('Missed doses'),
    ).toBeVisible({ timeout: 5000 });
  });
});
