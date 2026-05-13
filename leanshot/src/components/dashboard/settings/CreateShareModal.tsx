/**
 * Phase 8 Plan 08-03 — CreateShareModal placeholder.
 *
 * Task 1 of Plan 08-03 wires the Settings → Active shares section against
 * a minimal export so the section can compile + render its create-CTA. The
 * full two-step modal (form → success state with raw_token + raw_code copy
 * buttons) ships in Task 2 of the same plan; this stub is replaced in-place.
 */

import { Modal } from '@/components/ui/Modal';

export interface CreateShareModalProps {
  open: boolean;
  onClose: () => void;
  onCreated?: (shareId: string) => void;
}

export function CreateShareModal({ open, onClose }: CreateShareModalProps) {
  return (
    <Modal open={open} onClose={onClose} title="Create a share link" size="md">
      <p className="text-[14px] text-[var(--color-text-secondary)]">Loading…</p>
    </Modal>
  );
}
