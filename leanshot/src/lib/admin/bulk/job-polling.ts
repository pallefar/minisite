/**
 * Phase 27 Plan 27-06 — client polling hook for admin_bulk_jobs progress.
 *
 * Polls supabase.from('admin_bulk_jobs').select('*').eq('id', jobId).single()
 * every 2 seconds while the job is in flight; stops polling on terminal status
 * ('completed' | 'failed'). The Edge Function worker (admin-bulk-job-worker)
 * persists progress via rows_completed + error_log; this hook converts that
 * into a UI-friendly shape for BulkJobProgress.
 *
 * RLS: admin_bulk_jobs has two SELECT policies (Plan 27-01):
 *   - select_own (auth.uid() = requested_by) AND
 *   - select_admin (is_admin_at_least('admin'))
 * The requesting admin can always read their own job; super-admins can read all.
 *
 * Cleanup safety: we track the mounted state via a ref so a late-resolving poll
 * never calls setState on an unmounted component (avoids the React warning).
 */
import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';

const POLL_INTERVAL_MS = 2000;

export type BulkJobStatus = 'loading' | 'pending' | 'running' | 'completed' | 'failed';

export interface BulkJobErrorEntry {
  user_id?: string;
  chunk_offset?: number;
  error_code?: string;
  error_message?: string;
}

export interface BulkJobState {
  status: BulkJobStatus;
  rowsCompleted: number;
  rowsTotal: number;
  errorLog: BulkJobErrorEntry[];
  /** Integer 0..100 derived from rowsCompleted/rowsTotal. */
  percent: number;
}

interface BulkJobRow {
  id: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  rows_completed: number;
  rows_total: number;
  error_log: BulkJobErrorEntry[] | null;
}

const initial: BulkJobState = {
  status: 'loading',
  rowsCompleted: 0,
  rowsTotal: 0,
  errorLog: [],
  percent: 0,
};

function isTerminal(status: BulkJobStatus): boolean {
  return status === 'completed' || status === 'failed';
}

function toPercent(rowsCompleted: number, rowsTotal: number): number {
  if (!rowsTotal || rowsTotal <= 0) return 0;
  const raw = (rowsCompleted / rowsTotal) * 100;
  return Math.max(0, Math.min(100, Math.round(raw)));
}

export function useBulkJobProgress(jobId: string | null | undefined): BulkJobState {
  const [state, setState] = useState<BulkJobState>(initial);
  const mountedRef = useRef(true);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    if (!jobId) {
      setState(initial);
      return () => {
        mountedRef.current = false;
      };
    }

    let cancelled = false;

    const poll = async () => {
      try {
        const { data, error } = await supabase
          .from('admin_bulk_jobs')
          .select('id, status, rows_completed, rows_total, error_log')
          .eq('id', jobId)
          .single();
        if (cancelled || !mountedRef.current) return;
        if (error || !data) {
          // Fail-soft: keep last known state; subsequent polls will retry.
          return;
        }
        const row = data as unknown as BulkJobRow;
        const next: BulkJobState = {
          status: row.status,
          rowsCompleted: row.rows_completed ?? 0,
          rowsTotal: row.rows_total ?? 0,
          errorLog: Array.isArray(row.error_log) ? row.error_log : [],
          percent: toPercent(row.rows_completed ?? 0, row.rows_total ?? 0),
        };
        setState(next);
        if (isTerminal(next.status) && intervalRef.current !== null) {
          clearInterval(intervalRef.current);
          intervalRef.current = null;
        }
      } catch {
        // Network glitch — keep last known state.
      }
    };

    // Kick off the first poll immediately.
    void poll();
    // Continue polling every 2s until terminal.
    intervalRef.current = setInterval(() => {
      void poll();
    }, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      mountedRef.current = false;
      if (intervalRef.current !== null) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [jobId]);

  return state;
}
