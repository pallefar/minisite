/**
 * Phase 44 Plan 03 — Community Feed Foundation: Community media storage helpers.
 *
 * Analog: src/lib/page-builder/page-assets.ts (Phase 15 Plan 09).
 * Mirrors the validation-first pattern: size check → MIME check → upload.
 * Returns typed Result objects (never throws) so callers branch on error codes.
 *
 * T-44-04 storage path traversal mitigation:
 *   Path constructed as `${userId}/${postId}/${crypto.randomUUID()}.${ext}`
 *   Storage RLS (Plan 44-01) enforces `(storage.foldername(name))[1] = auth.uid()::text`
 *   so even a tampered client cannot write under another user's prefix.
 *
 * D-04:
 *   - Per-post image cap = 10 (enforced by assertImageCap client-side + DB trigger in 44-01)
 *   - Signed URL TTL = 60 min (3600 seconds)
 *   - MIME whitelist: image/jpeg, image/png, image/webp (no SVG — T-44-05 SVG-XSS defense)
 */
import { supabase } from '@/lib/supabase';

// ─── Constants ────────────────────────────────────────────────────────────────

export const COMMUNITY_MEDIA_BUCKET = 'community-media' as const;

const SIGNED_URL_TTL = 3600; // 60 min per D-04

// No SVG per security threat table (T-44-05: SVG can embed script content)
export const COMMUNITY_MEDIA_MIMES: ReadonlySet<string> = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
]);

// Exported so CommunityImageUploader can enforce the same limit client-side
export const COMMUNITY_MEDIA_MAX_BYTES = 10 * 1024 * 1024; // 10 MB per file

const MIME_TO_EXT: Record<string, string> = {
  'image/jpeg': 'jpeg',
  'image/png': 'png',
  'image/webp': 'webp',
};

// ─── Types ────────────────────────────────────────────────────────────────────

export type CommunityUploadError = 'file_too_large' | 'invalid_mime' | 'network';

export type CommunityUploadResult =
  | { ok: true; path: string }
  | { ok: false; error: CommunityUploadError };

// ─── Image cap helper (COMMUNITY-04 client-side gate) ─────────────────────────

/**
 * Assert that the current image count is within the per-post cap (D-04: 10 images).
 *
 * This is the CLIENT-SIDE gate; the authoritative server-side gate is the
 * DB trigger on community_post_media (Plan 44-01).
 *
 * @param currentCount — number of images already attached to the post
 * @returns { ok: true } when under cap, { ok: false, error: 'image_cap_reached' } at/over cap
 */
export function assertImageCap(
  currentCount: number,
): { ok: true } | { ok: false; error: 'image_cap_reached' } {
  if (currentCount >= 10) {
    return { ok: false, error: 'image_cap_reached' };
  }
  return { ok: true };
}

// ─── Upload helper ────────────────────────────────────────────────────────────

/**
 * Upload an image to the `community-media` bucket.
 *
 * Validation order (mirrors page-assets.ts pattern):
 *   1. file_too_large if file.size > 10 MB
 *   2. invalid_mime if file.type is not in the jpeg/png/webp set
 *   3. network for any supabase error or thrown exception
 *
 * On success returns { ok: true, path } where path is the storage object key.
 * The signed URL for display is fetched separately via getCommunityMediaSignedUrl.
 *
 * Path format: `${userId}/${postId}/${crypto.randomUUID()}.${ext}`
 * The userId prefix is required for RLS enforcement (T-44-04).
 */
export async function uploadCommunityMedia(
  file: File,
  userId: string,
  postId: string,
): Promise<CommunityUploadResult> {
  if (file.size > COMMUNITY_MEDIA_MAX_BYTES) {
    return { ok: false, error: 'file_too_large' };
  }
  if (!COMMUNITY_MEDIA_MIMES.has(file.type)) {
    return { ok: false, error: 'invalid_mime' };
  }

  const ext = MIME_TO_EXT[file.type] ?? 'jpeg';
  const path = `${userId}/${postId}/${crypto.randomUUID()}.${ext}`;

  try {
    const { error } = await supabase.storage
      .from(COMMUNITY_MEDIA_BUCKET)
      .upload(path, file, { contentType: file.type, upsert: false });
    if (error) return { ok: false, error: 'network' };
    return { ok: true, path };
  } catch {
    return { ok: false, error: 'network' };
  }
}

// ─── Signed URL helper ────────────────────────────────────────────────────────

/**
 * Generate a 60-minute signed URL for a community media object.
 *
 * Analog: page-assets.ts `listPageAssets` signed URL approach.
 * TTL = 3600s per D-04 (matches page-assets bucket pattern).
 */
export async function getCommunityMediaSignedUrl(
  path: string,
): Promise<{ url: string } | { error: string }> {
  const { data, error } = await supabase.storage
    .from(COMMUNITY_MEDIA_BUCKET)
    .createSignedUrl(path, SIGNED_URL_TTL);
  if (error || !data) return { error: 'network' };
  return { url: data.signedUrl };
}
