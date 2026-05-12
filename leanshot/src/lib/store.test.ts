/**
 * Tests for the Zustand store actions:
 *   - `updateLastAssistant` (Phase 4 Plan 04-02 Task 2 — streaming UX).
 *   - `setSession`, `clearUserDataSlices`, `enqueueOp`, `isSyncEnabled`
 *     (Phase 5 Plan 05-02 Task 2 — D-11, CONF-3, DELEG-2, D-13).
 *   - Plan 05-05 — per-user storage adapter G2 closure (multi-account
 *     regression M1, Realtime INSERT routing M2, anon-only M3, anon-promotion
 *     ordering contract M4).
 *
 * NOTE: the `signOut()` action wraps `@/lib/auth` signOut and is exercised
 * indirectly here only by stubbing the auth module; the wrapper's args
 * (scope:'local') are regression-tested in src/lib/auth.test.ts.
 */
import type { RealtimePostgresChangesPayload } from '@supabase/supabase-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Injection, PendingOp } from '@/types';
import {
  __resetActiveNamespaceForTests,
  initialState,
  namespacedKey,
  removeUserNamespace,
  renameStorageNamespace,
  setActiveStorageUserId,
  STORAGE_KEY,
  STORAGE_VERSION,
} from './storage';
import { useStore } from './store';

// ---------------------------------------------------------------------------
// Phase 6 Plan 06-01 Task 3 — showToast `durationMs?: number` extension.
// UI-CHECK N4: 06-05's conflict toast needs to override the default 2400ms;
// store shape gains an optional `durationMs` field and the action signature
// gains an optional 3rd arg. Back-compat: 2-arg / 1-arg callers unchanged.
// ---------------------------------------------------------------------------

describe('showToast — Phase 6 durationMs extension', () => {
  beforeEach(() => {
    useStore.setState({ toast: null });
  });

  it('Test 1: showToast accepts durationMs and writes it into state', () => {
    useStore.getState().showToast('hi', 'info', 5000);
    const t = useStore.getState().toast!;
    expect(t.durationMs).toBe(5000);
    expect(t.message).toBe('hi');
    expect(t.kind).toBe('info');
  });

  it('Test 2: showToast without durationMs keeps durationMs undefined (back-compat)', () => {
    useStore.getState().showToast('hi');
    const t = useStore.getState().toast!;
    expect(t.durationMs).toBeUndefined();
    expect(t.message).toBe('hi');
    expect(t.kind).toBe('success'); // default kind preserved
  });

  it('Test 3: showToast(message, kind) — positional 2-arg back-compat', () => {
    useStore.getState().showToast('boom', 'error');
    const t = useStore.getState().toast!;
    expect(t.durationMs).toBeUndefined();
    expect(t.kind).toBe('error');
  });
});

describe('updateLastAssistant', () => {
  beforeEach(() => {
    useStore.setState({ aiHistory: [] });
  });

  it('appends delta to last assistant message', () => {
    useStore.setState({
      aiHistory: [
        { role: 'user', content: 'hi' },
        { role: 'assistant', content: 'Hel' },
      ],
    });
    useStore.getState().updateLastAssistant('lo');
    const history = useStore.getState().aiHistory;
    expect(history[history.length - 1]).toEqual({ role: 'assistant', content: 'Hello' });
  });

  it('no-ops when last message is a user message', () => {
    useStore.setState({
      aiHistory: [
        { role: 'assistant', content: 'Hi' },
        { role: 'user', content: 'next?' },
      ],
    });
    useStore.getState().updateLastAssistant('xx');
    const history = useStore.getState().aiHistory;
    expect(history[history.length - 1]).toEqual({ role: 'user', content: 'next?' });
  });

  it('no-ops on empty history', () => {
    useStore.setState({ aiHistory: [] });
    useStore.getState().updateLastAssistant('xx');
    expect(useStore.getState().aiHistory).toEqual([]);
  });

  it('preserves other messages (does not mutate earlier history)', () => {
    useStore.setState({
      aiHistory: [
        { role: 'user', content: 'hi' },
        { role: 'assistant', content: 'one' },
        { role: 'user', content: 'more' },
        { role: 'assistant', content: 'two' },
      ],
    });
    useStore.getState().updateLastAssistant(' more');
    const history = useStore.getState().aiHistory;
    expect(history).toHaveLength(4);
    expect(history[0]).toEqual({ role: 'user', content: 'hi' });
    expect(history[1]).toEqual({ role: 'assistant', content: 'one' });
    expect(history[2]).toEqual({ role: 'user', content: 'more' });
    expect(history[3]).toEqual({ role: 'assistant', content: 'two more' });
  });
});

// ---------------------------------------------------------------------------
// Phase 5 Plan 05-02 Task 2 — auth/session slice + clearUserDataSlices + sync gate.
// ---------------------------------------------------------------------------

describe('setSession', () => {
  beforeEach(() => {
    useStore.setState({ signedIn: null });
  });

  it('null session clears signedIn', () => {
    useStore.setState({
      signedIn: { user: { id: 'u1' } as never, session: null as never, verified: true },
    });
    useStore.getState().setSession(null);
    expect(useStore.getState().signedIn).toBeNull();
  });

  it('permanent user with confirmed email → verified=true', () => {
    const session = {
      user: { id: 'u1', is_anonymous: false, email_confirmed_at: '2026-05-11T00:00:00Z' },
    } as never;
    useStore.getState().setSession(session);
    const s = useStore.getState().signedIn!;
    expect(s.verified).toBe(true);
    expect(s.user).toEqual(
      expect.objectContaining({ id: 'u1', email_confirmed_at: '2026-05-11T00:00:00Z' }),
    );
  });

  it('permanent user without confirmed email → verified=false', () => {
    const session = {
      user: { id: 'u1', is_anonymous: false, email_confirmed_at: null },
    } as never;
    useStore.getState().setSession(session);
    expect(useStore.getState().signedIn!.verified).toBe(false);
  });

  it('anonymous user → verified=false even if email_confirmed_at present', () => {
    const session = {
      user: { id: 'anon', is_anonymous: true, email_confirmed_at: '2026-05-11T00:00:00Z' },
    } as never;
    useStore.getState().setSession(session);
    expect(useStore.getState().signedIn!.verified).toBe(false);
  });
});

describe('clearUserDataSlices', () => {
  it('resets user-data slices but preserves acknowledgedDisclaimer (CONF-3 regression guard)', () => {
    useStore.setState({
      user: { name: 'X' } as never,
      injections: [{ log_id: 'l1', datetime: 'd', dose: '1', unit: 'mg', site: null, notes: '' }],
      aiHistory: [{ role: 'user', content: 'hi' }],
      pendingOps: [{ table: 'injections', op: 'upsert', key: 'l1', enqueuedAt: 'now' }],
      acknowledgedDisclaimer: 'v1',
      signedIn: { user: { id: 'u1' } as never, session: null as never, verified: true },
    });
    useStore.getState().clearUserDataSlices();
    const s = useStore.getState();
    expect(s.user).toBeNull();
    expect(s.injections).toEqual([]);
    expect(s.aiHistory).toEqual([]);
    expect(s.pendingOps).toEqual([]);
    expect(s.signedIn).toBeNull();
    // CONF-3: device-level preference MUST survive sign-out.
    expect(s.acknowledgedDisclaimer).toBe('v1');
  });
});

describe('enqueueOp idempotency', () => {
  beforeEach(() => {
    useStore.setState({ pendingOps: [] });
  });

  it('appends a fresh entry', () => {
    const op: PendingOp = {
      table: 'injections',
      op: 'upsert',
      key: 'l1',
      enqueuedAt: 'now',
    };
    useStore.getState().enqueueOp(op);
    expect(useStore.getState().pendingOps).toEqual([op]);
  });

  it('does not duplicate same (table, op, key) — idempotent for upserts', () => {
    const op: PendingOp = {
      table: 'injections',
      op: 'upsert',
      key: 'l1',
      enqueuedAt: 'now',
    };
    useStore.getState().enqueueOp(op);
    useStore.getState().enqueueOp({ ...op, enqueuedAt: 'later' });
    expect(useStore.getState().pendingOps).toHaveLength(1);
  });

  it('allows distinct keys for the same table', () => {
    useStore.getState().enqueueOp({
      table: 'injections',
      op: 'upsert',
      key: 'l1',
      enqueuedAt: 'now',
    });
    useStore.getState().enqueueOp({
      table: 'injections',
      op: 'upsert',
      key: 'l2',
      enqueuedAt: 'now',
    });
    expect(useStore.getState().pendingOps).toHaveLength(2);
  });
});

describe('isSyncEnabled (D-13 gate)', () => {
  let onLineSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    onLineSpy = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
  });
  afterEach(() => {
    onLineSpy.mockRestore();
  });

  it('false when signedIn is null', () => {
    useStore.setState({ signedIn: null });
    expect(useStore.getState().isSyncEnabled()).toBe(false);
  });

  it('false when verified=false', () => {
    useStore.setState({
      signedIn: { user: { id: 'u1' } as never, session: null as never, verified: false },
    });
    expect(useStore.getState().isSyncEnabled()).toBe(false);
  });

  it('false when offline (navigator.onLine=false) even if verified', () => {
    onLineSpy.mockReturnValue(false);
    useStore.setState({
      signedIn: { user: { id: 'u1' } as never, session: null as never, verified: true },
    });
    expect(useStore.getState().isSyncEnabled()).toBe(false);
  });

  it('true when verified AND online', () => {
    useStore.setState({
      signedIn: { user: { id: 'u1' } as never, session: null as never, verified: true },
    });
    expect(useStore.getState().isSyncEnabled()).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Phase 5 Plan 05-03 Task 2 — LWW merge + Realtime payload handler + offline
// queue wiring on addInjection/editInjection/removeInjection + dropOps.
// ---------------------------------------------------------------------------

// Auto-mock sync.ts so addInjection's fire-and-forget flushSyncQueue() does
// not network. (vi.mock hoists to top of file.)
vi.mock('@/lib/sync', () => ({
  flushSyncQueue: vi.fn().mockResolvedValue(undefined),
}));

describe('mergeServerInjections LWW (D-08)', () => {
  beforeEach(() => {
    useStore.setState({ injections: [] });
  });

  it('appends server-only rows when local is empty', () => {
    const server: Injection = {
      log_id: 'sA',
      datetime: '2026-05-11T00:00:00Z',
      dose: '0.5',
      unit: 'mg',
      site: null,
      notes: '',
      updated_at: '2026-05-11T00:00:00Z',
    };
    useStore.getState().mergeServerInjections([server]);
    const s = useStore.getState().injections;
    expect(s).toHaveLength(1);
    expect(s[0]!.log_id).toBe('sA');
  });

  it('overwrites local when server.updated_at > local.updated_at', () => {
    useStore.setState({
      injections: [
        {
          log_id: 'r1',
          datetime: '2026-05-10T00:00:00Z',
          dose: '0.5',
          unit: 'mg',
          site: null,
          notes: 'old',
          updated_at: '2026-05-10T00:00:00Z',
        },
      ],
    });
    useStore.getState().mergeServerInjections([
      {
        log_id: 'r1',
        datetime: '2026-05-10T00:00:00Z',
        dose: '0.5',
        unit: 'mg',
        site: null,
        notes: 'newer-server-note',
        updated_at: '2026-05-11T00:00:00Z',
      },
    ]);
    const s = useStore.getState().injections;
    expect(s).toHaveLength(1);
    expect(s[0]!.notes).toBe('newer-server-note');
    expect(s[0]!.updated_at).toBe('2026-05-11T00:00:00Z');
  });

  it('keeps local when local.updated_at > server.updated_at (reverse-LWW)', () => {
    useStore.setState({
      injections: [
        {
          log_id: 'r2',
          datetime: '2026-05-12T00:00:00Z',
          dose: '0.5',
          unit: 'mg',
          site: null,
          notes: 'local-newer',
          updated_at: '2026-05-12T00:00:00Z',
        },
      ],
    });
    useStore.getState().mergeServerInjections([
      {
        log_id: 'r2',
        datetime: '2026-05-10T00:00:00Z',
        dose: '0.5',
        unit: 'mg',
        site: null,
        notes: 'older-server',
        updated_at: '2026-05-10T00:00:00Z',
      },
    ]);
    const s = useStore.getState().injections;
    expect(s[0]!.notes).toBe('local-newer');
  });

  it('preserves local-only rows when server returns a disjoint set', () => {
    useStore.setState({
      injections: [
        {
          log_id: 'local-only',
          datetime: '2026-05-12T00:00:00Z',
          dose: '0.5',
          unit: 'mg',
          site: null,
          notes: '',
        },
      ],
    });
    useStore.getState().mergeServerInjections([
      {
        log_id: 'server-only',
        datetime: '2026-05-11T00:00:00Z',
        dose: '0.5',
        unit: 'mg',
        site: null,
        notes: '',
        updated_at: '2026-05-11T00:00:00Z',
      },
    ]);
    const ids = useStore
      .getState()
      .injections.map((i) => i.log_id)
      .sort();
    expect(ids).toEqual(['local-only', 'server-only']);
  });
});

describe('applyRealtimePayload', () => {
  beforeEach(() => {
    useStore.setState({ injections: [] });
  });

  it('INSERT for new log_id → appended', () => {
    useStore.getState().applyRealtimePayload({
      eventType: 'INSERT',
      new: {
        log_id: 'rt1',
        datetime: '2026-05-12T00:00:00Z',
        dose: '0.5',
        unit: 'mg',
        site: null,
        notes: '',
        updated_at: '2026-05-12T00:00:00Z',
      },
      old: {},
    });
    const s = useStore.getState().injections;
    expect(s).toHaveLength(1);
    expect(s[0]!.log_id).toBe('rt1');
  });

  it('UPDATE with later updated_at → replaced', () => {
    useStore.setState({
      injections: [
        {
          log_id: 'rt1',
          datetime: '2026-05-12T00:00:00Z',
          dose: '0.5',
          unit: 'mg',
          site: null,
          notes: 'old',
          updated_at: '2026-05-10T00:00:00Z',
        },
      ],
    });
    useStore.getState().applyRealtimePayload({
      eventType: 'UPDATE',
      new: {
        log_id: 'rt1',
        datetime: '2026-05-12T00:00:00Z',
        dose: '0.5',
        unit: 'mg',
        site: null,
        notes: 'newer',
        updated_at: '2026-05-11T00:00:00Z',
      },
      old: { log_id: 'rt1' },
    });
    const s = useStore.getState().injections;
    expect(s[0]!.notes).toBe('newer');
  });

  it('UPDATE with EARLIER updated_at → ignored (local kept)', () => {
    useStore.setState({
      injections: [
        {
          log_id: 'rt1',
          datetime: '2026-05-12T00:00:00Z',
          dose: '0.5',
          unit: 'mg',
          site: null,
          notes: 'local-newer',
          updated_at: '2026-05-12T00:00:00Z',
        },
      ],
    });
    useStore.getState().applyRealtimePayload({
      eventType: 'UPDATE',
      new: {
        log_id: 'rt1',
        datetime: '2026-05-12T00:00:00Z',
        dose: '0.5',
        unit: 'mg',
        site: null,
        notes: 'older-remote',
        updated_at: '2026-05-10T00:00:00Z',
      },
      old: { log_id: 'rt1' },
    });
    expect(useStore.getState().injections[0]!.notes).toBe('local-newer');
  });

  it('DELETE → row removed by log_id', () => {
    useStore.setState({
      injections: [
        {
          log_id: 'rt1',
          datetime: '2026-05-12T00:00:00Z',
          dose: '0.5',
          unit: 'mg',
          site: null,
          notes: '',
        },
        {
          log_id: 'rt2',
          datetime: '2026-05-11T00:00:00Z',
          dose: '0.25',
          unit: 'mg',
          site: null,
          notes: '',
        },
      ],
    });
    useStore.getState().applyRealtimePayload({
      eventType: 'DELETE',
      new: {},
      old: { log_id: 'rt1' },
    });
    const s = useStore.getState().injections;
    expect(s).toHaveLength(1);
    expect(s[0]!.log_id).toBe('rt2');
  });
});

describe('addInjection wires pendingOps + flushSyncQueue', () => {
  beforeEach(() => {
    useStore.setState({ injections: [], pendingOps: [], vials: [] });
  });

  it('enqueues a pendingOps upsert entry for the new log_id', () => {
    useStore.getState().addInjection({
      datetime: '2026-05-12T00:00:00Z',
      dose: '0.5',
      unit: 'mg',
      site: null,
      notes: '',
    } as never);
    const ops = useStore.getState().pendingOps;
    expect(ops).toHaveLength(1);
    expect(ops[0]!.table).toBe('injections');
    expect(ops[0]!.op).toBe('upsert');
    // The key equals the log_id auto-stamped by addInjection.
    const created = useStore.getState().injections[0]!;
    expect(ops[0]!.key).toBe(created.log_id);
  });
});

describe('editInjection wires pendingOps upsert', () => {
  beforeEach(() => {
    useStore.setState({
      injections: [
        {
          log_id: 'edit-1',
          datetime: '2026-05-12T00:00:00Z',
          dose: '0.5',
          unit: 'mg',
          site: null,
          notes: 'before',
        },
      ],
      pendingOps: [],
    });
  });

  it('mutates the row in place and enqueues an upsert op', () => {
    useStore.getState().editInjection('edit-1', { notes: 'after' });
    const inj = useStore.getState().injections.find((i) => i.log_id === 'edit-1');
    expect(inj?.notes).toBe('after');
    const ops = useStore.getState().pendingOps;
    expect(ops).toHaveLength(1);
    expect(ops[0]!.op).toBe('upsert');
    expect(ops[0]!.key).toBe('edit-1');
  });
});

describe('removeInjection wires pendingOps delete', () => {
  beforeEach(() => {
    useStore.setState({
      injections: [
        {
          log_id: 'rm-1',
          datetime: '2026-05-12T00:00:00Z',
          dose: '0.5',
          unit: 'mg',
          site: null,
          notes: '',
        },
      ],
      pendingOps: [],
    });
  });

  it('removes the row by index AND enqueues a delete op with the row log_id', () => {
    useStore.getState().removeInjection(0);
    expect(useStore.getState().injections).toEqual([]);
    const ops = useStore.getState().pendingOps;
    expect(ops).toHaveLength(1);
    expect(ops[0]!.op).toBe('delete');
    expect(ops[0]!.key).toBe('rm-1');
    expect(ops[0]!.table).toBe('injections');
  });
});

describe('dropOps', () => {
  it('removes matching injection pendingOps by key', () => {
    useStore.setState({
      pendingOps: [
        { table: 'injections', op: 'upsert', key: 'l1', enqueuedAt: 'now' },
        { table: 'injections', op: 'upsert', key: 'l2', enqueuedAt: 'now' },
        { table: 'injections', op: 'delete', key: 'l3', enqueuedAt: 'now' },
      ],
    });
    useStore.getState().dropOps(['l1', 'l3']);
    const remaining = useStore.getState().pendingOps;
    expect(remaining).toHaveLength(1);
    expect(remaining[0]!.key).toBe('l2');
  });
});

// ---------------------------------------------------------------------------
// Plan 05-05 — per-user storage adapter (G2 closure / T-05-03 re-mitigation).
//
// These tests drive the production code path that fires on Supabase
// onAuthStateChange (SIGNED_IN → setActiveStorageUserId(userId) BEFORE
// renameStorageNamespace(userId)). No mocks of @/lib/storage exports — the
// real adapter is exercised so a future refactor that swaps the call order
// fails M4 immediately.
// ---------------------------------------------------------------------------

describe('Plan 05-05 — per-user storage adapter (G2 closure)', () => {
  beforeEach(() => {
    // Order matters: reset the store FIRST (this fires a persist write to
    // the universal key while activeNamespaceKey is still whatever the prior
    // test left it), THEN reset the namespace cache, THEN clear localStorage
    // so the test starts with both an empty store AND an empty localStorage.
    useStore.setState({ ...initialState, currentTab: 'home', toast: null });
    __resetActiveNamespaceForTests();
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
    __resetActiveNamespaceForTests();
  });

  it('M1: multi-account regression — A signs in, logs 3, signs out → B sees zero', async () => {
    const userA = 'user-a-00000000-0000-0000-0000-000000000001';
    const userB = 'user-b-00000000-0000-0000-0000-000000000002';

    // Account A signs in: setActiveStorageUserId then writes.
    await setActiveStorageUserId(userA);
    useStore.getState().addInjection({
      datetime: '2026-05-10T10:00:00Z',
      dose: '0.5',
      unit: 'mg',
      site: 'thigh-l',
      notes: '',
    } as unknown as Injection);
    useStore.getState().addInjection({
      datetime: '2026-05-10T11:00:00Z',
      dose: '0.5',
      unit: 'mg',
      site: 'thigh-r',
      notes: '',
    } as unknown as Injection);
    useStore.getState().addInjection({
      datetime: '2026-05-10T12:00:00Z',
      dose: '0.5',
      unit: 'mg',
      site: 'abdomen-ul',
      notes: '',
    } as unknown as Injection);

    expect(useStore.getState().injections.length).toBe(3);
    const keyA = await namespacedKey(userA);
    const persistedA = JSON.parse(localStorage.getItem(keyA)!);
    expect(persistedA.state.injections.length).toBe(3);

    // SIGNED_OUT: real App.tsx wiring sequence.
    useStore.getState().clearUserDataSlices();
    await setActiveStorageUserId(null);
    await removeUserNamespace(userA);
    expect(localStorage.getItem(keyA)).toBeNull();

    // Account B signs in.
    await setActiveStorageUserId(userB);
    expect(useStore.getState().injections.length).toBe(0); // THE proof: no leak.
  });

  it('M2: Realtime INSERT lands in namespaced key, not universal', async () => {
    const userC = 'user-c-uuid';
    await setActiveStorageUserId(userC);
    const keyC = await namespacedKey(userC);

    useStore.getState().applyRealtimePayload({
      eventType: 'INSERT',
      new: {
        log_id: 'log-1',
        user_id: userC,
        datetime: '2026-05-11T10:00:00Z',
        dose: '2.5',
        unit: 'mg',
        site: 'thigh-r',
        notes: '',
        updated_at: '2026-05-11T10:00:00Z',
      } as Injection,
      old: {},
      schema: 'public',
      table: 'injections',
      commit_timestamp: '2026-05-11T10:00:00Z',
      errors: null,
    } as unknown as RealtimePostgresChangesPayload<Injection>);

    const persistedC = JSON.parse(localStorage.getItem(keyC)!);
    expect(persistedC.state.injections.find((i: Injection) => i.log_id === 'log-1')).toBeDefined();
    // Universal key MUST NOT have received the write.
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it('M3: anon writes still land in universal STORAGE_KEY (no regression)', () => {
    // No setActiveStorageUserId call → activeNamespaceKey stays null.
    useStore.getState().addInjection({
      datetime: '2026-05-09T10:00:00Z',
      dose: '0.5',
      unit: 'mg',
      site: null,
      notes: '',
    } as unknown as Injection);

    const persisted = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
    expect(persisted.state.injections.length).toBe(1);
  });

  it('M4: anon-promotion preserves anon-era injections AND locks ordering contract', async () => {
    // Setup: seed the universal `leanshot_v4` key with a complete v7-shaped blob
    // containing 1 anon-era injection.
    const anonLogId = '00000000-anon-era-injection-0001';
    const seededBlob = {
      state: {
        ...initialState,
        pendingOps: [],
        injections: [
          {
            log_id: anonLogId,
            datetime: '2026-05-09T10:00:00Z',
            dose: '0.5',
            unit: 'mg',
            site: 'thigh-l',
            notes: '',
            pkEngineVersion: 1,
          } satisfies Injection,
        ],
      },
      version: STORAGE_VERSION,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(seededBlob));

    // Act: invoke the production sequence (setActiveStorageUserId BEFORE renameStorageNamespace).
    const promotedUserId = '00000000-0000-0000-0000-anon-promoted-1';
    await setActiveStorageUserId(promotedUserId);
    await renameStorageNamespace(promotedUserId);

    // Assert 1: namespaced key contains the seeded anon-era injection.
    const hashedKey = await namespacedKey(promotedUserId);
    const namespacedBlob = JSON.parse(localStorage.getItem(hashedKey)!);
    expect(namespacedBlob.state.injections.length).toBe(1);
    expect(namespacedBlob.state.injections[0].log_id).toBe(anonLogId);

    // Assert 2: universal key was cleared by renameStorageNamespace.
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();

    // Assert 3: subsequent persist write lands in the NAMESPACED key, not universal.
    // First hydrate the store from the namespaced snapshot so injections.length is 1
    // (renameStorageNamespace moved bytes but the store's in-memory state is still
    // initialState from beforeEach — drive it directly via setState to mirror the
    // hydration step that persist.rehydrate() would perform in App.tsx).
    useStore.setState({
      injections: namespacedBlob.state.injections,
    });
    expect(useStore.getState().injections.length).toBe(1);

    useStore.getState().addInjection({
      datetime: '2026-05-12T08:00:00Z',
      dose: '1.0',
      unit: 'mg',
      site: 'thigh-r',
      notes: 'post-promotion write',
    } as unknown as Injection);

    const afterWrite = JSON.parse(localStorage.getItem(hashedKey)!);
    expect(afterWrite.state.injections.length).toBe(2);
    // Universal key must still be empty — proves the persist write went through
    // the namespaced route (i.e. setActiveStorageUserId ran BEFORE
    // renameStorageNamespace AND the adapter routed correctly).
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it('CONF-2 regression: clearUserDataSlices preserves acknowledgedDisclaimer', () => {
    useStore.setState({
      acknowledgedDisclaimer: 'v1',
      injections: [
        {
          log_id: 'l1',
          datetime: '2026-05-10T10:00:00Z',
          dose: '1',
          unit: 'mg',
          site: null,
          notes: '',
        },
      ],
    });
    useStore.getState().clearUserDataSlices();
    // CONF-2: device-level acknowledgment survives sign-out.
    expect(useStore.getState().acknowledgedDisclaimer).toBe('v1');
    expect(useStore.getState().injections).toEqual([]);
  });

  it('CONF-3 regression: signedIn slice is not persisted by partialize', async () => {
    const userId = 'conf3-user-id';
    await setActiveStorageUserId(userId);
    useStore.setState({
      signedIn: {
        user: { id: userId } as never,
        session: null as never,
        verified: true,
      },
      // Force a write through persist by also setting a persisted slice.
      injections: [
        {
          log_id: 'conf3-log',
          datetime: '2026-05-12T00:00:00Z',
          dose: '1',
          unit: 'mg',
          site: null,
          notes: '',
        },
      ],
    });
    const key = await namespacedKey(userId);
    // Persist flushes synchronously on setState in jsdom.
    const raw = localStorage.getItem(key);
    expect(raw).not.toBeNull();
    const blob = JSON.parse(raw!);
    // CONF-3: signedIn is NOT in the persisted snapshot (partialize allow-list excludes it).
    expect(blob.state.signedIn).toBeUndefined();
    expect(blob.state.injections).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Phase 6 Plan 06-02 — migration_state slice + actions + partialize coverage.
//
// Six tests covering the migration_state slice surface introduced by the
// migration state machine in @/lib/migration:
//   1. setMigrationState writes the slice
//   2. markMigrationEntity mutates only the specified entity
//   3. markMigrationComplete sets complete: true
//   4. setMigrationError sets the flag
//   5. clearUserDataSlices resets both migration_state and migrationError to null
//   6. partialize allow-list includes migration_state but NOT migrationError
// ---------------------------------------------------------------------------

describe('Phase 6 — migration_state slice actions', () => {
  beforeEach(() => {
    useStore.setState({
      ...initialState,
      pendingOps: [],
      migration_state: null,
      migrationError: null,
      currentTab: 'home',
      toast: null,
      signedIn: null,
    });
    __resetActiveNamespaceForTests();
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
    __resetActiveNamespaceForTests();
  });

  it('setMigrationState writes the slice', () => {
    const next = {
      startedAt: '2026-05-12T00:00:00Z',
      complete: false,
      snapshotKey: 'leanshot_v4_pre_cloud_backup',
      injections: 'pending' as const,
    };
    useStore.getState().setMigrationState(next);
    expect(useStore.getState().migration_state).toEqual(next);
    // null clears it.
    useStore.getState().setMigrationState(null);
    expect(useStore.getState().migration_state).toBeNull();
  });

  it('markMigrationEntity mutates only the specified entity', () => {
    useStore.getState().setMigrationState({
      startedAt: '2026-05-12T00:00:00Z',
      complete: false,
      snapshotKey: 'leanshot_v4_pre_cloud_backup',
      injections: 'pending',
      weights: 'pending',
    });
    useStore.getState().markMigrationEntity('weights', 'complete');
    const state = useStore.getState().migration_state!;
    expect(state.weights).toBe('complete');
    expect(state.injections).toBe('pending'); // untouched
  });

  it('markMigrationEntity is a no-op when migration_state is null', () => {
    expect(useStore.getState().migration_state).toBeNull();
    useStore.getState().markMigrationEntity('injections', 'complete');
    // Still null — no slice to mutate.
    expect(useStore.getState().migration_state).toBeNull();
  });

  it('markMigrationComplete sets complete: true', () => {
    useStore.getState().setMigrationState({
      startedAt: '2026-05-12T00:00:00Z',
      complete: false,
      snapshotKey: 'leanshot_v4_pre_cloud_backup',
    });
    useStore.getState().markMigrationComplete();
    expect(useStore.getState().migration_state?.complete).toBe(true);
  });

  it('setMigrationError sets and clears the corruption flag', () => {
    useStore.getState().setMigrationError('corrupted');
    expect(useStore.getState().migrationError).toBe('corrupted');
    useStore.getState().setMigrationError(null);
    expect(useStore.getState().migrationError).toBeNull();
  });

  it('clearUserDataSlices resets migration_state AND migrationError to null', () => {
    useStore.setState({
      migration_state: {
        startedAt: '2026-05-12T00:00:00Z',
        complete: true,
        snapshotKey: 'leanshot_v4_pre_cloud_backup',
      },
      migrationError: 'corrupted',
      acknowledgedDisclaimer: 'v1',
    });
    useStore.getState().clearUserDataSlices();
    expect(useStore.getState().migration_state).toBeNull();
    expect(useStore.getState().migrationError).toBeNull();
    // CONF-3 still holds: acknowledgedDisclaimer survives.
    expect(useStore.getState().acknowledgedDisclaimer).toBe('v1');
  });

  it('partialize allow-list includes migration_state (survives reload) and excludes migrationError (ephemeral)', async () => {
    const userId = 'phase6-mig-partialize-user';
    await setActiveStorageUserId(userId);
    // Set both slices — only migration_state should land in the persisted blob.
    useStore.setState({
      migration_state: {
        startedAt: '2026-05-12T00:00:00Z',
        complete: false,
        snapshotKey: 'leanshot_v4_pre_cloud_backup',
        injections: 'complete',
      },
      migrationError: 'corrupted',
      // Force a write through persist by setting a persisted slice too.
      injections: [
        {
          log_id: 'partialize-log',
          datetime: '2026-05-12T00:00:00Z',
          dose: '1',
          unit: 'mg',
          site: null,
          notes: '',
        },
      ],
    });
    const key = await namespacedKey(userId);
    const raw = localStorage.getItem(key);
    expect(raw).not.toBeNull();
    const blob = JSON.parse(raw!);
    // migration_state survives reload (D-02 resume contract).
    expect(blob.state.migration_state).toBeDefined();
    expect(blob.state.migration_state.injections).toBe('complete');
    // migrationError is ephemeral — re-derived from corruption detection on next sign-in.
    expect(blob.state.migrationError).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Phase 6 06-03 — per-entity add/edit/remove enqueue contract. Each entity
// mirrors Phase 5's addInjection pattern: stamp <pk>_id if absent + append +
// enqueue a pendingOp keyed by the stamped id.
// ---------------------------------------------------------------------------

describe('Phase 6 06-03 — per-entity actions enqueue pendingOps', () => {
  beforeEach(() => {
    useStore.setState({
      ...initialState,
      pendingOps: [],
      currentTab: 'home',
      toast: null,
      signedIn: { user: { id: 'u-test' }, session: null, verified: true } as never,
    });
  });

  it('addWeight stamps weight_id + enqueues upsert', () => {
    useStore.getState().addWeight({ date: '2026-05-12', weight: 80, bodyFat: null, ts: 1 });
    const s = useStore.getState();
    expect(s.weights).toHaveLength(1);
    const w0 = s.weights[0] as { weight_id?: string };
    expect(w0.weight_id).toMatch(/^[0-9a-f-]{36}$/);
    const op = (s.pendingOps ?? []).find((o) => o.table === 'weights' && o.op === 'upsert');
    expect(op).toBeDefined();
    expect(op!.key).toBe(w0.weight_id);
  });

  it('editWeight enqueues upsert and updates the row', () => {
    useStore.getState().addWeight({ date: '2026-05-12', weight: 80, bodyFat: null, ts: 1 });
    const wid = (useStore.getState().weights[0] as { weight_id: string }).weight_id;
    useStore.getState().editWeight(wid, { weight: 82 });
    expect(useStore.getState().weights[0]!.weight).toBe(82);
    const upserts = (useStore.getState().pendingOps ?? []).filter(
      (o) => o.table === 'weights' && o.op === 'upsert' && o.key === wid,
    );
    expect(upserts).toHaveLength(1); // enqueueOp dedupes by (table, op, key)
  });

  it('removeWeight enqueues delete keyed by weight_id', () => {
    useStore.getState().addWeight({ date: '2026-05-12', weight: 80, bodyFat: null, ts: 1 });
    const wid = (useStore.getState().weights[0] as { weight_id: string }).weight_id;
    useStore.getState().removeWeight(0);
    expect(useStore.getState().weights).toHaveLength(0);
    const op = (useStore.getState().pendingOps ?? []).find(
      (o) => o.table === 'weights' && o.op === 'delete',
    );
    expect(op).toBeDefined();
    expect(op!.key).toBe(wid);
  });

  it('addMeal / editMeal / removeMeal enqueue ops keyed by meal_id', () => {
    useStore.getState().addMeal({
      date: '2026-05-12',
      name: 'x',
      calories: 100,
      protein: 10,
      fiber: 2,
      hunger: null,
      satisfaction: null,
      ts: 1,
    });
    const mid = (useStore.getState().meals[0] as { meal_id: string }).meal_id;
    expect(mid).toMatch(/^[0-9a-f-]{36}$/);
    useStore.getState().editMeal(mid, { calories: 200 });
    expect(useStore.getState().meals[0]!.calories).toBe(200);
    useStore.getState().removeMeal(0);
    const ops = (useStore.getState().pendingOps ?? []).filter((o) => o.table === 'meals');
    expect(ops.some((o) => o.op === 'upsert' && o.key === mid)).toBe(true);
    expect(ops.some((o) => o.op === 'delete' && o.key === mid)).toBe(true);
  });

  it('addWorkout / editWorkout / removeWorkout enqueue ops keyed by workout_id', () => {
    useStore.getState().addWorkout({
      date: '2026-05-12',
      type: 'cardio',
      name: 'jog',
      minutes: 30,
      rpe: null,
      notes: '',
    });
    const wid = (useStore.getState().workouts[0] as { workout_id: string }).workout_id;
    expect(wid).toMatch(/^[0-9a-f-]{36}$/);
    useStore.getState().editWorkout(wid, { minutes: 45 });
    expect(useStore.getState().workouts[0]!.minutes).toBe(45);
    useStore.getState().removeWorkout(0);
    const ops = (useStore.getState().pendingOps ?? []).filter((o) => o.table === 'workouts');
    expect(ops.some((o) => o.op === 'upsert' && o.key === wid)).toBe(true);
    expect(ops.some((o) => o.op === 'delete' && o.key === wid)).toBe(true);
  });

  it('addMood / editMood / removeMood enqueue ops keyed by mood_id', () => {
    useStore.getState().addMood({ date: '2026-05-12', mood: 4, energy: null, notes: '' });
    const mid = (useStore.getState().mood[0] as { mood_id: string }).mood_id;
    expect(mid).toMatch(/^[0-9a-f-]{36}$/);
    useStore.getState().editMood(mid, { mood: 3 });
    expect(useStore.getState().mood[0]!.mood).toBe(3);
    useStore.getState().removeMood(0);
    const ops = (useStore.getState().pendingOps ?? []).filter((o) => o.table === 'mood');
    expect(ops.some((o) => o.op === 'upsert' && o.key === mid)).toBe(true);
    expect(ops.some((o) => o.op === 'delete' && o.key === mid)).toBe(true);
  });

  it('addSleep / editSleep / removeSleep enqueue ops keyed by sleep_id', () => {
    useStore
      .getState()
      .addSleep({ date: '2026-05-12', hours: 7.5, wakings: 1, quality: null, notes: '' });
    const sid = (useStore.getState().sleep[0] as { sleep_id: string }).sleep_id;
    expect(sid).toMatch(/^[0-9a-f-]{36}$/);
    useStore.getState().editSleep(sid, { hours: 8 });
    expect(useStore.getState().sleep[0]!.hours).toBe(8);
    useStore.getState().removeSleep(0);
    const ops = (useStore.getState().pendingOps ?? []).filter((o) => o.table === 'sleep');
    expect(ops.some((o) => o.op === 'upsert' && o.key === sid)).toBe(true);
    expect(ops.some((o) => o.op === 'delete' && o.key === sid)).toBe(true);
  });

  it('addSymptom / editSymptom / removeSymptom enqueue ops keyed by symptom_id', () => {
    useStore.getState().addSymptom({ date: '2026-05-12', symptom: 'h', severity: 2, notes: '' });
    const sid = (useStore.getState().symptoms[0] as { symptom_id: string }).symptom_id;
    expect(sid).toMatch(/^[0-9a-f-]{36}$/);
    useStore.getState().editSymptom(sid, { severity: 4 });
    expect(useStore.getState().symptoms[0]!.severity).toBe(4);
    useStore.getState().removeSymptom(0);
    const ops = (useStore.getState().pendingOps ?? []).filter((o) => o.table === 'symptoms');
    expect(ops.some((o) => o.op === 'upsert' && o.key === sid)).toBe(true);
    expect(ops.some((o) => o.op === 'delete' && o.key === sid)).toBe(true);
  });

  it('addVial / editVial / removeVial enqueue ops keyed by vial_id', () => {
    useStore.getState().addVial({
      name: 'oz 2mg',
      dosesPerVial: 4,
      dosesUsed: 0,
      startDate: '2026-05-12',
      expirationDate: '2026-08-12',
    });
    const vid = (useStore.getState().vials[0] as { vial_id: string }).vial_id;
    expect(vid).toMatch(/^[0-9a-f-]{36}$/);
    useStore.getState().editVial(vid, { dosesUsed: 2 });
    expect(useStore.getState().vials[0]!.dosesUsed).toBe(2);
    useStore.getState().removeVial(0);
    const ops = (useStore.getState().pendingOps ?? []).filter((o) => o.table === 'vials');
    expect(ops.some((o) => o.op === 'upsert' && o.key === vid)).toBe(true);
    expect(ops.some((o) => o.op === 'delete' && o.key === vid)).toBe(true);
  });

  it('toggleSupplement enqueues upsert when taken=true, delete when taken=false', () => {
    useStore.getState().toggleSupplement('2026-05-12', 'd3', true);
    let ops = (useStore.getState().pendingOps ?? []).filter((o) => o.table === 'supplements');
    expect(ops).toHaveLength(1);
    expect(ops[0]!.op).toBe('upsert');
    expect(ops[0]!.key).toBe('2026-05-12:d3');
    useStore.getState().toggleSupplement('2026-05-12', 'd3', false);
    ops = (useStore.getState().pendingOps ?? []).filter((o) => o.table === 'supplements');
    expect(ops.some((o) => o.op === 'delete' && o.key === '2026-05-12:d3')).toBe(true);
  });

  it('setUser enqueues a settings upsert keyed by user_id', () => {
    useStore.getState().setUser({
      name: 'Test',
      units: 'metric',
      medication: 'ozempic',
      dose: '0.5',
      doseUnit: 'mg',
      startDate: '2026-05-12',
      startWeight: 80,
      height: null,
      age: null,
      sex: 'male',
      bodyFat: null,
      goalWeight: 70,
      goal: 'fat-loss',
      proteinTarget: 100,
      calorieTarget: 2000,
      fiberTarget: 30,
      waterTarget: 3000,
      injectionDay: 0,
      activityLevel: 'moderate',
      liftingLevel: 'beginner',
      createdAt: new Date().toISOString(),
    });
    const ops = (useStore.getState().pendingOps ?? []).filter((o) => o.table === 'settings');
    expect(ops).toHaveLength(1);
    expect(ops[0]!.op).toBe('upsert');
    expect(ops[0]!.key).toBe('u-test');
  });
});

// ---------------------------------------------------------------------------
// Phase 6 06-03 — dropOps generalization. Phase 5 callers (no `table` arg)
// still scope to injections; Phase 6 callers pass `table` for per-table
// scoping.
// ---------------------------------------------------------------------------

describe('Phase 6 06-03 — dropOps signature generalization', () => {
  beforeEach(() => {
    useStore.setState({
      ...initialState,
      pendingOps: [],
      currentTab: 'home',
      toast: null,
      signedIn: null,
    });
  });

  it('Phase 5 back-compat: dropOps([keys]) drops injection ops only', () => {
    useStore.setState({
      pendingOps: [
        { table: 'injections', op: 'upsert', key: 'l1', enqueuedAt: 'now' },
        { table: 'weights', op: 'upsert', key: 'l1', enqueuedAt: 'now' },
      ],
    });
    useStore.getState().dropOps(['l1']);
    const remaining = useStore.getState().pendingOps ?? [];
    expect(remaining.find((o) => o.table === 'injections')).toBeUndefined();
    expect(remaining.find((o) => o.table === 'weights' && o.key === 'l1')).toBeDefined();
  });

  it('Phase 6 06-03: dropOps([keys], "weights") drops weights ops only', () => {
    useStore.setState({
      pendingOps: [
        { table: 'injections', op: 'upsert', key: 'l1', enqueuedAt: 'now' },
        { table: 'weights', op: 'upsert', key: 'l1', enqueuedAt: 'now' },
      ],
    });
    useStore.getState().dropOps(['l1'], 'weights');
    const remaining = useStore.getState().pendingOps ?? [];
    expect(remaining.find((o) => o.table === 'injections' && o.key === 'l1')).toBeDefined();
    expect(remaining.find((o) => o.table === 'weights')).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Phase 6 06-03 — per-entity applyRealtimePayload reducers (INSERT/UPDATE/DELETE).
// ---------------------------------------------------------------------------

describe('Phase 6 06-03 — applyXRealtimePayload reducers', () => {
  beforeEach(() => {
    useStore.setState({
      ...initialState,
      pendingOps: [],
      currentTab: 'home',
      toast: null,
      signedIn: null,
    });
  });

  it('applyWeightRealtimePayload INSERT adds a new row keyed by weight_id', () => {
    const payload = {
      eventType: 'INSERT',
      new: {
        weight_id: 'w1',
        date: '2026-05-12',
        weight: 80,
        bodyFat: null,
        ts: 1,
        updated_at: '2026-05-12T00:00:00Z',
      },
      old: {},
    } as unknown as RealtimePostgresChangesPayload<never>;
    useStore.getState().applyWeightRealtimePayload(payload as never);
    expect(useStore.getState().weights).toHaveLength(1);
    expect((useStore.getState().weights[0] as { weight_id: string }).weight_id).toBe('w1');
  });

  it('applyMoodRealtimePayload DELETE removes the row by mood_id', () => {
    useStore.setState({
      mood: [
        { date: '2026-05-12', mood: 4, energy: null, notes: '', mood_id: 'm1' } as never,
        { date: '2026-05-13', mood: 3, energy: null, notes: '', mood_id: 'm2' } as never,
      ],
    });
    const payload = {
      eventType: 'DELETE',
      new: {},
      old: { mood_id: 'm1' },
    } as unknown as RealtimePostgresChangesPayload<never>;
    useStore.getState().applyMoodRealtimePayload(payload as never);
    expect(useStore.getState().mood).toHaveLength(1);
    expect((useStore.getState().mood[0] as { mood_id: string }).mood_id).toBe('m2');
  });

  it('applySettingsRealtimePayload UPDATE merges into user', () => {
    useStore.setState({
      user: {
        name: 'orig',
        units: 'metric',
        medication: 'ozempic',
      } as never,
    });
    const payload = {
      eventType: 'UPDATE',
      new: { payload: { medication: 'mounjaro' } },
      old: {},
    } as unknown as RealtimePostgresChangesPayload<never>;
    useStore.getState().applySettingsRealtimePayload(payload as never);
    expect(useStore.getState().user!.medication).toBe('mounjaro');
    expect(useStore.getState().user!.name).toBe('orig'); // shallow merge preserves other fields
  });
});

// ---------------------------------------------------------------------------
// Phase 6 06-05 D-11 — notifyLwwLoss action + lww-loser toast wiring.
// ---------------------------------------------------------------------------

describe('Phase 6 06-05 — notifyLwwLoss action (lww-loser toast wiring)', () => {
  beforeEach(() => {
    useStore.setState({ toast: null });
  });

  it('notifyLwwLoss fires the info toast with the D-11 copy and 5000ms duration', () => {
    useStore.getState().notifyLwwLoss('weights', 'w-1');
    const t = useStore.getState().toast!;
    expect(t).not.toBeNull();
    expect(t.message).toBe('We kept your most recent edit.');
    expect(t.kind).toBe('info');
    expect(t.durationMs).toBe(5000);
  });

  it('notifyLwwLoss kind is info (NOT error/warning per D-11)', () => {
    useStore.getState().notifyLwwLoss('injections', 'inj-1');
    expect(useStore.getState().toast!.kind).toBe('info');
    expect(useStore.getState().toast!.kind).not.toBe('error');
  });

  it('notifyLwwLoss is idempotent — every call rewrites the toast slice (new id)', () => {
    useStore.getState().notifyLwwLoss('weights', 'w-1');
    const id1 = useStore.getState().toast!.id;
    useStore.getState().notifyLwwLoss('meals', 'm-1');
    const id2 = useStore.getState().toast!.id;
    expect(id2).toBeGreaterThan(id1);
    expect(useStore.getState().toast!.message).toBe('We kept your most recent edit.');
  });
});

// ---------------------------------------------------------------------------
// Phase 6 06-05 D-11 — 10-table parameterized loss-detection wiring.
//
// For each entity reducer, when (a) a local row exists with an older
// updated_at AND (b) a matching pendingOp exists, applying a newer remote
// payload MUST fire the lww-loser toast. Vanilla propagation (no pendingOp)
// MUST NOT fire it.
// ---------------------------------------------------------------------------

describe('Phase 6 06-05 — applyXRealtimePayload wires lww-loser toast across all 10 reducers', () => {
  // Minimal local-row factories so we can populate state[table][0] before the
  // apply call. Each table's reducer reads `local.updated_at` from the matching
  // row; we set it 5 minutes BEFORE the remote payload's timestamp so the
  // server-strictly-newer condition holds.
  const localTs = '2026-05-12T09:00:00Z';
  const remoteTs = '2026-05-12T10:00:00Z';

  type ApplyCase = {
    table: string;
    key: string;
    pkField: string;
    sliceKey: keyof ReturnType<typeof useStore.getState>;
    localRow: Record<string, unknown>;
    remoteRow: Record<string, unknown>;
    apply: (payload: RealtimePostgresChangesPayload<never>) => void;
  };

  const cases: ApplyCase[] = [
    {
      table: 'injections',
      key: 'inj-1',
      pkField: 'log_id',
      sliceKey: 'injections',
      localRow: {
        log_id: 'inj-1',
        datetime: '2026-05-12T08:00:00Z',
        dose: '0.5',
        unit: 'mg',
        site: null,
        notes: '',
        pkEngineVersion: 1,
        updated_at: localTs,
      },
      remoteRow: {
        log_id: 'inj-1',
        datetime: '2026-05-12T08:00:00Z',
        dose: '0.6',
        unit: 'mg',
        site: null,
        notes: '',
        pkEngineVersion: 1,
        updated_at: remoteTs,
      },
      apply: (p) => useStore.getState().applyRealtimePayload(p as never),
    },
    {
      table: 'weights',
      key: 'w-1',
      pkField: 'weight_id',
      sliceKey: 'weights',
      localRow: {
        weight_id: 'w-1',
        date: '2026-05-12',
        weight: 80,
        bodyFat: null,
        ts: 1,
        updated_at: localTs,
      },
      remoteRow: {
        weight_id: 'w-1',
        date: '2026-05-12',
        weight: 81,
        bodyFat: null,
        ts: 1,
        updated_at: remoteTs,
      },
      apply: (p) => useStore.getState().applyWeightRealtimePayload(p as never),
    },
    {
      table: 'meals',
      key: 'm-1',
      pkField: 'meal_id',
      sliceKey: 'meals',
      localRow: {
        meal_id: 'm-1',
        date: '2026-05-12',
        name: 'lunch',
        calories: 500,
        protein: 30,
        fiber: 5,
        hunger: 3,
        satisfaction: 4,
        ts: 1,
        updated_at: localTs,
      },
      remoteRow: {
        meal_id: 'm-1',
        date: '2026-05-12',
        name: 'lunch',
        calories: 600,
        protein: 30,
        fiber: 5,
        hunger: 3,
        satisfaction: 4,
        ts: 1,
        updated_at: remoteTs,
      },
      apply: (p) => useStore.getState().applyMealRealtimePayload(p as never),
    },
    {
      table: 'workouts',
      key: 'wk-1',
      pkField: 'workout_id',
      sliceKey: 'workouts',
      localRow: {
        workout_id: 'wk-1',
        date: '2026-05-12',
        type: 'cardio',
        name: 'run',
        minutes: 30,
        rpe: 6,
        notes: '',
        updated_at: localTs,
      },
      remoteRow: {
        workout_id: 'wk-1',
        date: '2026-05-12',
        type: 'cardio',
        name: 'run',
        minutes: 40,
        rpe: 7,
        notes: '',
        updated_at: remoteTs,
      },
      apply: (p) => useStore.getState().applyWorkoutRealtimePayload(p as never),
    },
    {
      table: 'mood',
      key: 'mo-1',
      pkField: 'mood_id',
      sliceKey: 'mood',
      localRow: {
        mood_id: 'mo-1',
        date: '2026-05-12',
        mood: 4,
        energy: 3,
        notes: '',
        updated_at: localTs,
      },
      remoteRow: {
        mood_id: 'mo-1',
        date: '2026-05-12',
        mood: 5,
        energy: 4,
        notes: '',
        updated_at: remoteTs,
      },
      apply: (p) => useStore.getState().applyMoodRealtimePayload(p as never),
    },
    {
      table: 'sleep',
      key: 'sl-1',
      pkField: 'sleep_id',
      sliceKey: 'sleep',
      localRow: {
        sleep_id: 'sl-1',
        date: '2026-05-12',
        hours: 7,
        wakings: 1,
        quality: 4,
        notes: '',
        updated_at: localTs,
      },
      remoteRow: {
        sleep_id: 'sl-1',
        date: '2026-05-12',
        hours: 8,
        wakings: 0,
        quality: 5,
        notes: '',
        updated_at: remoteTs,
      },
      apply: (p) => useStore.getState().applySleepRealtimePayload(p as never),
    },
    {
      table: 'symptoms',
      key: 'sx-1',
      pkField: 'symptom_id',
      sliceKey: 'symptoms',
      localRow: {
        symptom_id: 'sx-1',
        date: '2026-05-12',
        symptom: 'nausea',
        severity: 2,
        notes: '',
        updated_at: localTs,
      },
      remoteRow: {
        symptom_id: 'sx-1',
        date: '2026-05-12',
        symptom: 'nausea',
        severity: 3,
        notes: '',
        updated_at: remoteTs,
      },
      apply: (p) => useStore.getState().applySymptomRealtimePayload(p as never),
    },
    {
      table: 'vials',
      key: 'v-1',
      pkField: 'vial_id',
      sliceKey: 'vials',
      localRow: {
        vial_id: 'v-1',
        name: 'oz 2mg',
        dosesPerVial: 4,
        dosesUsed: 1,
        startDate: '2026-05-12',
        expirationDate: '2026-08-12',
        updated_at: localTs,
      },
      remoteRow: {
        vial_id: 'v-1',
        name: 'oz 2mg',
        dosesPerVial: 4,
        dosesUsed: 2,
        startDate: '2026-05-12',
        expirationDate: '2026-08-12',
        updated_at: remoteTs,
      },
      apply: (p) => useStore.getState().applyVialRealtimePayload(p as never),
    },
    {
      table: 'photos',
      key: 'ph-1',
      pkField: 'photo_id',
      sliceKey: 'photos',
      localRow: {
        photo_id: 'ph-1',
        date: '2026-05-12',
        weight: null,
        storage_path: 'u1/photos/ph-1.jpg',
        mime_type: 'image/jpeg',
        size_bytes: 1000,
        updated_at: localTs,
      },
      remoteRow: {
        photo_id: 'ph-1',
        date: '2026-05-12',
        weight: 80,
        storage_path: 'u1/photos/ph-1.jpg',
        mime_type: 'image/jpeg',
        size_bytes: 1200,
        updated_at: remoteTs,
      },
      apply: (p) => useStore.getState().applyPhotoRealtimePayload(p as never),
    },
  ];
  // 9 entity-row tables above; supplements uses a composite date:name key and a
  // different state shape (Record<date, Record<name, boolean>>), so it gets
  // its own case using only the pendingOp + payload trigger.

  cases.forEach(({ table, key, sliceKey, localRow, remoteRow, apply }) => {
    it(`apply${table} reducer fires the lww-loser toast when conditions hold`, () => {
      useStore.setState({
        ...initialState,
        pendingOps: [{ table, op: 'upsert', key, enqueuedAt: 'now' }],
        toast: null,
        currentTab: 'home',
        signedIn: null,
        [sliceKey]: [localRow as never],
      } as never);
      const payload = {
        eventType: 'UPDATE',
        new: remoteRow,
        old: {},
      } as unknown as RealtimePostgresChangesPayload<never>;
      apply(payload);
      const t = useStore.getState().toast;
      expect(t).not.toBeNull();
      expect(t!.message).toBe('We kept your most recent edit.');
      expect(t!.kind).toBe('info');
      expect(t!.durationMs).toBe(5000);
    });

    it(`apply${table} reducer does NOT fire the toast on vanilla propagation (no pendingOp)`, () => {
      useStore.setState({
        ...initialState,
        pendingOps: [], // no matching local edit — propagation only
        toast: null,
        currentTab: 'home',
        signedIn: null,
        [sliceKey]: [localRow as never],
      } as never);
      const payload = {
        eventType: 'UPDATE',
        new: remoteRow,
        old: {},
      } as unknown as RealtimePostgresChangesPayload<never>;
      apply(payload);
      expect(useStore.getState().toast).toBeNull();
    });
  });

  it('applySupplementRealtimePayload (10th reducer) does NOT fire on vanilla propagation', () => {
    // Supplements use composite key date:name and no local updated_at;
    // ensure the helper short-circuits on the missing-local-baseline guard.
    useStore.setState({
      ...initialState,
      pendingOps: [],
      toast: null,
      currentTab: 'home',
      signedIn: null,
      supplements: {},
    } as never);
    const payload = {
      eventType: 'INSERT',
      new: {
        date: '2026-05-12',
        supplement_name: 'd3',
        taken: true,
        updated_at: remoteTs,
      },
      old: {},
    } as unknown as RealtimePostgresChangesPayload<never>;
    useStore.getState().applySupplementRealtimePayload(payload as never);
    // Local row was applied (taken=true) but no toast because there's no local
    // baseline timestamp AND no pending op.
    expect(useStore.getState().supplements['2026-05-12']?.['d3']).toBe(true);
    expect(useStore.getState().toast).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Phase 6 06-05 D-11 — local mutations stamp updated_at so the LWW
// comparison in apply reducers has a meaningful local baseline.
// ---------------------------------------------------------------------------

describe('Phase 6 06-05 — addX/editX local mutations stamp updated_at', () => {
  beforeEach(() => {
    useStore.setState({
      ...initialState,
      pendingOps: [],
      toast: null,
      currentTab: 'home',
      signedIn: null,
    });
  });

  it('addInjection stamps updated_at on the new row', () => {
    useStore.getState().addInjection({
      datetime: '2026-05-12T08:00:00Z',
      dose: '0.5',
      unit: 'mg',
      site: 'abdomen-ul',
      notes: '',
      pkEngineVersion: 1,
    });
    const inj = useStore.getState().injections[0]!;
    expect(inj.updated_at).toBeTruthy();
    expect(new Date(inj.updated_at!).getTime()).toBeGreaterThan(0);
  });

  it('editInjection refreshes updated_at on the edited row', async () => {
    useStore.getState().addInjection({
      datetime: '2026-05-12T08:00:00Z',
      dose: '0.5',
      unit: 'mg',
      site: null,
      notes: '',
      pkEngineVersion: 1,
    });
    const originalTs = useStore.getState().injections[0]!.updated_at!;
    const logId = useStore.getState().injections[0]!.log_id!;
    // small delay so timestamps differ at ms granularity
    await new Promise((r) => setTimeout(r, 5));
    useStore.getState().editInjection(logId, { dose: '0.6' });
    const newTs = useStore.getState().injections[0]!.updated_at!;
    expect(new Date(newTs).getTime()).toBeGreaterThanOrEqual(new Date(originalTs).getTime());
  });

  it('addWeight / addMeal / addWorkout / addMood / addSleep / addVial stamp updated_at', () => {
    useStore.getState().addWeight({ date: '2026-05-12', weight: 80, bodyFat: null, ts: 1 });
    useStore.getState().addMeal({
      date: '2026-05-12',
      name: 'lunch',
      calories: 500,
      protein: 30,
      fiber: 5,
      hunger: null,
      satisfaction: null,
      ts: 1,
    });
    useStore.getState().addWorkout({
      date: '2026-05-12',
      type: 'cardio',
      name: 'run',
      minutes: 30,
      rpe: null,
      notes: '',
    });
    useStore
      .getState()
      .addMood({ date: '2026-05-12', mood: 4, energy: null, notes: '' } as never);
    useStore.getState().addSleep({
      date: '2026-05-12',
      hours: 8,
      wakings: 0,
      quality: null,
      notes: '',
    } as never);
    useStore.getState().addVial({
      name: 'oz 2mg',
      dosesPerVial: 4,
      dosesUsed: 0,
      startDate: '2026-05-12',
      expirationDate: '2026-08-12',
    });
    const state = useStore.getState();
    expect((state.weights[0] as { updated_at?: string }).updated_at).toBeTruthy();
    expect((state.meals[0] as { updated_at?: string }).updated_at).toBeTruthy();
    expect((state.workouts[0] as { updated_at?: string }).updated_at).toBeTruthy();
    expect((state.mood[0] as { updated_at?: string }).updated_at).toBeTruthy();
    expect((state.sleep[0] as { updated_at?: string }).updated_at).toBeTruthy();
    expect((state.vials[0] as { updated_at?: string }).updated_at).toBeTruthy();
  });
});
