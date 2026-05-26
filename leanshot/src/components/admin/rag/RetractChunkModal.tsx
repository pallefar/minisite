/**
 * Phase 60 Plan 60-08 — RetractChunkModal.
 *
 * Retract confirmation modal with required reason textarea.
 * Verbatim copy per UI-SPEC §Copywriting Contract + plan grep gate.
 *
 * Actions: Keep chunk (secondary) + Retract chunk (destructive).
 * Retract button disabled until at least 1 non-whitespace char in reason.
 *
 * role=dialog + aria-modal=true inherited from Modal primitive.
 */
import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';

export interface RetractChunkModalProps {
  open: boolean;
  onClose: () => void;
  onRetract: (reason: string) => void | Promise<void>;
}

export function RetractChunkModal({ open, onClose, onRetract }: RetractChunkModalProps) {
  const [reason, setReason] = useState('');
  const [retracting, setRetracting] = useState(false);

  const canRetract = reason.trim().length > 0;

  const handleRetract = () => {
    if (!canRetract) return;
    setRetracting(true);
    const result = onRetract(reason.trim());
    if (result instanceof Promise) {
      result.finally(() => {
        setRetracting(false);
        onClose();
      });
    } else {
      setRetracting(false);
      onClose();
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Retract this chunk?" size="sm" hideClose>
      <div className="space-y-4">
        <p className="text-[13px] text-[var(--color-text-secondary)]">
          Chunk removes from RAG retrieval immediately. Already-sent newsletter inclusions stay sent. Action is logged.
        </p>

        <div className="space-y-1">
          <label
            htmlFor="retract-reason"
            className="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-text-tertiary)]"
          >
            Reason <span className="text-[var(--color-danger)]">*</span>
          </label>
          <textarea
            id="retract-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            placeholder="Explain why this chunk is being retracted…"
            className="w-full p-3 text-[13px] border border-[var(--color-border)] rounded-card bg-[var(--color-surface)] focus:outline-none focus:ring-1 focus:ring-[var(--color-primary)] resize-y"
            aria-label="Retract reason"
            aria-required="true"
          />
        </div>

        <div className="flex items-center justify-end gap-2 pt-2">
          <Button variant="secondary" size="sm" onClick={onClose}>
            Keep chunk
          </Button>
          <Button
            variant="destructive"
            size="sm"
            disabled={!canRetract}
            loading={retracting}
            onClick={handleRetract}
          >
            Retract chunk
          </Button>
        </div>
      </div>
    </Modal>
  );
}

export default RetractChunkModal;
