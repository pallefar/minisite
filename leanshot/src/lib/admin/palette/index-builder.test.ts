/**
 * Phase 27 Plan 27-03 Task 2 — index-builder unit tests.
 *
 * Tests the 3-source merge (modules + recent + quick-actions) per CONTEXT D-11:
 *   T1: admin role + flag-enabled returns N module entries
 *   T2: staff role filters out entries with minRole='admin' (or 'superadmin')
 *   T3: posthog.isFeatureEnabled === false filters that module
 *       (undefined/true KEEP it — only an explicit `false` filters out)
 *   T4: recent items + quick actions merged in correct group order
 *       (modules → recent → quick_actions)
 *   T5: destructive quick-action entries pass through the `destructive: true` flag
 */
import { describe, it, expect } from 'vitest';
import { ADMIN_MODULES } from '@/lib/admin/modules';
import { buildPaletteIndex, type RecentItem } from '@/lib/admin/palette/index-builder';

// Trivial posthog stub matching the index-builder contract surface.
function ph(enabledKeys: Set<string> | 'all' | 'none'): {
  isFeatureEnabled: (k: string) => boolean | undefined;
} {
  return {
    isFeatureEnabled: (k: string): boolean | undefined => {
      if (enabledKeys === 'all') return true;
      if (enabledKeys === 'none') return false;
      return enabledKeys.has(k) ? true : false;
    },
  };
}

const recents: RecentItem[] = [
  {
    item_type: 'member',
    item_id: 'u-1',
    label: 'Member u-1',
    route: '/admin/users/u-1',
    last_interacted_at: new Date().toISOString(),
  },
  {
    item_type: 'helpdesk_ticket',
    item_id: '42',
    label: 'Ticket 42',
    route: '/admin/helpdesk/42',
    last_interacted_at: new Date().toISOString(),
  },
];

describe('buildPaletteIndex', () => {
  it('T1: admin role + all flags enabled yields one entry per admin-eligible module', () => {
    const idx = buildPaletteIndex('admin', ph('all'), []);
    const moduleEntries = idx.filter((e) => e.group === 'modules');
    const adminEligible = ADMIN_MODULES.filter(
      (m) => m.minRole === 'admin' || m.minRole === 'staff',
    );
    expect(moduleEntries).toHaveLength(adminEligible.length);
  });

  it('T2: staff role excludes admin-only + superadmin-only modules', () => {
    const idx = buildPaletteIndex('staff', ph('all'), []);
    const moduleEntries = idx.filter((e) => e.group === 'modules');
    // Sanity — every entry's underlying module must be staff-min
    for (const entry of moduleEntries) {
      const mod = ADMIN_MODULES.find((m) => m.key === entry.id.replace(/^module:/, ''));
      expect(mod?.minRole).toBe('staff');
    }
    // And no admin/superadmin-min module leaks in
    const adminOnlyKeys = ADMIN_MODULES.filter(
      (m) => m.minRole === 'admin' || m.minRole === 'superadmin',
    ).map((m) => `module:${m.key}`);
    for (const k of adminOnlyKeys) {
      expect(moduleEntries.find((e) => e.id === k)).toBeUndefined();
    }
  });

  it('T3: posthog.isFeatureEnabled === false filters that module entry', () => {
    const oneOff = ADMIN_MODULES.find((m) => m.minRole === 'staff')!;
    // Enable everything EXCEPT oneOff.flagKey
    const allButOne = new Set(ADMIN_MODULES.map((m) => m.flagKey));
    allButOne.delete(oneOff.flagKey);
    const idx = buildPaletteIndex('superadmin', ph(allButOne), []);
    const ids = idx.filter((e) => e.group === 'modules').map((e) => e.id);
    expect(ids).not.toContain(`module:${oneOff.key}`);
  });

  it('T4: groups appear in canonical order — modules → recent → quick_actions', () => {
    const idx = buildPaletteIndex('superadmin', ph('all'), recents);
    const firstModule = idx.findIndex((e) => e.group === 'modules');
    const firstRecent = idx.findIndex((e) => e.group === 'recent');
    const firstQuick = idx.findIndex((e) => e.group === 'quick_actions');
    expect(firstModule).toBeGreaterThanOrEqual(0);
    expect(firstRecent).toBeGreaterThan(firstModule);
    expect(firstQuick).toBeGreaterThan(firstRecent);
  });

  it('T5: destructive quick-action entries preserve their destructive flag', () => {
    const idx = buildPaletteIndex('superadmin', ph('all'), []);
    const quickEntries = idx.filter((e) => e.group === 'quick_actions');
    // At least one destructive and at least one non-destructive in v1 registry
    expect(quickEntries.some((e) => e.destructive === true)).toBe(true);
    expect(quickEntries.some((e) => e.destructive === false)).toBe(true);
  });
});
