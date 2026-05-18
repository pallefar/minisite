/**
 * Phase 27 Plan 27-06 — BulkJobProgress UI for admin_bulk_jobs.
 *
 * Renders inside AdminBulkConfirmModal's async branch when admin_bulk_action_execute
 * returns {mode:'async', job_id}. Polls the job row every 2s via useBulkJobProgress;
 * fires onComplete/onError when the worker reaches a terminal status.
 *
 * UI:
 *   - ProgressBar showing rowsCompleted / rowsTotal (percent).
 *   - Live caption "Processing X of Y users…".
 *   - On failed: collapsible details listing error_log entries (user_id + error_message).
 *
 * Accessibility: ProgressBar carries aria-valuenow + aria-label; the status line
 * is wrapped in role="status" aria-live="polite" so screen readers announce progress.
 */
import { useEffect, useRef } from 'react';
import { ProgressBar } from '@/components/ui/ProgressRing';
import { useBulkJobProgress, type BulkJobErrorEntry } from '@/lib/admin/bulk/job-polling';

export interface BulkJobProgressProps {
  jobId: string;
  onComplete?: (info: { rowsTotal: number; errorLog: BulkJobErrorEntry[] }) => void;
  onError?: (errorLog: BulkJobErrorEntry[]) => void;
}

export function BulkJobProgress({ jobId, onComplete, onError }: BulkJobProgressProps) {
  const { status, rowsCompleted, rowsTotal, errorLog, percent } = useBulkJobProgress(jobId);
  const firedRef = useRef(false);

  useEffect(() => {
    if (firedRef.current) return;
    if (status === 'completed') {
      firedRef.current = true;
      onComplete?.({ rowsTotal, errorLog });
    } else if (status === 'failed') {
      firedRef.current = true;
      onError?.(errorLog);
    }
  }, [status, rowsCompleted, rowsTotal, errorLog, onComplete, onError]);

  const caption =
    status === 'loading' ? 'Connecting to job…'
      : status === 'pending' ? 'Waiting in queue…'
      : status === 'running' ? `Processing ${rowsCompleted} of ${rowsTotal} users…`
      : status === 'completed' ? `Completed ${rowsCompleted} of ${rowsTotal} users.`
      : `Failed after ${rowsCompleted} of ${rowsTotal} users.`;

  return (
    <div className="space-y-3">
      <div
        role="status"
        aria-live="polite"
        className="text-[14px] text-[var(--color-text-secondary)]"
      >
        {caption}
      </div>
      <ProgressBar
        value={percent}
        max={100}
        thickness="normal"
        label={`Bulk job progress: ${percent}%`}
        color={status === 'failed' ? 'var(--color-error)' : 'var(--color-primary)'}
      />
      {errorLog.length > 0 && (
        <details className="text-[13px] text-[var(--color-text-secondary)]">
          <summary className="cursor-pointer select-none">
            {errorLog.length} per-row error{errorLog.length === 1 ? '' : 's'}
          </summary>
          <ul className="mt-2 space-y-1 max-h-40 overflow-y-auto">
            {errorLog.slice(0, 50).map((entry, i) => (
              <li key={i} className="font-mono text-[12px]">
                {entry.user_id ? `${entry.user_id.slice(0, 8)}…` : `chunk@${entry.chunk_offset ?? '?'}`}
                {': '}
                {entry.error_message ?? entry.error_code ?? 'unknown error'}
              </li>
            ))}
            {errorLog.length > 50 && (
              <li className="text-[12px] italic">+{errorLog.length - 50} more…</li>
            )}
          </ul>
        </details>
      )}
    </div>
  );
}
