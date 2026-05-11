---
phase: 02-visible-compliance-public-deploy
plan: 7
subsystem: build-and-host-config
tags: [vite, sentry, csp, vercel, marketing, code-splitting]
provides:
  - SPA build with @sentry/vite-plugin (no-op when no token)
  - 5-chunk manualChunks splitting (vendor-react / -motion / -charts / -icons / -telemetry)
  - sourcemap:'hidden' so .js never references .map publicly
  - Marketing build pipeline (vite.marketing.config.ts + marketing.html + main.marketing.tsx)
  - vercel.json (SPA, strict CSP with all RESEARCH gotcha #2 corrections)
  - vercel.marketing.json (sidecar — pasted into the marketing project's dashboard in 02-08)
requires:
  - 02-02 bundle measurement baseline (rollup-plugin-visualizer)
  - Wave-3 Sentry+PostHog instrumentation (already in dependencies)
affects:
  - dist/ output shape (5 vendor chunks instead of monolithic index)
  - Vercel Project config consumption (vercel.json auto-applied)
key-files:
  created:
    - leanshot/marketing.html
    - leanshot/src/main.marketing.tsx
    - leanshot/vite.marketing.config.ts
    - vercel.json
    - vercel.marketing.json
  modified:
    - leanshot/vite.config.ts
    - leanshot/package.json
    - leanshot/package-lock.json
    - leanshot/tsconfig.node.json
    - leanshot/.gitignore
decisions:
  - Worktree-root vercel.json (not leanshot/vercel.json) per orchestrator objective
  - Marketing build does NOT use manualChunks (default Rollup chunking is adequate)
  - VITE_SPA_URL env var introduced for marketing → SPA handoff (documented in 02-08)
metrics:
  duration: ~12 min
  completed: 2026-05-11
requirements: [PROD-01, PROD-06]
---

# Phase 02 Plan 07: Build + Host Config Summary

Vite SPA + marketing build pipelines wired with @sentry/vite-plugin (Preview-safe via `disable: !env.SENTRY_AUTH_TOKEN`), 5-chunk manualChunks shape (human-approved in 02-02), and Vercel host config (strict CSP for the SPA, minimal D-06 headers for marketing). Both `npm run build` and `npm run build:marketing` exit 0; the SPA's `index-*.js` dropped from a monolithic 206 kB gz to 68.9 kB gz with 4 parallel-fetched vendor chunks.

## File-Path Note (read first)

The orchestrator brief overrides the plan body:

- `vercel.json` and `vercel.marketing.json` live at the **worktree (repo) root**, NOT at `leanshot/vercel.json`. The worktree root is the actual Vercel project root for the SPA project (Vercel reads `vercel.json` from the project root, and the SPA project's "Root Directory" setting in Vercel maps the project root to repo root since the build runs `npm run build` from there).
- `vite.config.ts`, `vite.marketing.config.ts`, `marketing.html`, `src/main.marketing.tsx`, `package.json`, `tsconfig.node.json`, `.gitignore` all live under `leanshot/`.

## What landed

### Task 1 — Vite + Sentry + manualChunks (commit `a56a0d4`)

**Final manualChunks shape (paste from `vite.config.ts`):**

```js
manualChunks: {
  'vendor-react': ['react', 'react-dom', 'scheduler'],
  'vendor-motion': ['framer-motion', 'motion-dom', 'motion-utils'],
  'vendor-charts': ['chart.js', '@kurkle/color'],
  'vendor-icons': ['lucide-react'],
  'vendor-telemetry': [
    '@sentry/react',
    '@sentry/core',
    '@sentry/browser',
    '@sentry-internal/browser-utils',
    'posthog-js',
  ],
}
```

This matches the **human-approved shape** in `02-02-BUNDLE-MEASUREMENT.md` "Decision (Human-verified — Task 3 resume signal)" exactly:
- **Q1 (split vendor-telemetry?):** No — kept merged. No consent toggle in Phase 02 scope.
- **Q2 (promote vendor-charts?):** Yes — promoted out of BaseChart for cache-stability across all chart-using tabs.
- **Q3 (split vendor-icons?):** Yes — split into its own ~6.5 kB gz chunk.

**Per-chunk emitted sizes after split** (from `gzip -c dist/assets/<file>.js | wc -c` on a clean `npm run build`):

| Chunk | Raw | Gzipped | Notes |
|-------|-----|---------|-------|
| `vendor-charts-*.js` | 207,431 | 71,046 | chart.js + @kurkle/color (was inside BaseChart) |
| `vendor-telemetry-*.js` | 280,235 | 93,070 | @sentry/* + posthog-js |
| `vendor-motion-*.js` | 115,385 | 38,150 | framer-motion + motion-dom + motion-utils |
| `vendor-icons-*.js` | 30,063 | 6,494 | lucide-react |
| `vendor-react-*.js` | 7,749 | 3,009 | react + react-dom + scheduler |
| `index-*.js` | 219,644 | 68,857 | App shell (slimmed) — pulls vendor chunks lazily |

**Pre-split baseline** (from 02-02): `index-*.js` was 635,321 raw / 205,822 gz monolithic. Post-split: `index-*.js` is 219,644 raw / 68,857 gz, with 5 parallel vendor chunks. The Vite "chunks larger than 500 kB" warning that fired on the old monolithic `index-*.js` no longer fires for vendor chunks; the largest single chunk now is `vendor-telemetry` at 93 kB gz, well under the 500 kB ceiling, and crucially it's NOT on the first-paint critical path (Sentry/PostHog initialization happens after React mounts).

**Sentry plugin wiring:**

```ts
sentryVitePlugin({
  authToken: env.SENTRY_AUTH_TOKEN,
  org: env.SENTRY_ORG,
  project: env.SENTRY_PROJECT,
  release: { name: process.env.VERCEL_GIT_COMMIT_SHA },
  sourcemaps: { filesToDeleteAfterUpload: ['./dist/**/*.map'] },
  disable: !env.SENTRY_AUTH_TOKEN,
})
```

- `disable: !env.SENTRY_AUTH_TOKEN` — Preview + Dev are no-ops (D-22)
- `build.sourcemap: 'hidden'` — `.js` files have no public `sourceMappingURL` comment, so even if a `.map` slips past the cleanup it cannot be discovered by clients (D-21)
- `filesToDeleteAfterUpload` — Production cleans up `.map` files after Sentry upload

**`.map` files in dev/Preview build:** Yes, `sourcemap: 'hidden'` still emits `.map` files in `dist/`. The cleanup only runs when the Sentry plugin is enabled (token set). This is the intended path — `.map` files that ship with a Preview build are safe because the `.js` files don't reference them; clients have no way to fetch them. Production with token enabled = uploaded to Sentry then deleted from `dist/` before the upload artifact ships to Vercel.

**Caveat fixed:** The plan body imported `loadEnv` from `'vitest/config'`. That re-export does NOT exist in vitest. Moved to `import { loadEnv, type PluginOption } from 'vite';` while keeping `defineConfig` from `'vitest/config'` (which extends Vite's defineConfig with the `test` block typing).

### Task 2 — Marketing build (commit `2fa0cef`)

- `leanshot/marketing.html` — clones `index.html` font preconnects, theme-color metas, and `#root` mount; differs only in `<title>` ("LeanShot — GLP-1 Tracker") and the script src (`/src/main.marketing.tsx`).
- `leanshot/src/main.marketing.tsx` — renders `<Landing />` ONLY. No Zustand store, no Sentry/PostHog, no AppShell. Reads `import.meta.env.VITE_SPA_URL` for the Start CTA handoff and falls back to `'/'` for local dev (the marketing build is rarely served with a hot SPA target; `'/'` is harmless).
- `leanshot/vite.marketing.config.ts` — emits to `dist-marketing/` with `marketing.html` as the sole rollup input, default chunking (no manualChunks — marketing is tiny). Uses `fileURLToPath(new URL('./marketing.html', import.meta.url))` to dodge the ESM `__dirname` undefined gotcha (no shim needed; see "ESM `__dirname` shim" section below).
- `package.json` — added `"build:marketing": "tsc -b && vite build --config vite.marketing.config.ts"`.
- `tsconfig.node.json` — included `vite.marketing.config.ts` so `tsc -b` typechecks it alongside `vite.config.ts`.
- `.gitignore` — added `dist-marketing/`.

**`build:marketing` emitted sizes:**

| File | Raw | Gzipped |
|------|-----|---------|
| `marketing.html` | 1.20 kB | 0.62 kB |
| `assets/marketing-*.js` | 338.75 kB | 106.20 kB |
| `assets/marketing-*.css` | 59.60 kB | 11.30 kB |

The marketing JS is dominated by framer-motion (Landing has heavy entrance animations) plus the Landing illustrations (HeroOrbital, ConnectData, AIAvatar). Default chunking is fine here — the marketing surface is a single static landing page and a code-split would not improve TTI on a dedicated origin.

**`__dirname` ESM shim needed?** No. Used `fileURLToPath(new URL('./marketing.html', import.meta.url))` directly as the rollup input — same pattern Vite already uses for `resolve.alias`. No `dirname(fileURLToPath(import.meta.url))` shim added.

### Task 3 — vercel.json + vercel.marketing.json (commit `1c38eaf`)

Both files live at the worktree (repo) root, NOT under `leanshot/`. Both parse as strict JSON (validated via `python3 -c "import json; ..."`).

**`vercel.json` (SPA, auto-consumed by Vercel)** — D-05 with all four corrections from RESEARCH gotcha #2 encoded into the CSP value:

```
default-src 'none'; script-src 'self'; connect-src 'self' https://*.ingest.us.sentry.io https://*.ingest.sentry.io https://*.posthog.com https://api.anthropic.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; img-src 'self' data: blob:; font-src 'self' data: https://fonts.gstatic.com; frame-src 'none'; object-src 'none'; base-uri 'self'; form-action 'self'; worker-src 'self' blob:
```

**Correction checklist (each correction encoded — verified via `grep`):**

- [x] `https://*.ingest.us.sentry.io` AND `https://*.ingest.sentry.io` in `connect-src` (NOT `*.sentry.io` — CSP wildcards are single-label, RESEARCH Pitfall 1)
- [x] `https://fonts.googleapis.com` in `style-src` (Google Fonts loaded by `index.html:13-16`)
- [x] `https://fonts.gstatic.com` in `font-src` (gstatic delivers the actual font files)
- [x] `worker-src 'self' blob:` directive present (PostHog Replay + future Web Workers)
- [x] `blob:` in `img-src` (BodyTab `URL.createObjectURL` for photo previews)
- [x] `https://*.posthog.com` in `connect-src` (PostHog official recommendation)
- [x] `https://api.anthropic.com` in `connect-src` (BYO Anthropic key flow)

Other D-05 headers also present: HSTS (`max-age=63072000; includeSubDomains; preload`), `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy: camera=(), microphone=(), geolocation=()`.

**`vercel.marketing.json`** — D-06 minimal headers (HSTS + nosniff + Referrer-Policy). Intentionally NO `Content-Security-Policy` header (verified via `grep -c "Content-Security-Policy"` = 0). This file is **NOT auto-consumed by Vercel** — only `vercel.json` is. The marketing project's Vercel "Configuration Override" field accepts a JSON blob via the dashboard; 02-08's human task pastes this file's content there. We commit it to the repo so the override is reproducible and version-controlled.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — Blocking] `loadEnv` re-export gotcha in `vitest/config`**
- **Found during:** Task 1 typecheck
- **Issue:** Plan body shows `import { defineConfig, loadEnv } from 'vitest/config';` — but `vitest/config` only re-exports `defineConfig`, not `loadEnv`. Typecheck failed with `TS2305: Module '"vitest/config"' has no exported member 'loadEnv'`.
- **Fix:** Split the import — `defineConfig` from `'vitest/config'` (preserves the `test` block typing); `loadEnv` and `type PluginOption` from `'vite'`.
- **Files modified:** `leanshot/vite.config.ts`
- **Commit:** `a56a0d4`

**2. [Rule 3 — Blocking] `tsc -b` did not typecheck `vite.marketing.config.ts`**
- **Found during:** Task 2 build
- **Issue:** `tsconfig.node.json` only included `vite.config.ts`, so `tsc -b` ignored the new `vite.marketing.config.ts` and would silently miss type errors there.
- **Fix:** Added `vite.marketing.config.ts` to `tsconfig.node.json`'s `include` array.
- **Files modified:** `leanshot/tsconfig.node.json`
- **Commit:** `2fa0cef`

**3. [Rule 2 — Critical] `emptyOutDir: true` on marketing build**
- **Found during:** Task 2 design
- **Issue:** Marketing config emits to `dist-marketing/` which is OUTSIDE the default Vite `outDir` (`dist/`). Vite warns and refuses to clean a directory outside the project root unless `emptyOutDir: true` is explicit.
- **Fix:** Added `emptyOutDir: true` to `vite.marketing.config.ts`'s `build` block so repeated runs leave a clean output.
- **Files modified:** `leanshot/vite.marketing.config.ts`
- **Commit:** `2fa0cef`

**4. [Path override] vercel.json placement**
- **Found during:** Task 3
- **Issue:** Plan body says "leanshot/vercel.json" but the orchestrator objective explicitly overrides with "vercel.json lives at REPO ROOT". The success criteria (`WORKTREE_ROOT/vercel.json`) confirm this.
- **Fix:** Followed the objective. Both `vercel.json` and `vercel.marketing.json` written at the worktree root (which is the repo root); they are NOT inside `leanshot/`.
- **Files affected:** `vercel.json`, `vercel.marketing.json` at worktree root
- **Commit:** `1c38eaf`

### Out-of-scope discoveries: None.

## Verification

| Check | Command | Result |
|-------|---------|--------|
| typecheck | `npm run typecheck` | exits 0 |
| SPA build | `npm run build` (no env vars) | exits 0; 5 vendor chunks emitted |
| Marketing build | `npm run build:marketing` | exits 0; `dist-marketing/marketing.html` + assets present |
| vercel.json strict-JSON | `python3 -c "import json; json.load(open('vercel.json'))"` | OK |
| vercel.marketing.json strict-JSON | same | OK |
| CSP corrections present | `grep` for ingest hosts, fonts.googleapis.com, fonts.gstatic.com, worker-src, blob: in vercel.json | all found |
| Marketing has no CSP | `grep -c "Content-Security-Policy" vercel.marketing.json` | 0 (correct per D-06) |
| Vendor chunks count | `ls dist/assets/ \| grep -E "vendor-(charts\|motion\|icons\|react\|telemetry)" \| wc -l` (excluding .map) | 5 |
| `.gitignore` covers dist-marketing | `git status --short` after `npm run build:marketing` | dist-marketing/ not listed |
| `.github/workflows/ci.yml` untouched | `git status --short` | not in list |

## Threat-Surface Confirmation

The plan's `<threat_model>` lists 8 threats. Mitigation status after this plan:

| Threat ID | Mitigation | Status |
|-----------|------------|--------|
| T-02-01 (CSP misconfig kills Sentry) | `*.ingest.us.sentry.io` + `*.ingest.sentry.io` wildcards in vercel.json connect-src | ✅ encoded; HUMAN-UAT in 02-08 will trigger a test error to confirm |
| T-02-02 (source-map leak) | `sourcemap: 'hidden'` + `filesToDeleteAfterUpload` | ✅ both wired in vite.config.ts |
| T-02-03 (XSS via inline script) | `script-src 'self'` (no `'unsafe-inline'`) | ✅ encoded |
| T-02-04 (clickjacking) | `X-Frame-Options: DENY` + `frame-src 'none'` | ✅ both encoded |
| T-02-05 (mixed-content downgrade) | HSTS `max-age=63072000; includeSubDomains; preload` | ✅ encoded |
| T-02-06 (MIME-type confusion) | `X-Content-Type-Options: nosniff` | ✅ encoded |
| T-02-07 (Anthropic key in CSP typo) | `https://api.anthropic.com` in connect-src | ✅ encoded; deferred per disposition (Phase 4 server-side) |
| T-02-08 (cross-origin marketing→SPA) | Two separate Vercel projects = two separate origins | ✅ vercel.json + vercel.marketing.json describe two distinct projects |

## Threat Flags

None. No new security-relevant surface introduced beyond what the threat model already enumerates.

## Known Stubs

None. All wired functionality is real:
- `VITE_SPA_URL` falls back to `/` for local dev — this is documented behavior, not a stub. The 02-08 plan sets the production value via Vercel env vars.
- Marketing-side has no Sentry/PostHog by design (D-19) — not a stub.

## Notes for Downstream Plans

- **02-08 (deploy plan)** must:
  1. Create the SPA Vercel project with Root Directory = repo root (so `vercel.json` is found).
  2. Set Production env vars: `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT`. Without these, Sentry plugin no-ops (intentional for Preview).
  3. Create the marketing Vercel project; paste `vercel.marketing.json` content into its Configuration Override field via the dashboard.
  4. Set `VITE_SPA_URL` env var on the marketing project pointing to the SPA's production URL.
  5. Trigger a test Sentry error post-deploy and confirm it lands (validates T-02-01 mitigation).
  6. Run Lighthouse against both the bare landing route AND the dashboard route (per 02-02 measurement note).

- **Future consent gate (post-Phase 02)**: To split `vendor-telemetry` into `vendor-sentry` + `vendor-posthog` for consent-gated lazy-loading of PostHog, the `manualChunks` block in `vite.config.ts` is a one-line edit (split the array).

## Self-Check: PASSED

Verified files:
- `leanshot/vite.config.ts` — FOUND
- `leanshot/marketing.html` — FOUND
- `leanshot/src/main.marketing.tsx` — FOUND
- `leanshot/vite.marketing.config.ts` — FOUND
- `leanshot/package.json` — FOUND (build:marketing script present)
- `leanshot/tsconfig.node.json` — FOUND
- `leanshot/.gitignore` — FOUND (dist-marketing/ present)
- `vercel.json` — FOUND (worktree root)
- `vercel.marketing.json` — FOUND (worktree root)

Verified commits:
- `a56a0d4` — Task 1 (Sentry plugin + manualChunks)
- `2fa0cef` — Task 2 (marketing build)
- `1c38eaf` — Task 3 (Vercel host config)
