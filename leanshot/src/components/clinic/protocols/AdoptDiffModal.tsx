/**
 * Phase 61 Plan 61-06 — AdoptDiffModal.
 *
 * Two-column diff preview modal. Shows the patient's current injection
 * schedule vs the protocol's expected dosing. On confirm, calls the
 * assign_protocol_to_patient SECDEF RPC.
 *
 * Cancel CTA: "Keep current schedule" (per UI-SPEC revision iter-1).
 * Confirm CTA: "Assign to patient".
 *
 * Data fetched on open:
 *   - protocol_steps for the selected protocol
 *   - injections for the patient (most recent 20)
 *
 * Typography ceiling: text-[11px] / text-[13px] / text-[18px] / text-heading
 * @theme tokens only — no undefined Tailwind v4 tokens.
 */

import { useEffect, useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Skeleton } from '@/components/ui/Skeleton';
import { useToast } from '@/hooks/useToast';
import { supabase } from '@/lib/supabase';

export interface AdoptDiffModalProps {
  open: boolean;
  onClose: () => void;
  onConfirmed: () => void;
  patientId: string;
  patientName: string;
  protocol: {
    id: string;
    version: number;
    name: string;
    compound: string;
  };
}

interface ProtocolStep {
  week: number;
  dose_mg: number;
  frequency: string;
  monitoring: string[] | null;
}

interface PatientInjection {
  week_number: number | null;
  dose_mg: number;
}

interface DiffRow {
  week: number;
  patientDose: number | null;
  protocolDose: number;
  frequency: string;
  differs: boolean;
}

function buildDiffRows(steps: ProtocolStep[], injections: PatientInjection[]): DiffRow[] {
  // Build a map of week → patient dose from most recent injections
  const patientByWeek = new Map<number, number>();
  for (const inj of injections) {
    if (inj.week_number != null && !patientByWeek.has(inj.week_number)) {
      patientByWeek.set(inj.week_number, inj.dose_mg);
    }
  }

  return steps.map((step) => {
    const patientDose = patientByWeek.get(step.week) ?? null;
    const differs = patientDose !== null && patientDose !== step.dose_mg;
    return {
      week: step.week,
      patientDose,
      protocolDose: step.dose_mg,
      frequency: step.frequency,
      differs,
    };
  });
}

export function AdoptDiffModal({
  open,
  onClose,
  onConfirmed,
  patientId,
  patientName,
  protocol,
}: AdoptDiffModalProps) {
  const [diffRows, setDiffRows] = useState<DiffRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [assigning, setAssigning] = useState(false);
  const showToast = useToast();

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);

    void (async () => {
      const [stepsResult, injectionsResult] = await Promise.all([
        supabase
          .from('protocol_steps')
          .select('week, dose_mg, frequency, monitoring')
          .eq('protocol_id', protocol.id)
          .eq('protocol_version', protocol.version)
          .order('week'),
        supabase
          .from('injections')
          .select('week_number, dose_mg')
          .eq('user_id', patientId)
          .order('created_at', { ascending: false })
          .limit(20),
      ]);

      if (cancelled) return;

      const steps = (stepsResult.data ?? []) as ProtocolStep[];
      const injections = (injectionsResult.data ?? []) as PatientInjection[];
      setDiffRows(buildDiffRows(steps, injections));
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [open, protocol.id, protocol.version, patientId]);

  async function handleAssign() {
    setAssigning(true);
    const { error } = await supabase.rpc('assign_protocol_to_patient', {
      p_protocol_id: protocol.id,
      p_version: protocol.version,
      p_patient_id: patientId,
    });
    setAssigning(false);

    if (error) {
      showToast(error.message ?? 'Assignment failed', 'error');
      return;
    }

    showToast(`Protocol "${protocol.name}" assigned to ${patientName}`, 'success');
    onConfirmed();
  }

  return (
    <Modal open={open} onClose={onClose} title="Assignment preview" size="lg" hideClose={false}>
      <div className="space-y-4">
        <p className="text-[13px] text-[var(--color-text-secondary)]">
          Assigning{' '}
          <span className="font-semibold text-[var(--color-text)]">{protocol.name}</span> to{' '}
          <span className="font-semibold text-[var(--color-text)]">{patientName}</span>
        </p>

        {loading ? (
          <div className="space-y-2" aria-busy="true">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-10 w-full rounded-card" />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-4 mb-4">
            {/* Left column header */}
            <p className="text-[13px] font-semibold text-[var(--color-text)]">Current schedule</p>
            {/* Right column header */}
            <p className="text-[13px] font-semibold text-[var(--color-text)]">
              Protocol expectation
            </p>

            {diffRows.length === 0 ? (
              <>
                <p className="text-[13px] text-[var(--color-text-secondary)] col-span-2">
                  No step data available for this protocol.
                </p>
              </>
            ) : (
              diffRows.map((row) => (
                <>
                  {/* Left: patient's current dose */}
                  <div key={`left-${row.week}`} className="text-[13px]">
                    <span
                      className={
                        row.differs
                          ? 'text-[var(--color-warning)]'
                          : 'text-[var(--color-text-secondary)]'
                      }
                    >
                      Week {row.week} &bull;{' '}
                      {row.patientDose !== null ? `${row.patientDose}mg` : '—'}
                    </span>
                  </div>
                  {/* Right: protocol expectation */}
                  <div key={`right-${row.week}`} className="text-[13px]">
                    <span
                      className={
                        row.differs
                          ? 'text-[var(--color-warning)]'
                          : 'text-[var(--color-text-secondary)]'
                      }
                    >
                      Week {row.week} &bull; {row.protocolDose}mg {row.frequency}
                    </span>
                  </div>
                </>
              ))
            )}
          </div>
        )}

        {/* Footer action row */}
        <div className="flex items-center justify-end gap-2 pt-2 border-t border-[var(--color-border)]">
          <button
            type="button"
            className="text-[13px] text-[var(--color-text-secondary)] px-4 py-2 rounded-pill border border-[var(--color-border-strong)] hover:border-[var(--color-primary)] hover:text-[var(--color-primary)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
            onClick={onClose}
          >
            Keep current schedule
          </button>
          <button
            type="button"
            aria-busy={assigning}
            disabled={assigning}
            className="min-h-[44px] px-5 text-[13px] font-semibold rounded-pill bg-[var(--color-primary)] text-[var(--color-primary-foreground)] hover:bg-[var(--color-primary-hover)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] disabled:opacity-50 disabled:pointer-events-none"
            onClick={() => void handleAssign()}
          >
            {assigning ? 'Assigning…' : 'Assign to patient'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
