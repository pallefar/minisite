/**
 * Phase 23 Plan 23-04 (DEBT-03) — Photo Trash modal.
 *
 * Lazy-loaded from BodyTab.tsx via:
 *   const PhotoTrashView = lazy(() =>
 *     import('@/components/dashboard/photos/PhotoTrashView').then((m) => ({
 *       default: m.PhotoTrashView,
 *     }))
 *   );
 *
 * Renders trashed photos fetched from Supabase (WHERE trashed_at IS NOT NULL),
 * with per-photo "Restore" + "Delete permanently now" actions and an
 * "auto-deletes in N days" label computed from trashed_at.
 *
 * RLS scopes the query to auth.uid() = user_id — no explicit user_id filter
 * needed on the client side.
 */
import { RotateCcw, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { Modal } from '@/components/ui/Modal';
import { Skeleton } from '@/components/ui/Skeleton';
import { useToast } from '@/hooks/useToast';
import { formatShort } from '@/lib/helpers';
import { deletePhotoPermanently, restorePhoto } from '@/lib/photo-trash';
import { storageTransformUrl } from '@/lib/photo-url';
import { supabase } from '@/lib/supabase';
import type { Photo } from '@/types';

export interface PhotoTrashViewProps {
  open: boolean;
  onClose: () => void;
}

/** Days remaining until a trashed photo is auto-deleted (30-day window). */
function daysRemaining(trashed_at: string): number {
  const trashedMs = new Date(trashed_at).getTime();
  const expireMs = trashedMs + 30 * 24 * 60 * 60 * 1000;
  const remaining = Math.ceil((expireMs - Date.now()) / (24 * 60 * 60 * 1000));
  return Math.max(0, remaining);
}

export function PhotoTrashView({ open, onClose }: PhotoTrashViewProps) {
  const [trashed, setTrashed] = useState<Photo[]>([]);
  const [loading, setLoading] = useState(false);
  const toast = useToast();

  useEffect(() => {
    if (!open) return;

    let cancelled = false;
    setLoading(true);

    void (async () => {
      try {
        const { data, error } = await supabase
          .from('photos')
          .select('*')
          .not('trashed_at', 'is', null)
          .order('trashed_at', { ascending: false });

        if (cancelled) return;
        if (error) {
          console.error('[leanshot] PhotoTrashView fetch failed', error.message);
          toast('Could not load trash', 'error');
          setTrashed([]);
        } else {
          setTrashed((data ?? []) as Photo[]);
        }
      } catch (err) {
        if (!cancelled) {
          console.error('[leanshot] PhotoTrashView fetch threw', err);
          toast('Could not load trash', 'error');
          setTrashed([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleRestore = async (photo: Photo): Promise<void> => {
    try {
      await restorePhoto(photo.photo_id);
      setTrashed((prev) => prev.filter((p) => p.photo_id !== photo.photo_id));
      toast('Photo restored');
    } catch {
      toast('Restore failed', 'error');
    }
  };

  const handleDeleteNow = async (photo: Photo): Promise<void> => {
    try {
      await deletePhotoPermanently(photo.photo_id, photo.storage_path);
      setTrashed((prev) => prev.filter((p) => p.photo_id !== photo.photo_id));
      toast('Photo permanently deleted');
    } catch {
      toast('Delete failed', 'error');
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Trash" size="lg">
      {loading ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {[1, 2, 3].map((n) => (
            <Skeleton key={n} shape="rect" className="aspect-[3/4] rounded-xl" />
          ))}
        </div>
      ) : trashed.length === 0 ? (
        <EmptyState
          inline
          title="No photos in trash"
          body="Photos you delete appear here for 30 days before permanent removal."
        />
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3" data-testid="photo-trash-grid">
          {trashed.map((photo) => {
            const days = photo.trashed_at ? daysRemaining(photo.trashed_at) : 0;
            const thumbUrl = photo.storage_path
              ? storageTransformUrl(photo.storage_path, { width: 200, height: 200 })
              : null;
            return (
              <div
                key={photo.photo_id}
                className="flex flex-col gap-2 rounded-xl overflow-hidden border border-[var(--color-border)] bg-[var(--color-surface-elevated)]"
                data-testid={`trash-photo-${photo.photo_id}`}
              >
                {/* Thumbnail */}
                <div className="relative aspect-[3/4] bg-[var(--color-surface)]">
                  {thumbUrl ? (
                    <img
                      src={thumbUrl}
                      alt={`From ${photo.date}`}
                      width={200}
                      height={200}
                      loading="lazy"
                      decoding="async"
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-[var(--color-text-tertiary)] text-[12px]">
                      No preview
                    </div>
                  )}
                </div>

                {/* Caption */}
                <div className="px-2 pb-1 flex flex-col gap-0.5">
                  <p className="text-[12px] font-semibold">{formatShort(photo.date)}</p>
                  <p className="text-[11px] text-[var(--color-warning,#b45309)]">
                    {days > 0
                      ? `Auto-deletes in ${days} day${days === 1 ? '' : 's'}`
                      : 'Deletes today'}
                  </p>
                </div>

                {/* Actions */}
                <div className="px-2 pb-2 flex flex-col gap-1.5">
                  <Button
                    variant="secondary"
                    size="sm"
                    block
                    leadingIcon={<RotateCcw className="size-3.5" aria-hidden />}
                    onClick={() => void handleRestore(photo)}
                    data-testid={`restore-btn-${photo.photo_id}`}
                  >
                    Restore
                  </Button>
                  <Button
                    variant="destructive"
                    size="sm"
                    block
                    leadingIcon={<Trash2 className="size-3.5" aria-hidden />}
                    onClick={() => void handleDeleteNow(photo)}
                    data-testid={`delete-now-btn-${photo.photo_id}`}
                  >
                    Delete now
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Modal>
  );
}
