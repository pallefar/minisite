/**
 * Phase 30 Plan 04 — PatientThresholdOverrideForm (CLIN-07).
 *
 * Per-patient dose threshold override form rendered inside ClinicDrillInPage
 * on the 'Dose thresholds' tab (admin/staff role-gated — W13 plan-checker fix).
 *
 * Props:
 *   - orgId: string
 *   - patientUserId: string
 *   - patientDisplayName: string (used in reset modal body)
 *   - clinicDefaults: { missed_doses_n, window_days_m, variance_pct_x }
 *   - existingOverride: same shape or null
 *
 * 3 number inputs (N/M/X) matching constraints from ClinicDoseTrendThresholdsForm:
 *   - Missed doses N: min 1 / max 30
 *   - Observation window M: min 7 / max 90
 *   - Interval variance X: min 5 / max 100
 *
 * Save: calls SECDEF set_patient_dose_thresholds
 * Reset: opens Modal → calls SECDEF reset_patient_dose_thresholds (Plan 30-04 migration)
 *
 * Reset modal copy (canonical per 30-UI-SPEC Copywriting Contract):
 *   Title: "Reset patient thresholds"
 *   Body:  "This will remove the override for {patientDisplayName} and use
 *           the clinic's default thresholds. This cannot be undone."
 *   Confirm: "Reset to defaults" (danger)
 *   Cancel: "Keep current thresholds" (secondary)
 *
 * UI-SPEC notes:
 *   - Note below inputs: text-[13px] text-[var(--color-text-tertiary)]
 *     "Overrides clinic default for this patient only."
 *   - Save toast: "Patient thresholds saved."
 *   - Reset toast: "Thresholds reset to clinic defaults."
 */

import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Card, CardHeader } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { useToast } from '@/hooks/useToast';
import { supabase } from '@/lib/supabase';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PatientThresholdOverrideFormProps {
  orgId: string;
  patientUserId: string;
  patientDisplayName: string;
  clinicDefaults: {
    missed_doses_n: number;
    window_days_m: number;
    variance_pct_x: number;
  };
  existingOverride: {
    missed_doses_n: number;
    window_days_m: number;
    variance_pct_x: number;
  } | null;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function PatientThresholdOverrideForm({
  orgId,
  patientUserId,
  patientDisplayName,
  clinicDefaults,
  existingOverride,
}: PatientThresholdOverrideFormProps) {
  const toast = useToast();

  // Form values: empty string = use clinic default; numeric string = override
  const [nValue, setNValue] = useState(
    existingOverride ? String(existingOverride.missed_doses_n) : '',
  );
  const [mValue, setMValue] = useState(
    existingOverride ? String(existingOverride.window_days_m) : '',
  );
  const [xValue, setXValue] = useState(
    existingOverride ? String(existingOverride.variance_pct_x) : '',
  );

  const [isSaving, setIsSaving] = useState(false);
  const [isResetting, setIsResetting] = useState(false);
  const [resetModalOpen, setResetModalOpen] = useState(false);

  // Save handler
  const handleSave = async () => {
    if (isSaving) return;

    const n = nValue !== '' ? parseInt(nValue, 10) : clinicDefaults.missed_doses_n;
    const m = mValue !== '' ? parseInt(mValue, 10) : clinicDefaults.window_days_m;
    const x = xValue !== '' ? parseInt(xValue, 10) : clinicDefaults.variance_pct_x;

    setIsSaving(true);
    try {
      const { error } = await supabase.rpc('set_patient_dose_thresholds', {
        p_org_id: orgId,
        p_patient_user_id: patientUserId,
        p_thresholds: {
          missed_doses_n: n,
          window_days_m: m,
          variance_pct_x: x,
        },
      });

      if (error) {
        toast('Save failed — please try again.', 'error');
        return;
      }

      toast('Patient thresholds saved.', 'success');
    } catch {
      toast('Save failed — please try again.', 'error');
    } finally {
      setIsSaving(false);
    }
  };

  // Reset confirm handler
  const handleConfirmReset = async () => {
    if (isResetting) return;

    setIsResetting(true);
    try {
      const { error } = await supabase.rpc('reset_patient_dose_thresholds', {
        p_org_id: orgId,
        p_patient_user_id: patientUserId,
      });

      if (error) {
        toast('Reset failed — please try again.', 'error');
        return;
      }

      toast('Thresholds reset to clinic defaults.', 'success');
      setResetModalOpen(false);
      // Clear form to empty (shows clinic defaults as placeholders)
      setNValue('');
      setMValue('');
      setXValue('');
    } catch {
      toast('Reset failed — please try again.', 'error');
    } finally {
      setIsResetting(false);
    }
  };

  return (
    <>
      <Card variant="elevated" data-testid="patient-threshold-override-form">
        <CardHeader title="Dose thresholds for this patient" />

        <p className="text-[13px] text-[var(--color-text-secondary)] mb-4">
          Overrides the clinic&apos;s default thresholds for this patient only. Leave blank to use
          the clinic default.
        </p>

        <div className="space-y-4">
          {/* Missed doses N */}
          <Input
            label="Missed doses (N)"
            type="number"
            min={1}
            max={30}
            step={1}
            placeholder={String(clinicDefaults.missed_doses_n)}
            value={nValue}
            onChange={(e) => setNValue(e.target.value)}
            aria-label="Missed doses (N)"
          />

          {/* Observation window M */}
          <Input
            label="Observation window (days)"
            type="number"
            min={7}
            max={90}
            step={1}
            placeholder={String(clinicDefaults.window_days_m)}
            value={mValue}
            onChange={(e) => setMValue(e.target.value)}
            aria-label="Observation window (days)"
          />

          {/* Interval variance X */}
          <Input
            label="Interval variance (%)"
            type="number"
            min={5}
            max={100}
            step={1}
            placeholder={String(clinicDefaults.variance_pct_x)}
            value={xValue}
            onChange={(e) => setXValue(e.target.value)}
            aria-label="Interval variance (%)"
          />

          {/* Per-UI-SPEC note */}
          <p className="text-[13px] text-[var(--color-text-tertiary)]">
            Overrides clinic default for this patient only.
          </p>

          {/* Action buttons */}
          <div className="flex flex-col sm:flex-row gap-3">
            <Button variant="primary" onClick={handleSave} loading={isSaving} aria-busy={isSaving}>
              Save patient thresholds
            </Button>
            <Button variant="secondary" onClick={() => setResetModalOpen(true)} disabled={isSaving}>
              Reset to clinic defaults
            </Button>
          </div>
        </div>
      </Card>

      {/* Reset confirmation modal — canonical copy per 30-UI-SPEC §Copywriting Contract */}
      <Modal
        open={resetModalOpen}
        onClose={() => setResetModalOpen(false)}
        title="Reset patient thresholds"
        size="sm"
      >
        <div className="space-y-5">
          <p className="text-[15px] text-[var(--color-text)]">
            This will remove the override for{' '}
            <span className="font-semibold">{patientDisplayName}</span> and use the clinic&apos;s
            default thresholds. This cannot be undone.
          </p>

          <div className="flex flex-col sm:flex-row gap-3">
            <Button
              variant="destructive"
              onClick={handleConfirmReset}
              loading={isResetting}
              aria-busy={isResetting}
            >
              Reset to defaults
            </Button>
            <Button
              variant="secondary"
              onClick={() => setResetModalOpen(false)}
              disabled={isResetting}
            >
              Keep current thresholds
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}

export default PatientThresholdOverrideForm;
