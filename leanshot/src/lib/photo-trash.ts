/**
 * Phase 23 Plan 23-04 (DEBT-03) — Photo trash pure RPC helpers.
 *
 * Three helpers for the soft-delete / restore / permanent-delete lifecycle:
 *
 *   softDeletePhoto    — sets trashed_at = NOW() (RLS scopes to caller's rows)
 *   restorePhoto       — nulls trashed_at (un-deletes from Trash view)
 *   deletePhotoPermanently — removes Storage object then DB row
 *
 * No `s.user!` or explicit user_id filter needed here — the existing RLS
 * policies (photos_update_own, photos_delete_own) enforce auth.uid() = user_id
 * server-side, so any photo_id that doesn't belong to the caller is a no-op.
 *
 * deletePhotoPermanently order: Storage API first, then DB row. This matches
 * the account-delete cascade pattern (Phase 19). If Storage removal fails, we
 * log the error and continue to DB delete — the DB row is authoritative; a
 * dangling Storage object is cleaned up by the photos-trash-purge cron's own
 * Storage sweep. The reverse order (DB first) would leave an orphaned DB row
 * on Storage failure, making it invisible to any recovery path.
 */

import { supabase } from '@/lib/supabase';

/**
 * Soft-delete a photo by setting trashed_at to the current time.
 * The photo disappears from the main grid (WHERE trashed_at IS NULL) and
 * appears in the Trash view. Call restorePhoto to undo.
 *
 * @throws if the DB update fails (let callers show a toast).
 */
export async function softDeletePhoto(photo_id: string): Promise<void> {
  const { error } = await supabase
    .from('photos')
    .update({ trashed_at: new Date().toISOString() })
    .eq('photo_id', photo_id);

  if (error) {
    throw new Error(`softDeletePhoto failed: ${error.message}`);
  }
}

/**
 * Restore a soft-deleted photo by nulling trashed_at.
 * The photo reappears in the main grid and disappears from the Trash view.
 *
 * @throws if the DB update fails (let callers show a toast).
 */
export async function restorePhoto(photo_id: string): Promise<void> {
  const { error } = await supabase
    .from('photos')
    .update({ trashed_at: null })
    .eq('photo_id', photo_id);

  if (error) {
    throw new Error(`restorePhoto failed: ${error.message}`);
  }
}

/**
 * Permanently delete a photo — removes the Storage object then the DB row.
 *
 * Storage failure is logged and swallowed — the DB delete still proceeds.
 * This matches the account-delete cascade pattern (Phase 19): a dangling
 * Storage object is harmless vs. an orphaned DB row (which would be invisible
 * to any recovery path). The photos-trash-purge cron also performs a Storage
 * sweep, so any leaked objects are cleaned up eventually.
 *
 * @throws if the DB delete fails (let callers show a toast).
 */
export async function deletePhotoPermanently(
  photo_id: string,
  storage_path: string,
): Promise<void> {
  // Step 1: Storage removal (best-effort — failure does NOT block DB delete)
  try {
    await supabase.storage.from('photos').remove([storage_path]);
  } catch (storageErr) {
    console.error(
      '[leanshot] deletePhotoPermanently: Storage remove failed (continuing to DB delete)',
      storageErr instanceof Error ? storageErr.message : 'unknown',
    );
  }

  // Step 2: DB row delete (authoritative — throw on failure)
  const { error } = await supabase.from('photos').delete().eq('photo_id', photo_id);

  if (error) {
    throw new Error(`deletePhotoPermanently: DB delete failed: ${error.message}`);
  }
}
