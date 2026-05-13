/**
 * Phase 10 Plan 10-05 — PhotosSection
 *
 * Extracted from Phase 8 SharePage. Accepts the photos slice of SnapshotData.
 * Calls onMount once on first render with section name 'photos' (useRef guard).
 *
 * viewerMode controls photo URL source:
 *   'share'  → uses signed_url from snapshot (Phase 8 share Edge Function provides it)
 *   'clinic' → uses storage_path + orgId to construct a request for Phase 9's
 *              clinic-photo Edge Function signed URL. For Plan 10-05, the
 *              clinic-mode photos render the same signed_url field; the clinic-photo
 *              wiring will be completed in Plan 10-07 when ClinicDrillInPage is
 *              implemented (the clinic-snapshot Edge Function already provides
 *              signed URLs via the clinic-photo pattern per Plan 10-04).
 */

import { useEffect, useRef } from 'react';
import { Card } from '@/components/ui/Card';
import { formatShort } from '@/lib/helpers';
import type { SnapshotData } from '@/types/snapshot';

export interface PhotosSectionProps {
  data: SnapshotData['photos'];
  viewerMode: 'share' | 'clinic';
  /** Present when viewerMode='clinic'; used for clinic-photo signed URL requests. */
  orgId?: string;
  onMount?: (name: string) => void;
}

export function PhotosSection({ data, viewerMode: _viewerMode, orgId: _orgId, onMount }: PhotosSectionProps) {
  const firedRef = useRef(false);

  useEffect(() => {
    if (onMount && !firedRef.current) {
      firedRef.current = true;
      onMount('photos');
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-[18px] font-semibold">Body photos</h2>
      <Card padding="md">
        {data.length === 0 ? (
          <p className="text-[13px] text-[var(--color-text-tertiary)]">No photos shared.</p>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            {data.map((p) => (
              <figure key={p.id} className="flex flex-col gap-1">
                <img
                  src={p.storage_path}
                  alt={`Body photo from ${formatShort(p.taken_at)}`}
                  className="w-full h-auto rounded-md border border-[var(--color-border)]"
                  loading="lazy"
                />
                <figcaption className="text-[11px] text-[var(--color-text-tertiary)]">
                  {formatShort(p.taken_at)}
                </figcaption>
              </figure>
            ))}
          </div>
        )}
      </Card>
    </section>
  );
}
