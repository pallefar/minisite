/**
 * Phase 42 Plan 04 (D-18) — Capacitor shim.
 *
 * The Capacitor SDK is NOT a dependency of this phase (POLISH-07 is web-only;
 * the mobile shell lands in a v1.4 phase). This module exposes a minimal
 * `Capacitor` object with `isNativePlatform()` that:
 *   - reads `window.Capacitor.isNativePlatform()` when the SDK is loaded,
 *   - returns `false` when the SDK is absent (running as a regular web app).
 *
 * Per memory feedback_scaffolding_for_deferred_mobile_pattern this is the
 * architectural seam the v1.4 Capacitor phase hooks into without touching
 * Plan 42-04 code.
 *
 * Note: the leanshot codebase already depends on @capacitor/* packages for
 * Phase 16 native features, but those are bundled into the `capacitor-bridge`
 * lazy chunk and are NOT statically reachable from src/lib/pwa/register.ts.
 * This shim sniffs the runtime window object so it works on plain web
 * (window.Capacitor undefined → returns false) without dragging the SDK
 * into the PWA registration chunk.
 */

interface WindowWithCapacitor {
  Capacitor?: { isNativePlatform?: () => boolean };
}

export const Capacitor = {
  isNativePlatform(): boolean {
    if (typeof window === 'undefined') return false;
    const w = window as unknown as WindowWithCapacitor;
    try {
      return w.Capacitor?.isNativePlatform?.() === true;
    } catch {
      return false;
    }
  },
};
