/**
 * Phase 10 Plan 10-10 — BulkOpenInTabsFlow.
 *
 * Confirmation modal (with cap warning if N>5) → window.open loop with
 * 100ms stagger → cap at 5 tabs → toast warns if capped.
 *
 * D-22: 1 audit row per patient drill-open (handled by D-21's section audit
 * on page load). This component just opens the tabs.
 */
import { useState } from 'react';

import { CLINIC_EVENTS } from '@/lib/clinic-events';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/hooks/useToast';

const TAB_CAP = 5;

export interface BulkOpenInTabsFlowProps {
  slug: string;
  selectedIds: string[];
  onClose: () => void;
}

export function BulkOpenInTabsFlow({ slug, selectedIds, onClose }: BulkOpenInTabsFlowProps) {
  const [opening, setOpening] = useState(false);
  const toast = useToast();
  const isCapped = selectedIds.length > TAB_CAP;
  const tabCount = Math.min(selectedIds.length, TAB_CAP);

  const handleOpenTabs = async () => {
    setOpening(true);

    const toOpen = selectedIds.slice(0, TAB_CAP);
    for (let i = 0; i < toOpen.length; i++) {
      const patientId = toOpen[i];
      // Stagger tab opens by 100ms to avoid browser blocking
      await new Promise((resolve) => setTimeout(resolve, i * 100));
      window.open(`/clinic/${slug}/patient/${patientId}`, '_blank');
    }

    setOpening(false);
    onClose();

    // Fire PHI-safe PostHog event
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).posthog?.capture(CLINIC_EVENTS.BULK_ACTION_EXECUTED, {
        action: 'tabs',
        patient_count: toOpen.length,
      });
    } catch {
      // PostHog unavailable
    }

    if (isCapped) {
      toast(
        `Opened ${TAB_CAP} tabs (${selectedIds.length - TAB_CAP} more were not opened — capped at ${TAB_CAP}).`,
        'info',
      );
    } else {
      toast(`Opened ${toOpen.length} patient tab${toOpen.length !== 1 ? 's' : ''}.`, 'success');
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="Open patients in tabs"
      size="sm"
      hideClose={opening}
      dismissible={!opening}
    >
      <div className="space-y-4">
        {isCapped && (
          <div
            className={
              'bg-[var(--color-warning)]/10 border border-[var(--color-warning)] rounded-xl px-3 py-2'
            }
            role="alert"
          >
            <p className="text-[13px] text-[var(--color-warning)] font-medium">
              Tab limit: only the first {TAB_CAP} patients will be opened.
            </p>
            <p className="text-[12px] text-[var(--color-text-secondary)] mt-1">
              You selected {selectedIds.length} patients. Browsers may block more than {TAB_CAP}{' '}
              simultaneous new tabs.
            </p>
          </div>
        )}

        <p className="text-[14px] text-[var(--color-text-secondary)]">
          Open{' '}
          <span className="font-semibold text-[var(--color-text)]">
            {tabCount} patient{tabCount !== 1 ? 's' : ''}
          </span>{' '}
          in new browser tabs.
        </p>

        <div className="flex gap-3 justify-end">
          <Button variant="secondary" size="sm" onClick={onClose} disabled={opening}>
            Cancel
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={() => void handleOpenTabs()}
            loading={opening}
          >
            Open {tabCount} tab{tabCount !== 1 ? 's' : ''}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
