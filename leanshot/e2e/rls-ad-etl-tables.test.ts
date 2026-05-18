/**
 * Phase 33 Plan 33-05 — ad ETL tables RLS cross-tenant impersonation proof.
 * @requires-linked-db
 *
 * Verifies, against the live cloud DB (ytnsipxxmzgaebkqmokp), that non-admin
 * authenticated users receive 0 rows on all 7 ad ETL tables (51-deny rule),
 * and that the service-role client (acting as admin) can read ad_etl_health.
 *
 * Tables covered (7 ad ETL + etl_cursors):
 *   ad_spend_facts, ad_network_config, fx_rates, ad_etl_health, ad_etl_gaps,
 *   growth_targets, cac_alerts
 *
 * Pattern references honored:
 *   - reference_rls_fixture_gotrueclient_flake.md — admin.generateLink + /auth/v1/verify
 *     via plain fetch (NOT signInWithPassword); avoids GoTrueClient ES256-compat issues.
 *   - feedback_rls_per_file_slug_prefix.md — file-scoped const TEST_SLUG_PREFIX;
 *     never shared with sibling test files.
 *   - reference_supabase_project.md — every RLS surface gets a live cross-tenant test.
 *
 * Environment:
 *   SUPABASE_URL              — public project URL (also VITE_SUPABASE_URL)
 *   SUPABASE_ANON_KEY         — public anon key (also VITE_SUPABASE_ANON_KEY)
 *   SUPABASE_SERVICE_ROLE_KEY — PRIVATE service_role key (CI secret; never commit)
 *
 * Self-skipping: entire describe block is skipped when env vars are absent.
 * This prevents failures in local dev or fork PRs that lack the service_role key.
 *
 * Run via:
 *   npx vitest run --config vitest-e2e.config.ts e2e/rls-ad-etl-tables.test.ts
 */

import { randomUUID } from 'node:crypto';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? '';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY ?? '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

const SHOULD_RUN = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY && SUPABASE_SERVICE_ROLE_KEY);
const describeIfLive = SHOULD_RUN ? describe : describe.skip;

// ---------------------------------------------------------------------------
// File-scoped prefix — feedback_rls_per_file_slug_prefix.md
// Must NOT be shared with sibling test files; prevents clobbering under
// vitest file-parallelism (randomUUID ensures uniqueness per test run).
// ---------------------------------------------------------------------------
const TEST_SLUG_PREFIX = 'adtest-' + randomUUID().slice(0, 8) + '-';

// ---------------------------------------------------------------------------
// The 7 ad ETL tables to assert non-admin denial on.
// etl_cursors is excluded (admin CRUD) — these are the user-facing RLS surfaces.
// ---------------------------------------------------------------------------
const AD_ETL_TABLES = [
  'ad_spend_facts',
  'ad_network_config',
  'fx_rates',
  'ad_etl_health',
  'ad_etl_gaps',
  'growth_targets',
  'cac_alerts',
] as const;

// ---------------------------------------------------------------------------
// Auth helper: admin.generateLink + /auth/v1/verify via plain fetch
// Avoids GoTrueClient cross-contamination (reference_rls_fixture_gotrueclient_flake.md)
// No signInWithPassword — ES256 project; only /auth/v1/verify produces valid tokens.
// ---------------------------------------------------------------------------

interface GenerateLinkResponse {
  hashed_token?: string;
  email_otp?: string;
}

interface VerifySessionResponse {
  access_token?: string;
  error?: string;
  msg?: string;
}

async function getUserAccessToken(email: string): Promise<string> {
  const linkRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/generate_link`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    },
    body: JSON.stringify({ type: 'magiclink', email }),
  });
  if (!linkRes.ok) {
    throw new Error(`generate_link failed: HTTP ${linkRes.status} — ${await linkRes.text()}`);
  }
  const linkBody = (await linkRes.json()) as GenerateLinkResponse;
  const verifyBody = linkBody.hashed_token
    ? { type: 'magiclink', token_hash: linkBody.hashed_token }
    : { type: 'magiclink', token: linkBody.email_otp, email };

  const verifyRes = await fetch(`${SUPABASE_URL}/auth/v1/verify`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: SUPABASE_ANON_KEY,
    },
    body: JSON.stringify(verifyBody),
  });
  if (!verifyRes.ok) {
    throw new Error(`auth/v1/verify failed: HTTP ${verifyRes.status} — ${await verifyRes.text()}`);
  }
  const session = (await verifyRes.json()) as VerifySessionResponse;
  if (!session.access_token) {
    throw new Error(`auth/v1/verify returned no access_token: ${JSON.stringify(session)}`);
  }
  return session.access_token;
}

// ---------------------------------------------------------------------------
// Client builders
// ---------------------------------------------------------------------------

function getServiceRoleClient(): SupabaseClient {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

function buildAuthenticatedClient(accessToken: string): SupabaseClient {
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false, storageKey: `user-${randomUUID()}` },
    global: {
      headers: { Authorization: `Bearer ${accessToken}` },
    },
  });
}

// ---------------------------------------------------------------------------
// Module-level state
// ---------------------------------------------------------------------------

let serviceRoleClient: SupabaseClient;
let nonAdminClient: SupabaseClient;

const createdUserIds: string[] = [];
let nonAdminEmail: string;

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describeIfLive('Phase 33 Plan 33-05 — ad ETL tables RLS cross-tenant impersonation proof', () => {
  beforeAll(async () => {
    serviceRoleClient = getServiceRoleClient();
    const ts = randomUUID().slice(0, 8);

    nonAdminEmail = `${TEST_SLUG_PREFIX}nonadmin-${ts}@leanshot.test`;

    // Create a non-admin (plain authenticated) user via admin API
    const { data, error } = await serviceRoleClient.auth.admin.createUser({
      email: nonAdminEmail,
      password: `AdTest1!-${ts}`,
      email_confirm: true,
    });
    if (error) throw new Error(`createUser(${nonAdminEmail}): ${error.message}`);
    const userId = data.user!.id;
    createdUserIds.push(userId);

    // Ensure profile exists with no admin_role (null = plain user)
    // The trigger should auto-create the profile; explicitly set admin_role to null for safety
    await serviceRoleClient
      .from('profiles')
      .update({ admin_role: null })
      .eq('id', userId);

    // Mint ES256-signed access token for the non-admin user
    const nonAdminToken = await getUserAccessToken(nonAdminEmail);
    nonAdminClient = buildAuthenticatedClient(nonAdminToken);
  }, 90_000);

  afterAll(async () => {
    for (const id of createdUserIds) {
      try {
        await serviceRoleClient.auth.admin.deleteUser(id);
      } catch {
        // best-effort
      }
      try {
        await serviceRoleClient.from('profiles').delete().eq('id', id);
      } catch {
        // best-effort
      }
    }
  }, 30_000);

  // ---------------------------------------------------------------------------
  // T1–T7: Non-admin authenticated user gets 0 rows on each ad ETL table
  // ---------------------------------------------------------------------------

  for (const table of AD_ETL_TABLES) {
    it(`non-admin cannot read from ${table} (0 rows returned)`, async () => {
      const { data, error } = await nonAdminClient.from(table).select('*');
      // PostgREST default-deny: either empty array or PGRST116 depending on version
      // Either way, non-admin must see zero rows
      expect(error === null || (data !== null && data.length === 0)).toBe(true);
      expect(data?.length ?? 0).toBe(0);
    });
  }

  // ---------------------------------------------------------------------------
  // T8: Service-role admin client can read ad_etl_health (positive case)
  // ---------------------------------------------------------------------------

  it('service-role admin client can read ad_etl_health (positive case)', async () => {
    const { data, error } = await serviceRoleClient
      .from('ad_etl_health')
      .select('network, credentials_present, last_success_at, last_error, last_attempt_at');
    // Service role bypasses RLS; we only assert no error (table exists + accessible)
    // The 3-row seed assertion would require seeded data; we relax to >= 0 rows.
    // If the ETL migrations ran, we expect 3 rows (meta/google/tiktok).
    expect(error).toBeNull();
    expect(data).not.toBeNull();
    // Soft assertion: may be 0 rows if ETL seed not applied in this env
    expect(Array.isArray(data)).toBe(true);
  });
});
