/**
 * Deno tests for `admin-bulk-job-worker` Edge Function — Phase 27 Plan 27-06.
 *
 * Coverage (5 tests):
 *   T1 — bearer mismatch                        → 401
 *   T2 — zero pending jobs                      → 200 {claimed:0, completed:0, reclaimed:0}
 *   T3 — one 250-row pending job                → claimed:1 + completed:1 + 3 chunks processed
 *   T4 — reclaim stuck 'running' job (>5min)    → reclaimed:1 (then claimed next tick)
 *   T5 — process_chunk RPC error catastrophic   → job set status='failed'
 *
 * Test seam: __internal.setAdminForTest(fake) overrides the lazy admin client.
 */
import { assertEquals, assert } from 'jsr:@std/assert@^1';

Deno.env.set('SUPABASE_URL', 'http://localhost:54321');
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'test-service-role-key');

const { __internal } = await import('./index.ts');

// ============================================================================
// Test fake builder
// ============================================================================

interface FakeJob {
  id: string;
  action_type: string;
  target_user_ids: string[];
  requested_by: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  rows_total: number;
  rows_completed: number;
  error_log: Array<Record<string, unknown>>;
  claimed_by: string | null;
  claimed_at: string | null;
  created_at: string;
  completed_at: string | null;
  target_filter: Record<string, unknown> | null;
}

interface FakeState {
  jobs: FakeJob[];
  reclaimedCount: number;
  // RPC mocks per-call counters
  rpcCalls: Array<{ fn: string; args: Record<string, unknown> }>;
  // process_chunk behavior controls
  chunkBehavior: 'happy' | 'catastrophic';
  // jobs that got UPDATE'd by .from('admin_bulk_jobs').update(...)
  jobUpdates: Array<{ id: string; patch: Record<string, unknown> }>;
}

function makeFakeAdmin(state: FakeState): unknown {
  return {
    rpc(fn: string, args: Record<string, unknown>) {
      state.rpcCalls.push({ fn, args });
      if (fn === 'admin_bulk_job_reclaim_stuck') {
        const out = state.reclaimedCount;
        // Mutate stuck jobs back to pending.
        for (const j of state.jobs) {
          if (j.status === 'running' && j.claimed_at && Date.parse(j.claimed_at) < Date.now() - 5 * 60_000) {
            j.status = 'pending';
            j.claimed_at = null;
            j.claimed_by = null;
          }
        }
        return Promise.resolve({ data: out, error: null });
      }
      if (fn === 'admin_bulk_job_claim_pending') {
        const max = (args.p_max as number) ?? 3;
        const claimed: FakeJob[] = [];
        for (const j of state.jobs) {
          if (j.status === 'pending' && claimed.length < max) {
            j.status = 'running';
            j.claimed_at = new Date().toISOString();
            claimed.push({ ...j });
          }
        }
        return Promise.resolve({ data: claimed, error: null });
      }
      if (fn === 'admin_bulk_action_process_chunk') {
        if (state.chunkBehavior === 'catastrophic') {
          return Promise.resolve({
            data: null,
            error: { message: 'simulated catastrophic failure', code: '58000' },
          });
        }
        const size = args.p_chunk_size as number;
        return Promise.resolve({
          data: { processed: size, errors: [] },
          error: null,
        });
      }
      throw new Error(`unexpected rpc ${fn}`);
    },
    from(table: string) {
      if (table !== 'admin_bulk_jobs') throw new Error(`unexpected table ${table}`);
      let pendingPatch: Record<string, unknown> | null = null;
      let pendingId: string | null = null;
      const api = {
        update(patch: Record<string, unknown>) {
          pendingPatch = patch;
          return api;
        },
        eq(col: string, val: unknown) {
          if (col === 'id') pendingId = val as string;
          return api;
        },
        then(resolve: (v: unknown) => void) {
          if (pendingId && pendingPatch) {
            state.jobUpdates.push({ id: pendingId, patch: pendingPatch });
            const job = state.jobs.find((j) => j.id === pendingId);
            if (job) Object.assign(job, pendingPatch);
          }
          resolve({ data: null, error: null });
          return api;
        },
      };
      return api;
    },
  };
}

function emptyState(): FakeState {
  return {
    jobs: [],
    reclaimedCount: 0,
    rpcCalls: [],
    chunkBehavior: 'happy',
    jobUpdates: [],
  };
}

function makeJob(overrides: Partial<FakeJob> = {}): FakeJob {
  return {
    id: 'job-001',
    action_type: 'tag',
    target_user_ids: Array.from({ length: 250 }, (_, i) => `u-${i}`),
    requested_by: 'admin-001',
    status: 'pending',
    rows_total: 250,
    rows_completed: 0,
    error_log: [],
    claimed_by: null,
    claimed_at: null,
    created_at: new Date(Date.now() - 60_000).toISOString(),
    completed_at: null,
    target_filter: { tag: 'async_test' },
    ...overrides,
  };
}

// ============================================================================
// Tests
// ============================================================================

Deno.test('T1 — bearer mismatch → 401', async () => {
  __internal.setAdminForTest(makeFakeAdmin(emptyState()));
  try {
    const res = await __internal.handle(
      new Request('http://localhost/admin-bulk-job-worker', {
        method: 'POST',
        headers: { Authorization: 'Bearer WRONG' },
      }),
    );
    assertEquals(res.status, 401);
  } finally {
    __internal.resetAdminForTest();
  }
});

Deno.test('T2 — zero pending → claimed=0, completed=0', async () => {
  const state = emptyState();
  __internal.setAdminForTest(makeFakeAdmin(state));
  try {
    const res = await __internal.handle(
      new Request('http://localhost/admin-bulk-job-worker', {
        method: 'POST',
        headers: { Authorization: 'Bearer test-service-role-key' },
      }),
    );
    assertEquals(res.status, 200);
    const body = await res.json();
    assertEquals(body.claimed, 0);
    assertEquals(body.completed, 0);
    assertEquals(body.failed, 0);
    assertEquals(body.reclaimed, 0);
  } finally {
    __internal.resetAdminForTest();
  }
});

Deno.test('T3 — one 250-row pending job → 3 chunks + completed', async () => {
  const state = emptyState();
  state.jobs.push(makeJob());
  __internal.setAdminForTest(makeFakeAdmin(state));
  try {
    const res = await __internal.handle(
      new Request('http://localhost/admin-bulk-job-worker', {
        method: 'POST',
        headers: { Authorization: 'Bearer test-service-role-key' },
      }),
    );
    assertEquals(res.status, 200);
    const body = await res.json();
    assertEquals(body.claimed, 1);
    assertEquals(body.completed, 1);
    assertEquals(body.failed, 0);
    // 250 / 100 = 3 chunks (100 + 100 + 50)
    const chunkCalls = state.rpcCalls.filter((c) => c.fn === 'admin_bulk_action_process_chunk');
    assertEquals(chunkCalls.length, 3);
    assertEquals(chunkCalls[0]!.args.p_chunk_offset, 0);
    assertEquals(chunkCalls[1]!.args.p_chunk_offset, 100);
    assertEquals(chunkCalls[2]!.args.p_chunk_offset, 200);
    // Last call has size 50 (250 - 200).
    assertEquals(chunkCalls[2]!.args.p_chunk_size, 50);
    // Final update sets status='completed'.
    const finalPatch = state.jobUpdates.find((u) => (u.patch as Record<string, unknown>).status === 'completed');
    assert(finalPatch, 'expected a completion update');
  } finally {
    __internal.resetAdminForTest();
  }
});

Deno.test('T4 — reclaim stuck running job → reclaimed:1', async () => {
  const state = emptyState();
  state.reclaimedCount = 1;
  // Insert a 'running' job old enough to be reclaimable, but the reclaim_stuck
  // mock counter is what the response surfaces — claim happens next tick anyway.
  state.jobs.push(makeJob({
    status: 'running',
    claimed_at: new Date(Date.now() - 6 * 60_000).toISOString(),
  }));
  __internal.setAdminForTest(makeFakeAdmin(state));
  try {
    const res = await __internal.handle(
      new Request('http://localhost/admin-bulk-job-worker', {
        method: 'POST',
        headers: { Authorization: 'Bearer test-service-role-key' },
      }),
    );
    assertEquals(res.status, 200);
    const body = await res.json();
    assertEquals(body.reclaimed, 1);
    // After reclaim, the same tick re-claims the now-pending job.
    assertEquals(body.claimed, 1);
  } finally {
    __internal.resetAdminForTest();
  }
});

Deno.test('T5 — process_chunk RPC error → job marked failed', async () => {
  const state = emptyState();
  state.chunkBehavior = 'catastrophic';
  state.jobs.push(makeJob({ rows_total: 100, target_user_ids: Array.from({ length: 100 }, (_, i) => `u-${i}`) }));
  __internal.setAdminForTest(makeFakeAdmin(state));
  try {
    const res = await __internal.handle(
      new Request('http://localhost/admin-bulk-job-worker', {
        method: 'POST',
        headers: { Authorization: 'Bearer test-service-role-key' },
      }),
    );
    assertEquals(res.status, 200);
    const body = await res.json();
    assertEquals(body.claimed, 1);
    assertEquals(body.failed, 1);
    assertEquals(body.completed, 0);
    const failPatch = state.jobUpdates.find((u) => (u.patch as Record<string, unknown>).status === 'failed');
    assert(failPatch, 'expected a failed-status update');
  } finally {
    __internal.resetAdminForTest();
  }
});
