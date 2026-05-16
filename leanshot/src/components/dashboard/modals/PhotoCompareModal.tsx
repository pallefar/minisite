import { useEffect, useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import { formatShort } from '@/lib/helpers';
import { cn } from '@/lib/helpers';
// Phase 16 Plan 16-01 Task 4 — Pro-tier Supabase Storage transform URL
// builder used for compare-modal thumbnails (400×400 budget; larger than
// BodyTab's 200×200 because compare view uses the larger card surface).
// Free tier returns 404 today; PhotoImg references the transformed URL
// in `data-transform-url` for the post-Pro-upgrade swap (Wave-0
// vendor-checkpoint Task 6).
import { storageTransformUrl } from '@/lib/photo-url';
import { useStore } from '@/lib/store';
import type { Photo } from '@/types';

export function PhotoCompareModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  // Phase 7 Plan 07-09 (D-06): nullable selector + early-return after hooks.
  const photos = useStore((s) => s.photos);
  const u = useStore((s) => s.user);
  const [sel, setSel] = useState<number[]>([photos.length - 1, 0].filter((n) => n >= 0));

  if (!u) return null;

  const wU = u.units === 'metric' ? 'kg' : 'lb';

  const toggle = (i: number): void => {
    setSel((prev) => {
      const found = prev.indexOf(i);
      if (found >= 0) return prev.filter((x) => x !== i);
      const next = [...prev];
      if (next.length >= 2) next.shift();
      next.push(i);
      return next;
    });
  };

  const sorted = [...sel].sort(
    (a, b) => new Date(photos[a]?.date ?? 0).getTime() - new Date(photos[b]?.date ?? 0).getTime(),
  );
  const left = sorted[0] != null ? photos[sorted[0]] : null;
  const right = sorted[1] != null ? photos[sorted[1]] : null;

  const days =
    left && right
      ? Math.round((new Date(right.date).getTime() - new Date(left.date).getTime()) / 86_400_000)
      : null;
  const wDelta = left?.weight != null && right?.weight != null ? right.weight - left.weight : null;

  return (
    <Modal open={open} onClose={onClose} title="Compare photos" size="lg" mobileFullscreen>
      <p className="text-[13px] text-[var(--color-text-secondary)] mb-3">
        Tap two photos to compare side-by-side.
      </p>
      <div className="grid grid-cols-2 gap-3 mb-4">
        <Side photo={left ?? null} side="Before" units={wU} />
        <Side photo={right ?? null} side="After" units={wU} />
      </div>
      {left && right && (
        <div className="rounded-2xl bg-[var(--color-primary-soft)] border border-[var(--color-primary-soft)] p-4 flex flex-wrap items-center justify-center gap-x-6 gap-y-3 text-center mb-4">
          <DeltaStat label="Days apart" value={Math.abs(days ?? 0).toString()} />
          {wDelta != null && (
            <DeltaStat
              label={`Weight Δ`}
              value={`${wDelta < 0 ? '−' : '+'}${Math.abs(wDelta).toFixed(1)} ${wU}`}
            />
          )}
          {left.weight && wDelta != null && (
            <DeltaStat
              label="Body weight"
              value={`${((wDelta / left.weight) * 100).toFixed(1)}%`}
            />
          )}
        </div>
      )}
      <p className="text-[13px] font-semibold mb-2">Choose photos to compare</p>
      <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
        {photos.map((p, i) => {
          const selected = sel.includes(i);
          return (
            <button
              key={p.photo_id ?? i}
              onClick={() => toggle(i)}
              aria-pressed={selected}
              className={cn(
                'relative aspect-[3/4] rounded-xl overflow-hidden border-2 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]',
                selected
                  ? 'border-[var(--color-primary)]'
                  : 'border-transparent hover:border-[var(--color-border-strong)]',
              )}
            >
              <PhotoImg photo={p} />
              <span className="absolute bottom-0 inset-x-0 px-1.5 py-1 bg-gradient-to-t from-black/85 to-transparent text-white text-[10px] font-semibold">
                {formatShort(p.date)}
              </span>
              {selected && (
                <span className="absolute top-1 left-1 size-5 rounded-full bg-[var(--color-primary)] text-white inline-flex items-center justify-center text-[12px] font-bold">
                  {sel.indexOf(i) + 1}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </Modal>
  );
}

function Side({ photo, side, units }: { photo: Photo | null; side: string; units: string }) {
  return (
    <div className="rounded-2xl bg-[var(--color-surface-elevated)] border border-[var(--color-border)] overflow-hidden">
      {photo ? (
        <PhotoImg photo={photo} className="aspect-[3/4] w-full object-cover" />
      ) : (
        <div className="aspect-[3/4] flex items-center justify-center text-[12px] text-[var(--color-text-tertiary)]">
          Tap a photo below
        </div>
      )}
      <div className="p-3">
        <p className="text-[10px] font-bold uppercase tracking-[0.08em] text-[var(--color-text-tertiary)]">
          {side}
          {photo ? ` · ${formatShort(photo.date)}` : ''}
        </p>
        <p className="text-[18px] font-bold mt-0.5">
          {photo?.weight != null ? `${photo.weight.toFixed(1)} ${units}` : '—'}
        </p>
      </div>
    </div>
  );
}

/**
 * Phase 6 06-04 — resolves the displayable URL for a photo across the
 * 4-state matrix (loaded / queued-for-upload / signed-url-failed). The
 * "loading-signed-url" skeleton is omitted here in favor of a transparent
 * placeholder because the compare-modal grid intentionally renders all
 * tiles in parallel and a flash of skeletons across the grid is noisier
 * than a brief blank frame.
 */
function PhotoImg({ photo, className }: { photo: Photo; className?: string }) {
  const [url, setUrl] = useState<string | null>(null);

  // Phase 16 Plan 16-01 Task 4 — Pro-tier transform URL pre-computed for
  // the compare-modal thumbnail budget (400×400 cover q=75). Stored in
  // `data-transform-url` for the post-Pro-upgrade swap (Wave-0
  // vendor-checkpoint Task 6).
  const transformedUrl = photo.storage_path
    ? storageTransformUrl(photo.storage_path, { width: 400, height: 400 })
    : null;

  useEffect(() => {
    let cancelled = false;
    let createdObjectUrl: string | null = null;
    (async () => {
      if (!photo.storage_path) {
        // Queued for upload → local blob preview
        try {
          const { getPhotoBlob } = await import('@/lib/photo-queue');
          const blob = await getPhotoBlob(photo.photo_id);
          if (cancelled) return;
          if (blob) {
            createdObjectUrl = URL.createObjectURL(blob);
            setUrl(createdObjectUrl);
          }
        } catch {
          /* noop */
        }
        return;
      }
      try {
        const { getSignedPhotoUrl } = await import('@/lib/signed-url-cache');
        const signed = await getSignedPhotoUrl(photo.storage_path);
        if (!cancelled) setUrl(signed);
      } catch {
        /* noop — render falls back to the placeholder */
      }
    })();
    return () => {
      cancelled = true;
      if (createdObjectUrl) URL.revokeObjectURL(createdObjectUrl);
    };
  }, [photo.storage_path, photo.photo_id]);

  if (!url) {
    return (
      <div
        className={cn(
          'w-full h-full absolute inset-0 bg-[var(--color-surface-elevated)]',
          className,
        )}
        aria-hidden
      />
    );
  }
  return (
    <img
      src={url}
      alt=""
      width={400}
      height={400}
      loading="lazy"
      decoding="async"
      data-transform-url={transformedUrl ?? undefined}
      className={cn('w-full h-full object-cover absolute inset-0', className)}
    />
  );
}

function DeltaStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[22px] font-extrabold tracking-tight text-[var(--color-primary)] numerals-tabular">
        {value}
      </p>
      <p className="text-[10px] uppercase tracking-[0.08em] text-[var(--color-text-secondary)] font-semibold">
        {label}
      </p>
    </div>
  );
}
