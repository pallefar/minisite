/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

declare module '*.css';

// Phase 42 Plan 04 — service worker source uses self.__WB_MANIFEST injected
// by VitePWA at build time (injectManifest strategy). Workbox declares this
// inside workbox-precaching types; the reference below ensures src/sw.ts
// typechecks under the app project as well.
declare interface ServiceWorkerGlobalScope {
  __WB_MANIFEST: Array<{ url: string; revision: string | null }>;
}
