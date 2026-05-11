/**
 * Tests for the Zustand store actions:
 *   - `updateLastAssistant` (Phase 4 Plan 04-02 Task 2 — streaming UX).
 *   - `setSession`, `clearUserDataSlices`, `enqueueOp`, `isSyncEnabled`
 *     (Phase 5 Plan 05-02 Task 2 — D-11, CONF-3, DELEG-2, D-13).
 *
 * NOTE: the `signOut()` action wraps `@/lib/auth` signOut and is exercised
 * indirectly here only by stubbing the auth module; the wrapper's args
 * (scope:'local') are regression-tested in src/lib/auth.test.ts.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Injection, PendingOp } from '@/types';
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
