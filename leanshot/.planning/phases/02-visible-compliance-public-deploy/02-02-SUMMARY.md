---
phase: 02-visible-compliance-public-deploy
plan: 2
subsystem: foundations
tags: [modal, bundle, vite, measurement, foundation, partial]
status: partial-awaiting-checkpoint
dependency_graph:
  requires:
    - "Phase-1 Modal primitive (src/components/ui/Modal.tsx) with current 7 callers"
  provides:
    - "Modal `dismissible?: boolean` prop (default true) — required by 02-04 disclaimer modal and 02-05 fallback modal"
    - "ANALYZE=true build pipeline producing dist/stats.html"
    - "02-02-BUNDLE-MEASUREMENT.md — measurement-backed manualChunks proposal for 02-07"
  affects:
    - "vite.config.ts shape — 02-07 must preserve the .filter(Boolean) plugins pattern when adding sentryVitePlugin"
tech-stack:
  added:
    - "rollup-plugin-visualizer ^6.0.4 (devDependency, ANALYZE-gated)"
  patterns:
    - "Plugin gating via `process.env.ANALYZE === 'true' && plugin(...)` inside a `.filter(Boolean) as PluginOption[]` array"
    - "Per-module gzip parsing from dist/stats.html JSON (`const data = ...`) for evidence-based chunk-shape decisions"
key-files:
  created:
    - ".planning/phases/02-visible-compliance-public-deploy/02-02-BUNDLE-MEASUREMENT.md"
    - "leanshot/src/components/ui/Modal.test.tsx"
  modified:
    - "leanshot/src/components/ui/Modal.tsx"
    - "leanshot/vite.config.ts"
    - "leanshot/package.json"
    - "leanshot/package-lock.json"
    - "leanshot/.gitignore"
decisions:
  - "Promote chart.js to its own `vendor-charts` chunk in 02-07 (instead of leaving it inside BaseChart) for cache-stability — chart.js rarely changes, src/* changes often"
  - "Group all telemetry (sentry/* + posthog-js) into a single `vendor-telemetry` chunk; await human input on whether to split posthog separately for consent-gated lazy load"
  - "Lighthouse 90 confidence: HIGH — top-5 passenger groupings cover 89% of pre-bundle gzipped mass, well above the 60% threshold from D-23/D-25"
metrics:
  tasks_completed: 2
  tasks_total: 3
  unit_tests_added: 4
  unit_tests_total_passing: 67
  duration: "~12 minutes"
  completed_date: "2026-05-11"
---

# Phase 2 Plan 2: Foundations (Modal `dismissible` + Bundle Measurement) Summary

**Status:** PARTIAL — Tasks 1-2 complete; Task 3 (`checkpoint:human-verify`) is intentionally NOT executed by this executor. The orchestrator will surface `02-02-BUNDLE-MEASUREMENT.md` to the user, capture the approval (or alternative manualChunks), and pass the decision into 02-07 directly.

Two independent foundation pieces unblocking Wave 2 — a `dismissible` prop on the existing Modal primitive (so the medical-disclaimer modal in 02-04 and the dashboard-render fallback in 02-05 can compose Modal with no decline path per D-09) and an evidence-based bundle measurement that locks the manualChunks shape for 02-07 (per D-23, replacing estimates with real numbers).

## Tasks completed

### Task 1 — Modal `dismissible` prop (TDD, RED → GREEN)

- **RED commit** added `src/components/ui/Modal.test.tsx` with 4 tests (default-dismissible Escape closes, dismissible=false Escape no-op, dismissible=false backdrop-click no-op, explicit dismissible=true behaves identically to omitting). 2 tests failed before implementation as required.
- **GREEN commit** added `dismissible?: boolean` to `ModalProps` (default `true`), short-circuited the Escape handler when `!dismissible`, and set the backdrop `onClick` to `dismissible ? onClose : undefined`. The inner `motion.div`'s `e.stopPropagation()` already prevents clicks on the card itself from bubbling through to the backdrop, so `undefined` on the outer handler is the correct no-op.
- All 4 new tests pass. All 7 existing Modal callers (`Confirm`, `MedicationTab` x2, `SettingsPage`, `DoctorReport`, `PhotoCompareModal`, `ShareCardModal`) omit `dismissible` and therefore receive the `true` default — full unit suite remains green at **67/67 passing**.
- `grep -c "dismissible" src/components/ui/Modal.tsx` = **5** (well above the ≥4 threshold in the plan).

**Final prop signature:**
```typescript
/**
 * When false, ESC keydown and backdrop click are no-ops.
 * Use for blocking modals (e.g. medical disclaimer) where the only exit is an
 * explicit acknowledge button. Defaults to true (preserves existing behavior).
 * D-09 (no decline path on disclaimer modal).
 */
dismissible?: boolean;   // default true
```

### Task 2 — `rollup-plugin-visualizer` wired and baseline captured

- Installed `rollup-plugin-visualizer@^6.0.4` as a devDependency (lockfile updated, +17 packages).
- Modified `vite.config.ts` to import `visualizer` and add it conditionally inside the `plugins` array, gated by `process.env.ANALYZE === 'true'`, then `.filter(Boolean) as PluginOption[]`. **02-07 must preserve this exact shape** when adding the Sentry plugin around it. `PluginOption` is imported from `vite` (not `vitest/config`, which does not re-export it).
- Added `dist/stats.html` and `stats.html` to `.gitignore` (defense-in-depth; `dist/` was already ignored).
- Ran `ANALYZE=true npm run build` → produced `dist/stats.html` (~900 kB).
- Parsed the visualizer JSON payload to derive per-module gzipped contributions to the always-loaded `index-*.js` chunk (currently 635 kB raw / **205,822 bytes gzipped**) and the lazy `BaseChart-*.js` chunk (208 kB raw / **71,503 bytes gzipped**).
- Wrote `02-02-BUNDLE-MEASUREMENT.md` (155 lines) with: top-10 emitted chunks table, in-chunk per-module breakdown for both `index` and `BaseChart`, ranked passenger list, proposed `manualChunks` for 02-07, and a HIGH-rated Lighthouse-90 confidence assessment with explicit fallback levers per D-25.
- Verified plain `npm run build` (no ANALYZE) still works and does NOT emit `stats.html`.

**Top-4 passenger gzipped sizes (per-module, from visualizer):**
- `framer-motion`: 112,657 B (≈110 kB) — largest single passenger
- `react-dom`: 98,061 B (≈96 kB)
- `chart.js`: 102,957 B (≈101 kB) — already lazy-loaded inside BaseChart
- `lucide-react`: 8,277 B (≈8 kB) — small, tree-shaken

(Wave-3 telemetry now also weighs heavily: sentry packages sum to ≈116 kB gzipped pre-bundle, posthog-js to ≈61 kB. The proposed `vendor-telemetry` chunk covers both.)

**Proposed `manualChunks` (awaiting checkpoint approval):**
```js
manualChunks: {
  'vendor-react':     ['react', 'react-dom', 'scheduler'],
  'vendor-motion':    ['framer-motion', 'motion-dom', 'motion-utils'],
  'vendor-charts':    ['chart.js', '@kurkle/color'],
  'vendor-icons':     ['lucide-react'],
  'vendor-telemetry': ['@sentry/react','@sentry/core','@sentry/browser','@sentry-internal/browser-utils','posthog-js'],
}
```
Rationale: covers ~89% of the index chunk's pre-bundle gzipped mass, well above the 60% threshold (D-23). Slim `index-*.js` after split is projected at 20–30 kB gz.

## Task 3 — DEFERRED to orchestrator

`checkpoint:human-verify` for the bundle measurement. Per the executor brief:

> Tasks 1-2 complete; Task 3 awaits orchestrator-led human approval of `02-02-BUNDLE-MEASUREMENT.md`.

The orchestrator should:
1. Surface `.planning/phases/02-visible-compliance-public-deploy/02-02-BUNDLE-MEASUREMENT.md` and `dist/stats.html` (locally generated; not committed) to the user.
2. Ask the human to either approve the proposed `manualChunks` shape OR provide alternative groupings (e.g., "split posthog from sentry for consent-gated lazy load", "leave lucide-react in `index`", "promote `vendor-charts` even though chart.js is already lazy", etc.).
3. Pass the approved/amended decision directly into 02-07's planning context — 02-07 will commit the chosen shape into `vite.config.ts` under `build.rollupOptions.output.manualChunks`.

Per the executor brief, **STATE.md and ROADMAP.md are intentionally NOT updated by this executor** — that's the orchestrator's responsibility once Task 3 resolves.

## Deviations from Plan

### Auto-fixed issues

**1. [Rule 1 — Bug] `PluginOption` import source**
- **Found during:** Task 2, first `ANALYZE=true npm run build` run.
- **Issue:** Plan suggested `import { defineConfig, type PluginOption } from 'vitest/config'` (or implied it via the `defineConfig` source already in use). `vitest/config` does not re-export `PluginOption` → `tsc -b` failed with TS2305.
- **Fix:** Kept `defineConfig` import from `vitest/config` (Vitest's flavor includes the `test` config slot already used in this project) and added a separate `import { type PluginOption } from 'vite'`.
- **Files modified:** `leanshot/vite.config.ts`
- **Commit:** included in `feat(02-02): wire ANALYZE-gated bundle visualizer and capture baseline`.

### Auth gates

None. No external services were touched.

## Known stubs

None. The `dismissible` prop is fully wired (not a placeholder). The bundle measurement document contains real numbers from a real build; no `TODO` markers in the artifacts.

## Threat flags

None. This plan adds:
- A defaults-preserving boolean prop on an existing UI primitive — no new attack surface, no auth/data path changes.
- A devDependency (`rollup-plugin-visualizer`) gated behind an env var that is never set in production builds — no runtime exposure.
- A markdown planning artifact — no executable surface.

No items added or modified that would require entries in the threat register.

## Self-Check: PASSED

**Files:**
- FOUND: leanshot/src/components/ui/Modal.test.tsx (RED test, 4 tests)
- FOUND: leanshot/src/components/ui/Modal.tsx (modified — `dismissible` prop, 5 occurrences)
- FOUND: leanshot/vite.config.ts (modified — visualizer wired)
- FOUND: leanshot/package.json (rollup-plugin-visualizer devDependency)
- FOUND: leanshot/.gitignore (stats.html entries)
- FOUND: .planning/phases/02-visible-compliance-public-deploy/02-02-BUNDLE-MEASUREMENT.md
- FOUND: .planning/phases/02-visible-compliance-public-deploy/02-02-SUMMARY.md

**Commits:**
- FOUND: 02a4510 test(02-02): add failing tests for Modal dismissible prop
- FOUND: 4ad14c4 feat(02-02): add dismissible prop to Modal primitive
- FOUND: 447c0fe feat(02-02): wire ANALYZE-gated bundle visualizer and capture baseline
- (this SUMMARY commit will be appended next)

**Verification:**
- `npm run typecheck` → exit 0
- `npm run test:unit` → 67/67 passing
- `npm run build` (no ANALYZE) → exit 0, no `dist/stats.html`
- `ANALYZE=true npm run build` → exit 0, `dist/stats.html` produced (~900 kB)

**State updates:** Intentionally skipped per executor brief (orchestrator owns STATE.md / ROADMAP.md until Task 3 resolves).
