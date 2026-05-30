/**
 * Phase 10 Plan 10-05 — ChartSection
 *
 * Extracted from Phase 8 SharePage. Renders the MedLevel chart via BaseChart
 * (lazy-loaded to ride its existing vendor-charts chunk).
 * Calls onMount once on first render with section name 'chart' (useRef guard).
 *
 * data: SnapshotData['injections'] — the chart derives the PK curve from
 * injection history. Weights are not passed separately since the chart
 * snapshot prop accepts the Phase 8 SnapshotResponse shape.
 */

import { Suspense, lazy, useEffect, useRef } from 'react';
import { Card } from '@/components/ui/Card';
import { Skeleton } from '@/components/ui/Skeleton';
import type { MedicationId } from '@/types';
import type { SnapshotData } from '@/types/snapshot';

// Lazy-load MedLevelChart so it rides the existing vendor-charts chunk.
const MedLevelChart = lazy(() =>
  import('@/components/dashboard/charts/MedLevelChart').then((m) => ({
    default: m.MedLevelChart,
  })),
);

export interface ChartSectionProps {
  data: SnapshotData['injections'];
  /**
   * The patient's medication (drives the PK curve half-life). When absent the
   * curve cannot be rendered correctly, so we show an explicit "unavailable"
   * state instead of falling back to the viewer's own drug.
   */
  medication?: MedicationId;
  viewerMode: 'share' | 'clinic';
  onMount?: (name: string) => void;
}

/**
 * Map SnapshotData['injections'] to the shape MedLevelChart's `injections` prop
 * expects (Phase 8 SnapshotResponse['snapshot']['injections']). The per-injection
 * `medication` field is required by that shape but unused by the curve math
 * (the top-level `medication` prop drives the half-life), so it carries the
 * patient's drug when known.
 */
function toChartInjections(data: SnapshotData['injections'], medication: MedicationId | undefined) {
  return data.map((i) => ({
    log_id: i.id,
    timestamp: i.created_at,
    medication: medication ?? '',
    dose: i.dose_mg,
    unit: 'mg',
    site: i.site,
  }));
}

export function ChartSection({
  data,
  medication,
  viewerMode: _viewerMode,
  onMount,
}: ChartSectionProps) {
  const firedRef = useRef(false);

  useEffect(() => {
    if (onMount && !firedRef.current) {
      firedRef.current = true;
      onMount('chart');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-[18px] font-semibold">Drug-level estimate</h2>
      <Card padding="md">
        {medication ? (
          <Suspense fallback={<Skeleton className="h-64 w-full" />}>
            <MedLevelChart
              injections={toChartInjections(data, medication)}
              weights={[]}
              medication={medication}
            />
          </Suspense>
        ) : (
          <p className="text-[14px] text-[var(--color-text-secondary)]">
            Drug-level estimate unavailable for this share.
          </p>
        )}
      </Card>
    </section>
  );
}
