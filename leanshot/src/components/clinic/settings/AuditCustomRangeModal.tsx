/**
 * Phase 10 Plan 10-08 — AuditCustomRangeModal.
 *
 * Modal with two date inputs (From / To). Validates:
 *   - from <= to
 *   - to <= today
 *   - range <= 13 months
 *
 * Emits the validated CustomRange on Apply; calls onClose on Cancel.
 */
import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import type { CustomRange } from './use-audit-events';

export interface AuditCustomRangeModalProps {
  open: boolean;
  initial: CustomRange | null;
  onApply: (range: CustomRange) => void;
  onClose: () => void;
}

/** Return YYYY-MM-DD for today. */
function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Return true if the range is <= 13 months (approx 397 days). */
function isWithin13Months(from: string, to: string): boolean {
  const fromMs = new Date(from).getTime();
  const toMs = new Date(to).getTime();
  const days = (toMs - fromMs) / (1000 * 60 * 60 * 24);
  return days <= 397;
}

export function AuditCustomRangeModal({
  open,
  initial,
  onApply,
  onClose,
}: AuditCustomRangeModalProps) {
  const today = todayIso();
  const [from, setFrom] = useState<string>(initial?.from ?? '');
  const [to, setTo] = useState<string>(initial?.to ?? today);
  const [err, setErr] = useState<string | null>(null);

  const handleApply = (): void => {
    setErr(null);
    if (!from || !to) {
      setErr('Please select both a start and end date.');
      return;
    }
    if (from > to) {
      setErr('Start date must be on or before end date.');
      return;
    }
    if (to > today) {
      setErr('End date cannot be in the future.');
      return;
    }
    if (!isWithin13Months(from, to)) {
      setErr('Date range cannot exceed 13 months.');
      return;
    }
    onApply({ from, to });
    onClose();
  };

  const handleClose = (): void => {
    setErr(null);
    onClose();
  };

  return (
    <Modal open={open} onClose={handleClose} title="Custom time range" size="sm">
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <label
            htmlFor="audit-range-from"
            className="text-[13px] font-semibold text-[var(--color-text)]"
          >
            From
          </label>
          <input
            id="audit-range-from"
            type="date"
            value={from}
            max={to || today}
            aria-label="Start date"
            aria-describedby={err ? 'audit-range-error' : undefined}
            aria-invalid={err ? true : undefined}
            onChange={(e) => {
              setFrom(e.target.value);
              setErr(null);
            }}
            className="w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-elevated)] px-3 py-2.5 text-[13px] text-[var(--color-text)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] focus:border-transparent"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label
            htmlFor="audit-range-to"
            className="text-[13px] font-semibold text-[var(--color-text)]"
          >
            To
          </label>
          <input
            id="audit-range-to"
            type="date"
            value={to}
            min={from || undefined}
            max={today}
            aria-label="End date"
            aria-describedby={err ? 'audit-range-error' : undefined}
            aria-invalid={err ? true : undefined}
            onChange={(e) => {
              setTo(e.target.value);
              setErr(null);
            }}
            className="w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-elevated)] px-3 py-2.5 text-[13px] text-[var(--color-text)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] focus:border-transparent"
          />
        </div>

        {err && (
          <p
            id="audit-range-error"
            role="alert"
            className="text-[12px] text-[var(--color-danger)]"
          >
            {err}
          </p>
        )}

        <div className="flex items-center justify-end gap-2 pt-1">
          <Button variant="secondary" size="sm" onClick={handleClose}>
            Cancel
          </Button>
          <Button variant="primary" size="sm" onClick={handleApply}>
            Apply
          </Button>
        </div>
      </div>
    </Modal>
  );
}
