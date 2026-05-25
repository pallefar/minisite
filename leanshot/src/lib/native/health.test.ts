/**
 * Phase 55 Plan 55-03 — health.ts import-mapping, dedupe, platform-guard, firewall-guard tests.
 *
 * Coverage:
 *   HEALTH-01: requestHealthKitAuthorization API shape
 *   HEALTH-03: import mapping mock samples → correct destination with hk_source
 *   HEALTH-04: firewall guard mocked out (assertHealthTunnel no-op in test); platform guard blocks non-iOS
 *   HEALTH-07: revokeAccess + purgeImportedData call correct RPCs
 *
 * Vitest 4.x: run as `npx vitest run --config vite.config.ts src/lib/native/health.test.ts`
 * or via the default `npm run test:unit` surface (src/**‌/*.test.ts glob).
 */
import { Health } from '@capgo/capacitor-health';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useStore } from '@/lib/store';
import { supabase } from '@/lib/supabase';
import {
  healthSampleId,
  isEnabled,
  isHealthKitAvailable,
  purgeImportedData,
  readDietaryProtein,
  readHealthSamples,
  requestHealthKitAuthorization,
  revokeAccess,
  syncNow,
} from './health';
import { detectPlatform } from './platform';

// ---------------------------------------------------------------------------
// Mock @capgo/capacitor-health — inline factory (plan-check fix requirement)
// ---------------------------------------------------------------------------
vi.mock('@capgo/capacitor-health', () => ({
  Health: {
    isAvailable: vi.fn(async () => ({ available: true })),
    requestAuthorization: vi.fn(async () => ({
      readAuthorized: ['weight', 'steps', 'sleep', 'heartRate', 'calories', 'height'],
      readDenied: [],
      writeAuthorized: [],
      writeDenied: [],
    })),
    readSamples: vi.fn(async () => ({ samples: [] })),
  },
}));

// ---------------------------------------------------------------------------
// Mock ./healthAssert — no-op so assertHealthTunnel doesn't throw in tests
// ---------------------------------------------------------------------------
vi.mock('./healthAssert', () => ({
  assertHealthTunnel: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Mock ./platform — default to 'ios'; override per test
// ---------------------------------------------------------------------------
vi.mock('./platform', () => ({
  detectPlatform: vi.fn(() => 'ios' as const),
}));

// ---------------------------------------------------------------------------
// Mock @/lib/supabase
// All internal mock functions accessible via vi.mocked(supabase.*).mock
// ---------------------------------------------------------------------------
vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: vi.fn(() => ({
      upsert: vi.fn(async () => ({ error: null })),
      update: vi.fn(() => ({ eq: vi.fn(async () => ({ error: null })) })),
      select: vi.fn(() => ({
        maybeSingle: vi.fn(async () => ({ data: { healthkit_enabled: true }, error: null })),
      })),
    })),
    rpc: vi.fn(async () => ({ error: null })),
    auth: { getUser: vi.fn(async () => ({ data: { user: { id: 'user-123' } } })) },
  },
}));

// ---------------------------------------------------------------------------
// Mock @/lib/store
// ---------------------------------------------------------------------------
vi.mock('@/lib/store', () => ({
  useStore: {
    getState: vi.fn(() => ({
      bulkSetSteps: vi.fn(),
    })),
  },
}));

// (imports moved to top of file, before vi.mock calls — vi.mock is hoisted so order doesn't matter)

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSample(overrides: {
  dataType?: string;
  value?: number;
  unit?: string;
  startDate?: string;
  endDate?: string;
  sourceName?: string;
  sourceId?: string;
} = {}) {
  return {
    dataType: 'weight',
    value: 80,
    unit: 'kg',
    startDate: '2026-05-25T08:00:00.000Z',
    endDate: '2026-05-25T08:01:00.000Z',
    sourceName: 'iPhone',
    sourceId: 'com.apple.health',
    ...overrides,
  };
}

const START = new Date('2026-05-01');
const END = new Date('2026-05-25');

// ---------------------------------------------------------------------------
// Tests: healthSampleId (deterministic UUID-v5 dedupe)
// ---------------------------------------------------------------------------

describe('healthSampleId (deterministic UUID-v5 dedupe)', () => {
  it('returns the same UUID when called twice with identical inputs', () => {
    const id1 = healthSampleId('user-abc', '2026-05-25', 'weight', 'com.apple.health');
    const id2 = healthSampleId('user-abc', '2026-05-25', 'weight', 'com.apple.health');
    expect(id1).toBe(id2);
  });

  it('returns different UUIDs for different dates', () => {
    const id1 = healthSampleId('user-abc', '2026-05-25', 'weight', 'com.apple.health');
    const id2 = healthSampleId('user-abc', '2026-05-26', 'weight', 'com.apple.health');
    expect(id1).not.toBe(id2);
  });

  it('returns different UUIDs for different metrics', () => {
    const id1 = healthSampleId('user-abc', '2026-05-25', 'weight', 'com.apple.health');
    const id2 = healthSampleId('user-abc', '2026-05-25', 'sleep', 'com.apple.health');
    expect(id1).not.toBe(id2);
  });

  it('produces a valid UUID-like format string (8-4-4-4-12 hex)', () => {
    const id = healthSampleId('user-abc', '2026-05-25', 'weight', 'com.apple.health');
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });
});

// ---------------------------------------------------------------------------
// Tests: isHealthKitAvailable
// ---------------------------------------------------------------------------

describe('isHealthKitAvailable', () => {
  beforeEach(() => {
    vi.mocked(detectPlatform).mockReturnValue('ios');
    vi.mocked(Health.isAvailable).mockReset();
    vi.mocked(Health.isAvailable).mockResolvedValue({ available: true });
  });

  it('returns true when on iOS and plugin says available', async () => {
    expect(await isHealthKitAvailable()).toBe(true);
  });

  it('returns false on web without calling the plugin', async () => {
    vi.mocked(detectPlatform).mockReturnValue('web');
    expect(await isHealthKitAvailable()).toBe(false);
    expect(Health.isAvailable).not.toHaveBeenCalled();
  });

  it('returns false on android without calling the plugin', async () => {
    vi.mocked(detectPlatform).mockReturnValue('android');
    expect(await isHealthKitAvailable()).toBe(false);
    expect(Health.isAvailable).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Tests: requestHealthKitAuthorization
// ---------------------------------------------------------------------------

describe('requestHealthKitAuthorization', () => {
  beforeEach(() => {
    vi.mocked(detectPlatform).mockReturnValue('ios');
    vi.mocked(Health.requestAuthorization).mockReset();
    vi.mocked(Health.requestAuthorization).mockResolvedValue({
      readAuthorized: ['weight', 'steps', 'sleep', 'heartRate', 'calories', 'height'],
      readDenied: [],
      writeAuthorized: [],
      writeDenied: [],
    });
  });

  it('returns true when readAuthorized is non-empty', async () => {
    expect(await requestHealthKitAuthorization()).toBe(true);
  });

  it('returns false when readAuthorized is empty (user denied all)', async () => {
    vi.mocked(Health.requestAuthorization).mockResolvedValueOnce({
      readAuthorized: [],
      readDenied: ['weight', 'steps'],
      writeAuthorized: [],
      writeDenied: [],
    });
    expect(await requestHealthKitAuthorization()).toBe(false);
  });

  it('returns false on non-iOS without calling plugin', async () => {
    vi.mocked(detectPlatform).mockReturnValue('web');
    expect(await requestHealthKitAuthorization()).toBe(false);
    expect(Health.requestAuthorization).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Tests: readHealthSamples
// ---------------------------------------------------------------------------

describe('readHealthSamples', () => {
  beforeEach(() => {
    vi.mocked(detectPlatform).mockReturnValue('ios');
    vi.mocked(Health.readSamples).mockResolvedValue({ samples: [] });
  });

  it('returns [] on web (platform guard — T-55-03-04 mitigation)', async () => {
    vi.mocked(detectPlatform).mockReturnValue('web');
    const result = await readHealthSamples('weight', new Date(), new Date());
    expect(result).toEqual([]);
    expect(Health.readSamples).not.toHaveBeenCalled();
  });

  it('returns [] on android (platform guard)', async () => {
    vi.mocked(detectPlatform).mockReturnValue('android');
    const result = await readHealthSamples('sleep', new Date(), new Date());
    expect(result).toEqual([]);
    expect(Health.readSamples).not.toHaveBeenCalled();
  });

  it('calls Health.readSamples on iOS with limit:500 (T-55-03-03 cap)', async () => {
    const sample = makeSample();
    vi.mocked(Health.readSamples).mockResolvedValueOnce({ samples: [sample] });
    const result = await readHealthSamples('weight', new Date('2026-05-01'), new Date('2026-05-25'));
    expect(Health.readSamples).toHaveBeenCalledWith(expect.objectContaining({
      dataType: 'weight',
      limit: 500,
    }));
    expect(result).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Tests: readDietaryProtein
// ---------------------------------------------------------------------------

describe('readDietaryProtein', () => {
  it('returns empty array (plugin gap — Phase 70 placeholder)', async () => {
    const result = await readDietaryProtein();
    expect(result).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Tests: syncNow — import mapping
// ---------------------------------------------------------------------------

describe('syncNow — import mapping', () => {
  beforeEach(() => {
    vi.mocked(detectPlatform).mockReturnValue('ios');
    vi.mocked(supabase.from).mockReset();
    vi.mocked(supabase.from).mockReturnValue({
      upsert: vi.fn(async () => ({ error: null })),
      update: vi.fn(() => ({ eq: vi.fn(async () => ({ error: null })) })),
      select: vi.fn(() => ({
        maybeSingle: vi.fn(async () => ({ data: { healthkit_enabled: true }, error: null })),
      })),
    } as never);
    vi.mocked(supabase.rpc).mockReset();
    vi.mocked(supabase.rpc).mockResolvedValue({ error: null } as never);
    vi.mocked(supabase.auth.getUser).mockResolvedValue({ data: { user: { id: 'user-123' } } } as never);
    vi.mocked(Health.readSamples).mockReset();
    vi.mocked(Health.readSamples).mockResolvedValue({ samples: [] });
    vi.mocked(useStore.getState).mockReturnValue({ bulkSetSteps: vi.fn() } as never);
  });

  it('returns empty summary on non-iOS (platform guard)', async () => {
    vi.mocked(detectPlatform).mockReturnValue('web');
    const summary = await syncNow(START, END);
    expect(summary).toEqual({ weight: 0, steps: 0, sleep: 0, heartRate: 0, calories: 0, height: 0 });
    expect(Health.readSamples).not.toHaveBeenCalled();
  });

  it('weight sample → public.weights upsert with hk_source=apple_health', async () => {
    vi.mocked(Health.readSamples).mockImplementation(async (opts) => {
      if (opts.dataType === 'weight') return { samples: [makeSample({ dataType: 'weight', value: 82.5 })] };
      return { samples: [] };
    });

    let capturedArgs: unknown[] = [];
    vi.mocked(supabase.from).mockImplementation((table) => {
      const upsert = vi.fn(async (...args: unknown[]) => {
        if (table === 'weights') capturedArgs = args;
        return { error: null };
      });
      return { upsert, update: vi.fn(() => ({ eq: vi.fn(async () => ({ error: null })) })), select: vi.fn(() => ({ maybeSingle: vi.fn(async () => ({ data: null, error: null })) })) } as never;
    });

    const summary = await syncNow(START, END);
    expect(summary.weight).toBe(1);
    // Verify the from('weights') path was taken
    const fromCalls = vi.mocked(supabase.from).mock.calls.map((c) => c[0]);
    expect(fromCalls).toContain('weights');
    // Verify hk_source and weight are in the upsert payload
    const payload = capturedArgs[0] as Record<string, unknown>;
    expect(payload).toMatchObject({ hk_source: 'apple_health', weight: 82.5 });
    expect(capturedArgs[1]).toMatchObject({ onConflict: 'weight_id' });
  });

  it('step samples → Zustand bulkSetSteps; supabase.from never called with "steps"', async () => {
    vi.mocked(Health.readSamples).mockImplementation(async (opts) => {
      if (opts.dataType === 'steps') {
        return { samples: [makeSample({ dataType: 'steps', value: 8000, unit: 'count' })] };
      }
      return { samples: [] };
    });

    const mockBulkSetSteps = vi.fn();
    vi.mocked(useStore.getState).mockReturnValue({ bulkSetSteps: mockBulkSetSteps } as never);

    const summary = await syncNow(START, END);
    expect(summary.steps).toBe(1);
    expect(mockBulkSetSteps).toHaveBeenCalledWith(
      expect.objectContaining({ '2026-05-25': 8000 }),
    );
    const fromCalls = vi.mocked(supabase.from).mock.calls.map((c) => c[0]);
    expect(fromCalls).not.toContain('steps');
  });

  it('sleep sample → public.sleep upsert with hk_source', async () => {
    vi.mocked(Health.readSamples).mockImplementation(async (opts) => {
      if (opts.dataType === 'sleep') {
        return { samples: [makeSample({ dataType: 'sleep', value: 7.5, unit: 'hours' })] };
      }
      return { samples: [] };
    });

    let sleepPayload: unknown = null;
    vi.mocked(supabase.from).mockImplementation((table) => {
      const upsert = vi.fn(async (...args: unknown[]) => {
        if (table === 'sleep') sleepPayload = args[0];
        return { error: null };
      });
      return { upsert, update: vi.fn(() => ({ eq: vi.fn(async () => ({ error: null })) })), select: vi.fn(() => ({ maybeSingle: vi.fn(async () => ({ data: null, error: null })) })) } as never;
    });

    const summary = await syncNow(START, END);
    expect(summary.sleep).toBe(1);
    expect(sleepPayload).toMatchObject({ hk_source: 'apple_health', hours: 7.5 });
  });

  it('heartRate samples → synthetic cardio workout row type=cardio, name contains "Heart Rate"', async () => {
    vi.mocked(Health.readSamples).mockImplementation(async (opts) => {
      if (opts.dataType === 'heartRate') {
        return { samples: [makeSample({ dataType: 'heartRate', value: 72, unit: 'bpm' })] };
      }
      return { samples: [] };
    });

    let workoutPayload: unknown = null;
    vi.mocked(supabase.from).mockImplementation((table) => {
      const upsert = vi.fn(async (...args: unknown[]) => {
        if (table === 'workouts') workoutPayload = args[0];
        return { error: null };
      });
      return { upsert, update: vi.fn(() => ({ eq: vi.fn(async () => ({ error: null })) })), select: vi.fn(() => ({ maybeSingle: vi.fn(async () => ({ data: null, error: null })) })) } as never;
    });

    const summary = await syncNow(START, END);
    expect(summary.heartRate).toBe(1);
    expect(workoutPayload).toMatchObject({
      type: 'cardio',
      name: 'Apple Health – Heart Rate',
      hk_source: 'apple_health',
    });
  });

  it('calories samples → cardio workout "Apple Health Activity" with hk_source', async () => {
    vi.mocked(Health.readSamples).mockImplementation(async (opts) => {
      if (opts.dataType === 'calories') {
        return { samples: [makeSample({ dataType: 'calories', value: 450, unit: 'kilocalorie' })] };
      }
      return { samples: [] };
    });

    let calPayload: unknown = null;
    vi.mocked(supabase.from).mockImplementation((table) => {
      const upsert = vi.fn(async (...args: unknown[]) => {
        if (table === 'workouts') calPayload = args[0];
        return { error: null };
      });
      return { upsert, update: vi.fn(() => ({ eq: vi.fn(async () => ({ error: null })) })), select: vi.fn(() => ({ maybeSingle: vi.fn(async () => ({ data: null, error: null })) })) } as never;
    });

    const summary = await syncNow(START, END);
    expect(summary.calories).toBe(1);
    expect(calPayload).toMatchObject({
      type: 'cardio',
      name: 'Apple Health Activity',
      hk_source: 'apple_health',
    });
  });

  it('height sample → profiles.height update', async () => {
    vi.mocked(Health.readSamples).mockImplementation(async (opts) => {
      if (opts.dataType === 'height') {
        return { samples: [makeSample({ dataType: 'height', value: 178, unit: 'centimeter' })] };
      }
      return { samples: [] };
    });

    const summary = await syncNow(START, END);
    expect(summary.height).toBe(1);
    const fromCalls = vi.mocked(supabase.from).mock.calls.map((c) => c[0]);
    expect(fromCalls).toContain('profiles');
  });

  it('dedupe: same weight sample produces identical weight_id across two syncs', async () => {
    const sample = makeSample({ dataType: 'weight', value: 82.5 });
    vi.mocked(Health.readSamples).mockImplementation(async (opts) => {
      if (opts.dataType === 'weight') return { samples: [sample] };
      return { samples: [] };
    });

    const weightIds: string[] = [];
    vi.mocked(supabase.from).mockImplementation((table) => {
      const upsert = vi.fn(async (...args: unknown[]) => {
        if (table === 'weights') {
          const payload = args[0] as Record<string, string>;
          weightIds.push(payload.weight_id);
        }
        return { error: null };
      });
      return { upsert, update: vi.fn(() => ({ eq: vi.fn(async () => ({ error: null })) })), select: vi.fn(() => ({ maybeSingle: vi.fn(async () => ({ data: null, error: null })) })) } as never;
    });

    await syncNow(START, END);
    await syncNow(START, END);

    expect(weightIds).toHaveLength(2);
    expect(weightIds[0]).toBeTruthy();
    expect(weightIds[0]).toBe(weightIds[1]);
  });

  it('calls log_phi_access and upsert_healthkit_state RPCs after sync', async () => {
    vi.mocked(Health.readSamples).mockResolvedValue({ samples: [] });
    await syncNow(START, END);
    expect(supabase.rpc).toHaveBeenCalledWith('log_phi_access', expect.objectContaining({
      p_reason: 'healthkit_sync',
    }));
    expect(supabase.rpc).toHaveBeenCalledWith('upsert_healthkit_state', expect.objectContaining({
      p_enabled: true,
    }));
  });
});

// ---------------------------------------------------------------------------
// Tests: isEnabled
// ---------------------------------------------------------------------------

describe('isEnabled', () => {
  it('returns true when healthkit_enabled=true in DB', async () => {
    vi.mocked(supabase.from).mockReturnValue({
      select: vi.fn(() => ({
        maybeSingle: vi.fn(async () => ({ data: { healthkit_enabled: true }, error: null })),
      })),
    } as never);
    expect(await isEnabled()).toBe(true);
  });

  it('returns false when healthkit_enabled=false in DB', async () => {
    vi.mocked(supabase.from).mockReturnValue({
      select: vi.fn(() => ({
        maybeSingle: vi.fn(async () => ({ data: { healthkit_enabled: false }, error: null })),
      })),
    } as never);
    expect(await isEnabled()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Tests: revokeAccess
// ---------------------------------------------------------------------------

describe('revokeAccess', () => {
  it('calls upsert_healthkit_state with p_enabled=false (HEALTH-07)', async () => {
    vi.mocked(supabase.rpc).mockReset();
    vi.mocked(supabase.rpc).mockResolvedValue({ error: null } as never);
    await revokeAccess();
    expect(supabase.rpc).toHaveBeenCalledWith('upsert_healthkit_state', expect.objectContaining({
      p_enabled: false,
    }));
  });
});

// ---------------------------------------------------------------------------
// Tests: purgeImportedData
// ---------------------------------------------------------------------------

describe('purgeImportedData', () => {
  it('calls purge_healthkit_imports RPC with the current user id (HEALTH-07)', async () => {
    vi.mocked(supabase.rpc).mockReset();
    vi.mocked(supabase.rpc).mockResolvedValue({ error: null } as never);
    vi.mocked(supabase.auth.getUser).mockResolvedValue({ data: { user: { id: 'user-123' } } } as never);
    await purgeImportedData();
    expect(supabase.rpc).toHaveBeenCalledWith('purge_healthkit_imports', { p_user_id: 'user-123' });
  });
});
