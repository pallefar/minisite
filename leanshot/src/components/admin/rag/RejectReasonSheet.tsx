/**
 * Phase 60 Plan 60-08 — RejectReasonSheet.
 *
 * Bottom Sheet with 6-reason radiogroup for rejecting a chunk.
 * Per D-AdminQueue-05 + UI-SPEC §Copywriting Contract — Admin Curation Queue.
 *
 * 6 reasons: Off-topic | Factually wrong | Off-label | Low quality | Duplicate | Safety concern
 * Danger-toned: Factually wrong, Off-label, Safety concern.
 *
 * Single tap = onSelect(reason) + onClose().
 * Arrow-key cycling within the radiogroup.
 * role=dialog + aria-modal=true inherited from Sheet primitive.
 */
import { useState } from 'react';
import { Sheet } from '@/components/ui/Sheet';
import type { RejectReason } from '@/lib/admin/rag/chunk-api';

interface ReasonConfig {
  value: RejectReason;
  label: string;
  danger: boolean;
}

const REASONS: ReasonConfig[] = [
  { value: 'off-topic', label: 'Off-topic', danger: false },
  { value: 'factually-wrong', label: 'Factually wrong', danger: true },
  { value: 'off-label', label: 'Off-label', danger: true },
  { value: 'low-quality', label: 'Low quality', danger: false },
  { value: 'duplicate', label: 'Duplicate', danger: false },
  { value: 'safety-concern', label: 'Safety concern', danger: true },
];

export interface RejectReasonSheetProps {
  open: boolean;
  onClose: () => void;
  onSelect: (reason: RejectReason) => void;
}

export function RejectReasonSheet({ open, onClose, onSelect }: RejectReasonSheetProps) {
  const [activeIdx, setActiveIdx] = useState(0);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
      e.preventDefault();
      setActiveIdx((prev) => (prev + 1) % REASONS.length);
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
      e.preventDefault();
      setActiveIdx((prev) => (prev - 1 + REASONS.length) % REASONS.length);
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      const reason = REASONS[activeIdx];
      if (reason) {
        onSelect(reason.value);
        onClose();
      }
    }
  };

  const handleSelect = (reason: RejectReason) => {
    onSelect(reason);
    onClose();
  };

  return (
    <Sheet open={open} onClose={onClose} title="Reject chunk">
      <div
        role="radiogroup"
        aria-label="Reject reason"
        tabIndex={0}
        onKeyDown={handleKeyDown}
        className="flex flex-wrap gap-2 pb-2"
      >
        {REASONS.map((r, idx) => (
          <button
            key={r.value}
            type="button"
            role="radio"
            aria-checked={activeIdx === idx}
            onClick={() => handleSelect(r.value)}
            onFocus={() => setActiveIdx(idx)}
            className={`inline-flex items-center h-9 px-4 rounded-pill border text-[13px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] focus-visible:ring-offset-2 ${
              r.danger
                ? 'border-[var(--color-danger-soft)] text-[var(--color-danger)] bg-[var(--color-danger-soft)] hover:bg-[var(--color-danger)] hover:text-white danger'
                : 'border-[var(--color-border)] text-[var(--color-text-secondary)] bg-[var(--color-surface-elevated)] hover:border-[var(--color-primary)] hover:text-[var(--color-primary)]'
            }`}
          >
            {r.label}
          </button>
        ))}
      </div>
    </Sheet>
  );
}

export default RejectReasonSheet;
