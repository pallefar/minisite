/**
 * Phase 19 Plan 19-07 — ThumbmarkJS lazy-loaded device-fingerprint wrapper.
 *
 * Spec references:
 *   - 19-CONTEXT.md D-24: device-fingerprint is signal (b) in the 3-signal
 *     conversion-fraud screen. Best-effort capture at signup + apply form
 *     submit; missing fingerprint gracefully degrades (server-side fraud
 *     trigger no-ops on null).
 *   - 19-RESEARCH.md §"Supporting Stack" + Pitfall 3 (bundle-safe lazy
 *     import) — ThumbmarkJS MUST be dynamic-imported. The
 *     `manualChunks` rule in vite.config.ts isolates it into a
 *     `fingerprint` chunk; this module's `await import(...)` ensures the
 *     chunk only loads when these functions are called (i.e. on /signup
 *     or the affiliate apply form).
 *   - project_phase5_bundle_regression: never static-import heavy SDKs
 *     into App.tsx/main.tsx/store.ts. The fingerprint.ts module itself
 *     must NEVER be statically imported by any of those three files;
 *     callers must use a `React.lazy` or `await import('@/lib/affiliate/fingerprint')`
 *     pattern.
 *
 * API contract:
 *   - `getFingerprint(): Promise<string | null>` — returns the
 *     ThumbmarkJS hash string on success, `null` on any failure (canvas
 *     blocked, no-WebGL browser, module load fail, etc). Result is
 *     cached at module scope so repeated calls share one fingerprint
 *     evaluation.
 *   - `getFingerprintForSubmit(): Promise<string | null>` — alias today,
 *     future-proofing the call-site tag for a different sampling depth
 *     (e.g. extended `experimental: true` profile at form-submit time).
 *
 * Return-shape handling (W-2 plan hedge):
 *   ThumbmarkJS 1.9.x returns `{ thumbmark: string, ... }` from
 *   `new Thumbmark().get()`. Some prior majors returned a bare string.
 *   The conditional below handles both shapes so a future SDK roll-back
 *   or roll-forward does not break this wrapper.
 */

let cached: string | null = null;
let resolved = false;

async function fingerprintOnce(): Promise<string | null> {
  if (resolved) return cached;
  try {
    const mod = await import('@thumbmarkjs/thumbmarkjs');
    const tm = new mod.Thumbmark();
    const result = await tm.get();
    // Dual-shape handling (string OR { thumbmark: string }). 1.9.x is always
    // object-shape but the fallthrough leaves room for a future API change.
    cached =
      typeof result === 'string'
        ? result
        : ((result as { thumbmark?: string } | null)?.thumbmark ?? null);
  } catch (err) {
    // Best-effort: fingerprint failure must not break signup or the apply form.
    console.warn(
      '[leanshot/fingerprint] thumbmark capture failed',
      err instanceof Error ? err.message : 'unknown',
    );
    cached = null;
  }
  resolved = true;
  return cached;
}

/** Best-effort device fingerprint for fraud-signal capture. */
export async function getFingerprint(): Promise<string | null> {
  return fingerprintOnce();
}

/**
 * Alias of getFingerprint() used at form-submit sites (signup, affiliate
 * apply). Today both calls share the same sampling configuration; the
 * separate symbol exists so a future plan can swap call-site-specific
 * options (e.g. richer ThumbmarkJS option profile on submit) without a
 * fan-out refactor.
 */
export async function getFingerprintForSubmit(): Promise<string | null> {
  return fingerprintOnce();
}

/** Test-only reset hook. Clears the module-scope cache so each test
 *  exercises a fresh fingerprintOnce() path. */
export function _resetFingerprintCacheForTest(): void {
  cached = null;
  resolved = false;
}
