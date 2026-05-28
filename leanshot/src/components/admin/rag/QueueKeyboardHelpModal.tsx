/**
 * Phase 60 Plan 60-08 — QueueKeyboardHelpModal.
 *
 * Modal listing the 5 keyboard shortcuts for the curation queue.
 * Opened via Shift+? from any non-input context within RagQueuePage.
 *
 * Per D-AdminQueue-07 keyboard contract.
 * role=dialog + aria-modal=true inherited from Modal primitive.
 */
import { Modal } from '@/components/ui/Modal';

const SHORTCUTS = [
  { key: 'A', description: 'Approve selected' },
  { key: 'R', description: 'Reject selected' },
  { key: 'E', description: 'Edit & approve' },
  { key: 'J / K', description: 'Next / Previous' },
  { key: 'Shift + ?', description: 'Show/hide this help' },
] as const;

export interface QueueKeyboardHelpModalProps {
  open: boolean;
  onClose: () => void;
}

export function QueueKeyboardHelpModal({ open, onClose }: QueueKeyboardHelpModalProps) {
  return (
    <Modal open={open} onClose={onClose} title="Keyboard shortcuts" size="sm">
      <dl className="space-y-3">
        {SHORTCUTS.map(({ key, description }) => (
          <div key={key} className="flex items-center justify-between gap-4">
            <kbd className="inline-flex items-center justify-center min-w-[3rem] h-7 px-2 rounded text-[11px] font-mono bg-[var(--color-surface-elevated)] border border-[var(--color-border)] text-[var(--color-text-secondary)]">
              {key}
            </kbd>
            <dd className="text-[13px] text-[var(--color-text)] flex-1 text-end">{description}</dd>
          </div>
        ))}
      </dl>
    </Modal>
  );
}

export default QueueKeyboardHelpModal;
