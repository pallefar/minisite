/**
 * Phase 5 Plan 05-02 Task 4 — unit tests for auth-migration helpers.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import type { Injection } from '@/types';
import {
  _resetLastWasAnonForTests,
  enqueueLocalInjectionsForSync,
  runAnonPromotionMigrationIfNeeded,
  setLastWasAnon,
} from './auth-migration';
import { useStore } from './store';

function inj(logId: string): Injection {
  return {
    log_id: logId,
    datetime: '2026-04-01T10:00:00Z',
    dose: '1',
    unit: 'mg',
    site: null,
    notes: '',
    pkEngineVersion: 1,
  };
}

describe('enqueueLocalInjectionsForSync', () => {
  beforeEach(() => {
    useStore.setState({ injections: [], pendingOps: [] });
  });

  it('enqueues every local injection exactly once (idempotent)', () => {
    useStore.setState({
      injections: [inj('l1'), inj('l2'), inj('l3')],
      pendingOps: [],
    });
    enqueueLocalInjectionsForSync();
    let ops = useStore.getState().pendingOps ?? [];
    expect(ops).toHaveLength(3);
    expect(ops.map((o) => o.key).sort()).toEqual(['l1', 'l2', 'l3']);
    // Second call must not duplicate.
    enqueueLocalInjectionsForSync();
    ops = useStore.getState().pendingOps ?? [];
    expect(ops).toHaveLength(3);
  });

  it('no-op when injections is empty', () => {
    enqueueLocalInjectionsForSync();
    expect(useStore.getState().pendingOps).toEqual([]);
  });
});

describe('runAnonPromotionMigrationIfNeeded', () => {
  beforeEach(() => {
    _resetLastWasAnonForTests();
    useStore.setState({ toast: null });
  });

  it('fires the toast when lastWasAnon=true', async () => {
    setLastWasAnon(true);
    await runAnonPromotionMigrationIfNeeded('u-1');
    expect(useStore.getState().toast?.message).toMatch(/your AI chat history is saved/i);
  });

  it('silent when lastWasAnon=false', async () => {
    setLastWasAnon(false);
    await runAnonPromotionMigrationIfNeeded('u-1');
    expect(useStore.getState().toast).toBeNull();
  });

  it('does not re-toast on repeated invocation (lastWasAnon consumed)', async () => {
    setLastWasAnon(true);
    await runAnonPromotionMigrationIfNeeded('u-1');
    useStore.setState({ toast: null });
    await runAnonPromotionMigrationIfNeeded('u-1');
    expect(useStore.getState().toast).toBeNull();
  });

  it('silent when userId is empty', async () => {
    setLastWasAnon(true);
    await runAnonPromotionMigrationIfNeeded('');
    expect(useStore.getState().toast).toBeNull();
  });
});
