/**
 * Phase 5 Plan 05-03 Task 1: sync engine unit tests (RED → GREEN).
 *
 * Source: 05-03-PLAN.md Task 1 <behavior>. Mocks `@/lib/supabase` AND
 * `@/lib/store` so test runs do not hit network and the isSyncEnabled() /
 * pendingOps surfaces can be flipped per-case.
 *
 * Regression guards:
 *   - D-08 / Critical Gotcha #11: flushSyncQueue must NEVER send updated_at.
 *   - D-13 / T-05-07: flushSyncQueue early-returns when isSyncEnabled() === false.
 *   - Subscribe idempotency: calling subscribeInjections twice creates ONE channel.
 *   - postgres_changes filter syntax (Pitfall #10): string form `user_id=eq.<uid>`.
 *   - removeChannel is the canonical teardown.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Injection, PendingOp } from '@/types';

// --- Mocks -----------------------------------------------------------------

const mockSelect = vi.fn();
const mockOrder = vi.fn();
const mockEq = vi.fn();
const mockUpsert = vi.fn();
const mockDelete = vi.fn();
const mockIn = vi.fn();
const mockEqDelete = vi.fn();
const mockFrom = vi.fn();
const mockChannelOn = vi.fn();
const mockChannelSubscribe = vi.fn();
const mockChannel = vi.fn();
const mockRemoveChannel = vi.fn();

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: (...args: unknown[]) => mockFrom(...args),
    channel: (...args: unknown[]) => mockChannel(...args),
    removeChannel: (...args: unknown[]) => mockRemoveChannel(...args),
  },
}));

const mockMergeServerInjections = vi.fn();
const mockApplyRealtimePayload = vi.fn();
const mockEnqueueOp = vi.fn();
const mockDropOps = vi.fn();
const mockIsSyncEnabled = vi.fn();

const storeState: {
  signedIn: { user: { id: string }; verified: boolean } | null;
  user: { medication: string } | null;
  injections: Injection[];
  pendingOps: PendingOp[];
  isSyncEnabled: () => boolean;
  mergeServerInjections: typeof mockMergeServerInjections;
  applyRealtimePayload: typeof mockApplyRealtimePayload;
  enqueueOp: typeof mockEnqueueOp;
  dropOps: typeof mockDropOps;
} = {
  signedIn: { user: { id: 'u1' }, verified: true },
  user: { medication: 'ozempic' },
  injections: [],
  pendingOps: [],
  isSyncEnabled: () => mockIsSyncEnabled(),
  mergeServerInjections: mockMergeServerInjections,
  applyRealtimePayload: mockApplyRealtimePayload,
  enqueueOp: mockEnqueueOp,
  dropOps: mockDropOps,
};

vi.mock('@/lib/store', () => ({
  useStore: {
    getState: () => storeState,
  },
}));

// --- Helpers ---------------------------------------------------------------

function resetMocks(): void {
  mockSelect.mockReset();
  mockOrder.mockReset();
  mockEq.mockReset();
  mockUpsert.mockReset();
  mockDelete.mockReset();
  mockIn.mockReset();
  mockEqDelete.mockReset();
  mockFrom.mockReset();
  mockChannelOn.mockReset();
  mockChannelSubscribe.mockReset();
  mockChannel.mockReset();
  mockRemoveChannel.mockReset();
  mockMergeServerInjections.mockReset();
  mockApplyRealtimePayload.mockReset();
  mockEnqueueOp.mockReset();
  mockDropOps.mockReset();
  mockIsSyncEnabled.mockReset();
  storeState.signedIn = { user: { id: 'u1' }, verified: true };
  storeState.user = { medication: 'ozempic' };
  storeState.injections = [];
  storeState.pendingOps = [];
  mockIsSyncEnabled.mockReturnValue(true);
}

function wireFromForSelect(rows: Array<Record<string, unknown>>): void {
  // supabase.from('injections').select('*').eq('user_id', uid).order('logged_at', {...})
  mockOrder.mockResolvedValueOnce({ data: rows, error: null });
  mockEq.mockReturnValueOnce({ order: mockOrder });
  mockSelect.mockReturnValueOnce({ eq: mockEq });
  mockFrom.mockReturnValueOnce({ select: mockSelect });
}

function wireFromForUpsert(error: unknown = null): void {
  mockUpsert.mockResolvedValueOnce({ error });
  mockFrom.mockReturnValueOnce({ upsert: mockUpsert });
}

function wireFromForDelete(error: unknown = null): void {
  mockIn.mockResolvedValueOnce({ error });
  mockEqDelete.mockReturnValueOnce({ in: mockIn });
  mockDelete.mockReturnValueOnce({ eq: mockEqDelete });
  mockFrom.mockReturnValueOnce({ delete: mockDelete });
}

function wireChannelSubscribe(): {
  on: typeof mockChannelOn;
  subscribe: typeof mockChannelSubscribe;
} {
  const chain = {
    on: mockChannelOn,
    subscribe: mockChannelSubscribe,
  };
  mockChannelOn.mockReturnValue(chain);
  mockChannelSubscribe.mockReturnValue({ /* RealtimeChannel mock */ topic: 'mock' });
  mockChannel.mockReturnValue(chain);
  return chain;
}

beforeEach(() => {
  resetMocks();
  vi.resetModules();
});

// --- pullInitialInjections ------------------------------------------------

describe('pullInitialInjections', () => {
  it('calls supabase.from("injections").select with user_id filter and order desc', async () => {
    wireFromForSelect([
      {
        log_id: 'l1',
        user_id: 'u1',
        medication: 'ozempic',
        dose: '0.5',
        unit: 'mg',
        site: 'abdomen-ul',
        notes: '',
        logged_at: '2026-05-10T00:00:00Z',
        pk_engine_version: 1,
        updated_at: '2026-05-10T00:00:00Z',
      },
      {
        log_id: 'l2',
        user_id: 'u1',
        medication: 'ozempic',
        dose: '0.5',
        unit: 'mg',
        site: 'thigh-l',
        notes: '',
        logged_at: '2026-05-11T00:00:00Z',
        pk_engine_version: 1,
        updated_at: '2026-05-11T00:00:00Z',
      },
    ]);
    const { pullInitialInjections } = await import('./sync');
    await pullInitialInjections('u1');
    expect(mockFrom).toHaveBeenCalledWith('injections');
    expect(mockEq).toHaveBeenCalledWith('user_id', 'u1');
    expect(mockOrder).toHaveBeenCalledWith('logged_at', { ascending: false });
    expect(mockMergeServerInjections).toHaveBeenCalledTimes(1);
    const mapped = mockMergeServerInjections.mock.calls[0]![0] as Injection[];
    expect(mapped).toHaveLength(2);
    // server logged_at → local datetime
    expect(mapped[0]!.datetime).toBe('2026-05-10T00:00:00Z');
    expect(mapped[0]!.updated_at).toBe('2026-05-10T00:00:00Z');
    expect(mapped[0]!.user_id).toBe('u1');
    expect(mapped[0]!.log_id).toBe('l1');
  });

  it('on error: does not call mergeServerInjections', async () => {
    mockOrder.mockResolvedValueOnce({ data: null, error: { message: 'oops' } });
    mockEq.mockReturnValueOnce({ order: mockOrder });
    mockSelect.mockReturnValueOnce({ eq: mockEq });
    mockFrom.mockReturnValueOnce({ select: mockSelect });
    const { pullInitialInjections } = await import('./sync');
    await pullInitialInjections('u1');
    expect(mockMergeServerInjections).not.toHaveBeenCalled();
  });
});

// --- subscribeInjections + unsubscribeInjections ---------------------------

describe('subscribeInjections idempotency + filter syntax', () => {
  it('subscribes once; second call is a no-op', async () => {
    wireChannelSubscribe();
    const sync = await import('./sync');
    sync.subscribeInjections('u1');
    sync.subscribeInjections('u1');
    expect(mockChannel).toHaveBeenCalledTimes(1);
    expect(mockChannel).toHaveBeenCalledWith('injections:u1');
  });

  it('uses postgres_changes with string-form filter user_id=eq.<uid>', async () => {
    wireChannelSubscribe();
    const sync = await import('./sync');
    sync.subscribeInjections('u1');
    expect(mockChannelOn).toHaveBeenCalledTimes(1);
    const args = mockChannelOn.mock.calls[0]!;
    expect(args[0]).toBe('postgres_changes');
    expect(args[1]).toEqual(
      expect.objectContaining({
        event: '*',
        schema: 'public',
        table: 'injections',
        filter: 'user_id=eq.u1',
      }),
    );
  });

  it('handler maps payload.new to Injection-shape and dispatches applyRealtimePayload', async () => {
    wireChannelSubscribe();
    const sync = await import('./sync');
    sync.subscribeInjections('u1');
    const handler = mockChannelOn.mock.calls[0]![2] as (p: unknown) => void;
    handler({
      eventType: 'INSERT',
      new: {
        log_id: 'l1',
        user_id: 'u1',
        medication: 'ozempic',
        dose: '0.5',
        unit: 'mg',
        site: null,
        notes: '',
        logged_at: '2026-05-12T00:00:00Z',
        pk_engine_version: 1,
        updated_at: '2026-05-12T00:00:00Z',
      },
      old: {},
    });
    expect(mockApplyRealtimePayload).toHaveBeenCalledTimes(1);
    const payload = mockApplyRealtimePayload.mock.calls[0]![0] as {
      eventType: string;
      new: Injection;
      old: unknown;
    };
    expect(payload.eventType).toBe('INSERT');
    expect(payload.new.datetime).toBe('2026-05-12T00:00:00Z');
    expect(payload.new.log_id).toBe('l1');
  });
});

describe('unsubscribeInjections', () => {
  it('calls supabase.removeChannel and clears module-level channel', async () => {
    wireChannelSubscribe();
    const sync = await import('./sync');
    sync.subscribeInjections('u1');
    mockRemoveChannel.mockResolvedValueOnce(undefined);
    await sync.unsubscribeInjections();
    expect(mockRemoveChannel).toHaveBeenCalledTimes(1);

    // After teardown, a fresh subscribe should create a NEW channel.
    sync.subscribeInjections('u1');
    expect(mockChannel).toHaveBeenCalledTimes(2);
  });

  it('no-op when never subscribed', async () => {
    const sync = await import('./sync');
    await sync.unsubscribeInjections();
    expect(mockRemoveChannel).not.toHaveBeenCalled();
  });
});

// --- flushSyncQueue --------------------------------------------------------

describe('flushSyncQueue', () => {
  it('early-returns when isSyncEnabled() === false (D-13 / T-05-07 regression guard)', async () => {
    mockIsSyncEnabled.mockReturnValue(false);
    storeState.pendingOps = [{ table: 'injections', op: 'upsert', key: 'l1', enqueuedAt: 'now' }];
    const { flushSyncQueue } = await import('./sync');
    await flushSyncQueue();
    expect(mockFrom).not.toHaveBeenCalled();
    expect(mockDropOps).not.toHaveBeenCalled();
  });

  it('upserts pending rows with onConflict user_id,log_id (Pattern 2)', async () => {
    storeState.injections = [
      {
        log_id: 'l1',
        datetime: '2026-05-12T00:00:00Z',
        dose: '0.5',
        unit: 'mg',
        site: 'abdomen-ul',
        notes: '',
        pkEngineVersion: 1,
      },
    ];
    storeState.pendingOps = [{ table: 'injections', op: 'upsert', key: 'l1', enqueuedAt: 'now' }];
    wireFromForUpsert();
    const { flushSyncQueue } = await import('./sync');
    await flushSyncQueue();
    expect(mockUpsert).toHaveBeenCalledTimes(1);
    const [rows, opts] = mockUpsert.mock.calls[0]! as [
      Array<Record<string, unknown>>,
      { onConflict: string },
    ];
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual(
      expect.objectContaining({
        user_id: 'u1',
        log_id: 'l1',
        medication: 'ozempic',
        dose: '0.5',
        unit: 'mg',
        site: 'abdomen-ul',
        notes: '',
        logged_at: '2026-05-12T00:00:00Z',
        pk_engine_version: 1,
      }),
    );
    expect(opts.onConflict).toBe('user_id,log_id');
    expect(mockDropOps).toHaveBeenCalledWith(['l1']);
  });

  it('does NOT include updated_at in upsert payload (D-08, Critical Gotcha #11)', async () => {
    storeState.injections = [
      {
        log_id: 'l1',
        datetime: '2026-05-12T00:00:00Z',
        dose: '0.5',
        unit: 'mg',
        site: null,
        notes: '',
        pkEngineVersion: 1,
        // Even if the local copy somehow has a server-side updated_at, the upsert MUST strip it.
        updated_at: '2026-05-11T00:00:00Z',
      },
    ];
    storeState.pendingOps = [{ table: 'injections', op: 'upsert', key: 'l1', enqueuedAt: 'now' }];
    wireFromForUpsert();
    const { flushSyncQueue } = await import('./sync');
    await flushSyncQueue();
    const rows = mockUpsert.mock.calls[0]![0] as Array<Record<string, unknown>>;
    for (const row of rows) {
      expect(row).not.toHaveProperty('updated_at');
    }
  });

  it('handles delete ops via from().delete().eq().in()', async () => {
    storeState.pendingOps = [{ table: 'injections', op: 'delete', key: 'l9', enqueuedAt: 'now' }];
    wireFromForDelete();
    const { flushSyncQueue } = await import('./sync');
    await flushSyncQueue();
    expect(mockDelete).toHaveBeenCalledTimes(1);
    expect(mockEqDelete).toHaveBeenCalledWith('user_id', 'u1');
    expect(mockIn).toHaveBeenCalledWith('log_id', ['l9']);
    expect(mockDropOps).toHaveBeenCalledWith(['l9']);
  });

  it('on upsert error: leaves pendingOps intact (transient retry)', async () => {
    storeState.injections = [
      {
        log_id: 'l1',
        datetime: '2026-05-12T00:00:00Z',
        dose: '0.5',
        unit: 'mg',
        site: null,
        notes: '',
      },
    ];
    storeState.pendingOps = [{ table: 'injections', op: 'upsert', key: 'l1', enqueuedAt: 'now' }];
    wireFromForUpsert({ message: 'network', code: '503' });
    const { flushSyncQueue } = await import('./sync');
    await flushSyncQueue();
    expect(mockDropOps).not.toHaveBeenCalled();
  });
});

// --- subscribeToTable (forward-compat for Phase 6) ------------------------

describe('subscribeToTable<T> generic helper', () => {
  it('returns a channel and wires postgres_changes filter for arbitrary table', async () => {
    wireChannelSubscribe();
    const { subscribeToTable } = await import('./sync');
    const onPayload = vi.fn();
    const ch = subscribeToTable<{ user_id: string; date: string }>('weights', 'u1', onPayload);
    expect(ch).toBeDefined();
    expect(mockChannel).toHaveBeenCalledWith('weights:u1');
    expect(mockChannelOn).toHaveBeenCalledWith(
      'postgres_changes',
      expect.objectContaining({
        event: '*',
        schema: 'public',
        table: 'weights',
        filter: 'user_id=eq.u1',
      }),
      onPayload,
    );
  });
});

// ---------------------------------------------------------------------------
// Phase 6 06-03 — per-table subscribe helpers (channel-name + filter format).
// ---------------------------------------------------------------------------

describe('Phase 6 — per-table subscribe helpers', () => {
  const helpers: Array<[string, (uid: string) => void | unknown]> = [];

  beforeEach(async () => {
    helpers.length = 0;
    const sync = await import('./sync');
    helpers.push(['weights', sync.subscribeWeights]);
    helpers.push(['meals', sync.subscribeMeals]);
    helpers.push(['workouts', sync.subscribeWorkouts]);
    helpers.push(['supplements', sync.subscribeSupplements]);
    helpers.push(['mood', sync.subscribeMood]);
    helpers.push(['sleep', sync.subscribeSleep]);
    helpers.push(['symptoms', sync.subscribeSymptoms]);
    helpers.push(['vials', sync.subscribeVials]);
    helpers.push(['settings', sync.subscribeSettings]);
  });

  it.each([
    ['weights'],
    ['meals'],
    ['workouts'],
    ['supplements'],
    ['mood'],
    ['sleep'],
    ['symptoms'],
    ['vials'],
    ['settings'],
  ])('subscribe%s creates a "$table:<uid>" channel with string user_id filter', async (table) => {
    wireChannelSubscribe();
    const sync = await import('./sync');
    const fnName =
      `subscribe${table.charAt(0).toUpperCase()}${table.slice(1)}` as keyof typeof sync;
    const fn = sync[fnName] as (uid: string) => void;
    fn('u1');
    expect(mockChannel).toHaveBeenCalledWith(`${table}:u1`);
    const args = mockChannelOn.mock.calls[0]!;
    expect(args[0]).toBe('postgres_changes');
    expect(args[1]).toEqual(
      expect.objectContaining({
        event: '*',
        schema: 'public',
        table,
        filter: 'user_id=eq.u1',
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// Phase 6 06-03 — flushSyncQueue parameterized LWW regression. The
// "INTENTIONALLY OMITTING updated_at" contract is asserted per table.
// ---------------------------------------------------------------------------

describe('Phase 6 — flushSyncQueue per-table updated_at omission (D-08 Critical Gotcha #11)', () => {
  const cases: Array<{
    table: string;
    pk: string;
    sliceKey: string;
    sliceRow: Record<string, unknown>;
  }> = [
    {
      table: 'weights',
      pk: 'weight_id',
      sliceKey: 'weights',
      sliceRow: {
        weight_id: 'k1',
        date: '2026-05-12',
        weight: 80,
        bodyFat: null,
        ts: 1,
        updated_at: '2026-05-11T00:00:00Z',
      },
    },
    {
      table: 'meals',
      pk: 'meal_id',
      sliceKey: 'meals',
      sliceRow: {
        meal_id: 'k1',
        date: '2026-05-12',
        name: 'x',
        calories: 100,
        protein: 10,
        fiber: 2,
        hunger: null,
        satisfaction: null,
        ts: 1,
        updated_at: '2026-05-11T00:00:00Z',
      },
    },
    {
      table: 'workouts',
      pk: 'workout_id',
      sliceKey: 'workouts',
      sliceRow: {
        workout_id: 'k1',
        date: '2026-05-12',
        type: 'cardio',
        name: 'jog',
        minutes: 30,
        rpe: null,
        notes: '',
        updated_at: '2026-05-11T00:00:00Z',
      },
    },
    {
      table: 'mood',
      pk: 'mood_id',
      sliceKey: 'mood',
      sliceRow: {
        mood_id: 'k1',
        date: '2026-05-12',
        mood: 4,
        energy: null,
        notes: '',
        updated_at: '2026-05-11T00:00:00Z',
      },
    },
    {
      table: 'sleep',
      pk: 'sleep_id',
      sliceKey: 'sleep',
      sliceRow: {
        sleep_id: 'k1',
        date: '2026-05-12',
        hours: 7,
        wakings: 1,
        quality: null,
        notes: '',
        updated_at: '2026-05-11T00:00:00Z',
      },
    },
    {
      table: 'symptoms',
      pk: 'symptom_id',
      sliceKey: 'symptoms',
      sliceRow: {
        symptom_id: 'k1',
        date: '2026-05-12',
        symptom: 'h',
        severity: 2,
        notes: '',
        updated_at: '2026-05-11T00:00:00Z',
      },
    },
    {
      table: 'vials',
      pk: 'vial_id',
      sliceKey: 'vials',
      sliceRow: {
        vial_id: 'k1',
        name: 'x',
        dosesPerVial: 4,
        dosesUsed: 0,
        startDate: '2026-05-12',
        expirationDate: '2026-08-12',
        updated_at: '2026-05-11T00:00:00Z',
      },
    },
  ];

  it.each(cases)(
    'table $table — upsert payload does NOT include updated_at',
    async ({ table, pk, sliceKey, sliceRow }) => {
      resetMocks();
      // Pre-seed the local slice via dynamic key on storeState. The test
      // module's storeState is the same object the mocked useStore returns.
      (storeState as unknown as Record<string, unknown>)[sliceKey] = [sliceRow];
      storeState.pendingOps = [{ table, op: 'upsert', key: 'k1', enqueuedAt: 'now' }];
      wireFromForUpsert();
      const { flushSyncQueue } = await import('./sync');
      await flushSyncQueue();
      const callArgs = mockUpsert.mock.calls[0];
      expect(callArgs).toBeDefined();
      const rows = callArgs![0] as Array<Record<string, unknown>>;
      expect(rows.length).toBeGreaterThan(0);
      for (const row of rows) {
        expect(row).not.toHaveProperty('updated_at');
        expect(row[pk]).toBe('k1');
        expect(row.user_id).toBe('u1');
      }
    },
  );

  it('table supplements — upsert payload does NOT include updated_at', async () => {
    resetMocks();
    (storeState as unknown as Record<string, unknown>).supplements = {
      '2026-05-12': { d3: true },
    };
    storeState.pendingOps = [
      { table: 'supplements', op: 'upsert', key: '2026-05-12:d3', enqueuedAt: 'now' },
    ];
    wireFromForUpsert();
    const { flushSyncQueue } = await import('./sync');
    await flushSyncQueue();
    expect(mockUpsert).toHaveBeenCalled();
    const rows = mockUpsert.mock.calls[0]![0] as Array<Record<string, unknown>>;
    for (const row of rows) {
      expect(row).not.toHaveProperty('updated_at');
      expect(row.user_id).toBe('u1');
      expect(row.date).toBe('2026-05-12');
      expect(row.supplement_name).toBe('d3');
      expect(row.taken).toBe(true);
    }
  });

  it('table settings — upsert payload does NOT include updated_at', async () => {
    resetMocks();
    storeState.pendingOps = [{ table: 'settings', op: 'upsert', key: 'u1', enqueuedAt: 'now' }];
    wireFromForUpsert();
    const { flushSyncQueue } = await import('./sync');
    await flushSyncQueue();
    expect(mockUpsert).toHaveBeenCalled();
    const rows = mockUpsert.mock.calls[0]![0] as Array<Record<string, unknown>>;
    for (const row of rows) {
      expect(row).not.toHaveProperty('updated_at');
      expect(row.user_id).toBe('u1');
      expect(row).toHaveProperty('payload');
    }
  });
});

// ---------------------------------------------------------------------------
// Phase 6 06-03 — unsubscribeAll teardown semantics.
// ---------------------------------------------------------------------------

describe('Phase 6 — unsubscribeAll teardown', () => {
  it('removes injections + every per-table channel and resets the Map', async () => {
    wireChannelSubscribe();
    const sync = await import('./sync');
    sync.subscribeInjections('u1');
    sync.subscribeWeights('u1');
    sync.subscribeMeals('u1');
    mockRemoveChannel.mockResolvedValue(undefined);
    await sync.unsubscribeAll();
    // Injections + 2 mapped tables = 3 removeChannel calls
    expect(mockRemoveChannel).toHaveBeenCalledTimes(3);
    // After teardown, fresh subscribe creates new channels (Map was cleared).
    mockRemoveChannel.mockClear();
    sync.subscribeWeights('u1');
    expect(mockChannel).toHaveBeenCalledWith('weights:u1');
  });
});
