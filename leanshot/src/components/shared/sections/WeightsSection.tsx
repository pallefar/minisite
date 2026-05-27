/**
 * Phase 10 Plan 10-05 — WeightsSection
 *
 * Extracted from Phase 8 SharePage. Accepts the weights slice of SnapshotData.
 * Calls onMount once on first render with section name 'weights' (useRef guard).
 */

import { useEffect, useRef } from 'react';
import { Card } from '@/components/ui/Card';
import { formatShort } from '@/lib/helpers';
import type { SnapshotData } from '@/types/snapshot';

export interface WeightsSectionProps {
  data: SnapshotData['weights'];
  viewerMode: 'share' | 'clinic';
  onMount?: (name: string) => void;
}

export function WeightsSection({ data, viewerMode: _viewerMode, onMount }: WeightsSectionProps) {
  const firedRef = useRef(false);

  useEffect(() => {
    if (onMount && !firedRef.current) {
      firedRef.current = true;
      onMount('weights');
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-[18px] font-semibold">Weight log</h2>
      <Card padding="md">
        {data.length === 0 ? (
          <p className="text-[13px] text-[var(--color-text-tertiary)]">No entries.</p>
        ) : (
          <ul className="flex flex-col gap-2 text-[13px]">
            {data
              .slice(-15)
              .reverse()
              .map((w) => (
                <li
                  key={w.id}
                  className="flex items-center justify-between gap-3 py-1.5 border-b border-[var(--color-border)] last:border-b-0"
                >
                  <span>{formatShort(w.recorded_at)}</span>
                  <span className="font-bold numerals-tabular">
                    {w.weight_kg.toFixed(1)} kg
                  </span>
                </li>
              ))}
          </ul>
        )}
      </Card>
    </section>
  );
}
