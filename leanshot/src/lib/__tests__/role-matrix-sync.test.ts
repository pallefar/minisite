/**
 * Phase 31 Plan 31-01 ORG-12 — DB↔TS role permission matrix sync test (D-02 source-of-truth contract).
 *
 * Asserts public.has_permission(role, perm) SECDEF result equals ROLE_PERMISSIONS[role].has(perm)
 * for every (role, perm) pair (36 pairs total: 3 roles × 12 distinct permission keys).
 *
 * Drift in either direction fails the suite — the security floor is the DB function;
 * the TS const is a UX hint mirror that MUST stay in lockstep.
 *
 * See also: 31-CONTEXT.md D-02 / D-03.
 *
 * SKIP behavior: test is env-gated via SHOULD_RUN (requires SUPABASE_URL +
 * SUPABASE_SERVICE_ROLE_KEY). CI runs in SKIP mode until Plan 31-04's BLOCKING
 * `supabase db push --linked` lands all P31 migrations (wave-2-gated test).
 * After 31-04 push, CI exercises all 36 assertions against the live DB.
 */
import { type SupabaseClient } from '@supabase/supabase-js';
import { beforeAll, describe, expect, it } from 'vitest';
import { _ROLE_PERMISSIONS_FOR_TEST } from '../org';
import { SHOULD_RUN, getAdmin } from './_fixtures/p28-rls-fixture';

// ---------------------------------------------------------------------------
// Compute the permission universe once at module scope.
// ALL_PERMS: union of all values in ROLE_PERMISSIONS (12 distinct keys).
// ALL_ROLES: ['owner', 'clinician', 'staff']
// ---------------------------------------------------------------------------
const ALL_PERMS = Array.from(
  new Set(Object.values(_ROLE_PERMISSIONS_FOR_TEST).flatMap((s) => Array.from(s))),
);
const ALL_ROLES = Object.keys(_ROLE_PERMISSIONS_FOR_TEST) as Array<
  keyof typeof _ROLE_PERMISSIONS_FOR_TEST
>;

if (!SHOULD_RUN) {
  console.warn(
    '[role-matrix-sync.test] SKIPPED — SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY env not set.',
  );
}

const describeIfLive = SHOULD_RUN ? describe : describe.skip;

describeIfLive('role matrix DB↔TS sync (Phase 31 D-02)', () => {
  // Lazy-initialized inside the describe block — only created when SHOULD_RUN is true
  // and the describe body executes with live tests (not in describe.skip).
  let admin: SupabaseClient;

  beforeAll(() => {
    admin = getAdmin();
  });

  // ---------------------------------------------------------------------------
  // Sanity checks: verify TS matrix shape before running DB assertions.
  // 18 distinct owner permission keys: 12 original + 4 admin.gamification.* (Phase 35
  // Plan 35-05) + 2 onboarding.{ship_winner,edit_draft}.
  // Phase 70-07 R5 — public.has_permission() was extended (migration
  // 20290108000009) so the DB security floor now knows all 18 keys (owner=true),
  // closing the documented "TS ahead of DB" drift. The owner-pair sync assertions
  // below now pass; this count moves 16 → 18 to match the current TS matrix.
  // ---------------------------------------------------------------------------
  it('TS matrix shape sanity', () => {
    expect(ALL_ROLES.length).toBe(3);
    expect(ALL_PERMS.length).toBe(18);
  });

  // ---------------------------------------------------------------------------
  // Defensive: unknown permission must return false from DB CASE expression.
  // Verifies the `else false` branch handles unknown keys + NULL-role safety.
  // ---------------------------------------------------------------------------
  it('unknown permission returns false from DB', async () => {
    const { data, error } = await admin.rpc('has_permission', {
      p_role: 'owner',
      p_perm: 'made.up.perm',
    });
    expect(error).toBeNull();
    expect(data).toBe(false);
  });

  // ---------------------------------------------------------------------------
  // Matrix sync: assert DB has_permission() == TS ROLE_PERMISSIONS for all
  // 36 (role, perm) pairs. One it() per pair so a single failing pair surfaces
  // in CI output with the exact mismatch.
  // ---------------------------------------------------------------------------
  for (const role of ALL_ROLES) {
    for (const perm of ALL_PERMS) {
      const expected = _ROLE_PERMISSIONS_FOR_TEST[role].has(perm);
      it(`(${role}, ${perm}) -> ${expected}`, async () => {
        const { data, error } = await admin.rpc('has_permission', {
          p_role: role,
          p_perm: perm,
        });
        expect(error).toBeNull();
        expect(data).toBe(expected);
      });
    }
  }
});
