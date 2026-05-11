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

describe('mergeServerInjections + applyRealtimePayload stubs (05-03 will replace)', () => {
  it('mergeServerInjections is callable and does not throw', () => {
    expect(() => useStore.getState().mergeServerInjections([] as Injection[])).not.toThrow();
  });
  it('applyRealtimePayload is callable and does not throw', () => {
    expect(() => useStore.getState().applyRealtimePayload({})).not.toThrow();
  });
});
