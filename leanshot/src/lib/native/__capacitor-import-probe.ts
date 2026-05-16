/**
 * Phase 16 Plan 16-01 Task 3 — TEMPORARY static-import probe.
 *
 * Purpose: anchor `@capacitor/core` into the static module graph at Wave 1
 * time so the `capacitor-bridge` manualChunks rule (added in vite.config.ts
 * in this plan) actually emits a chunk. Without this probe, the chunk only
 * materializes after Plan 16-02 wires `Capacitor.getPlatform()` into
 * `src/lib/native/platform.ts` — meaning the bundle-budget CI gate at
 * `scripts/assert-clinic-bundle-budget.sh:155` would log `wave-0 skip` for
 * one full wave, missing the actual cost.
 *
 * Plan 16-02 Task 1 REMOVES this file AND the side-effect import line in
 * `src/main.tsx` as part of its `platform.ts` fill. After 16-02 ships, the
 * `capacitor-bridge` chunk is anchored by the real `Capacitor.getPlatform()`
 * call inside `detectPlatform()`.
 *
 * Per Phase 12 D-02 firewall: this probe lives inside `src/lib/native/` so
 * the `@capacitor/core` import passes the eslint `import-x/no-restricted-paths`
 * gate (capacitor imports are allowed inside `src/lib/native/*` only).
 */
import { Capacitor } from '@capacitor/core';

// Re-export so the import is not tree-shaken away by Rollup as an unused
// side-effect import. Anchored to a named export keeps the static graph
// link in production builds (Vite + Rollup with manualChunks active).
export const __capacitorImportProbe = Capacitor;
