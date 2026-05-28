/**
 * Phase 15 Plan 09 — page-assets bucket wrappers.
 *
 * Mirrors `uploadOrgLogo` in `src/lib/clinic.ts`:
 *   • Client-side validates size (≤ 10 MB) + MIME type BEFORE upload.
 *   • Returns a typed Result<...> rather than throwing — callers branch on
 *     `error: 'file_too_large' | 'invalid_mime' | 'missing_alt' | 'network'`
 *     to render the UI-SPEC error copy without try/catch ceremony.
 *
 * D-13 enforcement (Lighthouse a11y ≥ 95): alt-text is REQUIRED on every
 * upload — `uploadPageAsset` rejects with `'missing_alt'` if `altText.trim()`
 * is empty. The AssetLibraryPicker UI gate is the primary surface, but the
 * server-side floor lives here.
 *
 * RLS gate: the `page-assets` bucket's INSERT/SELECT policies (15-01) scope
 * every operation to `profiles.is_staff = true`. A non-staff caller's
 * `upload()`/`list()` is denied by Postgres RLS — this module does NOT
 * re-implement an auth check (T-15-09-02).
 */
import { supabase } from '@/lib/supabase';
import { buildImageUrl } from './build-image-url';

export const PAGE_ASSETS_BUCKET = 'page-assets';

const PAGE_ASSET_MAX_BYTES = 10 * 1024 * 1024; // 10 MB — matches bucket file_size_limit
const PAGE_ASSET_MIMES: ReadonlySet<string> = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
]);

const MIME_TO_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

export type UploadError = 'file_too_large' | 'invalid_mime' | 'missing_alt' | 'network';

export type UploadPageAssetResult =
  | { ok: true; path: string; url: string; altText: string }
  | { ok: false; error: UploadError };

export interface PageAsset {
  path: string;
  url: string;
  altText: string;
  name: string;
}

/**
 * Upload an image to the `page-assets` bucket. Alt-text is REQUIRED.
 *
 * Validation order:
 *   1. `missing_alt` if altText.trim() is empty (D-13 floor).
 *   2. `file_too_large` if file.size > 10 MB.
 *   3. `invalid_mime` if file.type is not in the jpeg/png/webp/gif set.
 *   4. `network` for any underlying supabase error or thrown exception.
 *
 * On success the alt-text is persisted as object metadata so subsequent
 * `listPageAssets()` calls can surface it as the default alt for re-use
 * in image property fields.
 */
export async function uploadPageAsset(file: File, altText: string): Promise<UploadPageAssetResult> {
  if (altText.trim() === '') {
    return { ok: false, error: 'missing_alt' };
  }
  if (file.size > PAGE_ASSET_MAX_BYTES) {
    return { ok: false, error: 'file_too_large' };
  }
  if (!PAGE_ASSET_MIMES.has(file.type)) {
    return { ok: false, error: 'invalid_mime' };
  }

  const ext = MIME_TO_EXT[file.type] ?? 'bin';
  const path = `${crypto.randomUUID()}.${ext}`;

  try {
    // supabase-js typings for the storage upload options vary by version;
    // we cast through `unknown` so that the `metadata` field (which IS
    // supported at the wire level) can ride along without fighting the
    // version-specific shape. The wider supabase-js call path validates
    // the rest of the payload.
    const uploadOpts = {
      contentType: file.type,
      upsert: false,
      // Persist alt-text alongside the object so listPageAssets() can
      // recover it later for re-use.
      metadata: { altText },
    } as unknown as Parameters<ReturnType<typeof supabase.storage.from>['upload']>[2];
    const { error } = await supabase.storage
      .from(PAGE_ASSETS_BUCKET)
      .upload(path, file, uploadOpts);
    if (error) return { ok: false, error: 'network' };
    return { ok: true, path, url: buildImageUrl(path), altText };
  } catch {
    return { ok: false, error: 'network' };
  }
}

/**
 * List every object in the `page-assets` bucket. RLS gates the result to
 * staff users only — a non-staff caller receives an empty list / error
 * from Supabase, which we surface as an empty array (graceful UI).
 *
 * The display `url` is built via `buildImageUrl()` so list rendering
 * honors the same Pro-vs-free tier branch as direct image rendering.
 */
export async function listPageAssets(): Promise<PageAsset[]> {
  try {
    const { data, error } = await supabase.storage.from(PAGE_ASSETS_BUCKET).list('', {
      limit: 200,
      sortBy: { column: 'created_at', order: 'desc' },
    });
    if (error || !data) return [];
    return data
      .filter((obj) => obj.name && !obj.name.endsWith('/'))
      .map((obj) => {
        // Supabase Storage exposes per-object metadata; the shape varies by
        // SDK version. We narrow defensively so a missing field renders as
        // empty alt-text (the picker will require the operator to supply
        // one before re-selecting).
        const meta = (obj as { metadata?: Record<string, unknown> }).metadata ?? {};
        const altText = typeof meta.altText === 'string' ? meta.altText : '';
        return {
          path: obj.name,
          url: buildImageUrl(obj.name),
          altText,
          name: obj.name,
        };
      });
  } catch {
    return [];
  }
}
