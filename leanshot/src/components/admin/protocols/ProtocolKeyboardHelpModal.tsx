/**
 * Phase 61 Plan 61-04 — ProtocolKeyboardHelpModal.
 *
 * Modal listing keyboard shortcuts for the Protocols admin surface.
 * Opened via Shift+? from any non-input context within ProtocolsListPage.
 *
 * Mirrors QueueKeyboardHelpModal.tsx structure verbatim; only the SHORTCUTS
 * array differs per D-AdminProtocols keyboard contract.
 * role=dialog + aria-modal=true inherited from Modal primitive.
 */
import { Modal } from '@/components/ui/Modal';

const SHORTCUTS = [
  { key: 'N', description: 'New protocol' },
  { key: 'J / K', description: 'Next / Previous protocol' },
  { key: 'Shift + ?', description: 'Show / hide this help' },
  { key: 'Escape', description: 'Close current sheet or modal' },
] as const;

export interface ProtocolKeyboardHelpModalProps {
  open: boolean;
  onClose: () => void;
}

export function ProtocolKeyboardHelpModal({ open, onClose }: ProtocolKeyboardHelpModalProps) {
  return (
    <Modal open={open} onClose={onClose} title="Keyboard shortcuts" size="sm">
      <dl className="space-y-3">
        {SHORTCUTS.map(({ key, description }) => (
          <div key={key} className="flex items-center justify-between gap-4">
            <kbd className="inline-flex items-center justify-center min-w-[3rem] h-7 px-2 rounded text-[11px] font-mono bg-[var(--color-surface-elevated)] border border-[var(--color-border)] text-[var(--color-text-secondary)]">
              {key}
            </kbd>
            <dd className="text-[13px] text-[var(--color-text)] flex-1 text-right">
              {description}
            </dd>
          </div>
        ))}
      </dl>
    </Modal>
  );
}

export default ProtocolKeyboardHelpModal;
