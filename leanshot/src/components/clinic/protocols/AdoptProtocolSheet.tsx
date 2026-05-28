/**
 * Phase 61 Plan 61-06 — AdoptProtocolSheet.
 *
 * Sheet wrapping PatientPickerList + Preview CTA. Opens AdoptDiffModal once
 * a patient is selected and the clinician clicks 'Preview assignment'.
 *
 * Analog: src/components/admin/rag/RejectReasonSheet.tsx (Sheet DS primitive wrapper).
 *
 * Typography ceiling: text-[11px] / text-[13px] / text-[18px] / text-heading
 * @theme tokens only — no undefined Tailwind v4 tokens.
 */

import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Sheet } from '@/components/ui/Sheet';
import { AdoptDiffModal } from './AdoptDiffModal';
import type { Patient } from './PatientPickerList';
import { PatientPickerList } from './PatientPickerList';

export interface AdoptProtocolSheetProps {
  open: boolean;
  onClose: () => void;
  orgId: string;
  protocol: {
    id: string;
    version: number;
    name: string;
    compound: string;
  } | null;
}

export function AdoptProtocolSheet({ open, onClose, orgId, protocol }: AdoptProtocolSheetProps) {
  const [selectedPatient, setSelectedPatient] = useState<Patient | null>(null);
  const [diffModalOpen, setDiffModalOpen] = useState(false);

  function handleClose() {
    setSelectedPatient(null);
    setDiffModalOpen(false);
    onClose();
  }

  function handlePreview() {
    if (!selectedPatient) return;
    setDiffModalOpen(true);
  }

  function handleConfirmed() {
    setDiffModalOpen(false);
    handleClose();
  }

  return (
    <>
      <Sheet open={open} onClose={handleClose} title="Adopt Protocol">
        <div className="space-y-4">
          <p className="text-[13px] font-semibold text-[var(--color-text)]">Select a patient</p>

          {protocol && (
            <p className="text-[13px] text-[var(--color-text-secondary)]">
              Adopting{' '}
              <span className="font-semibold text-[var(--color-text)]">{protocol.name}</span> (v
              {protocol.version})
            </p>
          )}

          <PatientPickerList
            orgId={orgId}
            selectedId={selectedPatient?.id}
            onSelect={setSelectedPatient}
          />

          <div className="pt-2 flex justify-end">
            <Button
              variant="primary"
              size="md"
              className="min-h-[44px]"
              disabled={!selectedPatient}
              onClick={handlePreview}
            >
              Preview assignment
            </Button>
          </div>
        </div>
      </Sheet>

      {selectedPatient && protocol && (
        <AdoptDiffModal
          open={diffModalOpen}
          onClose={() => setDiffModalOpen(false)}
          onConfirmed={handleConfirmed}
          patientId={selectedPatient.id}
          patientName={selectedPatient.name}
          protocol={protocol}
        />
      )}
    </>
  );
}
