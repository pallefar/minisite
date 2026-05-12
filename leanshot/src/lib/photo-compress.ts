/**
 * Phase 6 D-06 — canvas-based photo compression.
 *
 * Defaults (D-06 LOCKED):
 *   - maxEdge: 1600 (longest edge in px; aspect-preserving scale-down)
 *   - quality: 0.85
 *   - mimeType: 'image/jpeg'
 *
 * Output target: ≤ 2 MB after compression for a typical 12 MP capture.
 * The Storage bucket also enforces `file_size_limit = 2097152` server-side
 * so an over-large output is rejected by Supabase Storage (defence-in-depth
 * for T-06-04-02).
 *
 * Web Worker variant deferred (D-06): only ship the off-main-thread path if
 * UAT surfaces jank with main-thread compression. Single 1600px JPEG encode
 * is typically < 200 ms on a modern phone.
 */

export interface CompressOptions {
  maxEdge?: number;
  quality?: number;
  mimeType?: string;
}

const DEFAULTS = {
  maxEdge: 1600,
  quality: 0.85,
  mimeType: 'image/jpeg',
} as const;

/**
 * Compress a JPEG/PNG/WebP Blob via canvas downscale + re-encode.
 *
 * Throws `UNSUPPORTED_FORMAT` (Pitfall 2) if the input mime-type isn't a
 * supported image (heuristic via `blob.type`).
 */
export async function compressImage(source: Blob, opts: CompressOptions = {}): Promise<Blob> {
  const maxEdge = opts.maxEdge ?? DEFAULTS.maxEdge;
  const quality = opts.quality ?? DEFAULTS.quality;
  const mimeType = opts.mimeType ?? DEFAULTS.mimeType;

  // Pitfall 2 — guard at the boundary. The Storage bucket also gates via
  // `allowed_mime_types` server-side; this client-side gate keeps the
  // canvas decode from silently producing a corrupt output for, e.g., a
  // text file that slipped through file-picker filtering.
  if (source.type && !/^image\/(jpeg|jpg|png|webp)$/i.test(source.type)) {
    throw new Error('UNSUPPORTED_FORMAT');
  }

  const bitmap = await loadBitmap(source);
  try {
    const { width, height } = bitmap;
    const r = Math.min(maxEdge / width, maxEdge / height, 1);
    const targetW = Math.max(1, Math.round(width * r));
    const targetH = Math.max(1, Math.round(height * r));

    const canvas = document.createElement('canvas');
    canvas.width = targetW;
    canvas.height = targetH;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('CANVAS_2D_UNAVAILABLE');
    ctx.drawImage(bitmap, 0, 0, targetW, targetH);

    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (out) => {
          if (!out) return reject(new Error('CANVAS_TOBLOB_NULL'));
          resolve(out);
        },
        mimeType,
        quality,
      );
    });
  } finally {
    // ImageBitmap exposes .close() to release GPU memory. Some test envs
    // (jsdom/happy-dom) substitute HTMLImageElement and don't expose close;
    // guard it.
    const maybeClose = (bitmap as { close?: () => void }).close;
    if (typeof maybeClose === 'function') maybeClose.call(bitmap);
  }
}

interface DrawableSource {
  width: number;
  height: number;
}

/**
 * Resolve a Blob into something `ctx.drawImage` can paint. Prefers
 * `createImageBitmap` (off-thread decode) when available; falls back to
 * `<img>` + dataURL for test environments without ImageBitmap.
 */
async function loadBitmap(blob: Blob): Promise<CanvasImageSource & DrawableSource> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bm = await createImageBitmap(blob);
      return bm as ImageBitmap;
    } catch {
      /* fall through to dataURL path */
    }
  }
  // Fallback: FileReader → HTMLImageElement
  const dataUrl = await blobToDataUrl(blob);
  return await loadImage(dataUrl);
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error('FILEREADER_ERROR'));
    reader.readAsDataURL(blob);
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('IMAGE_LOAD_ERROR'));
    img.src = src;
  });
}
