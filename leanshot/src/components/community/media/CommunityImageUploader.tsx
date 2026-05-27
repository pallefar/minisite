/**
 * Phase 44 Plan 08 — Community Feed Foundation: Image upload component.
 *
 * Enforces D-04: per-post image cap = 10 (client-side assertImageCap +
 * DB trigger in 44-01 as defense in depth).
 * Enforces T-44-05: MIME whitelist = image/jpeg, image/png, image/webp only.
 * No SVG allowed (SVG can embed script content).
 *
 * Path under media/ is CRITICAL for bundle hygiene:
 * 44-09's vite.config.ts manualChunks rule routes media/ to 'community-media',
 * keeping this component out of the 20 kB 'community-feed' chunk.
 */
import { useRef, useState } from 'react';
import {
  assertImageCap,
  COMMUNITY_MEDIA_MAX_BYTES,
  COMMUNITY_MEDIA_MIMES,
  uploadCommunityMedia,
} from '@/lib/community/community-storage';
import { supabase } from '@/lib/supabase';

// ─── Props ────────────────────────────────────────────────────────────────────

export interface CommunityImageUploaderProps {
  postId: string;
  currentUserId: string;
  /**
   * Number of images already attached to this post.
   * The uploader rejects the selection when existingMediaCount + selected files > 10 (D-04).
   */
  existingMediaCount: number;
  onUploaded: (uploaded: { path: string; display_order: number }[]) => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function CommunityImageUploader({
  postId,
  currentUserId,
  existingMediaCount,
  onUploaded,
}: CommunityImageUploaderProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [selected, setSelected] = useState<File[]>([]);
  const [previews, setPreviews] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const raw = Array.from(e.target.files ?? []);
    const newErrors: string[] = [];

    // Step 1 — MIME whitelist (T-44-05: no SVG)
    const mimeFiltered = raw.filter((f) => {
      if (!COMMUNITY_MEDIA_MIMES.has(f.type)) {
        newErrors.push(`${f.name}: unsupported file type (JPEG, PNG, or WebP only)`);
        return false;
      }
      return true;
    });

    // Step 2 — Size guard (10 MB per file)
    const sizeFiltered = mimeFiltered.filter((f) => {
      if (f.size > COMMUNITY_MEDIA_MAX_BYTES) {
        newErrors.push(`${f.name}: file exceeds 10 MB limit`);
        return false;
      }
      return true;
    });

    // Step 3 — 10-image cap check (D-04)
    const capResult = assertImageCap(existingMediaCount + sizeFiltered.length);
    if (!capResult.ok) {
      newErrors.push('Maximum 10 images per post');
      setErrors(newErrors);
      return;
    }

    setErrors(newErrors);
    setSelected(sizeFiltered);

    // Build preview URLs
    const newPreviews = sizeFiltered.map((f) => URL.createObjectURL(f));
    setPreviews((prev) => {
      prev.forEach((url) => URL.revokeObjectURL(url));
      return newPreviews;
    });
  }

  async function handleSubmit() {
    if (selected.length === 0) return;
    setUploading(true);
    setErrors([]);

    const uploaded: { path: string; display_order: number }[] = [];
    const uploadErrors: string[] = [];

    for (let i = 0; i < selected.length; i++) {
      const file = selected[i]!;
      const result = await uploadCommunityMedia(file, currentUserId, postId);
      if (!result.ok) {
        uploadErrors.push(`${file.name}: upload failed (${result.error})`);
        continue;
      }

      const displayOrder = existingMediaCount + uploaded.length + 1;

      // Insert into community_post_media (DB trigger enforces 10-cap as defense in depth, T-44-04)
      const { error: insertError } = await supabase
        .from('community_post_media')
        .insert({ post_id: postId, path: result.path, display_order: displayOrder });

      if (insertError) {
        uploadErrors.push(`${file.name}: failed to record attachment`);
        continue;
      }

      uploaded.push({ path: result.path, display_order: displayOrder });
    }

    setUploading(false);

    if (uploadErrors.length > 0) {
      setErrors(uploadErrors);
    }

    if (uploaded.length > 0) {
      onUploaded(uploaded);
      setSelected([]);
      setPreviews((prev) => {
        prev.forEach((url) => URL.revokeObjectURL(url));
        return [];
      });
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  return (
    <div className="flex flex-col gap-2">
      {/* Hidden file input — only JPEG/PNG/WebP (T-44-05: no image/svg+xml) */}
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        multiple
        className="sr-only"
        aria-label="Select images to upload (JPEG, PNG, or WebP)"
        onChange={handleFileChange}
        disabled={uploading}
      />

      {/* Trigger button */}
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={uploading || existingMediaCount >= 10}
        className="inline-flex items-center gap-1.5 rounded-md border border-[var(--color-border)] px-3 py-1.5 text-sm font-medium text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] disabled:cursor-not-allowed disabled:opacity-50"
      >
        {uploading ? 'Uploading…' : 'Add images'}
      </button>

      {/* Selected image previews */}
      {previews.length > 0 && (
        <ul
          aria-label={`${previews.length} image${previews.length === 1 ? '' : 's'} selected`}
          className="flex flex-wrap gap-2"
        >
          {previews.map((src, i) => (
            <li key={src}>
              <img
                src={src}
                alt={`Preview ${i + 1}`}
                width={64}
                height={64}
                className="h-16 w-16 rounded object-cover ring-1 ring-[var(--color-border)]"
              />
            </li>
          ))}
        </ul>
      )}

      {/* Upload button — only shown when files are selected and not yet uploading */}
      {selected.length > 0 && !uploading && (
        <button
          type="button"
          onClick={() => void handleSubmit()}
          className="self-start rounded-md bg-[var(--color-accent)] px-3 py-1.5 text-sm font-medium text-white hover:opacity-90"
        >
          Upload {selected.length} image{selected.length === 1 ? '' : 's'}
        </button>
      )}

      {/* Error messages */}
      {errors.length > 0 && (
        <ul aria-live="polite" className="flex flex-col gap-0.5">
          {errors.map((err) => (
            <li key={err} className="text-sm text-[var(--color-error)]">
              {err}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default CommunityImageUploader;
