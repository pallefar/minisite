/**
 * D-28 bypass tests — compile-time (@ts-expect-error) + runtime (Proxy interposition + Sentry alert).
 * Covers ORG-03 success criterion #3.
 *
 * Phase 28 Plan 28-02 Task 3.
 *
 * Tests:
 *   1. Compile-time: _createServiceRoleClientUnsafe().from typed `never` (@ts-expect-error proof).
 *   2. Runtime: well-formed withOrgScope call (with .eq) resolves; Sentry NOT called.
 *   3. Runtime: missing .eq → OrgScopeBypassError thrown; Sentry called once with fatal+tag.
 *   4. Runtime: non-org-scoped table → resolves without throw.
 *   5. Runtime: .in('org_id', [orgId]) alternate scope → resolves; Sentry NOT called.
 *   6. Runtime: .eq('org_id', 'wrongOrg') filter present but wrong value → OrgScopeBypassError.
 *   7. Runtime: .rpc() call → does NOT throw (per D-07; Sentry NOT called).
 *
 * Approach: The supabase-server.ts and sentry.ts modules use Deno-only APIs (Deno.env.get,
 * npm: specifiers). We mock them entirely via vi.hoisted() + vi.mock() so:
 *   - _createServiceRoleClientUnsafe() returns a controlled fake client.
 *   - Sentry.captureException is a vi.fn() we can assert on.
 * The fake client has a minimal thenable query builder so the withOrgScope Proxy
 * can intercept .from() calls, track .eq() filter calls, and gate .then() resolution.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { _createServiceRoleClientUnsafe } from '../../../../supabase/functions/_shared/supabase-server.ts';
import {
  OrgScopeBypassError,
  ORG_SCOPED_TABLES,
  withOrgScope,
} from '../../../../supabase/functions/_shared/with-org-scope.ts';

// ---------------------------------------------------------------------------
// vi.hoisted — define mock values BEFORE vi.mock factories are evaluated.
// vi.hoisted() runs at the very top (before imports), enabling factory access.
// ---------------------------------------------------------------------------

const { mockCaptureException, mockCreateFakeClient } = vi.hoisted(() => {
  /**
   * Minimal fake thenable query builder.
   * Supports: .select(), .eq(), .in(), .contains() (chainable via `this`).
   * .then() resolves to { data: [], error: null } simulating a successful Supabase response.
   */
  function createFakeBuilder(): Record<string, unknown> {
    const builder: Record<string, unknown> = {};
    builder['select'] = (..._args: unknown[]) => builder;
    builder['eq'] = (..._args: unknown[]) => builder;
    builder['in'] = (..._args: unknown[]) => builder;
    builder['contains'] = (..._args: unknown[]) => builder;
    builder['not'] = builder;
    builder['filter'] = (..._args: unknown[]) => builder;
    builder['order'] = (..._args: unknown[]) => builder;
    builder['limit'] = (..._args: unknown[]) => builder;
    builder['then'] = (resolve?: (v: unknown) => unknown, _reject?: (e: unknown) => unknown) => {
      const result = { data: [], error: null };
      return Promise.resolve(result).then(resolve);
    };
    return builder;
  }

  /** Fake service-role client returned by the mocked _createServiceRoleClientUnsafe(). */
  function createFakeClient() {
    return {
      from: (_table: string) => createFakeBuilder(),
      rpc: (_fn: string, _params?: unknown) => createFakeBuilder(),
      auth: {},
      storage: {},
      functions: {},
      channel: (_name: string) => ({}),
      removeAllChannels: () => {},
    };
  }

  return {
    mockCaptureException: vi.fn(),
    mockCreateFakeClient: createFakeClient,
  };
});

// ---------------------------------------------------------------------------
// vi.mock — factories run AFTER hoisted, can reference hoisted values.
// vi.mock is itself hoisted to top, but factories run after vi.hoisted.
// ---------------------------------------------------------------------------

// Mock sentry.ts — provides Sentry.captureException for with-org-scope.ts
vi.mock('../../../../supabase/functions/_shared/sentry.ts', () => ({
  captureException: mockCaptureException,
}));

// Mock supabase-server.ts — _createServiceRoleClientUnsafe returns fake client
vi.mock('../../../../supabase/functions/_shared/supabase-server.ts', () => ({
  _createServiceRoleClientUnsafe: () => mockCreateFakeClient(),
}));

// ---------------------------------------------------------------------------
// Import modules under test AFTER mocks are registered
// ---------------------------------------------------------------------------

// Import the mocked supabase-server for the compile-time test (Test 1).
// @ts-expect-error is used below to prove .from is typed `never` on Unscoped client.

// ---------------------------------------------------------------------------
// Test constants
// ---------------------------------------------------------------------------

const ORG_ID = 'org-test-12345';
const OTHER_ORG_ID = 'org-other-67890';

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('with-org-scope (D-28)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // Test 1: Compile-time fence (brand type proof via @ts-expect-error)
  // -------------------------------------------------------------------------

  describe('compile-time fence', () => {
    it('Test 1: _createServiceRoleClientUnsafe().from is typed never on Unscoped client', () => {
      const c = _createServiceRoleClientUnsafe();

      // @ts-expect-error — .from should be typed `never` on ServiceRoleClient<'Unscoped'>.
      // Proof: if the brand type ever allows .from on Unscoped, TypeScript would report:
      //   "Unused '@ts-expect-error' directive." (because c.from wouldn't be a type error).
      // That would cause `tsc --noEmit` to fail, alerting that the fence broke.
      const _ = c.from;

      // The runtime assertion trivially passes — the compile-time proof is the @ts-expect-error.
      expect(true).toBe(true);
      void _;
    });
  });

  // -------------------------------------------------------------------------
  // Test 2: Well-formed call (with .eq) → resolves; Sentry NOT called
  // -------------------------------------------------------------------------

  it('Test 2: withOrgScope + .eq(org_id) → resolves; Sentry NOT called', async () => {
    const result = await withOrgScope(ORG_ID, async (c) => {
      return await c.from('org_members').select('*').eq('org_id', ORG_ID);
    });

    expect(result).toEqual({ data: [], error: null });
    expect(mockCaptureException).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Test 3: Missing .eq → OrgScopeBypassError; Sentry called once (fatal)
  // -------------------------------------------------------------------------

  it('Test 3: withOrgScope missing .eq → OrgScopeBypassError + Sentry fatal', async () => {
    await expect(
      withOrgScope(ORG_ID, async (c) => {
        return await c.from('org_members').select('*');
      }),
    ).rejects.toThrow(OrgScopeBypassError);

    expect(mockCaptureException).toHaveBeenCalledOnce();
    const [err, hint] = mockCaptureException.mock.calls[0];
    expect(err).toBeInstanceOf(OrgScopeBypassError);
    expect(hint).toEqual({
      level: 'fatal',
      tags: { org_scope_bypass: 'true' },
    });
  });

  // -------------------------------------------------------------------------
  // Test 4: Non-org-scoped table → resolves without throw; Sentry NOT called
  // -------------------------------------------------------------------------

  it('Test 4: withOrgScope + non-org-scoped table (audit_logs) → resolves; no Sentry', async () => {
    // audit_logs is NOT in ORG_SCOPED_TABLES — the Proxy does NOT intercept it
    expect(ORG_SCOPED_TABLES.has('audit_logs')).toBe(false);

    const result = await withOrgScope(ORG_ID, async (c) => {
      // Note: no .eq('org_id') — allowed because audit_logs is not org-scoped
      return await c.from('audit_logs').select('*');
    });

    expect(result).toEqual({ data: [], error: null });
    expect(mockCaptureException).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Test 5: .in('org_id', [orgId]) alternate scope → resolves; no Sentry
  // -------------------------------------------------------------------------

  it('Test 5: .in(org_id, [orgId]) → resolves (array filter counts as scoped); no Sentry', async () => {
    const result = await withOrgScope(ORG_ID, async (c) => {
      return await c.from('org_members').select('*').in('org_id', [ORG_ID]);
    });

    expect(result).toEqual({ data: [], error: null });
    expect(mockCaptureException).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Test 6: .eq('org_id', wrongOrg) → wrong value → OrgScopeBypassError
  // -------------------------------------------------------------------------

  it('Test 6: .eq(org_id, WRONG_ORG) → OrgScopeBypassError (filter present but wrong value)', async () => {
    await expect(
      withOrgScope(ORG_ID, async (c) => {
        return await c.from('org_members').select('*').eq('org_id', OTHER_ORG_ID);
      }),
    ).rejects.toThrow(OrgScopeBypassError);

    expect(mockCaptureException).toHaveBeenCalledOnce();
    const [err] = mockCaptureException.mock.calls[0];
    expect(err).toBeInstanceOf(OrgScopeBypassError);
    expect((err as OrgScopeBypassError).table).toBe('org_members');
    expect((err as OrgScopeBypassError).orgId).toBe(ORG_ID);
  });

  // -------------------------------------------------------------------------
  // Test 7: .rpc() not policed by Proxy (per D-07 + Pitfall 6)
  // -------------------------------------------------------------------------

  it('Test 7: withOrgScope + .rpc() → does NOT throw OrgScopeBypassError', async () => {
    const result = await withOrgScope(ORG_ID, async (c) => {
      return await c.rpc('send_org_invite', {
        p_org_id: ORG_ID,
        p_email: 'test@example.com',
        p_role: 'clinician',
      });
    });

    // rpc() passes through via Reflect.get; Proxy does NOT intercept it
    expect(result).toEqual({ data: [], error: null });
    expect(mockCaptureException).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Additional: ORG_SCOPED_TABLES contains the 7 retained Phase 28 org-scoped tables
  // (Phase 65.1: prior placeholder clinic-subs table removed — Phase 29 D-14 dropped it;
  // clinic subscription data lives in public.subscriptions WHERE clinic_id IS NOT NULL)
  // -------------------------------------------------------------------------

  it('ORG_SCOPED_TABLES contains the 7 retained Phase 28 org-scoped tables (Phase 65.1)', () => {
    const expectedTables = [
      'organizations',
      'org_members',
      'org_invites',
      'org_settings',
      'org_branding',
      'org_patient_links',
      'org_consent_grants',
    ];
    for (const table of expectedTables) {
      expect(ORG_SCOPED_TABLES.has(table), `Expected '${table}' in ORG_SCOPED_TABLES`).toBe(true);
    }
  });

  // -------------------------------------------------------------------------
  // Additional: OrgScopeBypassError raised for each ORG_SCOPED_TABLE without .eq
  // -------------------------------------------------------------------------

  it('OrgScopeBypassError raised for each ORG_SCOPED_TABLE when org_id filter missing', async () => {
    for (const table of ORG_SCOPED_TABLES) {
      mockCaptureException.mockClear();
      await expect(withOrgScope(ORG_ID, async (c) => c.from(table).select('*'))).rejects.toThrow(
        OrgScopeBypassError,
      );
    }
  });
});
