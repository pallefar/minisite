/**
 * Phase 10 Plan 10-11 — seed-org-50.ts
 *
 * Creates one test org + 50 synthetic patients for roster-perf testing
 * (SC#5: 50-patient roster renders within 2000ms).
 *
 * Each patient gets:
 *   - a unique auth.users row (via admin client)
 *   - an org membership (invite → accept via service-role bypass INSERTs)
 *   - 30 days of synthetic injections, weights, and symptom logs
 *
 * Returns: { orgId, slug, operatorJwt, operatorRefreshToken, patientUserIds }
 *
 * afterAll cleanup: cleanupOrg50({ orgId, operatorUserId, patientUserIds })
 *   — deletes all 51 auth.users (operator + 50 patients) and the org itself.
 *   Best-effort: never throws (masks test failure).
 *
 * Per memory reference_playwright_state_seeding.md:
 *   The operator JWT is returned so specs can seed it into the browser's
 *   localStorage via page.addInitScript (never page.evaluate + reload).
 *
 * Per memory feedback_parallel_executor_git_isolation.md HI-6 style:
 *   All test data uses @test.leanshot.app emails + perf-{ts} slugs so the
 *   cleanup helper can reliably scope deletes.
 *
 * Skips gracefully when SUPABASE_SERVICE_ROLE_KEY is absent.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import {
  fullConsentScope,
  getAdmin,
  hasLiveSupabase,
  makeInviteToken,
  testEmail,
  testRunId,
} from './clinic-fixtures';

export { hasLiveSupabase };

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? '';
const SUPABASE_ANON_KEY =
  process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY ?? '';

export interface Org50Fixture {
  /** The test org UUID. */
  orgId: string;
  /** The test org slug, used to build /clinic/{slug} URLs. */
  slug: string;
  /** JWT (access_token) for the seeded operator, valid for ~1 hour. */
  operatorJwt: string;
  /** Refresh token for the operator (for longevity, if needed). */
  operatorRefreshToken: string;
  /** Supabase storage key where the session is expected in the SPA. */
  storageKey: string;
  /** Full session object for addInitScript injection. */
  sessionJson: object;
  /** User ID of the operator. */
  operatorUserId: string;
  /** User IDs of all 50 synthetic patients (for cleanup). */
  patientUserIds: string[];
  /** Internal run ID — used by cleanupOrg50 to scope deletes. */
  runId: string;
}

const SYMPTOMS = ['nausea', 'fatigue', 'headache', 'dizziness', 'injection_site_reaction'];

async function insertPatientData(
  admin: SupabaseClient,
  userId: string,
  patientIndex: number,
): Promise<void> {
  const now = Date.now();
  const injections: object[] = [];
  const weights: object[] = [];
  const symptoms: object[] = [];

  for (let day = 0; day < 30; day++) {
    const ts = new Date(now - (29 - day) * 86_400_000).toISOString();

    // Inject every 7 days (typical GLP-1 cadence), spread by patient index
    if ((day + patientIndex) % 7 === 0) {
      injections.push({
        user_id: userId,
        site: ['abdomen', 'thigh', 'upper_arm'][day % 3],
        dose_mg: 0.5 + (patientIndex % 4) * 0.25, // 0.5 / 0.75 / 1.0 / 1.25
        created_at: ts,
      });
    }

    // Weight every 3 days
    if (day % 3 === 0) {
      weights.push({
        user_id: userId,
        value_kg: 85 + (patientIndex % 20) - day * 0.03,
        created_at: ts,
      });
    }

    // Symptoms every 5 days
    if (day % 5 === 0) {
      symptoms.push({
        user_id: userId,
        symptom: SYMPTOMS[(day + patientIndex) % SYMPTOMS.length],
        severity: 1 + (patientIndex % 3),
        created_at: ts,
      });
    }
  }

  // Batch inserts — each is small so we can do them in parallel per patient.
  const insertOps: Promise<{ error: unknown }>[] = [];

  if (injections.length > 0) {
    insertOps.push(admin.from('injections').insert(injections));
  }
  if (weights.length > 0) {
    insertOps.push(admin.from('weights').insert(weights));
  }
  if (symptoms.length > 0) {
    insertOps.push(admin.from('symptom_logs').insert(symptoms));
  }

  const results = await Promise.all(insertOps);
  for (const { error } of results) {
    if (error) {
      // Log but do not throw — a missing symptom row won't break the perf spec
      console.warn(
        `[seed-org-50] insert warning for patient ${userId}:`,
        error instanceof Error ? error.message : String(error),
      );
    }
  }
}

/**
 * Seed one org + 50 patients with 30 days of synthetic data.
 * ~30-60s on a cold Supabase free-tier project.
 *
 * NOTE: All 50 patient invite/accept calls go through the RPC surface
 * (send_invite + accept_invite_existing) so the membership rows get the
 * correct consent_scope and RLS grants. The admin client inserts the patient
 * health data directly (service-role bypass — no RLS on insert path needed
 * since we're seeding CI fixtures, not testing insert permissions here).
 */
export async function seedOrg50(): Promise<Org50Fixture> {
  if (!hasLiveSupabase()) {
    throw new Error(
      '[seed-org-50] requires SUPABASE_URL + SUPABASE_ANON_KEY + SUPABASE_SERVICE_ROLE_KEY',
    );
  }

  const admin = getAdmin();
  const runId = testRunId();
  const slug = `perf-${runId}`;

  // ── 1. Create operator ─────────────────────────────────────────────────────
  const opEmail = testEmail('op-perf', runId);
  const opPassword = `PerfTest1!-${runId}`;

  const { data: opData, error: opErr } = await admin.auth.admin.createUser({
    email: opEmail,
    password: opPassword,
    email_confirm: true,
  });
  if (opErr || !opData.user) {
    throw new Error(`[seed-org-50] createUser(operator) failed: ${opErr?.message ?? 'no user'}`);
  }
  const operatorUserId = opData.user.id;

  // ── 2. Sign in as operator to obtain a session for RPC calls ───────────────
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    throw new Error('[seed-org-50] SUPABASE_URL or SUPABASE_ANON_KEY not set');
  }
  const operatorAnonClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: signInData, error: signInErr } =
    await operatorAnonClient.auth.signInWithPassword({
      email: opEmail,
      password: opPassword,
    });
  if (signInErr || !signInData.session) {
    throw new Error(
      `[seed-org-50] operator sign-in failed: ${signInErr?.message ?? 'no session'}`,
    );
  }
  const session = signInData.session;

  // Rebuild an authenticated client from the obtained session
  const operatorClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: {
      headers: { Authorization: `Bearer ${session.access_token}` },
    },
  });

  // ── 3. Create org ──────────────────────────────────────────────────────────
  const { data: orgData, error: orgErr } = await operatorClient.rpc('create_org', {
    p_name: 'Perf Test Clinic',
    p_slug: slug,
    p_description: null,
    p_website_url: null,
  });
  if (orgErr) {
    throw new Error(`[seed-org-50] create_org failed: ${orgErr.message}`);
  }
  const orgRow = (Array.isArray(orgData) ? orgData[0] : orgData) as {
    id?: string;
    org_id?: string;
  } | null;
  const orgId = orgRow?.id ?? orgRow?.org_id;
  if (!orgId) {
    throw new Error(
      `[seed-org-50] create_org returned unexpected shape: ${JSON.stringify(orgData)}`,
    );
  }

  // ── 4. Seed 50 patients (invite + accept + data insert) ────────────────────
  const patientUserIds: string[] = [];
  const consentScope = fullConsentScope();

  // Process patients in batches of 10 to avoid overwhelming the DB connection pool
  const BATCH_SIZE = 10;
  for (let batchStart = 0; batchStart < 50; batchStart += BATCH_SIZE) {
    const batchPromises: Promise<string>[] = [];
    for (let i = batchStart; i < Math.min(batchStart + BATCH_SIZE, 50); i++) {
      batchPromises.push(
        (async (patientIndex: number): Promise<string> => {
          const patEmail = testEmail(`pat-perf-${String(patientIndex).padStart(2, '0')}`, runId);
          const patPassword = `PatPerf1!-${runId}-${patientIndex}`;

          // Create patient auth.users row
          const { data: patData, error: patErr } = await admin.auth.admin.createUser({
            email: patEmail,
            password: patPassword,
            email_confirm: true,
            user_metadata: { display_name: `Perf Patient ${patientIndex + 1}` },
          });
          if (patErr || !patData.user) {
            throw new Error(
              `[seed-org-50] createUser(patient ${patientIndex}) failed: ${patErr?.message ?? 'no user'}`,
            );
          }
          const patientId = patData.user.id;

          // Invite via RPC (bypasses Resend — project rule: never call public auth emails from e2e)
          const { rawToken: _raw, tokenHash } = makeInviteToken();
          const { error: inviteErr } = await operatorClient.rpc('send_invite', {
            p_email: patEmail,
            p_org_id: orgId,
            p_invite_token_hash: tokenHash,
            p_requested_scope: consentScope,
          });
          if (inviteErr) {
            throw new Error(
              `[seed-org-50] send_invite(patient ${patientIndex}) failed: ${inviteErr.message}`,
            );
          }

          // Accept invite as patient
          const patientClient = createClient(SUPABASE_URL!, SUPABASE_ANON_KEY!, {
            auth: { autoRefreshToken: false, persistSession: false },
          });
          const { error: patSignInErr } = await patientClient.auth.signInWithPassword({
            email: patEmail,
            password: patPassword,
          });
          if (patSignInErr) {
            throw new Error(
              `[seed-org-50] patient ${patientIndex} sign-in failed: ${patSignInErr.message}`,
            );
          }
          const { error: acceptErr } = await patientClient.rpc('accept_invite_existing', {
            p_invite_token_hash: tokenHash,
            p_consent_scope: consentScope,
          });
          if (acceptErr) {
            throw new Error(
              `[seed-org-50] accept_invite_existing(patient ${patientIndex}) failed: ${acceptErr.message}`,
            );
          }

          // Insert 30 days of synthetic health data via admin (service-role bypass)
          await insertPatientData(admin, patientId, patientIndex);

          return patientId;
        })(i),
      );
    }
    const batchResults = await Promise.all(batchPromises);
    patientUserIds.push(...batchResults);
  }

  // ── 5. Build session JSON for addInitScript injection ─────────────────────
  const storageKey = 'sb-leanshot-auth';
  const sessionJson = {
    access_token: session.access_token,
    refresh_token: session.refresh_token,
    expires_at: session.expires_at,
    token_type: 'bearer',
    user: session.user,
  };

  return {
    orgId,
    slug,
    operatorJwt: session.access_token,
    operatorRefreshToken: session.refresh_token,
    storageKey,
    sessionJson,
    operatorUserId,
    patientUserIds,
    runId,
  };
}

/**
 * Cleanup: delete all 51 auth.users (operator + 50 patients) and the org.
 *
 * Best-effort — errors are logged but never re-thrown to avoid masking test
 * failures in afterAll hooks.
 */
export async function cleanupOrg50(fixture: Org50Fixture): Promise<void> {
  if (!hasLiveSupabase()) return;
  const admin = getAdmin();

  // Delete patients
  for (const userId of fixture.patientUserIds) {
    try {
      await admin.auth.admin.deleteUser(userId);
    } catch (err) {
      console.warn(
        `[seed-org-50] cleanup: deleteUser(${userId}) failed:`,
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  // Delete operator
  try {
    await admin.auth.admin.deleteUser(fixture.operatorUserId);
  } catch (err) {
    console.warn(
      `[seed-org-50] cleanup: deleteUser(operator) failed:`,
      err instanceof Error ? err.message : String(err),
    );
  }

  // Delete org (cascades to memberships, invites, etc. via FK on-delete-cascade)
  try {
    await admin.from('orgs').delete().eq('id', fixture.orgId);
  } catch (err) {
    console.warn(
      `[seed-org-50] cleanup: delete org ${fixture.orgId} failed:`,
      err instanceof Error ? err.message : String(err),
    );
  }
}
