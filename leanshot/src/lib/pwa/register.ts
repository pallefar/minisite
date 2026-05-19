/**
 * Phase 42 Plan 04 — lazy service worker registration entry-point.
 *
 * IMPORTANT — Pitfall 9 mitigation: this module is dynamic-imported from
 * src/App.tsx AFTER first paint via useEffect, so the workbox-window glue
 * never reaches the index chunk. Do NOT statically import this from main.tsx
 * or App.tsx top-level imports.
 *
 * D-18: Inside Capacitor (native shell) the function early-returns; the
 * native app handles updates via its own delivery channel (App Store / Play).
 *
 * D-17: skipWaiting:false in vite.config.ts means the SW stays in the
 * "waiting" state until the client posts {type:'SKIP_WAITING'}. The
 * `onUpdate` callback fires on `onNeedRefresh` so the caller can render a
 * toast with a Reload button; the Reload click should:
 *   1. Ask the registered SW to skipWaiting (handled inside the registerSW
 *      callback below: `void updateSW(true)` activates + reloads).
 *   2. window.location.reload() to pick up the new bundle.
 */
import { registerSW } from 'virtual:pwa-register';

import { Capacitor } from '@/lib/native/capacitor-shim';

/**
 * Lazy-initialize PWA service worker.
 *
 * @param onUpdateAvailable Called when a new SW version is waiting to activate.
 *                          The caller typically renders a toast with a Reload
 *                          button. Calling `updateSW(true)` (returned here as
 *                          a side-effect of `registerSW`) skips waiting +
 *                          reloads; for simpler UX the caller can just
 *                          `window.location.reload()` after the user clicks.
 * @returns void — on web (registers SW); also void inside Capacitor (no-op).
 */
export function initializePWA(onUpdateAvailable: () => void): void {
  if (Capacitor.isNativePlatform()) {
    // D-18: PWA disabled inside Capacitor — native shell owns the update
    // channel; running both would create dual-update conflicts.
    return;
  }

  registerSW({
    onNeedRefresh() {
      onUpdateAvailable();
    },
    onOfflineReady() {
      // First-time install: SW is ready to serve offline. No-op for now;
      // the offline banner (D-13) is driven by navigator.onLine, not by SW
      // readiness. A future polish phase may surface a one-time "Ready to
      // work offline" toast here.
    },
  });
}
