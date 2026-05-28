/**
 * Phase 10 Plan 10-05 — DoctorReportSection
 *
 * Extracted from Phase 8 SharePage. Accepts the doctor_report slice of SnapshotData.
 * Calls onMount once on first render with section name 'doctor_report' (useRef guard).
 *
 * DoctorReport is lazy-loaded so it rides its existing dashboard modal chunk.
 * The snapshot prop passes the report data through without touching Zustand store.
 */

import { Suspense, lazy, useEffect, useRef } from 'react';
import { Card } from '@/components/ui/Card';
import { Skeleton } from '@/components/ui/Skeleton';
import type { SnapshotData } from '@/types/snapshot';

// Lazy-load DoctorReport to ride its existing dashboard modal chunk (no new chunk cost).
const DoctorReport = lazy(() =>
  import('@/components/dashboard/modals/DoctorReport').then((m) => ({ default: m.DoctorReport })),
);

export interface DoctorReportSectionProps {
  data: SnapshotData['doctor_report'];
  viewerMode: 'share' | 'clinic';
  onMount?: (name: string) => void;
}

/**
 * Build a minimal SnapshotResponse['snapshot'] shape for DoctorReport's
 * `snapshot` prop from the DoctorReportSection's `data` prop.
 */
function buildDoctorReportSnapshot(data: NonNullable<SnapshotData['doctor_report']>) {
  return {
    user_id: '',
    patient_first_name: '',
    injections: [] as Array<{
      log_id: string;
      timestamp: string;
      medication: string;
      dose: number;
      unit: string;
      site: string;
    }>,
    weights: [] as Array<{ id: string; timestamp: string; weight_kg: number }>,
    symptoms: [] as Array<{ id: string; timestamp: string; symptom: string; severity: number }>,
    photos: [] as Array<{ id: string; timestamp: string; signed_url: string }>,
    doctor_report: data,
  };
}

export function DoctorReportSection({
  data,
  viewerMode: _viewerMode,
  onMount,
}: DoctorReportSectionProps) {
  const firedRef = useRef(false);

  useEffect(() => {
    if (onMount && !firedRef.current) {
      firedRef.current = true;
      onMount('doctor_report');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-[18px] font-semibold">Doctor report</h2>
      <Card padding="md">
        {data == null ? (
          <p className="text-[13px] text-[var(--color-text-tertiary)]">
            No doctor report available.
          </p>
        ) : (
          <Suspense fallback={<Skeleton className="h-32 w-full" />}>
            <DoctorReport
              open
              onClose={() => {}}
              snapshot={buildDoctorReportSnapshot(data)}
              readOnly
            />
          </Suspense>
        )}
      </Card>
    </section>
  );
}
