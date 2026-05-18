/**
 * Phase 28 Plan 28-05 Task 1 — Zustand store `org` slice tests.
 *
 * Tests the 3 new state fields + 3 actions + partialize exclusion.
 * All store interactions use primitives (not full-state selectors)
 * per CLAUDE.md anti-pattern ("never useStore(s => s)").
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { useStore } from '@/lib/store';
import type { OrgContext, OrgRole } from '@/types/org';

const orgFixture: OrgContext = {
  id: 'org-uuid-1234',
  slug: 'acme-clinic',
  name: 'Acme Clinic',
};

function resetOrgSlice(): void {
  useStore.getState().clearCurrentOrg();
}

describe('store org slice', () => {
  beforeEach(() => {
    resetOrgSlice();
  });

  it('Test 1: exposes currentOrg, currentOrgRole, currentOrgLoading, setCurrentOrg, clearCurrentOrg, setCurrentOrgLoading', () => {
    const state = useStore.getState();
    expect('currentOrg' in state).toBe(true);
    expect('currentOrgRole' in state).toBe(true);
    expect('currentOrgLoading' in state).toBe(true);
    expect(typeof state.setCurrentOrg).toBe('function');
    expect(typeof state.clearCurrentOrg).toBe('function');
    expect(typeof state.setCurrentOrgLoading).toBe('function');
  });

  it('Test 2: initial state is null / false', () => {
    const state = useStore.getState();
    expect(state.currentOrg).toBeNull();
    expect(state.currentOrgRole).toBeNull();
    expect(state.currentOrgLoading).toBe(false);
  });

  it('Test 3: setCurrentOrg updates both fields atomically', () => {
    useStore.getState().setCurrentOrg(orgFixture, 'owner');
    const state = useStore.getState();
    expect(state.currentOrg).toEqual(orgFixture);
    expect(state.currentOrgRole).toBe<OrgRole>('owner');
    // loading is reset to false by setCurrentOrg
    expect(state.currentOrgLoading).toBe(false);
  });

  it('Test 4: clearCurrentOrg resets to initial state', () => {
    useStore.getState().setCurrentOrg(orgFixture, 'owner');
    useStore.getState().clearCurrentOrg();
    const state = useStore.getState();
    expect(state.currentOrg).toBeNull();
    expect(state.currentOrgRole).toBeNull();
    expect(state.currentOrgLoading).toBe(false);
  });

  it('Test 5: org slice fields are NOT persisted to localStorage', async () => {
    useStore.getState().setCurrentOrg(orgFixture, 'owner');
    // Rehydrate persists a snapshot
    await useStore.persist.rehydrate();
    // Retrieve the raw localStorage value
    const STORAGE_KEY = 'leanshot_v4';
    const raw = localStorage.getItem(STORAGE_KEY) ?? '{}';
    const persisted: Record<string, unknown> = JSON.parse(raw);
    // The persist middleware stores state under a `state` key
    const persistedState =
      typeof persisted.state === 'object' && persisted.state !== null
        ? (persisted.state as Record<string, unknown>)
        : persisted;
    expect(persistedState).not.toHaveProperty('currentOrg');
    expect(persistedState).not.toHaveProperty('currentOrgRole');
    expect(persistedState).not.toHaveProperty('currentOrgLoading');
  });

  it('Test 6: setCurrentOrgLoading flips the loading flag', () => {
    useStore.getState().setCurrentOrgLoading(true);
    expect(useStore.getState().currentOrgLoading).toBe(true);

    useStore.getState().setCurrentOrgLoading(false);
    expect(useStore.getState().currentOrgLoading).toBe(false);
  });
});
