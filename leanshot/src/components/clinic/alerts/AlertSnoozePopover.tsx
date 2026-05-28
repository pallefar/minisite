/**
 * Phase 30 Plan 03 — AlertSnoozePopover.
 *
 * 4-preset duration popover for snoozing a clinician alert.
 * Desktop: anchored 200px panel positioned below the Snooze trigger button.
 * Mobile (<768px): Sheet bottom-drawer.
 *
 * Accessibility pattern mirrors ScoreBreakdownPopover:
 *   - role="dialog" aria-modal="true" aria-labelledby
 *   - Focus trap (Tab cycles through 4 preset buttons + close button)
 *   - Escape closes + returns focus to trigger
 *
 * SECDEF call shape: rpc('snooze_clinician_alert', { p_alert_id, p_duration })
 * p_duration literals: '1h' | '4h' | '24h' | '7d'
 */

import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Sheet } from '@/components/ui/Sheet';
import { useToast } from '@/hooks/useToast';
import { supabase } from '@/lib/supabase';

type SnoozeDuration = '1h' | '4h' | '24h' | '7d';

const PRESETS: Array<{ label: string; duration: SnoozeDuration }> = [
  { label: '1 hour', duration: '1h' },
  { label: '4 hours', duration: '4h' },
  { label: '24 hours', duration: '24h' },
  { label: '7 days', duration: '7d' },
];

const HEADING_ID = 'snooze-alert-heading';

export interface AlertSnoozePopoverProps {
  alertId: string;
  triggerRef: React.RefObject<HTMLElement | null>;
  open: boolean;
  onClose: () => void;
}

function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia('(max-width: 767px)').matches : false,
  );

  useEffect(() => {
    const mql = window.matchMedia('(max-width: 767px)');
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, []);

  return isMobile;
}

export function AlertSnoozePopover({
  alertId,
  triggerRef,
  open,
  onClose,
}: AlertSnoozePopoverProps) {
  const toast = useToast();
  const isMobile = useIsMobile();
  const popoverRef = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState<SnoozeDuration | null>(null);

  // Focus first focusable element on open
  useEffect(() => {
    if (!open) return;
    const el = popoverRef.current?.querySelector<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
    );
    el?.focus();
  }, [open]);

  // Return focus to trigger on close
  useEffect(() => {
    if (open) return;
    triggerRef.current?.focus();
  }, [open, triggerRef]);

  // Escape + focus trap
  useEffect(() => {
    if (!open) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }

      if (e.key !== 'Tab' || !popoverRef.current) return;
      const focusable = popoverRef.current.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  async function snooze(duration: SnoozeDuration) {
    setLoading(duration);
    const { error } = await supabase.rpc('snooze_clinician_alert', {
      p_alert_id: alertId,
      p_duration: duration,
    });
    setLoading(null);
    if (error) {
      toast('Snooze failed — please try again.', 'error');
      // Keep open so user can retry
    } else {
      toast('Alert snoozed', 'success');
      onClose();
    }
  }

  if (!open) return null;

  const content = (
    <div ref={popoverRef} role="dialog" aria-modal="true" aria-labelledby={HEADING_ID}>
      <h2 id={HEADING_ID} className="text-[16px] font-semibold text-[var(--color-text)] mb-4">
        Snooze alert
      </h2>
      <div className="grid grid-cols-2 gap-2">
        {PRESETS.map(({ label, duration }) => (
          <Button
            key={duration}
            variant="secondary"
            size="sm"
            loading={loading === duration}
            disabled={loading !== null}
            onClick={() => void snooze(duration)}
          >
            {label}
          </Button>
        ))}
      </div>
      <button
        type="button"
        aria-label="Close snooze panel"
        onClick={onClose}
        className="mt-4 w-full text-[13px] text-[var(--color-text-secondary)] hover:text-[var(--color-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] rounded"
      >
        Cancel
      </button>
    </div>
  );

  // Mobile: Sheet bottom-drawer
  if (isMobile) {
    return (
      <Sheet open={open} onClose={onClose} title="Snooze alert">
        {/* Render body without the redundant h2 since Sheet has title */}
        <div ref={popoverRef} role="dialog" aria-modal="true" aria-labelledby={HEADING_ID}>
          <h2 id={HEADING_ID} className="sr-only">
            Snooze alert
          </h2>
          <div className="grid grid-cols-2 gap-2">
            {PRESETS.map(({ label, duration }) => (
              <Button
                key={duration}
                variant="secondary"
                size="sm"
                loading={loading === duration}
                disabled={loading !== null}
                onClick={() => void snooze(duration)}
              >
                {label}
              </Button>
            ))}
          </div>
        </div>
      </Sheet>
    );
  }

  // Desktop: anchored panel below trigger
  const triggerRect = triggerRef.current?.getBoundingClientRect();
  const style: React.CSSProperties = triggerRect
    ? {
        position: 'fixed',
        top: triggerRect.bottom + 4,
        left: Math.max(8, triggerRect.left),
        width: 200,
        zIndex: 60,
      }
    : {
        position: 'fixed',
        top: '50%',
        left: '50%',
        transform: 'translate(-50%, -50%)',
        zIndex: 60,
      };

  return (
    <div
      style={style}
      className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-card shadow-lg p-4"
    >
      {content}
    </div>
  );
}
