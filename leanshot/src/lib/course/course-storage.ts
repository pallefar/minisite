/**
 * Phase 46 Plan 08 — course-resources Storage helpers.
 *
 * Analog: src/lib/community/community-storage.ts (Phase 44 Plan 03).
 * Mirrors the validation-first + typed Result pattern.
 *
 * D-16 / COURSE-06: lesson resources (PDF / MP4 / ZIP) live in the
 * `course-resources` private bucket (Plan 46-02). Read RLS gates on
 * tier_effective.has_active — Free users get 403 (UI shows upgrade CTA).
 *
 * Bucket policy is the durable enforcement boundary; this helper is the
 * client-side fetch path that turns a stored path into a 60-min signed URL
 * the browser can open in a new tab.
 *
 * 60-min TTL matches the project-wide signed-URL TTL convention
 * (page-assets, community-media, dm-attachments) per D-16 + threat T-46-08.
 *
 * THREAT BOUNDARY (T-46-06 path traversal): the `path` argument MUST come
 * from a SECDEF-validated source — specifically `course_lessons.resources`
 * (jsonb, written by the admin LessonResourceUploader in Plan 46-09). The
 * RLS path-prefix check on the bucket is the secondary defense.
 */
import { supabase } from '@/lib/supabase';

// ─── Constants ────────────────────────────────────────────────────────────────

export const COURSE_RESOURCES_BUCKET = 'course-resources' as const;

const SIGNED_URL_TTL = 3600; // 60 min per D-16

/**
 * MIME whitelist for lesson resources (D-16).
 *
 * `application/pdf` → student handouts / worksheets
 * `video/mp4`       → supplementary downloadable clips (separate from Mux HLS playback)
 * `application/zip` → bundled archives (e.g. course datasets)
 *
 * Intentionally narrow — image attachments live on community posts, not
 * lesson resources. SVG is excluded for the same XSS-defense reason as
 * community-media (cf. community-storage.ts).
 */
export const COURSE_RESOURCES_MIMES: ReadonlySet<string> = new Set([
  'application/pdf',
  'video/mp4',
  'application/zip',
]);

/** 200 MB per resource per D-16 — accommodates lesson MP4 bundles. */
export const COURSE_RESOURCES_MAX_BYTES = 200 * 1024 * 1024;

// ─── Types ────────────────────────────────────────────────────────────────────

export type DownloadResourceError = 'forbidden' | 'not_found' | 'network';

export type DownloadResourceResult =
  | { ok: true; url: string }
  | { ok: false; error: DownloadResourceError };

// ─── Signed URL helper ────────────────────────────────────────────────────────

/**
 * Generate a 60-minute signed URL for a `course-resources` bucket object.
 *
 * Error mapping (advisory UX; RLS is the enforcement boundary):
 *   - Storage error message containing 'forbidden' / 'not authorized' → 'forbidden'
 *     (UI: render upgrade CTA — user is below the required tier).
 *   - Storage error containing 'not found' / 'object not found'        → 'not_found'
 *   - Anything else (network, unknown SDK error)                       → 'network'
 *
 * The bucket is PRIVATE — there is no public-URL fallback. Callers MUST gate
 * the download button with `isResourceAllowed(tier, resourceType)` (Plan 46-03)
 * BEFORE invoking this helper so Free users don't hit the 403 path needlessly.
 *
 * @param path — storage object key, e.g. `lesson_<uuid>/<filename>.pdf`
 *               (path layout established by Plan 46-09 LessonResourceUploader).
 */
export async function downloadResourceSignedUrl(
  path: string,
): Promise<DownloadResourceResult> {
  try {
    const { data, error } = await supabase.storage
      .from(COURSE_RESOURCES_BUCKET)
      .createSignedUrl(path, SIGNED_URL_TTL);

    if (error || !data) {
      const msg = (error?.message ?? '').toLowerCase();
      if (msg.includes('forbidden') || msg.includes('not authorized')) {
        return { ok: false, error: 'forbidden' };
      }
      if (msg.includes('not found') || msg.includes('object not found')) {
        return { ok: false, error: 'not_found' };
      }
      return { ok: false, error: 'network' };
    }
    return { ok: true, url: data.signedUrl };
  } catch {
    return { ok: false, error: 'network' };
  }
}

// ─── MIME → resource type helper ──────────────────────────────────────────────

/**
 * Map a resource MIME to the ResourceType discriminator used by
 * `isResourceAllowed(tier, type)` in `src/lib/community/tier-gate.ts`.
 *
 * Returns the most specific match; defaults to 'pdf' for unknown MIMEs so
 * the tier gate still fires (rather than silently bypassing it). The MIME
 * whitelist + bucket RLS are the actual enforcement boundaries.
 */
export function mimeToResourceType(mime: string): 'pdf' | 'video' | 'zip' {
  if (mime === 'application/pdf') return 'pdf';
  if (mime === 'video/mp4') return 'video';
  if (mime === 'application/zip') return 'zip';
  return 'pdf';
}
