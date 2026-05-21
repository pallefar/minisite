/**
 * Phase 35 Plan 35-02 — cross-tenant RLS proof for freeze_tokens_ledger + streak_state.
 * @requires-linked-db
 *
 * Per project rule (reference_supabase_project.md): every RLS surface gets a live
 * cross-tenant impersonation proof — NOT just policy SQL.
 *
 * Covers 6 assertions:
 *   Test 1: user B sees ZERO of user A freeze_tokens_ledger rows
 *   Test 2: user A cannot INSERT directly (no INSERT policy for authenticated → 42501)
 *   Test 3: user A cannot UPDATE their own row (append-only trigger fires → /append-only/ error)
 *   Test 4: user A cannot DELETE their own row (append-only trigger fires → /append-only/ error)
 *   Test 5: streak_state: user A reads own row; user B reads 0; user A direct UPDATE → 42501
 *   Test 6: freeze_tokens_remaining(p_user) returns correct count via authenticated RPC;
 *           accepted per T-35-02-06 (non-PII count; documented in threat model)
 *
 * Auth pattern: admin.generateLink + /auth/v1/verify via plain fetch (ES256 project).
 * Per [[reference_rls_fixture_gotrueclient_flake]]: signInWithPassword cross-contaminates
 * under vitest on ES256 projects; generateLink + /auth/v1/verify produces valid tokens.
 *
 * File-scoped slug prefix per [[feedback_rls_per_file_slug_prefix]]:
 * phase35-freeze-rls-${Date.now()}-  — never shared with sibling test files.
 *
 * Environment:
 *   SUPABASE_URL              — public project URL (also VITE_SUPABASE_URL)
 *   SUPABASE_ANON_KEY         — public anon key (also VITE_SUPABASE_ANON_KEY)
 *   SUPABASE_SERVICE_ROLE_KEY — PRIVATE service_role key (CI secret; never commit)
 *
 * Self-skipping when env vars absent (safe for local dev + fork PRs).
 *
 * Run via:
 *   cd leanshot && npx vitest run e2e/rls-freeze-tokens-ledger.test.ts
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
// File-scoped slug prefix — prevents clobbering under vitest parallelism.
// Per [[feedback_rls_per_file_slug_prefix]].
// ---------------------------------------------------------------------------
const TEST_SLUG_PREFIX = `phase35-freeze-rls-${Date.now()}-`;

// ---------------------------------------------------------------------------
// Auth helper: admin.generateLink + /auth/v1/verify via plain fetch.
// Per [[reference_rls_fixture_gotrueclient_flake]]: avoids GoTrueClient ES256 cross-contamination.
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
  const verifyPayload = linkBody.hashed_token
    ? { type: 'magiclink', token_hash: linkBody.hashed_token }
    : { type: 'magiclink', token: linkBody.email_otp, email };

  const verifyRes = await fetch(`${SUPABASE_URL}/auth/v1/verify`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: SUPABASE_ANON_KEY,
    },
    body: JSON.stringify(verifyPayload),
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

function buildAuthenticatedClient(accessToken: string): SupabaseClient {
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false, storageKey: `freeze-rls-${randomUUID()}` },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
}

// ---------------------------------------------------------------------------
// Module-level state
// ---------------------------------------------------------------------------

let admin: SupabaseClient;
let userA: { id: string; client: SupabaseClient };
let userB: { id: string; client: SupabaseClient };
const createdUserIds: string[] = [];
const createdLedgerIds: string[] = [];

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describeIfLive('Phase 35 Plan 35-02 — RLS cross-tenant proof: freeze_tokens_ledger + streak_state', () => {
  beforeAll(async () => {
    admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const ts = randomUUID().slice(0, 8);
    const emailA = `${TEST_SLUG_PREFIX}a-${ts}@leanshot.test`;
    const emailB = `${TEST_SLUG_PREFIX}b-${ts}@leanshot.test`;

    // Create user A
    const { data: aRes, error: aErr } = await admin.auth.admin.createUser({
      email: emailA,
      email_confirm: true,
    });
    if (aErr) throw new Error(`createUser A: ${aErr.message}`);
    createdUserIds.push(aRes.user!.id);

    // Create user B
    const { data: bRes, error: bErr } = await admin.auth.admin.createUser({
      email: emailB,
      email_confirm: true,
    });
    if (bErr) throw new Error(`createUser B: ${bErr.message}`);
    createdUserIds.push(bRes.user!.id);

    // Mint ES256-signed access tokens
    const tokenA = await getUserAccessToken(emailA);
    const tokenB = await getUserAccessToken(emailB);

    userA = { id: aRes.user!.id, client: buildAuthenticatedClient(tokenA) };
    userB = { id: bRes.user!.id, client: buildAuthenticatedClient(tokenB) };
  }, 90_000);

  afterAll(async () => {
    if (!admin) return;
    // Clean up freeze_tokens_ledger rows before deleting users (ON DELETE SET NULL on user_id
    // would orphan rows but not error; we clean explicitly for tidiness).
    for (const id of createdLedgerIds) {
      try {
        // Service-role bypasses append-only triggers (trigger is BEFORE, fires on UPDATE/DELETE
        // from authenticated; service_role is not 'authenticated' so trigger allows delete here).
        // Actually the trigger fires for ALL roles. We use a direct SQL workaround:
        // Since we can't DELETE via the ledger (trigger blocks it), we just let ON DELETE SET NULL
        // handle it when we delete the user. The test user cleanup below is sufficient.
        void id; // ledger rows orphaned to null user_id after user delete — acceptable in test env
      } catch { /* best-effort */ }
    }
    for (const id of createdUserIds) {
      try {
        await admin.auth.admin.deleteUser(id);
      } catch { /* best-effort */ }
    }
  }, 30_000);

  // ---------------------------------------------------------------------------
  // Test 1: user B sees ZERO of user A freeze_tokens_ledger rows
  // ---------------------------------------------------------------------------

  it('Test 1: user B reads ZERO of user A freeze_tokens_ledger rows (cross-tenant isolation)', async () => {
    // Admin inserts 3 ledger rows for user A.
    for (let i = 0; i < 3; i++) {
      const { data, error } = await admin.from('freeze_tokens_ledger').insert({
        user_id: userA.id,
        delta: 1,
        reason: 'admin_grant',
        granted_by_admin_user_id: null,
        source_ref: `test-grant-${i}`,
      }).select('id');
      if (error) throw new Error(`admin insert ledger row ${i}: ${error.message}`);
      if (data?.[0]?.id) createdLedgerIds.push(data[0].id);
    }

    // User A reads their own rows → 3 rows.
    const { data: aData, error: aErr } = await userA.client.from('freeze_tokens_ledger').select('*');
    if (aErr) throw aErr;
    expect(aData!.length).toBeGreaterThanOrEqual(3);
    expect(aData!.every((r) => r.user_id === userA.id)).toBe(true);

    // User B reads → ZERO rows (RLS silently filters).
    const { data: bData, error: bErr } = await userB.client.from('freeze_tokens_ledger').select('*');
    expect(bErr).toBeNull();
    expect(bData).toEqual([]);

    // Admin confirms rows exist (guards against false-pass from silent trigger failure).
    const { data: adminCheck } = await admin.from('freeze_tokens_ledger')
      .select('id').eq('user_id', userA.id);
    expect(adminCheck!.length).toBeGreaterThanOrEqual(3);
  }, 30_000);

  // ---------------------------------------------------------------------------
  // Test 2: user A cannot INSERT directly (no INSERT policy for authenticated)
  // ---------------------------------------------------------------------------

  it('Test 2: user A cannot INSERT into freeze_tokens_ledger (RLS denies — T-35-02-01)', async () => {
    const { error } = await userA.client.from('freeze_tokens_ledger').insert({
      user_id: userA.id,
      delta: 1,
      reason: 'monthly_grant',
      source_ref: 'test-direct-insert',
    });
    expect(error).not.toBeNull();
    // Expect either 42501 (violates row-level security) or similar RLS error.
    expect(
      error!.code === '42501' || /row.level security/i.test(error!.message ?? ''),
    ).toBe(true);
  }, 30_000);

  // ---------------------------------------------------------------------------
  // Test 3: user A cannot UPDATE their own row (append-only trigger blocks it)
  // ---------------------------------------------------------------------------

  it('Test 3: user A cannot UPDATE freeze_tokens_ledger (append-only trigger — T-35-02-01)', async () => {
    const { error } = await userA.client.from('freeze_tokens_ledger').update({
      delta: 99,
    }).eq('user_id', userA.id);
    // Either the RLS "no UPDATE policy" blocks it, or the trigger fires the raise exception.
    // Either way, expect an error.
    expect(error).not.toBeNull();
    // RLS denies UPDATE (no policy for authenticated) → 42501; or trigger fires /append-only/.
    const isRlsOrTrigger =
      error!.code === '42501' ||
      /row.level security/i.test(error!.message ?? '') ||
      /append-only/i.test(error!.message ?? '');
    expect(isRlsOrTrigger).toBe(true);
  }, 30_000);

  // ---------------------------------------------------------------------------
  // Test 4: user A cannot DELETE their own row (append-only trigger blocks it)
  // ---------------------------------------------------------------------------

  it('Test 4: user A cannot DELETE freeze_tokens_ledger (append-only trigger — T-35-02-01)', async () => {
    const { error } = await userA.client.from('freeze_tokens_ledger').delete()
      .eq('user_id', userA.id);
    expect(error).not.toBeNull();
    const isRlsOrTrigger =
      error!.code === '42501' ||
      /row.level security/i.test(error!.message ?? '') ||
      /append-only/i.test(error!.message ?? '');
    expect(isRlsOrTrigger).toBe(true);
  }, 30_000);

  // ---------------------------------------------------------------------------
  // Test 5: streak_state: user A reads own row; user B reads 0; user A UPDATE → 42501
  // ---------------------------------------------------------------------------

  it('Test 5: streak_state RLS — select-own; user B sees 0; direct UPDATE denied', async () => {
    // Admin inserts a streak_state row for user A.
    const { error: insertErr } = await admin.from('streak_state').insert({
      user_id: userA.id,
      current_streak_days: 5,
      longest_streak_days: 10,
    });
    if (insertErr && insertErr.code !== '23505') {
      // 23505 = unique violation (row already exists from T1 setup) — that's fine.
      throw new Error(`admin insert streak_state: ${insertErr.message}`);
    }

    // User A reads own streak_state → 1 row.
    const { data: aStreak, error: aStreakErr } = await userA.client.from('streak_state').select('*');
    if (aStreakErr) throw aStreakErr;
    expect(aStreak!.length).toBeGreaterThanOrEqual(1);
    expect(aStreak!.every((r) => r.user_id === userA.id)).toBe(true);

    // User B reads streak_state → ZERO rows.
    const { data: bStreak, error: bStreakErr } = await userB.client.from('streak_state').select('*');
    expect(bStreakErr).toBeNull();
    expect(bStreak).toEqual([]);

    // User A attempts direct UPDATE → should fail (no UPDATE policy for authenticated).
    const { error: updateErr } = await userA.client.from('streak_state').update({
      current_streak_days: 999,
    }).eq('user_id', userA.id);
    expect(updateErr).not.toBeNull();
    expect(
      updateErr!.code === '42501' || /row.level security/i.test(updateErr!.message ?? ''),
    ).toBe(true);
  }, 30_000);

  // ---------------------------------------------------------------------------
  // Test 6: freeze_tokens_remaining(p_user) returns correct count via authenticated RPC.
  // T-35-02-06 accept: COUNT is non-PII; SECDEF takes p_user param.
  // User B calling rpc with p_user=userA.id returns userA's count (documented accept).
  // ---------------------------------------------------------------------------

  it('Test 6: freeze_tokens_remaining(p_user) returns correct balance for user A', async () => {
    // User A should have at least 3 grant rows from Test 1 (admin_grant rows, delta=1 each).
    // freeze_tokens_remaining clamps to [0, 3]; admin_grant rows are not in the UNIQUE index
    // so they can stack — but balance ≥ 1 is guaranteed.

    const { data: balA, error: balAErr } = await userA.client.rpc('freeze_tokens_remaining', {
      p_user: userA.id,
    });
    if (balAErr) throw new Error(`freeze_tokens_remaining(userA) RPC: ${balAErr.message}`);
    expect(typeof balA).toBe('number');
    expect(balA).toBeGreaterThanOrEqual(1);
    expect(balA).toBeLessThanOrEqual(3);  // D-08 max stockpile = 3

    // User B calling the RPC with p_user=userA.id — SECDEF allows, returns correct count.
    // This is T-35-02-06 "accept" in the threat model: the count is non-PII; no real-name exposure.
    // Documented behavior: the SECDEF function takes p_user as a parameter (not auth.uid())
    // so it is callable by any authenticated user, but only reveals a COUNT (not PII).
    const { data: balAFromB, error: balBErr } = await userB.client.rpc('freeze_tokens_remaining', {
      p_user: userA.id,
    });
    if (balBErr) throw new Error(`freeze_tokens_remaining(userA) via userB RPC: ${balBErr.message}`);
    expect(balAFromB).toBe(balA);  // same count (T-35-02-06 accept documented)

    // User B's OWN balance starts at 0 (no ledger rows for userB).
    const { data: balB, error: balB2Err } = await userB.client.rpc('freeze_tokens_remaining', {
      p_user: userB.id,
    });
    if (balB2Err) throw new Error(`freeze_tokens_remaining(userB): ${balB2Err.message}`);
    expect(balB).toBe(0);
  }, 30_000);
});

// ---------------------------------------------------------------------------
// Gating check (always runs — confirms why skip is appropriate)
// ---------------------------------------------------------------------------

describe('Phase 35 RLS — gating', () => {
  it('runs against live cloud DB when SUPABASE_SERVICE_ROLE_KEY is set', () => {
    if (!SHOULD_RUN) {
      // eslint-disable-next-line no-console
      console.warn(
        '[rls-freeze-tokens-ledger.test] SKIPPED — SUPABASE_SERVICE_ROLE_KEY (or URL/ANON) not set. ' +
          'Wave verification runs this against live cloud DB.',
      );
    }
    expect(true).toBe(true);
  });
});
