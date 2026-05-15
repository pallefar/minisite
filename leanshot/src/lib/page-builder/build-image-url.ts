/**
 * Phase 15 Plan 09 — buildImageUrl tier-conditional Supabase Storage URL builder.
 *
 * RESEARCH Pitfall 3: Supabase Storage image transforms (the
 * `/storage/v1/render/image/...` route) are gated to the Pro plan. On the
 * free tier the transform endpoint returns 400. The LeanShot Supabase
 * project (`ytnsipxxmzgaebkqmokp`) is currently on the free tier, so the
 * runtime default MUST be raw bucket URLs. The Pro-tier behavior is opt-in
 * via `VITE_SUPABASE_STORAGE_TRANSFORMS_ENABLED=true` — set this only on
 * Vercel env + .env.local for projects on Pro.
 *
 * The `transformsEnabled` argument is an injectable seam so tests can
 * exercise both branches without mutating `import.meta.env` at runtime;
 * production code never passes it.
 */

const PAGE_ASSETS_BUCKET = 'page-assets';

export interface BuildImageUrlOpts {
  width?: number;
  height?: number;
  resize?: 'cover' | 'contain' | 'fill';
  /**
   * Injectable seam. Defaults to
   * `import.meta.env.VITE_SUPABASE_STORAGE_TRANSFORMS_ENABLED === 'true'`.
   * Tests pass `true`/`false` explicitly.
   */
  transformsEnabled?: boolean;
}

function getSupabaseUrl(): string {
  const raw = (import.meta.env as Record<string, string | undefined>).VITE_SUPABASE_URL;
  return (raw ?? '').replace(/\/$/, '');
}

function transformsEnabledDefault(): boolean {
  const raw = (import.meta.env as Record<string, string | undefined>)
    .VITE_SUPABASE_STORAGE_TRANSFORMS_ENABLED;
  return raw === 'true';
}

/**
 * Build a public URL for an object in the `page-assets` bucket.
 *
 *   - When transforms are enabled AND at least one of `width`/`height` is
 *     supplied, return the Storage image-transform URL.
 *   - Otherwise, return the raw `object/public/...` URL with NO transform
 *     query params.
 *
 * Callers pass a bucket-relative `path` (e.g. `"<uuid>.jpg"`). The builder
 * cannot produce arbitrary-origin URLs — the origin is always
 * `${VITE_SUPABASE_URL}/storage/v1/...` for the `page-assets` bucket
 * (defence-in-depth alongside threat T-15-09-05).
 */
export function buildImageUrl(path: string, opts: BuildImageUrlOpts = {}): string {
  const base = getSupabaseUrl();
  const enabled = opts.transformsEnabled ?? transformsEnabledDefault();
  const wantsSize = opts.width !== undefined || opts.height !== undefined;

  if (enabled && wantsSize) {
    const params = new URLSearchParams();
    if (opts.width !== undefined) params.set('width', String(opts.width));
    if (opts.height !== undefined) params.set('height', String(opts.height));
    if (opts.resize !== undefined) params.set('resize', opts.resize);
    return `${base}/storage/v1/render/image/public/${PAGE_ASSETS_BUCKET}/${path}?${params.toString()}`;
  }

  // Raw bucket URL — no transform parameters appended on either tier when
  // no size is requested, or on the free tier regardless of size.
  return `${base}/storage/v1/object/public/${PAGE_ASSETS_BUCKET}/${path}`;
}
