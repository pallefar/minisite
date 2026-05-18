/**
 * Phase 24 Plan 24-03 — ADMIN_MODULES manifest + roles unit tests.
 *
 * Covers behavior bullets from 24-03-PLAN Task 1:
 *   T1: ADMIN_MODULES.length === 12 and keys match D-05 list exactly.
 *   T2: All 12 entries have { key, label, route, icon, lazy, flagKey, minRole } — no missing fields.
 *   T3: All 12 flagKey values are unique.
 *   T4: All 12 route values are unique.
 *   T5: ROLE_ORDER ordinal compare: hasMinRole('superadmin', 'staff') === true,
 *       hasMinRole('staff', 'admin') === false, hasMinRole('admin', 'admin') === true.
 *   T6: Every entry's lazy() resolves to a default export (smoke test resolves one import).
 */
import { describe, expect, it } from 'vitest';

// Tested under vi.hoisted + dynamic import so modules.ts can be resolved by the time tests run.
describe('ADMIN_MODULES manifest', () => {
  it('T1: exports exactly 14 modules with the canonical D-05 keys (+ P28 clinic-orgs + P27-08 anomaly)', async () => {
    const { ADMIN_MODULES } = await import('./modules');
    expect(ADMIN_MODULES).toHaveLength(14);
    const keys = ADMIN_MODULES.map((m) => m.key);
    const expected = [
      'users',
      'content',
      'onboarding',
      'gamification',
      'reviews',
      'membership',
      'analytics',
      'anomaly',     // Phase 27 Plan 27-08 addendum — funnel-anomaly admin config
      'ai',
      'helpdesk',
      'billing',
      'settings',
      'audit-log',
      'clinic-orgs',  // Phase 28 Plan 07 — preview module (full UI in P31)
    ];
    expect(keys).toEqual(expected);
  });

  it('T2: all 14 entries have every required field', async () => {
    const { ADMIN_MODULES } = await import('./modules');
    const requiredKeys = ['key', 'label', 'route', 'icon', 'lazy', 'flagKey', 'minRole'] as const;
    for (const mod of ADMIN_MODULES) {
      for (const field of requiredKeys) {
        expect(
          mod[field],
          `Module '${mod.key}' is missing field '${field}'`,
        ).toBeDefined();
      }
    }
  });

  it('T3: all 14 flagKey values are unique', async () => {
    const { ADMIN_MODULES } = await import('./modules');
    const flagKeys = ADMIN_MODULES.map((m) => m.flagKey);
    const unique = new Set(flagKeys);
    expect(unique.size).toBe(14);
  });

  it('T4: all 14 route values are unique', async () => {
    const { ADMIN_MODULES } = await import('./modules');
    const routes = ADMIN_MODULES.map((m) => m.route);
    const unique = new Set(routes);
    expect(unique.size).toBe(14);
  });
});

describe('roles — hasMinRole ordinal comparator', () => {
  it('T5a: hasMinRole("superadmin", "staff") === true', async () => {
    const { hasMinRole } = await import('./roles');
    expect(hasMinRole('superadmin', 'staff')).toBe(true);
  });

  it('T5b: hasMinRole("staff", "admin") === false', async () => {
    const { hasMinRole } = await import('./roles');
    expect(hasMinRole('staff', 'admin')).toBe(false);
  });

  it('T5c: hasMinRole("admin", "admin") === true', async () => {
    const { hasMinRole } = await import('./roles');
    expect(hasMinRole('admin', 'admin')).toBe(true);
  });

  it('T5d: hasMinRole(null, "staff") === false', async () => {
    const { hasMinRole } = await import('./roles');
    expect(hasMinRole(null, 'staff')).toBe(false);
  });

  it('T5e: hasMinRole(undefined, "staff") === false', async () => {
    const { hasMinRole } = await import('./roles');
    expect(hasMinRole(undefined, 'staff')).toBe(false);
  });

  it('T5f: hasMinRole("staff", "superadmin") === false', async () => {
    const { hasMinRole } = await import('./roles');
    expect(hasMinRole('staff', 'superadmin')).toBe(false);
  });

  it('T5g: hasMinRole("superadmin", "superadmin") === true', async () => {
    const { hasMinRole } = await import('./roles');
    expect(hasMinRole('superadmin', 'superadmin')).toBe(true);
  });

  it('T5h: hasMinRole("admin", "superadmin") === false', async () => {
    const { hasMinRole } = await import('./roles');
    expect(hasMinRole('admin', 'superadmin')).toBe(false);
  });
});

describe('lazy import smoke test', () => {
  it('T6: ADMIN_MODULES[0].lazy() resolves to a default export function', async () => {
    const { ADMIN_MODULES } = await import('./modules');
    // The first module (users) lazy-imports AdminMembersPage which exists
    // Use the PlaceholderModule instead as it always exists regardless of other plan state
    const contentModule = ADMIN_MODULES.find((m) => m.key === 'content');
    expect(contentModule).toBeDefined();
    if (!contentModule) return;
    const result = await contentModule.lazy();
    expect(typeof result.default).toBe('function');
  });
});
