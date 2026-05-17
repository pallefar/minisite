/**
 * Phase 28 Plan 28-05 Task 3 — USER_UPDATED auth event invalidation tests.
 *
 * Tests that the auth listener wired in main.tsx calls
 * useStore.getState().setCurrentOrgLoading(true) on USER_UPDATED events,
 * and does NOT call it on other auth events.
 *
 * Strategy: extract the listener registration into a testable helper
 * `wireAuthInvalidation(supabaseClient, store)` that main.tsx calls.
 * This allows us to unit-test the callback without spinning up the full app.
 */

import type { AuthChangeEvent } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useStore } from '@/lib/store';
import { wireAuthInvalidation } from '@/lib/wire-auth-invalidation';

// Mock supabase to capture the onAuthStateChange callback
type AuthCallback = (event: AuthChangeEvent) => void;

function makeMockSupabase() {
  let capturedCallback: AuthCallback | null = null;

  const mockSupabase = {
    auth: {
      onAuthStateChange: vi.fn((cb: AuthCallback) => {
        capturedCallback = cb;
        return { data: { subscription: { unsubscribe: vi.fn() } } };
      }),
    },
  };

  function emit(event: AuthChangeEvent): void {
    if (!capturedCallback) throw new Error('No callback registered');
    capturedCallback(event);
  }

  return { mockSupabase, emit };
}

describe('USER_UPDATED auth invalidation', () => {
  beforeEach(() => {
    useStore.getState().clearCurrentOrg();
    useStore.getState().setCurrentOrgLoading(false);
  });

  it('Test 1: USER_UPDATED event triggers setCurrentOrgLoading(true)', () => {
    const { mockSupabase, emit } = makeMockSupabase();

    wireAuthInvalidation(mockSupabase as Parameters<typeof wireAuthInvalidation>[0]);

    expect(useStore.getState().currentOrgLoading).toBe(false);
    emit('USER_UPDATED');
    expect(useStore.getState().currentOrgLoading).toBe(true);
  });

  it('Test 2: Other auth events do NOT trigger setCurrentOrgLoading', () => {
    const { mockSupabase, emit } = makeMockSupabase();

    wireAuthInvalidation(mockSupabase as Parameters<typeof wireAuthInvalidation>[0]);

    const otherEvents: AuthChangeEvent[] = [
      'SIGNED_IN',
      'SIGNED_OUT',
      'INITIAL_SESSION',
      'TOKEN_REFRESHED',
    ];

    for (const event of otherEvents) {
      useStore.getState().setCurrentOrgLoading(false);
      emit(event);
      expect(useStore.getState().currentOrgLoading).toBe(false);
    }
  });
});
