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
// Phase 16 Plan 16-01 Task 4 — Pro-tier Supabase Storage transform URL
// builder. In viewerMode='share' / 'clinic' the `storage_path` field is
// pre-substituted by the Edge Function with a signed URL; the helper is
// referenced here to mark the surface for the post-Pro-upgrade swap
// (Wave-0 Task 6). Until then, `data-transform-url` is the swap target.
import { storageTransformUrl } from '@/lib/photo-url';
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
            {data.map((p) => {
              // Phase 16 Plan 16-01 Task 4 — Pro-tier transform URL for the
              // read-only share/clinic view (400×400 budget). Today the
              // `p.storage_path` field is a pre-signed URL from the Edge
              // Function; Wave-0 Task 6 (Pro upgrade) enables the swap.
              const transformedUrl = p.storage_path
                ? storageTransformUrl(p.storage_path, { width: 400, height: 400 })
                : null;
              return (
                <figure key={p.id} className="flex flex-col gap-1">
                  <img
                    src={p.storage_path}
                    alt={`Body photo from ${formatShort(p.taken_at)}`}
                    width={400}
                    height={400}
                    decoding="async"
                    data-transform-url={transformedUrl ?? undefined}
                    className="w-full h-auto rounded-md border border-[var(--color-border)]"
                    loading="lazy"
                  />
                  <figcaption className="text-[11px] text-[var(--color-text-tertiary)]">
                    {formatShort(p.taken_at)}
                  </figcaption>
                </figure>
              );
            })}
          </div>
        )}
      </Card>
    </section>
  );
}
