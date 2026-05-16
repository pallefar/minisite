/**
 * Phase 16 Plan 16-01 Task 4 (BL-2 fix — MOBILE-08 OOM mitigation).
 *
 * `storageTransformUrl(path, opts)` builds a Supabase Storage transform URL
 * for the public render endpoint:
 *   /storage/v1/render/image/public/photos/${path}?width=${w}&height=${h}&resize=${r}&quality=${q}
 *
 * **Important — Pro tier required (D-08):** Supabase Storage Image Transforms
 * are only available on the **Pro tier** ($25/mo). The LeanShot project
 * `ytnsipxxmzgaebkqmokp` is currently on the **Free tier** at time of writing
 * (2026-05-16), so transformed URLs will return 404 in dev + production until
 * the Phase 16 Wave-0 vendor-checkpoint Task 6 (Supabase Pro upgrade) lands.
 * The code path is shipped now per Wave-1 scaffolding so downstream plans
 * (16-04 Sentry, 16-05/06 RevenueCat, 16-10 OOM soak) don't have to re-edit
 * the photo render layer. See `16-01-SUMMARY.md` for the deferred-action flag.
 *
 * **Path validation:** the photos bucket is PRIVATE (Phase 6 D-04). The
 * `/storage/v1/render/image/public/photos/*` endpoint will only serve files
 * if the bucket is later flipped to public OR if a signed-URL variant is
 * used (Supabase Storage transforms also work with `createSignedUrl(path,
 * expiresIn, { transform: opts })`). The signed-URL pattern is layered in
 * BodyTab/PhotoCompareModal via `getSignedPhotoUrl` — this helper exposes
 * the transform-query-param construction independently for callers that
 * already have a signed/public URL and only need to append the transform
 * parameters.
 *
 * Default thumbnail budget: 200×200 cover quality=75 (grid view). Compare
 * view uses 400×400 (side-by-side larger size). Full-resolution view keeps
 * the raw signed URL behind a user-initiated tap.
 *
 * Clamping rule: width/height capped at 800 (Phase 16 RESEARCH §"WKWebView
 * OOM" — beyond 800px the per-tile decode cost defeats the OOM budget).
 *
 * @example
 *   storageTransformUrl('user-123/photos/abc.jpg', { width: 200, height: 200 })
 *   // → 'https://<project-ref>.supabase.co/storage/v1/render/image/public/photos/user-123/photos/abc.jpg?width=200&height=200&resize=cover&quality=75'
 */

// Read the Supabase project URL from build-time env (same source as
// `@/lib/supabase`). Fail-soft to an empty string so the helper still
// constructs a recognizable URL shape in test/dev environments where
// VITE_SUPABASE_URL is unset — callers handling the resulting 404 path
// is preferable to a hard crash during render.
const SUPABASE_URL = (import.meta.env.VITE_SUPABASE_URL as string | undefined) ?? '';

export interface StorageTransformOpts {
  width?: number;
  height?: number;
  resize?: 'cover' | 'contain' | 'fill';
  quality?: number;
}

const MAX_DIMENSION = 800; // Phase 16 RESEARCH WKWebView OOM ceiling.
const DEFAULT_WIDTH = 200;
const DEFAULT_HEIGHT = 200;
const DEFAULT_RESIZE: 'cover' | 'contain' | 'fill' = 'cover';
const DEFAULT_QUALITY = 75;

/**
 * Build a Supabase Storage transform URL for the `photos` bucket.
 *
 * - Empty path throws (caller bug; never silently return a malformed URL).
 * - Width/height clamped to 800 (OOM budget).
 * - Path segments URL-encoded (handles special chars like `:` in paths).
 */
export function storageTransformUrl(path: string, opts: StorageTransformOpts = {}): string {
  if (!path || path.trim().length === 0) {
    throw new Error('storageTransformUrl: path must be a non-empty string');
  }

  const width = clampDimension(opts.width ?? DEFAULT_WIDTH);
  const height = clampDimension(opts.height ?? DEFAULT_HEIGHT);
  const resize = opts.resize ?? DEFAULT_RESIZE;
  const quality = clampQuality(opts.quality ?? DEFAULT_QUALITY);

  // URL-encode each path segment but keep the `/` separators.
  // Special chars (`:`, `+`, ` `, etc.) must be encoded to keep the URL valid.
  const encodedPath = path
    .split('/')
    .map((seg) => encodeURIComponent(seg))
    .join('/');

  const params = new URLSearchParams({
    width: String(width),
    height: String(height),
    resize,
    quality: String(quality),
  });

  return `${SUPABASE_URL}/storage/v1/render/image/public/photos/${encodedPath}?${params.toString()}`;
}

function clampDimension(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return DEFAULT_WIDTH;
  return Math.min(Math.floor(value), MAX_DIMENSION);
}

function clampQuality(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return DEFAULT_QUALITY;
  return Math.max(1, Math.min(Math.floor(value), 100));
}
