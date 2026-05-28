/**
 * Phase 10 Plan 10-05 — SymptomsSection
 *
 * Extracted from Phase 8 SharePage. Accepts the symptoms slice of SnapshotData.
 * Calls onMount once on first render with section name 'symptoms' (useRef guard).
 */

import { useEffect, useRef } from 'react';
import { Card } from '@/components/ui/Card';
import { formatShort } from '@/lib/helpers';
import type { SnapshotData } from '@/types/snapshot';

export interface SymptomsSectionProps {
  data: SnapshotData['symptoms'];
  viewerMode: 'share' | 'clinic';
  onMount?: (name: string) => void;
}

export function SymptomsSection({ data, viewerMode: _viewerMode, onMount }: SymptomsSectionProps) {
  const firedRef = useRef(false);

  useEffect(() => {
    if (onMount && !firedRef.current) {
      firedRef.current = true;
      onMount('symptoms');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-[18px] font-semibold">Symptoms</h2>
      <Card padding="md">
        {data.length === 0 ? (
          <p className="text-[13px] text-[var(--color-text-tertiary)]">No symptoms logged.</p>
        ) : (
          <ul className="flex flex-col gap-2 text-[13px]">
            {data.slice(0, 20).map((s) => (
              <li
                key={s.id}
                className="flex items-center justify-between gap-3 py-1.5 border-b border-[var(--color-border)] last:border-b-0"
              >
                <span>{formatShort(s.recorded_at)}</span>
                <span>{s.name}</span>
                <span className="font-bold numerals-tabular">{s.severity}/5</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </section>
  );
}
