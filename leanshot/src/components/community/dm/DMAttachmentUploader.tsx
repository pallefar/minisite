/**
 * Phase 45 Plan 07b — DMAttachmentUploader.
 *
 * Single-image attachment uploader for DMs (caller passes exactly one file).
 *   - Cap = DM_ATTACHMENT_MAX_BYTES (5 MB per D-09; from 45-03).
 *   - MIME whitelist = COMMUNITY_MEDIA_MIMES (image/jpeg, image/png, image/webp;
 *     reuses the community-media set so the bucket policy stays uniform).
 *   - Uploads into the `dm-attachments` Storage bucket using a path shape that
 *     satisfies the 45-01 bucket RLS policy: `${threadId}/${messageId}/${uuid}.${ext}`.
 *
 * Server-side enforcement of MIME + size still owns the durable guarantee
 * (T-45-15); the client-side checks here are UX guards that fail fast and
 * surface a clear error before the network round-trip.
 *
 * Analog: CommunityImageUploader.tsx (45-03 storage helper pattern, with the
 * upload performed inline rather than via a generic helper because the path
 * shape and bucket differ).
 */
import { useRef, useState, type ChangeEvent, type JSX } from 'react';

import { useToast } from '@/hooks/useToast';
import {
  COMMUNITY_MEDIA_MIMES,
  DM_ATTACHMENT_MAX_BYTES,
  DM_ATTACHMENTS_BUCKET,
} from '@/lib/community/community-storage';
import { supabase } from '@/lib/supabase';

// ─── MIME → ext ──────────────────────────────────────────────────────────────
// Mirrors the MIME_TO_EXT map in community-storage.ts (kept local so this file
// doesn't reach into module-private state).
const MIME_TO_EXT: Record<string, string> = {
  'image/jpeg': 'jpeg',
  'image/png': 'png',
  'image/webp': 'webp',
};

export interface DMAttachmentUploaderProps {
  /** Required for path construction: `${threadId}/${messageId}/${uuid}.${ext}`. */
  threadId: string;
  /** Caller-supplied (the message id is known once the row inserts, but for
   *  pre-send uploads we use a placeholder message id so the path stays
   *  participant-scoped under the thread prefix). */
  pendingMessageId: string;
  /** Fires with the storage object path once upload succeeds. */
  onUploaded: (attachmentPath: string) => void;
  /** Fires when the user clears the chosen file. */
  onCleared?: () => void;
  /** Disable the file input (e.g. while parent is submitting). */
  disabled?: boolean;
}

export function DMAttachmentUploader({
  threadId,
  pendingMessageId,
  onUploaded,
  onCleared,
  disabled,
}: DMAttachmentUploaderProps): JSX.Element {
  const toast = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploadingName, setUploadingName] = useState<string | null>(null);
  const [uploadedPath, setUploadedPath] = useState<string | null>(null);

  const handleChange = async (e: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Size guard (5 MB per D-09; bucket policy enforces server-side too).
    if (file.size > DM_ATTACHMENT_MAX_BYTES) {
      toast('Attachment is too large. 5 MB max.', 'error');
      if (inputRef.current) inputRef.current.value = '';
      return;
    }
    // MIME guard (jpeg / png / webp — NO svg per T-44-05 SVG-XSS).
    if (!COMMUNITY_MEDIA_MIMES.has(file.type)) {
      toast('Unsupported file type. Use JPEG, PNG, or WebP.', 'error');
      if (inputRef.current) inputRef.current.value = '';
      return;
    }

    setUploadingName(file.name);
    const ext = MIME_TO_EXT[file.type] ?? 'jpeg';
    const path = `${threadId}/${pendingMessageId}/${crypto.randomUUID()}.${ext}`;

    try {
      const { error } = await supabase.storage
        .from(DM_ATTACHMENTS_BUCKET)
        .upload(path, file, { contentType: file.type, upsert: false });
      if (error) {
        toast('Upload failed. Please try again.', 'error');
        setUploadingName(null);
        if (inputRef.current) inputRef.current.value = '';
        return;
      }
      setUploadedPath(path);
      setUploadingName(null);
      onUploaded(path);
    } catch {
      toast('Upload failed. Please try again.', 'error');
      setUploadingName(null);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const handleClear = (): void => {
    setUploadedPath(null);
    if (inputRef.current) inputRef.current.value = '';
    onCleared?.();
  };

  return (
    <div className="flex items-center gap-2 text-xs">
      <label
        className={`inline-flex items-center gap-1 cursor-pointer px-2 py-1 rounded-md border border-[var(--color-border)] hover:bg-[var(--color-surface-elevated)] ${
          disabled ? 'opacity-50 pointer-events-none' : ''
        }`}
      >
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="sr-only"
          onChange={(e) => {
            void handleChange(e);
          }}
          disabled={disabled || uploadingName !== null}
          aria-label="Attach image"
        />
        <span aria-hidden="true">📎</span>
        <span>{uploadedPath ? 'Replace image' : 'Attach image'}</span>
      </label>
      {uploadingName ? (
        <span className="text-[var(--color-fg-muted)]" aria-live="polite">
          Uploading {uploadingName}…
        </span>
      ) : null}
      {uploadedPath && !uploadingName ? (
        <button
          type="button"
          onClick={handleClear}
          className="text-[var(--color-fg-muted)] hover:text-[var(--color-text)] underline"
          aria-label="Remove attached image"
        >
          Remove
        </button>
      ) : null}
    </div>
  );
}

export default DMAttachmentUploader;
