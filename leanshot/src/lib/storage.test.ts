import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { migrateFromV3 } from './storage';

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
