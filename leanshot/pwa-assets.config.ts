import { defineConfig, minimal2023Preset } from '@vite-pwa/assets-generator/config';

// Phase 42 Plan 04 Task 1 — PWA icon asset generation.
// Source: leanshot/public/pwa-source.svg (LeanShot brand mark over #0B1413 plate).
// Outputs:
//   - public/pwa-192x192.png (manifest icon)
//   - public/pwa-512x512.png (manifest icon, also used as maskable)
//   - public/apple-touch-icon.png (180x180, iOS home-screen)
// Run via: npx pwa-assets-generator --preset minimal-2023 public/pwa-source.svg
// (config below provides the same defaults so the command can omit args).
export default defineConfig({
  preset: minimal2023Preset,
  images: ['public/pwa-source.svg'],
});
