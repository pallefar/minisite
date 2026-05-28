/**
 * Phase 10 Plan 10-10 — BulkExportCSVFlow.
 *
 * Confirmation modal → POST to bulk-csv-export Edge Function →
 * browser triggers download via Content-Disposition response → toast success.
 *
 * D-22: per-included-patient audit is handled server-side by the Edge Function.
 */
import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { useToast } from '@/hooks/useToast';
import { CLINIC_EVENTS } from '@/lib/clinic-events';
import { supabase } from '@/lib/supabase';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;

export interface BulkExportCSVFlowProps {
  orgId: string;
  selectedIds: string[];
  onClose: () => void;
}

type FlowState = 'confirm' | 'downloading' | 'done' | 'error';

export function BulkExportCSVFlow({ orgId, selectedIds, onClose }: BulkExportCSVFlowProps) {
  const [state, setState] = useState<FlowState>('confirm');
  const [errorMsg, setErrorMsg] = useState('');
  const toast = useToast();

  const handleDownload = async () => {
    setState('downloading');

    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const jwt = sessionData?.session?.access_token ?? '';

      const response = await fetch(`${SUPABASE_URL}/functions/v1/bulk-csv-export`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${jwt}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ org_id: orgId, patient_ids: selectedIds }),
      });

      if (!response.ok) {
        const errBody = await response.json().catch(() => ({ error: 'unknown' }));
        throw new Error(
          `Export failed: ${(errBody as { error?: string }).error ?? response.status}`,
        );
      }

      // Trigger browser download via blob URL
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const dateStr = new Date().toISOString().split('T')[0];
      // Try to get filename from Content-Disposition, fallback to generic name
      const disposition = response.headers.get('Content-Disposition') ?? '';
      const filenameMatch = disposition.match(/filename="([^"]+)"/);
      a.download = filenameMatch ? filenameMatch[1] : `symptoms-${dateStr}.csv`;
      a.href = url;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      setState('done');

      // Fire PHI-safe PostHog event
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (window as any).posthog?.capture(CLINIC_EVENTS.BULK_ACTION_EXECUTED, {
          action: 'csv',
          patient_count: selectedIds.length,
        });
      } catch {
        // PostHog unavailable
      }

      toast(
        `CSV exported for up to ${selectedIds.length} patient${selectedIds.length !== 1 ? 's' : ''}.`,
        'success',
      );
    } catch (err) {
      setState('error');
      setErrorMsg(err instanceof Error ? err.message : 'Unknown error');
      toast('CSV export failed. Please try again.', 'error');
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="Export symptoms as CSV"
      size="sm"
      hideClose={state === 'downloading'}
      dismissible={state !== 'downloading'}
    >
      {state === 'confirm' && (
        <div className="space-y-4">
          <p className="text-[14px] text-[var(--color-text-secondary)]">
            Export symptom logs (last 30 days) for{' '}
            <span className="font-semibold text-[var(--color-text)]">{selectedIds.length}</span>{' '}
            patient{selectedIds.length !== 1 ? 's' : ''}. Only patients who have consented to share
            symptom data will be included.
          </p>
          <div className="flex gap-3 justify-end">
            <Button variant="secondary" size="sm" onClick={onClose}>
              Cancel
            </Button>
            <Button variant="primary" size="sm" onClick={() => void handleDownload()}>
              Download CSV
            </Button>
          </div>
        </div>
      )}

      {state === 'downloading' && (
        <div className="space-y-3">
          <p className="text-[14px] text-[var(--color-text-secondary)]">Preparing CSV export…</p>
        </div>
      )}

      {state === 'done' && (
        <div className="space-y-4">
          <p className="text-[14px] text-[var(--color-text-secondary)]">
            CSV downloaded successfully.
          </p>
          <div className="flex justify-end">
            <Button variant="primary" size="sm" onClick={onClose}>
              Done
            </Button>
          </div>
        </div>
      )}

      {state === 'error' && (
        <div className="space-y-4">
          <p className="text-[14px] text-[var(--color-error)]">Export failed: {errorMsg}</p>
          <div className="flex gap-3 justify-end">
            <Button variant="secondary" size="sm" onClick={onClose}>
              Close
            </Button>
            <Button variant="primary" size="sm" onClick={() => void handleDownload()}>
              Retry
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
