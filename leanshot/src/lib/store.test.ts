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
    const ids = useStore.getState().injections.map((i) => i.log_id).sort();
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
    localStorage.clear();
    __resetActiveNamespaceForTests();
    useStore.setState({ ...initialState, currentTab: 'home', toast: null });
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
    expect(
      persistedC.state.injections.find((i: Injection) => i.log_id === 'log-1'),
    ).toBeDefined();
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
