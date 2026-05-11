import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Injection } from '@/types';
import { initialState, migrateFromV3, STORAGE_VERSION, type PersistedState } from './storage';
import { migrateState, useStore } from './store';

describe('initialState', () => {
  it('defaults acknowledgedDisclaimer to undefined (D-10)', () => {
    expect(initialState.acknowledgedDisclaimer).toBeUndefined();
  });
});

describe('STORAGE_VERSION', () => {
  it('is bumped to 6 for PK-05 / D-07 pkEngineVersion field', () => {
    expect(STORAGE_VERSION).toBe(6);
  });
});

describe('migrateFromV3', () => {
  let storageMock: Record<string, string>;

  beforeEach(() => {
    storageMock = {};
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation((k) => storageMock[k] ?? null);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation((k, v) => {
      storageMock[k] = String(v);
    });
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation((k) => {
      delete storageMock[k];
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns null when no v3 or v4 keys exist (empty storage)', () => {
    expect(migrateFromV3()).toBeNull();
  });

  it('migrates v3 payload to v4 PersistedState shape', () => {
    const v3 = {
      user: { name: 'Alex', medication: 'tirzepatide', startWeightKg: 90 },
      injections: [],
      weights: [],
    };
    storageMock['leanshot_v3'] = JSON.stringify(v3);
    const result = migrateFromV3();
    expect(result).not.toBeNull();
    expect((result?.user as Record<string, unknown>)?.['name']).toBe('Alex');
    // D-11: v3 migrants must default to undefined so they see the dashboard fallback modal
    expect(result?.acknowledgedDisclaimer).toBeUndefined();
  });

  it('returns null when only v4 is present and v3 is absent', () => {
    storageMock['leanshot_v4'] = JSON.stringify({ user: null, injections: [] });
    expect(migrateFromV3()).toBeNull();
  });

  it('does not throw when both v3 and v4 are present', () => {
    storageMock['leanshot_v3'] = JSON.stringify({
      user: { name: 'Pat' },
      injections: [],
      weights: [],
    });
    storageMock['leanshot_v4'] = JSON.stringify({ user: null, injections: [] });
    expect(() => migrateFromV3()).not.toThrow();
    // The function returns the migrated v3 data (non-null) even when v4 is present
    const result = migrateFromV3();
    // After first call removed leanshot_v3, second call returns null
    expect(result).toBeNull();
  });

  it('returns null on corrupted v3 JSON without throwing', () => {
    storageMock['leanshot_v3'] = '{not-valid-json';
    expect(migrateFromV3()).toBeNull();
  });
});

describe('useStore.acknowledgeDisclaimer', () => {
  it('writes v1 into persisted state (D-10)', () => {
    useStore.setState({ acknowledgedDisclaimer: undefined });
    useStore.getState().acknowledgeDisclaimer('v1');
    expect(useStore.getState().acknowledgedDisclaimer).toBe('v1');
  });
});

// ---------------------------------------------------------------------------
// PK-05 / Phase 3 D-07: persist migrate v5 → v6 + addInjection pk stamping.
// ---------------------------------------------------------------------------

/** Build a v5-shaped persisted state for migration tests. */
function v5State(overrides: Partial<PersistedState> = {}): PersistedState {
  return {
    ...initialState,
    acknowledgedDisclaimer: 'v1',
    injections: [],
    ...overrides,
  };
}

describe('persist migrate v5 → v6 (PK-05)', () => {
  it('back-stamps injections lacking pkEngineVersion to 1', () => {
    const inj1: Injection = {
      datetime: '2026-04-01T10:00:00Z',
      dose: '1',
      unit: 'mg',
      site: null,
      notes: '',
    };
    const inj2: Injection = {
      datetime: '2026-04-08T10:00:00Z',
      dose: '1',
      unit: 'mg',
      site: 'abdomen-ul',
      notes: '',
    };
    const before = v5State({ injections: [inj1, inj2] });
    const after = migrateState(before, 5);
    expect(after.injections).toHaveLength(2);
    expect(after.injections[0]!.pkEngineVersion).toBe(1);
    expect(after.injections[1]!.pkEngineVersion).toBe(1);
  });

  it('preserves explicit pkEngineVersion when already present', () => {
    const inj: Injection = {
      datetime: '2026-04-01T10:00:00Z',
      dose: '1',
      unit: 'mg',
      site: null,
      notes: '',
      pkEngineVersion: 2,
    };
    const before = v5State({ injections: [inj] });
    const after = migrateState(before, 5);
    expect(after.injections[0]!.pkEngineVersion).toBe(2);
  });

  it('v4 → v6 chain applies BOTH disclaimer reset AND pk back-stamp', () => {
    const inj: Injection = {
      datetime: '2026-04-01T10:00:00Z',
      dose: '1',
      unit: 'mg',
      site: null,
      notes: '',
    };
    // v4-shaped state had acknowledgedDisclaimer 'v1' (or similar) — migrate must
    // reset to undefined (Phase 2 D-10) AND back-stamp injections (Phase 3 D-07).
    const before = v5State({ acknowledgedDisclaimer: 'v1', injections: [inj] });
    const after = migrateState(before, 4);
    expect(after.acknowledgedDisclaimer).toBeUndefined();
    expect(after.injections[0]!.pkEngineVersion).toBe(1);
  });

  it('tolerates missing injections array (defensive ?? [])', () => {
    // simulate a malformed v5 snapshot whose `injections` field is undefined
    const malformed = { ...v5State(), injections: undefined } as unknown as PersistedState;
    const after = migrateState(malformed, 5);
    expect(after.injections).toEqual([]);
  });
});

/**
 * CR-03 regression (Phase 3 review): the v3-bootstrap branch in migrateState
 * previously returned early — `{ ...initialState, ...v3 }` — without flowing
 * through the v<=4 and v<=5 transforms. A v3-direct-to-v6 user therefore
 * landed at v6 with every Injection.pkEngineVersion === undefined, defeating
 * the v5→v6 bump (D-07 / PK-05).
 *
 * This test drives migrateState(undefined, 3) against a mocked v3 blob that
 * contains injections, and asserts every record was back-stamped. It MUST
 * fail against the pre-fix early-return implementation.
 */
describe('CR-03: v3 → v6 bootstrap chains through v4 + v5 transforms', () => {
  let storageMock: Record<string, string>;

  beforeEach(() => {
    storageMock = {};
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation((k) => storageMock[k] ?? null);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation((k, v) => {
      storageMock[k] = String(v);
    });
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation((k) => {
      delete storageMock[k];
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('stamps pkEngineVersion: 1 on every injection in a v3 → v6 migration', () => {
    const v3Blob = {
      user: { name: 'Alex', medication: 'tirzepatide', startWeightKg: 90 },
      injections: [
        {
          datetime: '2026-03-01T10:00:00Z',
          dose: '5',
          unit: 'mg',
          site: null,
          notes: '',
        },
        {
          datetime: '2026-03-08T10:00:00Z',
          dose: '7.5',
          unit: 'mg',
          site: 'abdomen-ul',
          notes: '',
        },
        {
          datetime: '2026-03-15T10:00:00Z',
          dose: '10',
          unit: 'mg',
          site: 'thigh-r',
          notes: '',
        },
      ],
      weights: [],
    };
    storageMock['leanshot_v3'] = JSON.stringify(v3Blob);

    // version=3 with no persisted v6 state triggers the bootstrap branch.
    const after = migrateState(undefined, 3);

    expect(after.injections).toHaveLength(3);
    // Every legacy injection must be back-stamped with pkEngineVersion: 1.
    for (const inj of after.injections) {
      expect(inj.pkEngineVersion).toBe(1);
    }
    // Phase 2 D-10/D-11 chained transform also runs: disclaimer reset to undefined.
    expect(after.acknowledgedDisclaimer).toBeUndefined();
  });

  it('stamps pkEngineVersion: 1 even when v3 blob has empty injections', () => {
    const v3Blob = { user: { name: 'Pat' }, injections: [], weights: [] };
    storageMock['leanshot_v3'] = JSON.stringify(v3Blob);
    const after = migrateState(undefined, 3);
    // Empty injections array survives the chained map (no records to stamp).
    expect(after.injections).toEqual([]);
    expect(after.acknowledgedDisclaimer).toBeUndefined();
  });

  it('returns initialState when no v3 blob exists at all', () => {
    // version<STORAGE_VERSION + no v3 in localStorage → falls through to
    // initialState, then chained transforms run as no-ops.
    const after = migrateState(undefined, 3);
    expect(after.injections).toEqual([]);
    expect(after.acknowledgedDisclaimer).toBeUndefined();
  });
});

describe('useStore.addInjection — PK-05 stamping', () => {
  beforeEach(() => {
    useStore.setState({ ...initialState, currentTab: 'home', toast: null });
  });

  it('stamps pkEngineVersion: 1 on a new injection without explicit version', () => {
    useStore.getState().addInjection({
      datetime: '2026-04-01T10:00:00Z',
      dose: '1',
      unit: 'mg',
      site: null,
      notes: '',
    });
    expect(useStore.getState().injections[0]!.pkEngineVersion).toBe(1);
  });

  it('preserves explicit pkEngineVersion when caller provides one', () => {
    useStore.getState().addInjection({
      datetime: '2026-04-01T10:00:00Z',
      dose: '1',
      unit: 'mg',
      site: null,
      notes: '',
      pkEngineVersion: 2,
    });
    expect(useStore.getState().injections[0]!.pkEngineVersion).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Phase 5 D-08 / SYNC-01: addInjection log_id stamping (composite PK with user_id).
// ---------------------------------------------------------------------------

describe('useStore.addInjection — Phase 5 log_id stamping', () => {
  beforeEach(() => {
    useStore.setState({ ...initialState, currentTab: 'home', toast: null });
  });

  it('stamps a UUID log_id on a new injection without explicit log_id', () => {
    useStore.getState().addInjection({
      datetime: '2026-05-01T10:00:00Z',
      dose: '1',
      unit: 'mg',
      site: null,
      notes: '',
    } as unknown as Injection);
    const stamped = useStore.getState().injections[0]!;
    expect(stamped.log_id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  it('preserves explicit log_id when caller provides one', () => {
    const explicit = '11111111-2222-3333-4444-555555555555';
    useStore.getState().addInjection({
      log_id: explicit,
      datetime: '2026-05-01T10:00:00Z',
      dose: '1',
      unit: 'mg',
      site: null,
      notes: '',
    });
    expect(useStore.getState().injections[0]!.log_id).toBe(explicit);
  });
});
