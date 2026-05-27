/**
 * Phase 40 Plan 40-07 D-07 — paused-guards.test.ts
 *
 * Verifies that every guarded logging action (add*, upsert*) throws
 * PausedSubscriptionError when is_paused=true, and that unguarded actions
 * (remove*, edit*) do NOT throw.
 *
 * Test structure:
 *   (a) Baseline: each guarded action succeeds when is_paused=false
 *   (b) Guard fires: each guarded action throws PausedSubscriptionError with correct paused_until
 *   (c) Selective gating: removeInjection does NOT throw when is_paused=true
 *   (d) Resume clears guard: after setPauseState(false), addInjection succeeds
 *
 * Store reset pattern: useStore.setState({ ...initialState }) in beforeEach to
 * guarantee isolation between tests.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PausedSubscriptionError } from '@/lib/errors';
import { initialState } from '@/lib/storage';
import { useStore } from '@/lib/store';
import type {
  Injection,
  Meal,
  Measurement,
  MoodLog,
  SleepLog,
  SymptomLog,
  WeightLog,
  Workout,
} from '@/types';

// ─── Mocks ───────────────────────────────────────────────────────────────────

// Mock deferFlush so we don't trigger network calls in tests
vi.mock('@/lib/sync-defer', () => ({
  deferFlush: vi.fn(),
}));

// Mock photo modules (addPhoto uses dynamic imports for compression/IDB)
vi.mock('@/lib/photo-compress', () => ({
  compressImage: vi.fn().mockResolvedValue(new Blob([], { type: 'image/jpeg' })),
}));

vi.mock('@/lib/photo-queue', () => ({
  putPhotoBlob: vi.fn().mockResolvedValue(undefined),
}));

// ─── Fixtures ────────────────────────────────────────────────────────────────

const PAUSED_UNTIL = '2026-08-01T00:00:00.000Z';

const INJECTION: Injection = {
  log_id: 'test-log-id-001',
  datetime: '2026-08-01T08:00:00.000Z',
  dose: '0.5',
  unit: 'mg',
  site: null,
  notes: '',
};

const SYMPTOM: SymptomLog = {
  date: '2026-08-01',
  symptom: 'nausea',
  severity: 2,
  notes: '',
};

const WEIGHT: WeightLog = {
  date: '2026-08-01',
  weight: 80,
  bodyFat: null,
  ts: Date.now(),
};

const MEASUREMENT: Measurement = {
  date: '2026-08-01',
  waist: 32,
};

const MEAL: Meal = {
  date: '2026-08-01',
  name: 'Salad',
  calories: 300,
  protein: 20,
  fiber: 5,
  hunger: null,
  satisfaction: null,
  ts: Date.now(),
};

const WORKOUT: Workout = {
  date: '2026-08-01',
  type: 'walk',
  name: 'Morning walk',
  minutes: 30,
  rpe: null,
  notes: '',
};

const MOOD_LOG: MoodLog = {
  date: '2026-08-01',
  mood: 3,
  energy: null,
  notes: '',
};

const SLEEP_LOG: SleepLog = {
  date: '2026-08-01',
  hours: 7,
  quality: null,
  wakings: 0,
  notes: '',
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function setPaused(is_paused: boolean, paused_until: string | null): void {
  useStore.getState().setPauseState(is_paused, paused_until);
}

function resetStore(): void {
  useStore.setState({
    ...initialState,
    pendingOps: [],
    migration_state: null,
    currentTab: 'home',
    toast: null,
    signedIn: null,
    migrationError: null,
    currentOrg: null,
    currentOrgRole: null,
    currentOrgLoading: false,
  } as Parameters<typeof useStore.setState>[0]);
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('D-07 pause guards — store logging actions', () => {
  beforeEach(() => {
    resetStore();
  });

  // ─── (a) Baseline: guarded actions succeed when not paused ──────────────

  describe('(a) Baseline: no throw when is_paused=false', () => {
    beforeEach(() => {
      setPaused(false, null);
    });

    it('addInjection: does not throw and appends injection', () => {
      expect(() => useStore.getState().addInjection(INJECTION)).not.toThrow();
      expect(useStore.getState().injections).toHaveLength(1);
    });

    it('addSymptom: does not throw and appends symptom', () => {
      expect(() => useStore.getState().addSymptom(SYMPTOM)).not.toThrow();
      expect(useStore.getState().symptoms).toHaveLength(1);
    });

    it('upsertWeight: does not throw and adds weight', () => {
      expect(() => useStore.getState().upsertWeight(WEIGHT)).not.toThrow();
      expect(useStore.getState().weights).toHaveLength(1);
    });

    it('addWeight: does not throw and adds weight', () => {
      expect(() => useStore.getState().addWeight(WEIGHT)).not.toThrow();
      expect(useStore.getState().weights.length).toBeGreaterThan(0);
    });

    it('addMeasurement: does not throw and appends measurement', () => {
      expect(() => useStore.getState().addMeasurement(MEASUREMENT)).not.toThrow();
      expect(useStore.getState().measurements).toHaveLength(1);
    });

    it('addMeal: does not throw and appends meal', () => {
      expect(() => useStore.getState().addMeal(MEAL)).not.toThrow();
      expect(useStore.getState().meals).toHaveLength(1);
    });

    it('addWorkout: does not throw and appends workout', () => {
      expect(() => useStore.getState().addWorkout(WORKOUT)).not.toThrow();
      expect(useStore.getState().workouts).toHaveLength(1);
    });

    it('addMood: does not throw and appends mood', () => {
      expect(() => useStore.getState().addMood(MOOD_LOG)).not.toThrow();
      expect(useStore.getState().mood).toHaveLength(1);
    });

    it('addSleep: does not throw and appends sleep', () => {
      expect(() => useStore.getState().addSleep(SLEEP_LOG)).not.toThrow();
      expect(useStore.getState().sleep).toHaveLength(1);
    });

    it('addNSV: does not throw and appends NSV', () => {
      expect(() => useStore.getState().addNSV('Lost 10 lbs', '2026-08-01')).not.toThrow();
      expect(useStore.getState().nsvs).toHaveLength(1);
    });
  });

  // ─── (b) Guard fires: throws PausedSubscriptionError when is_paused=true ─

  describe('(b) Guard fires: throws PausedSubscriptionError when is_paused=true', () => {
    beforeEach(() => {
      setPaused(true, PAUSED_UNTIL);
    });

    it('addInjection: throws PausedSubscriptionError with correct paused_until', () => {
      expect(() => useStore.getState().addInjection(INJECTION)).toThrow(PausedSubscriptionError);
      try {
        useStore.getState().addInjection(INJECTION);
      } catch (e) {
        expect(e).toBeInstanceOf(PausedSubscriptionError);
        expect((e as PausedSubscriptionError).paused_until).toBe(PAUSED_UNTIL);
        expect((e as PausedSubscriptionError).name).toBe('PausedSubscriptionError');
      }
      // State must NOT be mutated
      expect(useStore.getState().injections).toHaveLength(0);
    });

    it('addSymptom: throws PausedSubscriptionError', () => {
      expect(() => useStore.getState().addSymptom(SYMPTOM)).toThrow(PausedSubscriptionError);
      expect(useStore.getState().symptoms).toHaveLength(0);
    });

    it('upsertWeight: throws PausedSubscriptionError', () => {
      expect(() => useStore.getState().upsertWeight(WEIGHT)).toThrow(PausedSubscriptionError);
      expect(useStore.getState().weights).toHaveLength(0);
    });

    it('addWeight: throws PausedSubscriptionError', () => {
      expect(() => useStore.getState().addWeight(WEIGHT)).toThrow(PausedSubscriptionError);
      expect(useStore.getState().weights).toHaveLength(0);
    });

    it('addMeasurement: throws PausedSubscriptionError', () => {
      expect(() => useStore.getState().addMeasurement(MEASUREMENT)).toThrow(PausedSubscriptionError);
      expect(useStore.getState().measurements).toHaveLength(0);
    });

    it('addMeal: throws PausedSubscriptionError', () => {
      expect(() => useStore.getState().addMeal(MEAL)).toThrow(PausedSubscriptionError);
      expect(useStore.getState().meals).toHaveLength(0);
    });

    it('addWorkout: throws PausedSubscriptionError', () => {
      expect(() => useStore.getState().addWorkout(WORKOUT)).toThrow(PausedSubscriptionError);
      expect(useStore.getState().workouts).toHaveLength(0);
    });

    it('addMood: throws PausedSubscriptionError', () => {
      expect(() => useStore.getState().addMood(MOOD_LOG)).toThrow(PausedSubscriptionError);
      expect(useStore.getState().mood).toHaveLength(0);
    });

    it('addSleep: throws PausedSubscriptionError', () => {
      expect(() => useStore.getState().addSleep(SLEEP_LOG)).toThrow(PausedSubscriptionError);
      expect(useStore.getState().sleep).toHaveLength(0);
    });

    it('addNSV: throws PausedSubscriptionError', () => {
      expect(() => useStore.getState().addNSV('Lost 10 lbs', '2026-08-01')).toThrow(
        PausedSubscriptionError,
      );
      expect(useStore.getState().nsvs).toHaveLength(0);
    });
  });

  // ─── (c) Selective gating: remove/edit actions NOT blocked ───────────────

  describe('(c) Selective gating: remove actions NOT blocked when paused', () => {
    beforeEach(() => {
      // Seed an injection first while NOT paused
      setPaused(false, null);
      useStore.getState().addInjection(INJECTION);
      // Now pause
      setPaused(true, PAUSED_UNTIL);
    });

    it('removeInjection(0): does NOT throw when is_paused=true (delete during pause is allowed)', () => {
      const before = useStore.getState().injections.length;
      expect(() => useStore.getState().removeInjection(0)).not.toThrow();
      expect(useStore.getState().injections).toHaveLength(before - 1);
    });

    it('editInjection: does NOT throw when is_paused=true (edit of existing data is allowed)', () => {
      const { log_id } = useStore.getState().injections[0];
      expect(() =>
        useStore.getState().editInjection(log_id, { notes: 'Updated note' }),
      ).not.toThrow();
    });
  });

  // ─── (d) Resume clears guard ──────────────────────────────────────────────

  describe('(d) Resume clears guard: setPauseState(false) re-enables logging', () => {
    it('addInjection succeeds after setPauseState(false, null)', () => {
      setPaused(true, PAUSED_UNTIL);
      // Confirm guard is active
      expect(() => useStore.getState().addInjection(INJECTION)).toThrow(PausedSubscriptionError);

      // Resume
      setPaused(false, null);
      expect(useStore.getState().is_paused).toBe(false);
      expect(useStore.getState().paused_until).toBeNull();

      // Logging now succeeds
      expect(() => useStore.getState().addInjection(INJECTION)).not.toThrow();
      expect(useStore.getState().injections).toHaveLength(1);
    });
  });
});
