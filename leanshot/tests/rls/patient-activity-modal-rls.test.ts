/**
 * Phase 23 Plan 23-03 — Live cross-tenant RLS impersonation proof for
 * the PatientActivityModal's data fetch queries.
 *
 * Verifies, against the live cloud DB (ytnsipxxmzgaebkqmokp), that:
 *
 *   T-23-03-01: Patient A's authenticated client sees ONLY their own
 *               injections when querying the `injections` table with
 *               the auth.uid() = user_id RLS policy active.
 *   T-23-03-02: Patient B's authenticated client sees ONLY their own
 *               injections — zero rows belong to Patient A.
 *   T-23-03-03: An unauthenticated (anon) client sees 0 rows from
 *               either patient (default-deny on RLS SELECT policy).
 *
 * Data isolation proof: Patient B's injections have a NEWER timestamp than
 * Patient A's. When Patient A's client queries `.order('logged_at', desc)`,
 * the most-recent row returned MUST belong to Patient A (not Patient B).
 * If the RLS policy were absent or misconfigured, Patient B's row would
 * appear first.
 *
 * Architecture note: the PatientActivityModal queries data tables directly
 * with `.eq('user_id', patientId)`. The RLS SELECT policy on each table is
 * `auth.uid() = user_id`. Both the client-side `.eq` and the server-side
 * RLS policy scope data to the patient's ID — this test validates the
 * server-side RLS layer independently of the client-side filter.
 *
 * Pattern follows subscriptions-impersonation.test.ts (Phase 14):
 *   - admin createClient with service_role key for setup/teardown
 *   - per-user authenticated clients with unique storageKey to prevent
 *     GoTrueClient cross-contamination (reference-rls-fixture-gotruclient-flake)
 *   - file-scoped slug prefix per feedback-rls-per-file-slug-prefix to avoid
 *     clobbering sibling suite fixtures in parallel vitest runs
 *
 * Environment (same as other RLS suites):
 *   SUPABASE_URL              — public (also VITE_SUPABASE_URL)
 *   SUPABASE_ANON_KEY         — public (also VITE_SUPABASE_ANON_KEY)
 *   SUPABASE_SERVICE_ROLE_KEY — PRIVATE (CI secret; never commit)
 *
 * Self-skips when any required env var is absent (local PR safety).
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const SHOULD_RUN = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY && SUPABASE_SERVICE_ROLE_KEY);
const describeIfLive = SHOULD_RUN ? describe : describe.skip;

// ---------------------------------------------------------------------------
// File-scoped slug prefix (per feedback-rls-per-file-slug-prefix)
// Avoids clobbering sibling RLS test fixtures when vitest runs files in parallel.
// ---------------------------------------------------------------------------

const PATIENT_ACTIVITY_PREFIX = 'patact-';

// ---------------------------------------------------------------------------
// Helper — build a service-role admin client
// ---------------------------------------------------------------------------

function getAdmin(): SupabaseClient {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('patient-activity-modal-rls: env vars missing');
  }
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

// ---------------------------------------------------------------------------
// Helper — build an anon client (unique storageKey per caller to prevent
// GoTrueClient cross-contamination in jsdom — reference-rls-fixture-gotruclient-flake)
// ---------------------------------------------------------------------------

function buildAnonClient(storageKey: string): SupabaseClient {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    throw new Error('patient-activity-modal-rls: anon env vars missing');
  }
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false, storageKey },
  });
}

// ---------------------------------------------------------------------------
// Cleanup helper — delete test injections + auth users by prefix
// ---------------------------------------------------------------------------

async function cleanupTestData(prefix: string, admin: SupabaseClient): Promise<void> {
  // Delete injections whose log_id contains the prefix (our seeded log_ids use it)
  try {
    await admin.from('injections').delete().like('log_id', `${prefix}%`);
  } catch {
    /* best-effort */
  }
}

async function deleteUser(userId: string | undefined, admin: SupabaseClient): Promise<void> {
  if (!userId) return;
  try {
    await admin.auth.admin.deleteUser(userId);
  } catch {
    /* best-effort */
  }
}

// ---------------------------------------------------------------------------
// Module-scoped state — populated in beforeAll, cleaned in afterAll
// ---------------------------------------------------------------------------

let admin: SupabaseClient;

let patientAId: string;
let patientAEmail: string;
let patientAPassword: string;

let patientBId: string;
let patientBEmail: string;
let patientBPassword: string;

// Seeded injection log_ids — use the prefix so cleanup can wipe them
const INJ_A_1 = `${PATIENT_ACTIVITY_PREFIX}inj-a-older`;
const INJ_A_2 = `${PATIENT_ACTIVITY_PREFIX}inj-a-recent`;
const INJ_B_1 = `${PATIENT_ACTIVITY_PREFIX}inj-b-newest`; // Newer than both A injections

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describeIfLive('Phase 23 Plan 23-03 — PatientActivityModal RLS cross-tenant isolation', () => {
  beforeAll(async () => {
    admin = getAdmin();

    const ts = Date.now();
    patientAEmail = `${PATIENT_ACTIVITY_PREFIX}pa-${ts}@leanshot.test`;
    patientBEmail = `${PATIENT_ACTIVITY_PREFIX}pb-${ts}@leanshot.test`;
    patientAPassword = `Pass1234-${crypto.randomUUID().slice(0, 8)}`;
    patientBPassword = `Pass1234-${crypto.randomUUID().slice(0, 8)}`;

    // Create Patient A
    const { data: aRes, error: aErr } = await admin.auth.admin.createUser({
      email: patientAEmail,
      password: patientAPassword,
      email_confirm: true,
    });
    if (aErr) throw new Error(`createUser A: ${aErr.message}`);
    patientAId = aRes.user!.id;

    // Create Patient B
    const { data: bRes, error: bErr } = await admin.auth.admin.createUser({
      email: patientBEmail,
      password: patientBPassword,
      email_confirm: true,
    });
    if (bErr) throw new Error(`createUser B: ${bErr.message}`);
    patientBId = bRes.user!.id;

    // Seed 2 injections for Patient A (older timestamps)
    const { error: iA1Err } = await admin.from('injections').insert({
      user_id: patientAId,
      log_id: INJ_A_1,
      medication: 'semaglutide',
      dose: '0.25',
      unit: 'mg',
      site: 'abdomen',
      notes: '',
      logged_at: new Date('2026-05-10T10:00:00Z').toISOString(),
      pk_engine_version: 1,
    });
    if (iA1Err) throw new Error(`seed injA1: ${iA1Err.message}`);

    const { error: iA2Err } = await admin.from('injections').insert({
      user_id: patientAId,
      log_id: INJ_A_2,
      medication: 'semaglutide',
      dose: '0.5',
      unit: 'mg',
      site: 'thigh',
      notes: '',
      logged_at: new Date('2026-05-14T10:00:00Z').toISOString(),
      pk_engine_version: 1,
    });
    if (iA2Err) throw new Error(`seed injA2: ${iA2Err.message}`);

    // Seed 1 injection for Patient B — NEWER timestamp than both A injections
    const { error: iB1Err } = await admin.from('injections').insert({
      user_id: patientBId,
      log_id: INJ_B_1,
      medication: 'tirzepatide',
      dose: '2.5',
      unit: 'mg',
      site: 'arm',
      notes: '',
      logged_at: new Date('2026-05-16T10:00:00Z').toISOString(), // Newest of all
      pk_engine_version: 1,
    });
    if (iB1Err) throw new Error(`seed injB1: ${iB1Err.message}`);
  }, 120_000);

  afterAll(async () => {
    if (!admin) return;
    await cleanupTestData(PATIENT_ACTIVITY_PREFIX, admin);
    await deleteUser(patientAId, admin);
    await deleteUser(patientBId, admin);
  }, 60_000);

  // -------------------------------------------------------------------------
  // T-23-03-01: Patient A sees ONLY their own injections
  // -------------------------------------------------------------------------

  it('T-23-03-01: Patient A sees only their own 2 injections, not Patient B\'s', async () => {
    const clientA = buildAnonClient('patact-rls-a-01');
    const { error: signInErr } = await clientA.auth.signInWithPassword({
      email: patientAEmail,
      password: patientAPassword,
    });
    if (signInErr) throw new Error(`signIn A: ${signInErr.message}`);

    const { data, error } = await clientA
      .from('injections')
      .select('log_id, logged_at, medication')
      .order('logged_at', { ascending: false })
      .limit(100);

    expect(error).toBeNull();
    expect(data).toBeTruthy();

    const logIds = (data as Array<{ log_id: string }>).map((r) => r.log_id);

    // Patient A should see their 2 injections
    expect(logIds).toContain(INJ_A_1);
    expect(logIds).toContain(INJ_A_2);

    // Patient A must NOT see Patient B's injection (cross-tenant isolation)
    expect(logIds).not.toContain(INJ_B_1);

    // The most-recent row must be Patient A's (not Patient B's newer injection)
    const mostRecent = (data as Array<{ log_id: string; logged_at: string }>)[0];
    expect(mostRecent.log_id).toBe(INJ_A_2); // 2026-05-14 is A's most recent
  }, 30_000);

  // -------------------------------------------------------------------------
  // T-23-03-02: Patient B sees ONLY their own injection
  // -------------------------------------------------------------------------

  it('T-23-03-02: Patient B sees only their own 1 injection, not Patient A\'s', async () => {
    const clientB = buildAnonClient('patact-rls-b-02');
    const { error: signInErr } = await clientB.auth.signInWithPassword({
      email: patientBEmail,
      password: patientBPassword,
    });
    if (signInErr) throw new Error(`signIn B: ${signInErr.message}`);

    const { data, error } = await clientB
      .from('injections')
      .select('log_id, logged_at, medication')
      .order('logged_at', { ascending: false })
      .limit(100);

    expect(error).toBeNull();
    expect(data).toBeTruthy();

    const logIds = (data as Array<{ log_id: string }>).map((r) => r.log_id);

    // Patient B should see their 1 injection
    expect(logIds).toContain(INJ_B_1);

    // Patient B must NOT see Patient A's injections
    expect(logIds).not.toContain(INJ_A_1);
    expect(logIds).not.toContain(INJ_A_2);

    // Only 1 row returned — B's own injection
    expect(data).toHaveLength(1);
  }, 30_000);

  // -------------------------------------------------------------------------
  // T-23-03-03: Unauthenticated client sees 0 rows (default-deny RLS)
  // -------------------------------------------------------------------------

  it('T-23-03-03: Unauthenticated (anon) client sees 0 injection rows', async () => {
    const anonClient = createClient(SUPABASE_URL!, SUPABASE_ANON_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false, storageKey: 'patact-rls-anon-03' },
    });

    const { data, error } = await anonClient
      .from('injections')
      .select('log_id')
      .in('log_id', [INJ_A_1, INJ_A_2, INJ_B_1]);

    // RLS default-deny: unauthenticated clients see 0 rows (policy: auth.uid() = user_id)
    expect(error).toBeNull();
    expect(data ?? []).toHaveLength(0);
  }, 30_000);
});

// ---------------------------------------------------------------------------
// Gating test — always passes, warns when skipped (matches Phase 14 pattern)
// ---------------------------------------------------------------------------
describe('Phase 23 Plan 23-03 RLS — gating', () => {
  it('runs against live cloud DB when SUPABASE_SERVICE_ROLE_KEY is set', () => {
    if (!SHOULD_RUN) {
      // eslint-disable-next-line no-console
      console.warn(
        '[patient-activity-modal-rls.test] SKIPPED — SUPABASE_SERVICE_ROLE_KEY (or URL/ANON) not set. Wave verification gates this.',
      );
    }
    expect(true).toBe(true);
  });
});
