/**
 * Tests for identify/alias bridge (Phase 24 Plan 24-02 Task 2).
 *
 * Tests cover:
 * 4. identify(uid) calls posthog.identify(uid).
 * 5. aliasAnonymousToUid(anon_id, uid) calls posthog.alias once;
 *    second call is idempotent (localStorage marker prevents double-fire).
 */

import posthog from 'posthog-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { identify, aliasAnonymousToUid } from '../identify';

vi.mock('posthog-js', () => ({
  default: {
    capture: vi.fn(),
    identify: vi.fn(),
    alias: vi.fn(),
  },
}));

const mockPosthog = posthog as {
  capture: ReturnType<typeof vi.fn>;
  identify: ReturnType<typeof vi.fn>;
  alias: ReturnType<typeof vi.fn>;
};

describe('identify.ts — identify + alias bridge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Clear localStorage alias markers between tests
    try {
      localStorage.clear();
    } catch {
      /* noop in environments without localStorage */
    }
  });

  it('Test 4: identify(uid) calls posthog.identify(uid)', () => {
    const uid = 'user-uuid-1234';
    identify(uid);
    expect(mockPosthog.identify).toHaveBeenCalledTimes(1);
    expect(mockPosthog.identify).toHaveBeenCalledWith(uid);
  });

  it('Test 5: aliasAnonymousToUid calls posthog.alias exactly once', () => {
    const anonId = 'anon-distinct-id-abc';
    const uid = 'user-uuid-5678';

    aliasAnonymousToUid(anonId, uid);
    expect(mockPosthog.alias).toHaveBeenCalledTimes(1);

    // Second call with same pair — must be idempotent (no-op)
    aliasAnonymousToUid(anonId, uid);
    expect(mockPosthog.alias).toHaveBeenCalledTimes(1);
  });

  it('Test 5b: aliasAnonymousToUid sets localStorage marker after first call', () => {
    const anonId = 'anon-id-xyz';
    const uid = 'user-uuid-9999';

    aliasAnonymousToUid(anonId, uid);

    const markerKey = `leanshot_posthog_aliased_${uid}`;
    const marker = localStorage.getItem(markerKey);
    expect(marker).not.toBeNull();
    expect(Number(marker)).toBeGreaterThan(0);
  });

  it('Test 5c: aliasAnonymousToUid with different uids each fires once', () => {
    aliasAnonymousToUid('anon-1', 'uid-A');
    aliasAnonymousToUid('anon-2', 'uid-B');
    // Each distinct uid fires once
    expect(mockPosthog.alias).toHaveBeenCalledTimes(2);
  });
});
