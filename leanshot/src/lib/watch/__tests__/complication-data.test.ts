/**
 * Phase 57 Plan 57-03 — complication-data.test.ts
 * Coverage: WATCH-05, WATCH-06
 * Run: npx vitest run --config vite.config.ts src/lib/watch/__tests__/complication-data.test.ts
 *
 * All tests are pure-function; no mocks needed.
 * Uses a frozen Date for determinism.
 */
import { describe, expect, it } from 'vitest';
import type { PersistedState } from '@/lib/storage';
import type { Injection, User } from '@/types';
import { watchComplicationData, watchSiteRecommendation } from '../complication-data';

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

// Frozen test date: 2026-05-25 (Monday, day-of-week = 1)
const TODAY = new Date('2026-05-25T12:00:00Z');

/** Build a minimal User fixture */
function makeUser(overrides: Partial<User> = {}): User {
  return {
    name: 'Test User',
    units: 'metric',
    medication: 'ozempic',
    dose: '0.5',
    doseUnit: 'mg',
    startDate: '2026-01-01',
    startWeight: 80,
    height: 170,
    age: 35,
    sex: 'female',
    bodyFat: null,
    goalWeight: 70,
    goal: 'fat-loss',
    proteinTarget: 130,
    calorieTarget: 1800,
    fiberTarget: 25,
    waterTarget: 2000,
    injectionDay: 3, // Wednesday (day-of-week = 3)
    activityLevel: 'moderate',
    liftingLevel: 'intermediate',
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

/** Build a minimal Injection fixture at a given datetime */
function makeInjection(datetime: string, site: Injection['site'] = 'abdomen-ul'): Injection {
  return {
    log_id: `log-${datetime}`,
    datetime,
    dose: '0.5',
    unit: 'mg',
    site,
    notes: '',
    pkEngineVersion: 1,
  };
}

/** Minimal PersistedState with user + injections */
function makeState(user: User | null, injections: Injection[] = []): PersistedState {
  return {
    user,
    injections,
    symptoms: [],
    weights: [],
    measurements: [],
    meals: [],
    water: {},
    foodNoise: {},
    workouts: [],
    steps: {},
    supplements: {},
    mood: [],
    sleep: [],
    nsvs: [],
    photos: [],
    vials: [],
    aiHistory: [],
    costs: [],
    acknowledgedDisclaimer: 'v1',
    pendingOps: [],
  };
}

// ---------------------------------------------------------------------------
// watchComplicationData — null state
// ---------------------------------------------------------------------------
describe('watchComplicationData — null user', () => {
  it('returns empty default when state.user is null', () => {
    const state = makeState(null);
    const result = watchComplicationData(state, TODAY);
    expect(result.nextDoseDate).toBeNull();
    expect(result.currentStreak).toBe(0);
    expect(result.nextSite).toBeNull();
    expect(result.medication).toBe('');
    expect(result.lastDose).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// watchComplicationData — nextDoseDate (WATCH-05)
// ---------------------------------------------------------------------------
describe('watchComplicationData — nextDoseDate (WATCH-05)', () => {
  // TODAY = Monday (day=1), injectionDay=3 (Wednesday)
  // daysUntil = ((3 - 1 + 7) % 7) = 2; ||7 = 2 (not zero so stays 2)
  it('returns the correct next injection date when future in the week', () => {
    const user = makeUser({ injectionDay: 3 }); // Wednesday
    const state = makeState(user);
    const result = watchComplicationData(state, TODAY);
    // TODAY is 2026-05-25 (Monday), next Wednesday = 2026-05-27
    expect(result.nextDoseDate).toBe('2026-05-27');
  });

  it('returns 7 days ahead when injectionDay is today (||7 case)', () => {
    // TODAY = 2026-05-25, day=1 (Monday); set injectionDay=1
    const user = makeUser({ injectionDay: 1 }); // Monday
    const state = makeState(user);
    const result = watchComplicationData(state, TODAY);
    // daysUntil = ((1 - 1 + 7) % 7) = 0, ||7 = 7; next Monday = 2026-06-01
    expect(result.nextDoseDate).toBe('2026-06-01');
  });

  it('returns a YYYY-MM-DD string', () => {
    const user = makeUser({ injectionDay: 5 }); // Friday
    const state = makeState(user);
    const result = watchComplicationData(state, TODAY);
    expect(result.nextDoseDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

// ---------------------------------------------------------------------------
// watchComplicationData — currentStreak (WATCH-05)
// ---------------------------------------------------------------------------
describe('watchComplicationData — currentStreak (WATCH-05)', () => {
  it('returns 0 when no injections', () => {
    const user = makeUser();
    const state = makeState(user, []);
    const result = watchComplicationData(state, TODAY);
    expect(result.currentStreak).toBe(0);
  });

  it('counts consecutive injection days via calcStreak', () => {
    const user = makeUser();
    // Injections on the last 3 days (today not included — that is fine per calcStreak)
    const injections = [
      makeInjection('2026-05-24T10:00:00.000Z'), // yesterday
      makeInjection('2026-05-23T10:00:00.000Z'), // day before
      makeInjection('2026-05-22T10:00:00.000Z'), // day before that
    ];
    const state = makeState(user, injections);
    const result = watchComplicationData(state, TODAY);
    expect(result.currentStreak).toBe(3);
  });

  it('breaks the streak on a gap day', () => {
    const user = makeUser();
    const injections = [
      makeInjection('2026-05-24T10:00:00.000Z'), // yesterday
      // gap on 2026-05-23
      makeInjection('2026-05-22T10:00:00.000Z'),
    ];
    const state = makeState(user, injections);
    const result = watchComplicationData(state, TODAY);
    expect(result.currentStreak).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// watchComplicationData — nextSite + medication + lastDose (WATCH-05, WATCH-06)
// ---------------------------------------------------------------------------
describe('watchComplicationData — nextSite (WATCH-06)', () => {
  it('returns the first SITES-order site not used in last 7 days', () => {
    const user = makeUser();
    // abdomen-ul used 1 day ago (recent, < 7 days)
    const injections = [
      makeInjection('2026-05-24T10:00:00.000Z', 'abdomen-ul'),
    ];
    const state = makeState(user, injections);
    const result = watchComplicationData(state, TODAY);
    // abdomen-ul is recent; next in SITES order is abdomen-ur
    expect(result.nextSite).toBe('abdomen-ur');
  });

  it('returns null when all SITES used in last 7 days', () => {
    const user = makeUser();
    const sites = ['abdomen-ul', 'abdomen-ur', 'abdomen-ll', 'abdomen-lr', 'thigh-l', 'thigh-r', 'arm-l', 'arm-r'] as const;
    // All sites used in last 2 days
    const injections = sites.map((s, i) => makeInjection(`2026-05-2${i < 5 ? 3 : 4}T10:00:00.000Z`, s));
    const state = makeState(user, injections);
    const result = watchComplicationData(state, TODAY);
    // All sites are recent — no empty slot
    expect(result.nextSite).toBeNull();
  });

  it('returns abdomen-ul when no injections (first in SITES order)', () => {
    const user = makeUser();
    const state = makeState(user, []);
    const result = watchComplicationData(state, TODAY);
    expect(result.nextSite).toBe('abdomen-ul');
  });
});

describe('watchComplicationData — medication + lastDose (WATCH-05)', () => {
  it('returns user.medication as medication string', () => {
    const user = makeUser({ medication: 'wegovy' });
    const state = makeState(user);
    const result = watchComplicationData(state, TODAY);
    expect(result.medication).toBe('wegovy');
  });

  it('returns lastDose from the newest injection as "<dose> <unit>"', () => {
    const user = makeUser({ dose: '1.0', doseUnit: 'mg' });
    const injections = [
      makeInjection('2026-05-24T10:00:00.000Z'),
    ];
    // Override dose/unit on injection to make it explicit
    injections[0].dose = '1.0';
    injections[0].unit = 'mg';
    const state = makeState(user, injections);
    const result = watchComplicationData(state, TODAY);
    expect(result.lastDose).toBe('1.0 mg');
  });

  it('returns lastDose null when no injections', () => {
    const user = makeUser();
    const state = makeState(user, []);
    const result = watchComplicationData(state, TODAY);
    expect(result.lastDose).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// watchSiteRecommendation — delegates to watchComplicationData (WATCH-06)
// ---------------------------------------------------------------------------
describe('watchSiteRecommendation', () => {
  it('returns the same nextSite as watchComplicationData', () => {
    const user = makeUser();
    const injections = [makeInjection('2026-05-24T10:00:00.000Z', 'abdomen-ul')];
    const state = makeState(user, injections);
    expect(watchSiteRecommendation(state, TODAY)).toBe(
      watchComplicationData(state, TODAY).nextSite,
    );
  });

  it('returns abdomen-ur when abdomen-ul is recent', () => {
    const user = makeUser();
    const injections = [makeInjection('2026-05-24T10:00:00.000Z', 'abdomen-ul')];
    const state = makeState(user, injections);
    expect(watchSiteRecommendation(state, TODAY)).toBe('abdomen-ur');
  });

  it('returns null when state.user is null', () => {
    const state = makeState(null);
    expect(watchSiteRecommendation(state, TODAY)).toBeNull();
  });
});
