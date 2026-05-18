/**
 * `admin-bulk-job-worker` Edge Function — Phase 27 Plan 27-06 (ADMIN-04 async path).
 *
 * Cron-invoked every minute by `cron.schedule('admin-bulk-job-worker', '* * * * *', ...)`
 * (see 20270602000050_admin_bulk_job_worker_cron.sql). The worker:
 *
 *   1. Reclaims stuck 'running' jobs older than 5 minutes (T-27-06-04).
 *   2. SQS-style atomic-claim up to N=3 pending jobs via SELECT FOR UPDATE
 *      SKIP LOCKED (T-27-06-03).
 *   3. For each claimed job: drain target_user_ids in chunks of 100 by calling
 *      admin_bulk_action_process_chunk(job_id, offset, size). Append per-row
 *      errors to admin_bulk_jobs.error_log; bump rows_completed after each chunk.
 *   4. On completion: status='completed', completed_at=now(). On RPC failure or
 *      errors > rows_total/2: status='failed'.
 *
 * Idempotency: rows_completed tracks per-chunk progress; on reclaim, the next
 * worker tick resumes from rows_completed offset (NOT 0).
 *
 * Auth: constant-time bearer compare against SUPABASE_SERVICE_ROLE_KEY
 * (sourced by pg_cron from vault.decrypted_secrets per BL-7). T-27-06-01.
 *
 * STATUS MACHINE OWNERSHIP (Pattern S10):
 *   - pending → running   : this worker (via admin_bulk_job_claim_pending)
 *   - running → completed : this worker (after all chunks succeed)
 *   - running → failed    : this worker (catastrophic RPC error or >50% per-row errors)
 *   - running → pending   : this worker (via admin_bulk_job_reclaim_stuck, after 5min stuck)
 *
 * Test seam: __internal.setAdminForTest(fake) overrides the lazy admin client.
 */
import {
  checkServiceRoleBearer,
  corsHeaders,
  jsonError,
  jsonResponse,
  makeLazyAdmin,
} from '../_shared/lifecycle-utils.ts';

const { admin, setAdminForTest, resetAdminForTest } = makeLazyAdmin();

const CHUNK_SIZE = 100;
const MAX_JOBS_PER_TICK = 3;
const FAIL_THRESHOLD_RATIO = 0.5;

interface BulkJobRow {
  id: string;
  action_type: string;
  target_user_ids: string[];
  requested_by: string;
  rows_total: number;
  rows_completed: number;
  error_log: Array<Record<string, unknown>>;
  status: string;
  target_filter: Record<string, unknown> | null;
}

interface ProcessChunkResult {
  processed: number;
  errors: Array<Record<string, unknown>>;
}

interface RunResult {
  reclaimed: number;
  claimed: number;
  completed: number;
  failed: number;
}

// ============================================================================
// Per-job drain loop
// ============================================================================

async function processOneJob(job: BulkJobRow): Promise<'completed' | 'failed'> {
  const accumulatedErrors: Array<Record<string, unknown>> = Array.isArray(job.error_log)
    ? [...job.error_log]
    : [];
  let cursor = job.rows_completed;

  while (cursor < job.rows_total) {
    const remaining = job.rows_total - cursor;
    const size = Math.min(CHUNK_SIZE, remaining);

    /* eslint-disable @typescript-eslint/no-explicit-any */
    const { data, error } = (await admin.rpc('admin_bulk_action_process_chunk', {
      p_job_id: job.id,
      p_chunk_offset: cursor,
      p_chunk_size: size,
      // deno-lint-ignore no-explicit-any
    } as any)) as { data: ProcessChunkResult | null; error: { message?: string; code?: string } | null };
    /* eslint-enable @typescript-eslint/no-explicit-any */

    if (error || !data) {
      // Catastrophic RPC error — surface a single error_log entry + mark failed.
      const msg = error?.message ?? 'process_chunk_no_data';
      const code = error?.code ?? 'unknown';
      console.error(
        `[admin-bulk-job-worker] catastrophic process_chunk error job=${job.id} offset=${cursor}`,
        code,
        msg,
      );
      accumulatedErrors.push({
        chunk_offset: cursor,
        error_code: code,
        // PHI safety (T-27-06-06): truncate; never include raw row data.
        error_message: String(msg).slice(0, 240),
      });
      await admin
        .from('admin_bulk_jobs')
        .update({
          status: 'failed',
          error_log: accumulatedErrors,
          completed_at: new Date().toISOString(),
        })
        .eq('id', job.id);
      return 'failed';
    }

    cursor += data.processed;
    if (Array.isArray(data.errors) && data.errors.length > 0) {
      accumulatedErrors.push(...data.errors);
    }

    // Persist progress after each chunk (drives client polling progress bar).
    await admin
      .from('admin_bulk_jobs')
      .update({
        rows_completed: cursor,
        error_log: accumulatedErrors,
      })
      .eq('id', job.id);

    // Per-chunk fail-safe: if data.processed < size AND no errors recorded,
    // we're not making progress — bail to prevent infinite loop.
    if (data.processed === 0) {
      console.error(`[admin-bulk-job-worker] zero-progress chunk job=${job.id} offset=${cursor}`);
      break;
    }
  }

  // Determine terminal state.
  const failed = accumulatedErrors.length > job.rows_total * FAIL_THRESHOLD_RATIO;
  const finalStatus: 'completed' | 'failed' = failed ? 'failed' : 'completed';

  await admin
    .from('admin_bulk_jobs')
    .update({
      status: finalStatus,
      rows_completed: cursor,
      error_log: accumulatedErrors,
      completed_at: new Date().toISOString(),
    })
    .eq('id', job.id);

  return finalStatus;
}

// ============================================================================
// Tick handler
// ============================================================================

async function runTick(): Promise<RunResult> {
  const result: RunResult = { reclaimed: 0, claimed: 0, completed: 0, failed: 0 };

  // 1. Reclaim stuck.
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const { data: reclaimedCount, error: reclaimErr } = (await admin.rpc(
    'admin_bulk_job_reclaim_stuck',
    {},
  )) as { data: number | null; error: { message?: string } | null };
  /* eslint-enable @typescript-eslint/no-explicit-any */
  if (reclaimErr) {
    console.error('[admin-bulk-job-worker] reclaim error', reclaimErr.message ?? 'unknown');
  } else {
    result.reclaimed = typeof reclaimedCount === 'number' ? reclaimedCount : 0;
  }

  // 2. Atomic claim.
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const { data: claimed, error: claimErr } = (await admin.rpc('admin_bulk_job_claim_pending', {
    p_max: MAX_JOBS_PER_TICK,
    // deno-lint-ignore no-explicit-any
  } as any)) as { data: BulkJobRow[] | null; error: { message?: string } | null };
  /* eslint-enable @typescript-eslint/no-explicit-any */
  if (claimErr) {
    console.error('[admin-bulk-job-worker] claim error', claimErr.message ?? 'unknown');
    return result;
  }
  const jobs = claimed ?? [];
  result.claimed = jobs.length;

  // 3. Process each.
  for (const job of jobs) {
    try {
      const outcome = await processOneJob(job);
      if (outcome === 'completed') result.completed += 1;
      else result.failed += 1;
    } catch (e) {
      // Catastrophic per-job failure outside the chunk loop — mark failed.
      const msg = e instanceof Error ? e.message : 'unknown';
      console.error(`[admin-bulk-job-worker] unhandled job=${job.id}`, msg);
      try {
        await admin
          .from('admin_bulk_jobs')
          .update({
            status: 'failed',
            error_log: [{ chunk_offset: -1, error_code: 'unhandled', error_message: String(msg).slice(0, 240) }],
            completed_at: new Date().toISOString(),
          })
          .eq('id', job.id);
      } catch {
        // best-effort
      }
      result.failed += 1;
    }
  }

  return result;
}

// ============================================================================
// Dispatcher
// ============================================================================

async function handle(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return jsonError(405, 'method_not_allowed');
  }
  if (!checkServiceRoleBearer(req)) {
    return jsonError(401, 'unauthorized');
  }

  try {
    const out = await runTick();
    return jsonResponse(200, { ok: true, ...out });
  } catch (e) {
    console.error('[admin-bulk-job-worker] unhandled', e instanceof Error ? e.message : 'unknown');
    return jsonError(500, 'internal');
  }
}

Deno.serve(handle);

// ============================================================================
// Test seam
// ============================================================================

export const __internal = {
  handle,
  runTick,
  setAdminForTest,
  resetAdminForTest,
};
