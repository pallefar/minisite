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
import type { SnapshotData } from '@/types/snapshot';

// Lazy-load MedLevelChart so it rides the existing vendor-charts chunk.
const MedLevelChart = lazy(() =>
  import('@/components/dashboard/charts/MedLevelChart').then((m) => ({
    default: m.MedLevelChart,
  })),
);

export interface ChartSectionProps {
  data: SnapshotData['injections'];
  viewerMode: 'share' | 'clinic';
  onMount?: (name: string) => void;
}

/**
 * Map SnapshotData['injections'] to the shape MedLevelChart's `injections` prop
 * expects (Phase 8 SnapshotResponse['snapshot']['injections']).
 */
function toChartInjections(data: SnapshotData['injections']) {
  return data.map((i) => ({
    log_id: i.id,
    timestamp: i.created_at,
    medication: 'semaglutide',
    dose: i.dose_mg,
    unit: 'mg',
    site: i.site,
  }));
}

export function ChartSection({ data, viewerMode: _viewerMode, onMount }: ChartSectionProps) {
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
        <Suspense fallback={<Skeleton className="h-64 w-full" />}>
          <MedLevelChart injections={toChartInjections(data)} weights={[]} />
        </Suspense>
      </Card>
    </section>
  );
}
