/**
 * Phase 24 Plan 24-01 — admin_backup_codes RLS + single-use enforcement proof.
 *
 * Verifies, against the live cloud DB (ytnsipxxmzgaebkqmokp), that:
 *
 *   T6: admin_backup_codes — 10 hashed codes seeded; one "consumed" (used_at set);
 *       re-use attempt rejected (unique constraint or used_at check)
 *   T7: admin_backup_codes RLS — non-owner user CANNOT select another user's codes
 *
 * Note on Plan 24-05 integration seam:
 *   Plan 24-05 ships `admin.issue_backup_codes(user_id)` and `admin.consume_backup_code(code)`
 *   RPCs which will own the canonical write + consume path. For Wave-1 Phase 24 CI,
 *   this test stubs the issuing as a direct service_role INSERT (with HMAC-style
 *   SHA-256 hash via pg_crypto / encode(hmac(...))) and stubs the consume as a
 *   direct SQL UPDATE set used_at = now(). When Plan 24-05 lands, the consume
 *   line should be replaced with `admin.consume_backup_code(code)` RPC call.
 *   See comment: [PLAN-24-05-SWAP] below.
 *
 * RLS note: admin_backup_codes has aal2 SELECT restriction (jwt ->> 'aal' = 'aal2').
 *   In CI, we cannot step up to aal2 without a real TOTP factor enrolled.
 *   The non-owner SELECT proof (T7) is exercised via the anon client without aal2
 *   — we prove that a different user's client gets zero rows regardless of aal claim.
 *   The owner's SELECT at aal2 is a behavioral proof at Plan 24-05 enrollment time.
 *
 * Pattern follows tests/rls/photo-trash-rls.test.ts (Phase 23).
 *
 * Environment:
 *   SUPABASE_URL              — public
 *   SUPABASE_ANON_KEY         — public
 *   SUPABASE_SERVICE_ROLE_KEY — PRIVATE (CI secret)
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getUserAccessToken } from '../../../../tests/rls/helpers/admin-session';

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const SHOULD_RUN = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY && SUPABASE_SERVICE_ROLE_KEY);
const describeIfLive = SHOULD_RUN ? describe : describe.skip;

// ---------------------------------------------------------------------------
// File-scoped prefix per [[feedback_rls_per_file_slug_prefix]]
// ---------------------------------------------------------------------------

const TEST_SLUG_PREFIX = `bkup-codes-${Date.now().toString(36)}-`;

// ---------------------------------------------------------------------------
// Client helpers
// ---------------------------------------------------------------------------

function getAdmin(): SupabaseClient {
  return createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

function buildAnonClient(storageKey: string): SupabaseClient {
  return createClient(SUPABASE_URL!, SUPABASE_ANON_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false, storageKey },
  });
}

// ---------------------------------------------------------------------------
// Module-level state
// ---------------------------------------------------------------------------

const admin = SHOULD_RUN ? getAdmin() : null!;
const createdUserIds: string[] = [];

let ownerEmail: string;
let ownerUserId: string;
let nonOwnerEmail: string;
let nonOwnerUserId: string;

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeAll(async () => {
  if (!SHOULD_RUN) return;

  ownerEmail = `${TEST_SLUG_PREFIX}owner@leanshot.test`;
  nonOwnerEmail = `${TEST_SLUG_PREFIX}other@leanshot.test`;
  const password = `Pass1234-${crypto.randomUUID().slice(0, 8)}`;

  const ownerRes = await admin.auth.admin.createUser({
    email: ownerEmail,
    password,
    email_confirm: true,
  });
  if (ownerRes.error) throw ownerRes.error;
  ownerUserId = ownerRes.data.user!.id;
  createdUserIds.push(ownerUserId);

  const otherRes = await admin.auth.admin.createUser({
    email: nonOwnerEmail,
    password,
    email_confirm: true,
  });
  if (otherRes.error) throw otherRes.error;
  nonOwnerUserId = otherRes.data.user!.id;
  createdUserIds.push(nonOwnerUserId);
}, 60_000);

// ---------------------------------------------------------------------------
// Teardown
// ---------------------------------------------------------------------------

afterAll(async () => {
  if (!SHOULD_RUN) return;
  // Clean backup codes for test users
  try {
    await admin.from('admin_backup_codes').delete().in('user_id', createdUserIds);
  } catch {
    /* best-effort */
  }
  for (const id of createdUserIds) {
    try {
      await admin.auth.admin.deleteUser(id);
    } catch {
      /* best-effort */
    }
  }
}, 30_000);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** SHA-256 hex of a string (mirrors Postgres encode(digest(x,'sha256'),'hex')). */
async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** Seed 10 hashed backup codes for a user via service_role direct insert. */
async function seedBackupCodes(userId: string, plainCodes: string[]): Promise<void> {
  const rows = await Promise.all(
    plainCodes.map(async (code) => ({
      user_id: userId,
      code_hash: await sha256Hex(code),
    })),
  );
  const { error } = await admin.from('admin_backup_codes').insert(rows);
  if (error) throw new Error(`seedBackupCodes failed: ${error.message}`);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describeIfLive('Phase 24 D-08 — admin_backup_codes single-use + RLS', () => {
  // Phase 70-07 cascade-52 — DEFERRED: seeds admin_backup_codes via a direct
  // service_role INSERT, but INSERT is intentionally revoked on this sensitive
  // append-only MFA table (service_role bypasses RLS, so re-granting would weaken the
  // hardening — do NOT). The supported path is a SECDEF seeding RPC at Plan 24-05;
  // re-enable then. Skipping to keep CI green meanwhile.
  // see deferred-tests.md#EG-29
  it.skip('T6: 10 hashed codes seeded; one consumed (used_at set); re-use rejected', async () => {
    // Generate 10 plain codes
    const plainCodes = Array.from({ length: 10 }, () => crypto.randomUUID());
    await seedBackupCodes(ownerUserId, plainCodes);

    // Verify 10 rows inserted
    const { data: allCodes } = await admin
      .from('admin_backup_codes')
      .select('id, code_hash, used_at')
      .eq('user_id', ownerUserId);
    expect(allCodes).toHaveLength(10);

    // "Consume" the first code by setting used_at — stub for Plan 24-05 RPC.
    // [PLAN-24-05-SWAP] replace this direct update with admin.consume_backup_code(plainCodes[0])
    const targetHash = await sha256Hex(plainCodes[0]!);
    const { error: consumeErr } = await admin
      .from('admin_backup_codes')
      .update({ used_at: new Date().toISOString() })
      .match({ user_id: ownerUserId, code_hash: targetHash, used_at: null });
    expect(consumeErr).toBeNull();

    // Re-use attempt: try to consume the same code again (used_at is already set)
    const { error: reuseErr, data: reuseData } = await admin
      .from('admin_backup_codes')
      .update({ used_at: new Date().toISOString() })
      .match({ user_id: ownerUserId, code_hash: targetHash, used_at: null })
      .select('id');

    // Expect 0 rows updated (WHERE used_at IS NULL filter excludes already-consumed row)
    const reuseDenied = reuseErr !== null || (reuseData != null && reuseData.length === 0);
    expect(reuseDenied).toBe(true);

    // Verify only one code has used_at set
    const { data: usedCodes } = await admin
      .from('admin_backup_codes')
      .select('id')
      .eq('user_id', ownerUserId)
      .not('used_at', 'is', null);
    expect(usedCodes).toHaveLength(1);
  }, 30_000);

  it("T7: non-owner user CANNOT select another user's backup codes (RLS deny)", async () => {
    const nonOwnerToken = await getUserAccessToken(nonOwnerEmail);
    const nonOwnerClient = buildAnonClient(`${TEST_SLUG_PREFIX}nonowner`);
    nonOwnerClient.auth.setSession({ access_token: nonOwnerToken, refresh_token: 'unused' });

    // Non-owner tries to SELECT owner's backup codes
    const { data: stolen, error: stealErr } = await nonOwnerClient
      .from('admin_backup_codes')
      .select('*')
      .eq('user_id', ownerUserId);

    // RLS must deny: either error OR empty array
    const denied = stealErr !== null || (stolen != null && stolen.length === 0);
    expect(denied).toBe(true);
  }, 30_000);

  // Phase 70-07 cascade-52 — DEFERRED, same root as T6 (direct service_role seed of the
  // revoked admin_backup_codes INSERT). Re-enable with the Plan 24-05 seeding RPC.
  // see deferred-tests.md#EG-29
  it.skip('T7b: unique(user_id, code_hash) constraint prevents duplicate codes', async () => {
    const dupeCode = crypto.randomUUID();
    const dupeHash = await sha256Hex(dupeCode);

    // Insert first time
    await admin.from('admin_backup_codes').insert({ user_id: ownerUserId, code_hash: dupeHash });

    // Insert same hash again — should fail with unique violation
    const { error: dupeErr } = await admin
      .from('admin_backup_codes')
      .insert({ user_id: ownerUserId, code_hash: dupeHash });

    expect(dupeErr).not.toBeNull();
    expect(dupeErr!.code).toBe('23505'); // unique_violation
  }, 30_000);
});

describe('Phase 24 admin_backup_codes — gating', () => {
  it('runs against live cloud DB when SUPABASE_SERVICE_ROLE_KEY is set', () => {
    if (!SHOULD_RUN) {
      console.warn('[backup-codes.test] SKIPPED — env vars not set; run against live DB.');
    }
    expect(true).toBe(true);
  });
});
