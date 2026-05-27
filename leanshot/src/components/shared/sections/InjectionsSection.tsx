/**
 * Phase 10 Plan 10-05 — InjectionsSection
 *
 * Extracted from Phase 8 SharePage. Accepts the injections slice of SnapshotData,
 * renders a list of recent injections. Calls onMount once on first render with
 * section name 'injections' (useRef guard prevents double-fire per D-21).
 *
 * viewerMode: 'share' | 'clinic' — passed through for future photo-fetch
 * wiring (no-op in injections section; included for interface parity).
 */

import { useEffect, useRef } from 'react';
import { Card } from '@/components/ui/Card';
import { formatShort } from '@/lib/helpers';
import type { SnapshotData } from '@/types/snapshot';

export interface InjectionsSectionProps {
  data: SnapshotData['injections'];
  viewerMode: 'share' | 'clinic';
  onMount?: (name: string) => void;
}

export function InjectionsSection({ data, viewerMode: _viewerMode, onMount }: InjectionsSectionProps) {
  const firedRef = useRef(false);

  useEffect(() => {
    if (onMount && !firedRef.current) {
      firedRef.current = true;
      onMount('injections');
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-[18px] font-semibold">Recent injections</h2>
      <Card padding="md">
        {data.length === 0 ? (
          <p className="text-[13px] text-[var(--color-text-tertiary)]">None logged.</p>
        ) : (
          <ul className="flex flex-col gap-2 text-[13px]">
            {data.slice(0, 12).map((i) => (
              <li
                key={i.id}
                className="flex items-center justify-between gap-3 py-1.5 border-b border-[var(--color-border)] last:border-b-0"
              >
                <span>{formatShort(i.created_at)}</span>
                <span className="font-bold numerals-tabular">
                  {i.dose_mg} mg
                </span>
                <span className="text-[var(--color-text-secondary)]">{i.site || '—'}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </section>
  );
}
