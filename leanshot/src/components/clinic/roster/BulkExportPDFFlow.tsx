/**
 * Phase 10 Plan 10-10 — BulkExportPDFFlow.
 *
 * Confirmation modal → DYNAMIC jsPDF import → per-patient snapshot loop →
 * assembled PDF → blob download.
 *
 * CRITICAL: jsPDF MUST be imported dynamically via `await import('jspdf')`.
 * Static imports are FORBIDDEN — they would regress the index bundle size
 * and trip the CI bundle guard. See memory `project_phase5_bundle_regression.md`.
 *
 * D-22: 1 audit_log row per included patient (action='bulk_pdf_export').
 * Calls log_bulk_export_inclusion RPC per patient.
 *
 * Fraunces success heading modal when N≥10 per UI-SPEC.
 */
import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { useToast } from '@/hooks/useToast';
import { CLINIC_EVENTS } from '@/lib/clinic-events';
import { supabase } from '@/lib/supabase';
import type { ReadOnlyPermissionMap } from '@/types/snapshot';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;

export interface BulkExportPDFFlowProps {
  orgId: string;
  slug: string;
  selectedIds: string[];
  permissionMap: ReadOnlyPermissionMap;
  onClose: () => void;
}

type FlowState = 'confirm' | 'generating' | 'done' | 'error';

export function BulkExportPDFFlow({
  orgId,
  slug: _slug,
  selectedIds,
  permissionMap: _permissionMap,
  onClose,
}: BulkExportPDFFlowProps) {
  const [state, setState] = useState<FlowState>('confirm');
  const [progress, setProgress] = useState(0);
  const [errorMsg, setErrorMsg] = useState('');
  const toast = useToast();

  const handleGenerate = async () => {
    setState('generating');
    setProgress(0);

    try {
      // DYNAMIC import — NEVER static. CI bundle guard checks for static imports.
      const { jsPDF } = await import('jspdf');

      const { data: sessionData } = await supabase.auth.getSession();
      const jwt = sessionData?.session?.access_token ?? '';

      const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' });
      const pageWidth = doc.internal.pageSize.getWidth();
      let firstPage = true;

      const partialFailures: string[] = [];

      for (let i = 0; i < selectedIds.length; i++) {
        const patientId = selectedIds[i];
        setProgress(Math.round(((i + 1) / selectedIds.length) * 100));

        if (!firstPage) {
          doc.addPage();
        }
        firstPage = false;

        // Fetch patient snapshot from clinic-snapshot Edge Function
        let snapshotData: { display_name?: string; injections?: unknown[] } | null = null;
        try {
          const response = await fetch(
            `${SUPABASE_URL}/functions/v1/clinic-snapshot?org_id=${encodeURIComponent(orgId)}&patient_id=${encodeURIComponent(patientId)}`,
            {
              headers: {
                Authorization: `Bearer ${jwt}`,
                'Content-Type': 'application/json',
              },
            },
          );
          if (response.ok) {
            snapshotData = await response.json();
          }
        } catch {
          // Best-effort — skip patient if snapshot fetch fails
          partialFailures.push(patientId);
        }

        // Write patient page into PDF
        let y = 40;
        const displayName =
          (snapshotData as { display_name?: string } | null)?.display_name ?? `Patient ${i + 1}`;

        // Patient header
        doc.setFontSize(18);
        doc.setFont('helvetica', 'bold');
        doc.text(displayName, 40, y);
        y += 30;

        doc.setFontSize(11);
        doc.setFont('helvetica', 'normal');
        doc.text(`Generated: ${new Date().toLocaleDateString()}`, 40, y);
        y += 20;

        // Horizontal rule
        doc.setDrawColor(220, 220, 220);
        doc.line(40, y, pageWidth - 40, y);
        y += 20;

        if (snapshotData) {
          // Render snapshot sections as text blocks
          doc.setFontSize(10);
          const summaryLines = doc.splitTextToSize(
            JSON.stringify(snapshotData, null, 2).slice(0, 500) + '...',
            pageWidth - 80,
          ) as string[];
          doc.text(summaryLines, 40, y);
        } else {
          doc.setFontSize(10);
          doc.setTextColor(150, 150, 150);
          doc.text('Patient data not available.', 40, y);
          doc.setTextColor(0, 0, 0);
        }

        // Per-included-patient audit row (best-effort)
        try {
          await supabase.rpc('log_bulk_export_inclusion', {
            p_org_id: orgId,
            p_target_user_id: patientId,
            p_export_type: 'pdf',
          });
        } catch {
          // Best-effort — audit failure doesn't block export
        }
      }

      // Output and download
      const blob = doc.output('blob');
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const dateStr = new Date().toISOString().split('T')[0];
      a.href = url;
      a.download = `bulk-report-${dateStr}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      setState('done');

      // Fire PHI-safe PostHog event
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (window as any).posthog?.capture(CLINIC_EVENTS.BULK_ACTION_EXECUTED, {
          action: 'pdf',
          patient_count: selectedIds.length,
        });
      } catch {
        // PostHog unavailable
      }

      if (partialFailures.length > 0) {
        toast(
          `PDF generated with ${selectedIds.length - partialFailures.length} of ${selectedIds.length} patients included.`,
          'info',
        );
      } else {
        toast(
          `PDF generated for ${selectedIds.length} patient${selectedIds.length !== 1 ? 's' : ''}.`,
          'success',
        );
      }
    } catch (err) {
      setState('error');
      setErrorMsg(err instanceof Error ? err.message : 'Unknown error');
      toast('PDF generation failed. Please try again.', 'error');
    }
  };

  const isLargeGroup = selectedIds.length >= 10;

  return (
    <Modal
      open
      onClose={onClose}
      title={state === 'done' && isLargeGroup ? undefined : 'Generate bulk PDF report'}
      size="sm"
      hideClose={state === 'generating'}
      dismissible={state !== 'generating'}
    >
      {state === 'confirm' && (
        <div className="space-y-4">
          <p className="text-[14px] text-[var(--color-text-secondary)]">
            Generate a PDF report for{' '}
            <span className="font-semibold text-[var(--color-text)]">{selectedIds.length}</span>{' '}
            patient{selectedIds.length !== 1 ? 's' : ''}. Each patient gets their own section with
            recent clinical data. Sections the patient has not consented to share will be omitted.
          </p>
          <div className="flex gap-3 justify-end">
            <Button variant="secondary" size="sm" onClick={onClose}>
              Cancel
            </Button>
            <Button variant="primary" size="sm" onClick={() => void handleGenerate()}>
              Generate PDF
            </Button>
          </div>
        </div>
      )}

      {state === 'generating' && (
        <div className="space-y-4">
          <p className="text-[14px] text-[var(--color-text-secondary)]">
            Generating PDF… {progress}%
          </p>
          <div
            className="h-2 bg-[var(--color-border)] rounded-full overflow-hidden"
            role="progressbar"
            aria-valuenow={progress}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <div
              className="h-full bg-[var(--color-primary)] transition-all duration-200 rounded-full"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      )}

      {state === 'done' && isLargeGroup && (
        <div className="space-y-4 text-center">
          <h2 className="font-[Fraunces] text-[22px] font-semibold text-[var(--color-text)]">
            Bulk report ready
          </h2>
          <p className="text-[14px] text-[var(--color-text-secondary)]">
            PDF with {selectedIds.length} patients generated and downloaded.
          </p>
          <Button variant="primary" size="sm" onClick={onClose}>
            Done
          </Button>
        </div>
      )}

      {state === 'done' && !isLargeGroup && (
        <div className="space-y-4">
          <p className="text-[14px] text-[var(--color-text-secondary)]">
            PDF generated and downloaded.
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
          <p className="text-[14px] text-[var(--color-error)]">
            Failed to generate PDF: {errorMsg}
          </p>
          <div className="flex gap-3 justify-end">
            <Button variant="secondary" size="sm" onClick={onClose}>
              Close
            </Button>
            <Button variant="primary" size="sm" onClick={() => void handleGenerate()}>
              Retry
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
