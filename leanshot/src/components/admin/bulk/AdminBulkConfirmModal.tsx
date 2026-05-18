/**
 * Phase 27 Plan 27-01 — AdminBulkConfirmModal (ADMIN-04).
 *
 * State machine: 'confirm' | 'running' | 'done' | 'error'
 *   (verbatim shape from BulkExportCSVFlow.tsx lines 92–135)
 *
 * - 'confirm': sample preview ("N users — Alice, Bob, Carol, +K more") +
 *   optional tag/days input for tag|comp_plan + Cancel/Confirm buttons.
 * - 'running': spinner + "Working…".
 * - 'done':    success summary + dismiss button. If undoable, parent renders
 *              AdminUndoBanner via onUndoAvailable callback.
 * - 'error':   error message + retry/close.
 */
import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { useToast } from '@/hooks/useToast';
import { buildAndDownloadCsv, executeBulkAction } from '@/lib/admin/bulk/action-handlers';
import { BulkApiError, type BulkActionResult, type BulkActionType } from '@/lib/admin/bulk/types';

type FlowState = 'confirm' | 'running' | 'done' | 'error';

const ACTION_LABELS: Record<BulkActionType, { verb: string; titleVerb: string; reversible: boolean }> = {
  csv_export:           { verb: 'export',         titleVerb: 'Export',         reversible: false },
  tag:                  { verb: 'tag',            titleVerb: 'Tag',            reversible: true  },
  comp_plan:            { verb: 'grant Pro to',   titleVerb: 'Grant Pro to',   reversible: true  },
  ban:                  { verb: 'ban',            titleVerb: 'Ban',            reversible: true  },
  force_password_reset: { verb: 'reset password for', titleVerb: 'Reset password for', reversible: false },
};

export interface AdminBulkConfirmModalProps {
  actionType: BulkActionType;
  selectedIds: string[];
  sampleNames: string[];
  onClose: () => void;
  onUndoAvailable: (info: { undoToken: string; count: number; actionType: BulkActionType }) => void;
  onActionComplete?: (info: { result: BulkActionResult; actionType: BulkActionType }) => void;
}

function previewLine(count: number, sampleNames: string[]): string {
  const sample = sampleNames.slice(0, 3);
  const remainder = Math.max(0, count - sample.length);
  if (remainder === 0) return sample.join(', ');
  return `${sample.join(', ')}, +${remainder} more`;
}

export function AdminBulkConfirmModal({
  actionType,
  selectedIds,
  sampleNames,
  onClose,
  onUndoAvailable,
  onActionComplete,
}: AdminBulkConfirmModalProps) {
  const [state, setState] = useState<FlowState>('confirm');
  const [errorMsg, setErrorMsg] = useState('');
  const [tagInput, setTagInput] = useState('');
  const [daysInput, setDaysInput] = useState('30');
  const [resultSummary, setResultSummary] = useState<{ affected: number; undoToken: string | null } | null>(null);
  const toast = useToast();

  const meta = ACTION_LABELS[actionType];
  const count = selectedIds.length;
  const isTag = actionType === 'tag';
  const isCompPlan = actionType === 'comp_plan';

  const handleConfirm = async () => {
    setState('running');
    try {
      const params: Record<string, unknown> = {};
      if (isTag) {
        if (!tagInput.trim()) {
          setState('error');
          setErrorMsg('Tag name is required.');
          return;
        }
        params.tag = tagInput.trim();
      }
      if (isCompPlan) {
        const d = Number(daysInput);
        if (!Number.isFinite(d) || d <= 0 || d > 3650) {
          setState('error');
          setErrorMsg('Days must be a positive integer ≤ 3650.');
          return;
        }
        params.days = d;
      }

      const result = await executeBulkAction(actionType, selectedIds, params);

      // csv_export: trigger client-side CSV download from the visible rows.
      // For v1 the rows are the selected ids only (no profile re-fetch — that
      // would require an additional admin_list_members call by-ids). The
      // download is a minimal "selection.csv" containing the id list; richer
      // CSV (full row dump) is a Plan 27-06 follow-up.
      if (actionType === 'csv_export' && result.mode === 'sync') {
        buildAndDownloadCsv(
          selectedIds.map((id, i) => ({ user_id: id, display_name: sampleNames[i] ?? '' })),
          'members',
        );
      }

      setResultSummary({
        affected: result.mode === 'sync' ? result.affected : 0,
        undoToken: result.mode === 'sync' ? result.undoToken : null,
      });
      setState('done');
      onActionComplete?.({ result, actionType });

      if (result.mode === 'sync' && result.undoToken && meta.reversible) {
        onUndoAvailable({
          undoToken: result.undoToken,
          count: result.affected,
          actionType,
        });
      }
    } catch (err) {
      setState('error');
      if (err instanceof BulkApiError) {
        setErrorMsg(
          err.code === 'too_many_rows' ? 'Selection too large (>10,000 rows).' :
          err.code === 'not_staff'     ? 'You are not authorized to perform this action.' :
          err.code === 'invalid_action' ? 'Invalid action parameters.' :
          err.code === 'network'       ? 'Network error. Please retry.' :
          'Unexpected error.',
        );
      } else {
        setErrorMsg(err instanceof Error ? err.message : 'Unknown error');
      }
      toast('Bulk action failed.', 'error');
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={`${meta.titleVerb} ${count} member${count === 1 ? '' : 's'}`}
      size="sm"
      hideClose={state === 'running'}
      dismissible={state !== 'running'}
    >
      {state === 'confirm' && (
        <div className="space-y-4">
          <p className="text-[14px] text-[var(--color-text-secondary)]">
            About to {meta.verb}{' '}
            <span className="font-semibold text-[var(--color-text)]">{count}</span> member
            {count === 1 ? '' : 's'} — {previewLine(count, sampleNames)}.
          </p>

          {isTag && (
            <Input
              label="Tag name"
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              placeholder="e.g. priority"
              maxLength={40}
            />
          )}

          {isCompPlan && (
            <Input
              label="Comp days"
              type="number"
              min={1}
              max={3650}
              value={daysInput}
              onChange={(e) => setDaysInput(e.target.value)}
            />
          )}

          <div className="flex justify-end gap-3">
            <Button variant="secondary" size="sm" onClick={onClose}>Cancel</Button>
            <Button
              variant={actionType === 'ban' ? 'destructive' : 'primary'}
              size="sm"
              onClick={() => void handleConfirm()}
            >
              Confirm
            </Button>
          </div>
        </div>
      )}

      {state === 'running' && (
        <div className="space-y-3">
          <p className="text-[14px] text-[var(--color-text-secondary)]">Working…</p>
        </div>
      )}

      {state === 'done' && resultSummary && (
        <div className="space-y-4">
          <p className="text-[14px] text-[var(--color-text-secondary)]">
            {meta.titleVerb}ed{' '}
            <span className="font-semibold text-[var(--color-text)]">{resultSummary.affected}</span>{' '}
            member{resultSummary.affected === 1 ? '' : 's'}.
            {resultSummary.undoToken && meta.reversible
              ? ' You have 60 seconds to undo this action.'
              : ''}
          </p>
          <div className="flex justify-end">
            <Button variant="primary" size="sm" onClick={onClose}>Done</Button>
          </div>
        </div>
      )}

      {state === 'error' && (
        <div className="space-y-4">
          <p className="text-[14px] text-[var(--color-error)]">{errorMsg}</p>
          <div className="flex justify-end gap-3">
            <Button variant="secondary" size="sm" onClick={onClose}>Close</Button>
            <Button variant="primary" size="sm" onClick={() => void handleConfirm()}>Retry</Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
