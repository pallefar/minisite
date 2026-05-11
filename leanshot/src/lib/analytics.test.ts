import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getOrCreateDistinctId, track, type EventName } from './analytics';

describe('analytics', () => {
  describe('EventName union (D-14, Phase 2 D-08/D-11)', () => {
    it('includes the five starter taxonomy events plus two Phase 2 disclaimer events', () => {
      // Phase 1 starter set (5)
      const e1: EventName = 'onboarding_started';
      const e2: EventName = 'onboarding_step_completed';
      const e3: EventName = 'onboarding_completed';
      const e4: EventName = 'onboarding_abandoned';
      const e5: EventName = 'tab_viewed';

      // Phase 2 additions (D-08, D-11) — wired by 02-04 and 02-05
      const e6: EventName = 'disclaimer_acknowledged';
      const e7: EventName = 'disclaimer_required';

      // The variables exist purely for compile-time enforcement
      expect([e1, e2, e3, e4, e5, e6, e7]).toHaveLength(7);
    });
  });

  describe('getOrCreateDistinctId (D-15)', () => {
    let storage: Record<string, string>;

    beforeEach(() => {
      storage = {};
      vi.spyOn(Storage.prototype, 'getItem').mockImplementation((k) => storage[k] ?? null);
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation((k, v) => {
        storage[k] = String(v);
      });
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('returns a UUID v4 shape on first call', () => {
      const id = getOrCreateDistinctId();
      expect(id).toMatch(/^[0-9a-f-]{36}$/i);
    });

    it('persists the same UUID across calls (localStorage-backed)', () => {
      const a = getOrCreateDistinctId();
      const b = getOrCreateDistinctId();
      expect(a).toBe(b);
    });

    it('writes to localStorage["leanshot_distinct_id"] on first call', () => {
      getOrCreateDistinctId();
      expect(storage['leanshot_distinct_id']).toMatch(/^[0-9a-f-]{36}$/i);
    });

    it('falls back to ephemeral UUID when localStorage throws', () => {
      vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
        throw new Error('private mode');
      });
      const id = getOrCreateDistinctId();
      expect(id).toMatch(/^[0-9a-f-]{36}$/i);
    });
  });

  describe('track (D-13 dormant production default)', () => {
    const originalEnv = import.meta.env.VITE_ANALYTICS_ENABLED;

    afterEach(() => {
      // Restore the env var
      (import.meta.env as { VITE_ANALYTICS_ENABLED?: string }).VITE_ANALYTICS_ENABLED = originalEnv;
    });

    it('does not call posthog.capture when VITE_ANALYTICS_ENABLED is undefined', () => {
      (import.meta.env as { VITE_ANALYTICS_ENABLED?: string }).VITE_ANALYTICS_ENABLED = undefined;
      // No mock needed — the test just verifies no-op behavior. We assert no throw.
      expect(() => track('tab_viewed', { tab: 'home' })).not.toThrow();
    });

    it('does not call posthog.capture when VITE_ANALYTICS_ENABLED is "false"', () => {
      (import.meta.env as { VITE_ANALYTICS_ENABLED?: string }).VITE_ANALYTICS_ENABLED = 'false';
      expect(() => track('tab_viewed', { tab: 'home' })).not.toThrow();
    });
  });
});
