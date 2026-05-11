# Phase 2: Visible Compliance & Public Deploy — Research

**Researched:** 2026-05-11
**Domain:** Vercel multi-project deploy, strict CSP, Chart.js canvas plugin, Sentry source-map upload, Lighthouse 90 bundle pass, CI compliance grep, disclaimer Step-0 insertion
**Confidence:** HIGH on Vercel config + Chart.js plugin lifecycle + Sentry vite plugin (Context7-verified). HIGH on CSP wildcard depth gotcha (confirmed against Sentry docs issue + PostHog docs). MEDIUM on exact Lighthouse score floor a manualChunks pass can hit (depends on real bundle composition once a measurement is taken).

## Summary

Phase 2 is a deploy/wiring phase, not an algorithm phase. The interesting risks cluster in three places: (1) Vercel multi-project plumbing where Root Directory and per-project Build/Output settings are owned by the Vercel dashboard, not `vercel.json` (so plans must split work between repo files and dashboard-config steps); (2) CSP correctness where the `*.sentry.io` wildcard trap silently kills error reporting on production (single-label wildcards do not cross dots); (3) the `acknowledgedDisclaimer` migration where the persisted-state shape must default to `undefined` (not `false`) so the dashboard-render fallback (D-11) actually fires for migrated v3/v4 users.

**Primary recommendation:** Build commands and output directories live in **Vercel dashboard Project Settings**, not `vercel.json` — keep `vercel.json` scoped to headers + redirects + framework preset. Use **two separate `vercel.json` files** (root for the SPA project, `marketing/vercel.json` or equivalent for the marketing project) selected via each project's Root Directory setting. For the marketing entry, use **Vite multi-page input** via a sibling `vite.marketing.config.ts` that points `build.rollupOptions.input` at a separate `marketing.html` and emits to `dist-marketing/` — least intrusive of the three options. For Sentry, use **`@sentry/vite-plugin` 5.x** with `sourcemap: 'hidden'` + `disable: !env.SENTRY_AUTH_TOKEN` (auto no-ops Preview/Dev). For Chart.js, register the watermark plugin **inline on the `MedLevelChart` `ChartConfiguration.plugins` array** (NOT globally on `BaseChart`'s `Chart.register(...registerables)` call). For Lighthouse, **defer to Phase 2.1** if the manualChunks pass alone doesn't land Performance ≥ 90 — library swaps (lucide-react) are explicitly Phase 2.1 per D-24.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Security headers (CSP, HSTS, etc.) | CDN / Edge (Vercel) | — | Static SPA; headers must hit before any byte of HTML reaches client; only Vercel can set them per-origin |
| Disclaimer Step-0 UI | Browser / Client (React) | Persisted Zustand (localStorage) | Local-first stack constraint — no backend in Phase 2; acknowledgment is a client-side flag |
| Chart watermark | Browser / Client (Chart.js canvas) | — | Must render into canvas pixels (D-15) so screenshots carry it; HTML overlay rejected by SC#3 |
| CI compliance grep | CI (GitHub Actions runner) | — | Pre-merge gate; never runs in app |
| Source-map upload | CI / Build (Vercel build step) | Sentry ingest | Upload happens during `npm run build`, not at runtime; SENTRY_AUTH_TOKEN is a build-time secret |
| Lighthouse score gate | CI (post-deploy hook against preview URL) | — | Tests against the actually-deployed origin, not localhost |
| Marketing landing | CDN / Static (separate Vercel project) | — | Origin isolation is the whole point of the split (D-04, D-06) |

## Standard Stack

### Core (Phase 2 adds)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@sentry/vite-plugin` | 5.2.1 [VERIFIED: `npm view @sentry/vite-plugin version` 2026-05-11] | Inject + upload sourcemaps during Vite build, tag release with commit SHA | Official Sentry-maintained plugin; supersedes ad-hoc `sentry-cli` shell invocations [CITED: docs.sentry.io/platforms/javascript/sourcemaps/uploading/vite/] |
| `rollup-plugin-visualizer` | 6.0.4 [VERIFIED: `npm view rollup-plugin-visualizer version` 2026-05-11; note Context7 sample uses 7.x] | One-shot bundle treemap for sizing the manualChunks pass | Standard tool for Rollup/Vite bundle analysis; opens HTML treemap [CITED: Context7 /btd/rollup-plugin-visualizer] |
| `@lhci/cli` | 0.15.1 [VERIFIED: `npm view @lhci/cli version` 2026-05-11] | CI-side Lighthouse runs + assertion gating | Google-maintained; standard CI Lighthouse runner [CITED: Context7 /googlechrome/lighthouse-ci] |

### Supporting (already installed — Phase 1)
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `@sentry/react` | 10.52.0 [VERIFIED: `package.json`] | SDK init already wired in `src/main.tsx` | Phase 2 only adds the vite-plugin alongside; SDK init unchanged |
| `posthog-js` | 1.372.10 [VERIFIED: `package.json`] | Cookieless analytics already wired in `src/lib/analytics.ts` | Phase 2 flips `VITE_ANALYTICS_ENABLED=true` in Production env only (D-18) |
| `chart.js` | 4.4.6 [VERIFIED: `package.json`] | Already registered globally in `BaseChart` via `Chart.register(...registerables)` | Watermark plugin uses inline `plugins: [...]` on `MedLevelChart`'s config (D-15) |
| `vite` | 6.0.1 [VERIFIED: `package.json`; latest 8.0.11 — do NOT bump in Phase 2] | Already running in project | All build config changes (sourcemap, manualChunks) target this version |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `@sentry/vite-plugin` | Direct `sentry-cli sourcemaps inject && upload` shell calls in Vercel build command | Plugin handles release name resolution, glob globbing, and post-upload cleanup automatically; shell-only path is what D-20 sketched but Sentry now recommends the plugin even for vanilla Vite [CITED: docs.sentry.io/platforms/javascript/sourcemaps/uploading/vite/]. **Picking plugin.** |
| Vite multi-page input | Separate `marketing.html` as Vite root + separate Vercel build script (`vite build --config vite.marketing.config.ts`) | Multi-page input keeps both entries in one Vite run; separate-config approach keeps the SPA build's Rollup graph clean (no risk of marketing-only deps leaking into SPA chunks) and lets each project have a totally independent `build.rollupOptions.input`. **Picking separate `vite.marketing.config.ts` per D-04** — the CONTEXT explicitly names it. |
| `lhci collect --url=...` ad-hoc | `lhci autorun` with `lighthouserc.json` | `autorun` runs collect+assert+upload in one shot with assertion config externalized — recommended path. **Picking autorun.** |
| `@lhci/cli` job in GitHub Actions | Vercel "Speed Insights" + manual Lighthouse | Speed Insights is observe-only, no CI gate. Manual is non-recurring. `@lhci/cli` is the only option that fails the PR when Performance drops below 90. **Picking `@lhci/cli`.** |

**Installation:**

```bash
npm install -D @sentry/vite-plugin rollup-plugin-visualizer @lhci/cli
```

(All three are dev-deps only. `@lhci/cli` can also be installed transiently in CI via `npm install -g @lhci/cli@0.15.x`; pinning in `devDependencies` is preferred for reproducibility.)

## Architecture Patterns

### System Architecture Diagram

```
                       ┌──────────────────────────┐
   git push ───────────▶│ Vercel git integration   │── triggers both projects
                       └──────┬──────────────┬────┘
                              │              │
                    ┌─────────▼─┐        ┌──▼────────────────┐
                    │ Project A │        │ Project B          │
                    │ leanshot  │        │ leanshot-marketing │
                    │ (SPA)     │        │ (landing)          │
                    │           │        │                    │
                    │ Root Dir: │        │ Root Dir: /        │
                    │ /         │        │ Build: npm run     │
                    │ Build:    │        │   build:marketing  │
                    │ npm run   │        │ Output: dist-      │
                    │   build   │        │   marketing/       │
                    │ Output:   │        │                    │
                    │ dist/     │        │ vercel.json:       │
                    │           │        │   - HSTS only      │
                    │ vercel.json:        │  - X-Content-Type │
                    │  - Strict CSP       │  - Referrer-Policy│
                    │  - HSTS             │                   │
                    │  - X-Frame-Options  │                   │
                    │  - Source-map upload│                   │
                    │    via Sentry plugin│                   │
                    └─────┬───┬───────────┘        └──────────┘
                          │   │
              ┌───────────┘   └──────────────┐
              │                              │
              ▼                              ▼
   leanshot-app.vercel.app          leanshot-marketing.vercel.app
   (authenticated SPA origin)       (marketing origin)
   strict CSP enforced              minimal headers, no CSP
              │
              │ runtime fetches
              ▼
   ┌──────────────────────────────────────────────────┐
   │ connect-src allowlist (CSP):                      │
   │  - 'self' (own origin)                            │
   │  - https://*.ingest.us.sentry.io  (error events)  │
   │  - https://*.posthog.com          (analytics)     │
   │  - https://api.anthropic.com      (AI coach)      │
   └──────────────────────────────────────────────────┘

CI pipeline (post-Phase 2):
  Job 1: lint           ┐
  Job 2: format-check   │  Phase 1 jobs — unchanged
  Job 3: typecheck      │
  Job 4: test-unit      │
  Job 5: test-e2e       ┘
  Job 6: compliance-copy   (new — Phase 2; grep denylist)
  Job 7: lighthouse        (new — Phase 2; runs against fresh Vercel preview URL)
```

### Recommended Project Structure

```
/  (repo root — project lives at root, NOT in a /leanshot subdir on this branch)
├── index.html                       # SPA entry (existing)
├── marketing.html                   # NEW — marketing entry
├── vite.config.ts                   # SPA build (modified: + sentryVitePlugin, + manualChunks, sourcemap:'hidden')
├── vite.marketing.config.ts         # NEW — marketing build config
├── vercel.json                      # NEW — root: SPA strict headers
├── marketing/                       # OPTIONAL — only if separating: marketing-only assets
│   └── vercel.json                  # NEW — marketing minimal headers (if Vercel project Root Directory = marketing/)
├── lighthouserc.json                # NEW — LHCI assertions config
├── .github/workflows/ci.yml         # MODIFIED — adds compliance-copy + lighthouse jobs
├── src/
│   ├── components/
│   │   ├── ui/
│   │   │   └── Modal.tsx            # existing — reuse for dashboard-render fallback
│   │   ├── onboarding/
│   │   │   ├── OnboardingFlow.tsx   # MODIFIED — TOTAL_STEPS 7→8, step 0 inline
│   │   │   ├── OnboardingFlow.test.tsx  # MODIFIED — 7-step → 8-step nav
│   │   │   └── (no new file — Step 0 lives inline per 02-PATTERNS.md)
│   │   └── dashboard/
│   │       └── charts/
│   │           ├── MedLevelChart.tsx        # MODIFIED — register watermark plugin per-instance
│   │           ├── medLevelWatermarkPlugin.ts  # NEW — Chart.js plugin module
│   │           └── BaseChart.tsx            # UNCHANGED — global Chart.register stays
│   ├── lib/
│   │   ├── store.ts        # MODIFIED — add acknowledgedDisclaimer + setAcknowledgedDisclaimer
│   │   ├── storage.ts      # MODIFIED — PersistedState.acknowledgedDisclaimer + migrate to undefined
│   │   └── analytics.ts    # MODIFIED — EventName += 'disclaimer_acknowledged' | 'disclaimer_required'
│   └── App.tsx             # MODIFIED — render disclaimer modal as overlay when user && ack !== 'v1'
└── e2e/
    └── onboarding.spec.ts  # MODIFIED — 7-step → 8-step assertions, opens with Step-0 acknowledgement
```

**Critical layout note:** On this branch (`claude/upgrade-leanshot-design-mjjJl`), the project lives at the repo root — there is no `leanshot/` subdirectory despite the Phase 1 `01-VERIFICATION.md` describing `defaults.run.working-directory: leanshot`. The `.github/` directory is NOT committed yet on this branch (Phase 1 plan 06 set it up locally but the workflow file was never pushed). Phase 2 plans MUST write the workflow at `./.github/workflows/ci.yml` (repo root) with NO `working-directory` indirection. Verify against `git ls-tree -r HEAD --name-only | grep github` (currently returns nothing). [VERIFIED: `git ls-tree` 2026-05-11]

### Pattern 1: Vercel multi-project from a single git repo (D-04)

**What:** Two Vercel projects, both linked to the same GitHub repo, distinguished by per-project Build Command + Output Directory configured in **the Vercel dashboard, not `vercel.json`**.

**When to use:** Whenever two distinct origins ship from one repo and you do not want a monorepo refactor (Turborepo/pnpm workspaces). Documented as the standard pattern for "one repo, multiple Vercel projects" [CITED: Vercel docs — `outputDirectory` and `buildCommand` overrides per project, Context7 /websites/vercel].

**The three entry-point options for the marketing build (D-04 asks the planner to pick):**

| Option | Mechanism | Pros | Cons |
|--------|-----------|------|------|
| **A. Vite multi-page input** | One `vite.config.ts`, `build.rollupOptions.input: { main: 'index.html', marketing: 'marketing.html' }`, both built into `dist/`; Vercel SPA project serves `dist/` and Vercel marketing project serves… also `dist/` but with a different rewrite rule | Single build run; shared chunks deduplicated automatically by Rollup | Both outputs land in same `dist/` — Vercel projects can't pick "just the marketing one"; you'd need rewrites in `vercel.json` to mask the SPA's `index.html` from the marketing origin. Defeats origin-isolation goal of D-04. **Rejected.** |
| **B. Separate `vite.marketing.config.ts` + separate output dir** | Two configs, two npm scripts (`build` and `build:marketing`), output to `dist/` and `dist-marketing/` respectively. SPA Vercel project: `buildCommand=npm run build`, `outputDirectory=dist`. Marketing project: `buildCommand=npm run build:marketing`, `outputDirectory=dist-marketing` | Clean origin split; each project's bundle graph is independent; matches D-04 wording exactly | Two builds run on every git push (Vercel parallelizes them); slight CI minute cost. **Recommended.** |
| **C. Build-time filter (single config, post-build copy)** | One `vite.config.ts`, build everything, then a post-build script copies the marketing subset to `dist-marketing/` | No second Vite config | Brittle; depends on knowing every asset name; loses Vite's HMR for marketing dev. **Rejected.** |

**Recommendation: Option B.** The CONTEXT.md decision (D-04) explicitly names `vite.marketing.config.ts` + `dist-marketing/`, which is Option B.

**Example skeleton — `vite.marketing.config.ts`:**

```typescript
// Source: derived from existing vite.config.ts (this repo) + Vite 6 build.rollupOptions docs [CITED: Context7 /websites/v6_vite_dev]
import { defineConfig } from 'vite';
import { fileURLToPath, URL } from 'node:url';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { resolve } from 'node:path';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  build: {
    outDir: 'dist-marketing',
    rollupOptions: {
      input: resolve(__dirname, 'marketing.html'),
    },
  },
});
```

**`marketing.html`** (new): same `<head>` as `index.html` but mounts a marketing-only React root. The planner picks whether to: (a) reuse `src/components/marketing/Landing.tsx` as the marketing entry's mount target (existing component, already lazy-loaded in `App.tsx:40-42`), or (b) ship a new pre-rendered marketing module. **Recommendation: (a)** — `Landing.tsx` is the documented marketing target per `.planning/codebase/ARCHITECTURE.md` and a new `src/main.marketing.tsx` mounts `<Landing />` directly without the dashboard's Zustand store dependency.

**`package.json` script additions:**

```jsonc
{
  "scripts": {
    "build:marketing": "tsc -b && vite build --config vite.marketing.config.ts"
  }
}
```

### Pattern 2: `vercel.json` for headers + redirects, dashboard for the rest

**What:** Vercel project settings (Root Directory, Build Command, Output Directory, Framework Preset, Node version) live in the **Vercel dashboard Project Settings**. `vercel.json` is for headers, redirects, rewrites, and selected build overrides — and these CAN be overridden per-project via the `outputDirectory` + `buildCommand` properties [CITED: Context7 /websites/vercel `vercel.json` page].

**Per-project header scoping:** When two Vercel projects share one repo, they typically read DIFFERENT `vercel.json` files via their distinct **Root Directory** settings. The SPA project's Root Directory = `/` (reads `./vercel.json`); the marketing project's Root Directory = `/marketing/` (reads `./marketing/vercel.json`) OR the marketing project also points at `/` but uses `--config vite.marketing.config.ts`. **Recommendation:** since CONTEXT D-04 says "no monorepo refactor," keep both projects' Root Directory at repo root and use **a single `vercel.json` at root that ONLY sets the SPA's strict CSP**. The marketing project gets its build command override via the dashboard and ships without a strict CSP — its `headers` block can live in a separate file (`vercel.marketing.json`) referenced by setting the marketing project's "Output Directory" to `dist-marketing` and adding **per-project `vercel.json` via dashboard "Vercel configuration"** — but the simpler path is described next.

**Recommended split (simplest):**
- `./vercel.json` — strict CSP + HSTS, applies to SPA only because SPA project's Output Directory is `dist/` and Vercel matches `headers` against served paths.
- For the marketing project, **override `vercel.json` via the dashboard's "Vercel Configuration → Override"** feature: paste a marketing-specific JSON with just HSTS + X-Content-Type-Options + Referrer-Policy. This avoids committing two configs and avoids the Root Directory split.

**Alternative (cleaner long-term):** Move the marketing entry to a `marketing/` subdir with its own `vercel.json` and set the marketing Vercel project's Root Directory to `marketing/`. Requires moving `marketing.html` + `src/components/marketing/Landing.tsx` into that subdir which collides with the "no monorepo refactor" decision. **Rejected for Phase 2; flag for Phase 7 cleanup.**

**Example `vercel.json` (SPA, repo root) — verbatim shape for D-05 headers:**

```jsonc
// Source: composed from Vercel headers docs [CITED: Context7 /websites/vercel project-configuration/vercel-json] + CONTEXT D-05/D-06/D-07
// CRITICAL: connect-src wildcard depth gotcha [VERIFIED: getsentry/sentry-docs issue #17202 — *.sentry.io does NOT match o123.ingest.us.sentry.io because CSP * is single-label]
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "framework": "vite",
  "buildCommand": "npm run build",
  "outputDirectory": "dist",
  "headers": [
    {
      "source": "/(.*)",
      "headers": [
        {
          "key": "Content-Security-Policy",
          "value": "default-src 'none'; script-src 'self'; connect-src 'self' https://*.ingest.us.sentry.io https://*.ingest.sentry.io https://*.posthog.com https://api.anthropic.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; img-src 'self' data: blob:; font-src 'self' data: https://fonts.gstatic.com; frame-src 'none'; object-src 'none'; base-uri 'self'; form-action 'self'; worker-src 'self' blob:"
        },
        { "key": "Strict-Transport-Security", "value": "max-age=63072000; includeSubDomains; preload" },
        { "key": "X-Content-Type-Options", "value": "nosniff" },
        { "key": "X-Frame-Options", "value": "DENY" },
        { "key": "Referrer-Policy", "value": "strict-origin-when-cross-origin" },
        { "key": "Permissions-Policy", "value": "camera=(), microphone=(), geolocation=()" }
      ]
    }
  ]
}
```

**Critical deltas from D-05 the planner MUST account for:**

1. **`*.ingest.us.sentry.io` (NOT `*.sentry.io`) is required.** CSP single-label wildcards do not match across dots. `*.sentry.io` matches `app.sentry.io` but NOT `o123456.ingest.us.sentry.io`. Sentry's actual ingest hosts on the US region have the shape `o<orgId>.ingest.us.sentry.io`. Including both `*.ingest.us.sentry.io` AND `*.ingest.sentry.io` covers US + legacy DSN hosts. [VERIFIED: getsentry/sentry-docs issue #17202 + WebSearch 2026-05-11]
2. **`https://*.posthog.com` is the documented allowlist** — PostHog explicitly recommends the wildcard over enumerating `us.i.posthog.com` + `us-assets.i.posthog.com` because subdomains may change [CITED: posthog.com/docs/advanced/content-security-policy].
3. **`worker-src 'self' blob:` is required by PostHog** for session replay / web worker patterns [CITED: posthog.com/docs/advanced/content-security-policy]. CONTEXT D-05 omits this — add it.
4. **`https://fonts.googleapis.com` (style-src) + `https://fonts.gstatic.com` (font-src) are required** because `index.html:13-16` loads Google Fonts (Inter, Fraunces, JetBrains Mono). Without these, the SPA renders in system fonts after `vercel.json` lands. [VERIFIED: `index.html` HEAD inspection 2026-05-11] — CONTEXT D-05 omits these.
5. **`img-src 'self' data: blob:`** — `blob:` is needed because `BodyTab` uses `URL.createObjectURL` for photo previews (per `.planning/codebase/STACK.md` "Browser requirements"). `data:` covers base64 photos already in store.
6. **`'unsafe-inline'` on `style-src` is the documented Tailwind v4 concession** (D-07). Note Tailwind v4 beta DOES inject inline styles at runtime; removing this is Phase 7 hardening.

**Marketing `vercel.json` (D-06 minimal headers) — paste into Vercel dashboard "Configuration Override" for the marketing project:**

```jsonc
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "framework": "vite",
  "buildCommand": "npm run build:marketing",
  "outputDirectory": "dist-marketing",
  "headers": [
    {
      "source": "/(.*)",
      "headers": [
        { "key": "Strict-Transport-Security", "value": "max-age=63072000; includeSubDomains; preload" },
        { "key": "X-Content-Type-Options", "value": "nosniff" },
        { "key": "Referrer-Policy", "value": "strict-origin-when-cross-origin" }
      ]
    }
  ]
}
```

### Pattern 3: Sentry source-map upload via `@sentry/vite-plugin`

**What:** Replace CONTEXT D-20's `sentry-cli sourcemaps inject && upload` shell pattern with `@sentry/vite-plugin` 5.x integrated into `vite.config.ts`. Plugin auto-injects debug IDs, uploads `.js.map` files, and (with `filesToDeleteAfterUpload`) strips them from `dist/` before deploy.

**When to use:** Production builds only. The plugin's `disable: !env.SENTRY_AUTH_TOKEN` flag makes it a complete no-op when the token is absent (Preview + Development envs per D-22).

**Example — `vite.config.ts` modifications:**

```typescript
// Source: docs.sentry.io/platforms/javascript/sourcemaps/uploading/vite/ [CITED] + existing vite.config.ts
import { defineConfig, loadEnv } from 'vitest/config';
import { fileURLToPath, URL } from 'node:url';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { sentryVitePlugin } from '@sentry/vite-plugin';
import { visualizer } from 'rollup-plugin-visualizer';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');

  return {
    plugins: [
      react(),
      tailwindcss(),
      // visualizer LAST so it sees post-transform sizes; gated to a manual mode
      // or always-on with `emitFile: true` to land in dist/stats.html
      process.env.ANALYZE === 'true' &&
        visualizer({
          filename: 'dist/stats.html',
          template: 'treemap',
          gzipSize: true,
          brotliSize: true,
        }),
      // Sentry plugin MUST be last per official guidance [CITED: docs.sentry.io/platforms/javascript/sourcemaps/uploading/vite/]
      sentryVitePlugin({
        authToken: env.SENTRY_AUTH_TOKEN,
        org: env.SENTRY_ORG,
        project: env.SENTRY_PROJECT,
        release: { name: process.env.VERCEL_GIT_COMMIT_SHA },
        sourcemaps: {
          filesToDeleteAfterUpload: ['./dist/**/*.map'],
        },
        disable: !env.SENTRY_AUTH_TOKEN,
      }),
    ].filter(Boolean),
    resolve: {
      alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
    },
    server: { port: 5173, host: true },
    build: {
      // 'hidden' generates .map files but does NOT add the sourceMappingURL comment to .js,
      // so even if a .map slips through filesToDeleteAfterUpload, clients can't fetch it.
      sourcemap: 'hidden',
      rollupOptions: {
        output: {
          // D-23: split chart.js, framer-motion, lucide-react into vendor chunks
          manualChunks: {
            'vendor-charts': ['chart.js'],
            'vendor-motion': ['framer-motion'],
            'vendor-icons': ['lucide-react'],
            'vendor-react': ['react', 'react-dom'],
          },
        },
      },
    },
    test: {
      environment: 'jsdom',
      globals: true,
      setupFiles: ['./src/test-setup.ts'],
      include: ['src/**/*.test.{ts,tsx}'],
      exclude: ['e2e/**', 'node_modules/**', 'dist/**'],
      css: false,
    },
  };
});
```

**Vercel env-var matrix (D-18 expanded with the new build-time tokens):**

| Env Var | Production | Preview | Development |
|---------|------------|---------|-------------|
| `VITE_SENTRY_DSN` | real DSN | empty OR separate Preview Sentry DSN | empty |
| `VITE_POSTHOG_KEY` | real PostHog key | empty | empty |
| `VITE_POSTHOG_HOST` | `https://us.i.posthog.com` | (unused) | (unused) |
| `VITE_ANALYTICS_ENABLED` | `true` | `false` | `false` |
| `SENTRY_AUTH_TOKEN` | **set in Vercel "Production" env only** [D-20] | unset | unset |
| `SENTRY_ORG` | set | set (harmless) | unset |
| `SENTRY_PROJECT` | set | set (harmless) | unset |

`VERCEL_GIT_COMMIT_SHA` is **automatically injected by Vercel** into the build environment for all three environments — no manual config needed [CITED: Vercel docs system env vars, Context7 /websites/vercel]. The Sentry plugin reads it via `process.env.VERCEL_GIT_COMMIT_SHA`.

### Pattern 4: Chart.js per-instance plugin via `afterDraw`

**What:** Define a Chart.js plugin object with `id` + `afterDraw(chart, args, options)` and pass it via `plugins: [...]` on the `MedLevelChart`'s `ChartConfiguration`. Do NOT call `Chart.register(plugin)` globally — that would activate it on every chart that goes through `BaseChart`.

**When to use:** Per-instance behavior that must not leak to other chart instances using the same `BaseChart` wrapper.

**Draw order (D-15 confirms Phase 3 will add a band):** Chart.js calls hooks in this order on each frame: `beforeDraw` → datasets render → `afterDraw`. So an `afterDraw` watermark renders ON TOP of dataset lines and labels. Phase 3's uncertainty band will use `beforeDraw` so the band paints BENEATH the data line; the watermark stays on top. **Confirmed.** [CITED: Context7 /websites/chartjs plugin lifecycle docs]

**Example — `src/components/dashboard/charts/medLevelWatermarkPlugin.ts` (new file):**

```typescript
// Source: pattern from chartjs.org getting-started/usage.html [CITED: Context7 /websites/chartjs]
// Per-instance plugin: NOT registered on Chart.register(); passed inline via config.plugins.
import type { Chart, Plugin } from 'chart.js';

export interface MedLevelWatermarkOptions {
  text?: string;
  fontFamily?: string;
  opacity?: number;
}

export const medLevelWatermarkPlugin: Plugin<'line', MedLevelWatermarkOptions> = {
  id: 'medLevelWatermark',
  afterDraw(chart: Chart<'line'>, _args, options: MedLevelWatermarkOptions) {
    const { ctx, chartArea } = chart;
    if (!chartArea) return;
    const { left, top, width, height } = chartArea;
    const cx = left + width / 2;
    const cy = top + height / 2;
    const text = options.text ?? 'Estimate — not medical advice';
    const opacity = options.opacity ?? 0.12;

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(-Math.PI / 4); // 45° counter-clockwise (D-13)
    ctx.font = `bold ${Math.max(14, height * 0.08)}px ${options.fontFamily ?? 'Inter, system-ui, sans-serif'}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = `rgba(120, 120, 120, ${opacity})`; // light-gray; planner verifies dark-theme variant (D-13)
    ctx.fillText(text, 0, 0);
    ctx.restore();
  },
};
```

**Wiring into `MedLevelChart.tsx`:**

```typescript
// Source: existing src/components/dashboard/charts/MedLevelChart.tsx + Chart.js per-instance plugin pattern
import { medLevelWatermarkPlugin } from './medLevelWatermarkPlugin';

// inside the useMemo that builds `config`:
return {
  type: 'line' as const,
  data: { /* unchanged */ },
  options: { /* unchanged */ },
  plugins: [medLevelWatermarkPlugin], // ← new; scopes plugin to THIS chart only
};
```

**The `BaseChart` wrapper passes `config` to `new Chart(canvas, config)` unchanged**, so the `plugins` array on the config is honored per-instance. `BaseChart`'s existing `Chart.register(...registerables)` is unrelated — that's the global controllers/scales registry, not per-chart plugins. [VERIFIED: `BaseChart.tsx:10` global register + Chart.js docs]

**Dark-theme verification (D-13 leaves this to the planner):** The chart-theme tokens at `src/lib/chart-theme.ts` provide `tick` and `grid` colors per theme. The watermark should darken on light themes (`rgba(60, 60, 60, 0.12)`) and lighten on dark (`rgba(220, 220, 220, 0.18)`). The plugin can read the chart's `options.color` or accept theme-derived options via the plugin-options pattern. **Recommendation:** pass theme-resolved color through `options.color` from the React component via `config.options.plugins.medLevelWatermark = { color: t.tick, opacity: theme === 'dark' ? 0.18 : 0.12 }`.

### Pattern 5: Bundle splitting for Lighthouse 90

**What:** Add `rollup-plugin-visualizer` for measurement (one-off `ANALYZE=true npm run build` run), then `build.rollupOptions.output.manualChunks` to extract `chart.js`, `framer-motion`, `lucide-react` into dedicated vendor chunks.

**When to use:** Only after measuring the current bundle. The 635 kB main chunk number in D-23 is a starting estimate; the plan should include a measurement task that produces `dist/stats.html` and records the current top contributors.

**Reasonable target chunk sizes (D-23 says "first-load main chunk ≤ 200 kB gzipped"):**

| Chunk | Target (gzipped) | Notes |
|-------|------------------|-------|
| main / index | ≤ 100 kB | App shell + critical CSS + first-render tabs |
| vendor-react | ~45 kB | React 19 + React DOM 19 |
| vendor-motion | ~45 kB | framer-motion 11 (high-cost passenger) |
| vendor-charts | ~70 kB | Chart.js 4.4 (lazy-load with the medication tab if possible) |
| vendor-icons | varies | lucide-react tree-shakes per-icon; manualChunks groups all imported icons into one chunk regardless |
| per-tab lazy | 5-15 kB each | Already in place via `React.lazy` in `App.tsx:9-55` |

**Critical: confirm `React.lazy` survives the manualChunks pass.** Rollup's `manualChunks` only affects vendor splitting — it does NOT collapse dynamic imports. The `App.tsx` lazy-loaded tabs (HomeTab, MedicationTab, …) will continue to generate their own chunks even after `manualChunks` adds vendor groups. The only risk: if a manualChunks rule names a module that's ALSO inside a lazy chunk, Rollup may hoist it into the vendor chunk, eagerly loading the vendor and the lazy chunk's other deps. **Mitigation:** confirm by inspecting `dist/assets/` after the change — every `HomeTab-*.js`, `MedicationTab-*.js`, `AIChatPanel-*.js`, `SettingsPage-*.js` should still exist. [CITED: Vite 6 build.rollupOptions.output.manualChunks docs, Context7 /websites/v6_vite_dev]

**Tailwind v4 beta caveat:** Tailwind v4 generates CSS via the `@tailwindcss/vite` plugin which emits one combined stylesheet. There's no known manualChunks pitfall — CSS chunking is separate from JS chunking. The remaining v4 beta risk is the `'unsafe-inline'` style-src concession (D-07).

**lucide-react tree-shaking note:** lucide-react already ships per-icon ES modules, so the tree-shake is automatic in production builds. `manualChunks: { 'vendor-icons': ['lucide-react'] }` groups only the icons actually imported by the app — verify in the stats.html treemap that vendor-icons doesn't contain all 1,000+ icons (if it does, switch the manualChunks rule to a regex/function form). [CITED: javascript.plainenglish.io 2025 tree-shaking writeup]

### Pattern 6: Lighthouse CI as the 7th GitHub Actions job

**What:** A new `lighthouse` job in `.github/workflows/ci.yml` that waits for the Vercel preview URL to be ready, then runs `lhci autorun` against it with assertion thresholds set to Performance/Accessibility/Best Practices ≥ 90.

**When to use:** On PRs (gates merge). Whether to also run on `main` push is up to the planner per D-25's "planner decides based on CI minute cost." **Recommendation: PR-only.** The preview URL is what we're protecting; once it merges, the next PR catches the regression.

**Wiring — "post-Vercel-deploy waitFor" pattern:** Vercel doesn't directly notify GitHub Actions when a preview is ready, but the `amondnet/vercel-action` or `patrickedqvist/wait-for-vercel-preview` actions poll Vercel's deployment status until the preview URL responds 200. Recommended action: **`patrickedqvist/wait-for-vercel-preview@v1.3.2`** — pure-shell, no Vercel token needed (uses GitHub's deployment status API). [VERIFIED: GitHub Marketplace listing 2026-05]

**`lighthouserc.json` (new at repo root):**

```jsonc
// Source: googlechrome/lighthouse-ci configuration docs [CITED: Context7 /googlechrome/lighthouse-ci]
{
  "ci": {
    "collect": {
      "numberOfRuns": 3,
      "settings": {
        "preset": "desktop"
      }
    },
    "assert": {
      "assertions": {
        "categories:performance": ["error", { "minScore": 0.9 }],
        "categories:accessibility": ["error", { "minScore": 0.9 }],
        "categories:best-practices": ["error", { "minScore": 0.9 }]
      }
    },
    "upload": {
      "target": "temporary-public-storage"
    }
  }
}
```

`temporary-public-storage` is Google's free LHCI report bucket — no token required. If the team later wants persistent reports, swap to `lhci-server` deployment. [CITED: Context7 /googlechrome/lighthouse-ci]

**`.github/workflows/ci.yml` job sketch (new 7th job):**

```yaml
# Source: googlechrome/lighthouse-ci README + patrickedqvist/wait-for-vercel-preview README
  lighthouse:
    runs-on: ubuntu-latest
    needs: [lint, format-check, typecheck, test-unit, test-e2e]
    if: github.event_name == 'pull_request'
    steps:
      - uses: actions/checkout@v4
      - name: Wait for Vercel preview
        id: wait
        uses: patrickedqvist/wait-for-vercel-preview@v1.3.2
        with:
          token: ${{ secrets.GITHUB_TOKEN }}
          max_timeout: 300
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npm install -g @lhci/cli@0.15.x
      - run: lhci autorun --collect.url=${{ steps.wait.outputs.url }}
```

`lhci collect --url=$URL` does **not** require any token. Assertions run locally; upload to `temporary-public-storage` requires no auth. The `LHCI_GITHUB_APP_TOKEN` shown in some Context7 examples is OPTIONAL — used for posting status checks to PRs with rich previews; without it, the job still fails the PR via exit code if assertions fail. [VERIFIED: lhci docs + Context7]

### Pattern 7: CI compliance grep (D-16, D-17)

**What:** A single `grep -rniE` invocation in a new `compliance-copy` CI job that case-insensitively, word-boundary matches the 4 SC#5 denylist terms in `src/**/*.{tsx,ts}` excluding test files and `e2e/**`.

**Exit-code semantics — CRITICAL:** `grep` exits **0 on match, 1 on no-match**. The CI job's success condition is the OPPOSITE — success = no match. Therefore the grep invocation must be **inverted** in the shell expression. Three idioms work:

```bash
# A. Negation
! grep -rniE '\b(depression|anxiety|therapy|mental health treatment)\b' src --include='*.ts' --include='*.tsx' --exclude='*.test.ts' --exclude='*.test.tsx'

# B. If/then
if grep -rniE '\b(depression|anxiety|therapy|mental health treatment)\b' src --include='*.ts' --include='*.tsx' --exclude='*.test.ts' --exclude='*.test.tsx'; then
  echo "::error::Forbidden term found"
  exit 1
fi

# C. Inverted with explicit success
grep -rniE '\b(depression|anxiety|therapy|mental health treatment)\b' src --include='*.ts' --include='*.tsx' --exclude='*.test.ts' --exclude='*.test.tsx' && exit 1 || exit 0
```

**Recommendation: idiom B** — produces a readable GitHub Actions annotation pointing the dev at the violating term. [VERIFIED via bash test on this repo 2026-05-11: `grep -rniE '\b(depression|anxiety|therapy|mental health treatment)\b' src --include='*.tsx' --include='*.ts' --exclude='*.test.ts' --exclude='*.test.tsx'` → exits 1 (no matches in current code)]

**`git grep` vs `grep`:** `git grep -niE` is faster on large repos and respects `.gitignore` automatically. For this repo (~150 source files), the difference is < 100ms either way — stick with plain `grep` for portability (the CI runner doesn't need a git checkout depth concern; `actions/checkout@v4` clones full tree). **Use `grep`.**

**Word-boundary caveat in extended regex:** GNU `grep -E` understands `\b` (POSIX-flavored) on Linux runners. BSD grep on macOS doesn't — but CI runs on `ubuntu-latest` so this is fine. Document the dependency for any future runner change.

**Path glob caveat:** `--include='*.test.tsx'` excludes by file extension, not by directory. The current Phase 1 test layout has tests co-located (`Foo.test.tsx` next to `Foo.tsx`), so `--exclude='*.test.tsx'` + `--exclude='*.test.ts'` is sufficient. The `e2e/` directory is NOT under `src/`, so it's excluded by virtue of being outside the search root. **The grep scope is `src/` only** — no extra `--exclude-dir=e2e` needed. [VERIFIED: file layout inspection 2026-05-11]

### Pattern 8: Disclaimer Step 0 + persisted-state migration

**What:** Insert Step 0 inline into the existing `OnboardingFlow.tsx` (no separate component file per 02-PATTERNS.md row 1); shift `useState(1)` → `useState(0)`, `TOTAL_STEPS: 7` → `8`, and the back-clamp `Math.max(1, …)` → `Math.max(0, …)`. Add `acknowledgedDisclaimer: 'v1' | undefined` to `PersistedState`. Render the same disclaimer modal as a blocking overlay in `App.tsx` whenever `user && acknowledgedDisclaimer !== 'v1'`.

**The state-machine pattern — two viable shapes, planner picks:**

| Approach | Mechanism | Tradeoff |
|----------|-----------|----------|
| **A. 0-indexed shift** | `useState(0)`, `TOTAL_STEPS = 8`, validation skipped on step 0, `next()` writes `acknowledgedDisclaimer: 'v1'` to store before advancing | Single state machine; matches CONTEXT D-08 wording ("Step 0"); ProgressIndicator shows 0% at start (acceptable). **Recommended.** |
| B. Separate "disclaimer modal first, then 7-step flow" state | Add a `phase: 'disclaimer' \| 'flow'` flag in component state; render `<DisclaimerModal>` when `phase === 'disclaimer'` else render the existing 7-step `<OnboardingFlow>` content | Cleaner separation but requires a second component file and a new state field, contradicts 02-PATTERNS.md row 1 ("Step-0 variant inside OnboardingFlow does not need to render `<Modal>` at all") |

**Recommendation: A.** Update `TOTAL_STEPS = 8`, `useState(0)`, branch the button row on `step === 0` to show only a single primary "I understand" button (no Back, no Cancel — per D-09), and on click set `acknowledgedDisclaimer: 'v1'` in the store then `setStep(1)`.

**Persisted state migration (D-10):**

```typescript
// src/lib/storage.ts — add to PersistedState
export interface PersistedState {
  // ... existing fields ...
  acknowledgedDisclaimer: 'v1' | undefined;
}

export const initialState: PersistedState = {
  // ... existing fields ...
  acknowledgedDisclaimer: undefined, // NEW; D-10 — undefined, not false, not 'v1'
};
```

```typescript
// src/lib/store.ts — extend the migrate callback
// The existing migrate runs only when persisted version < STORAGE_VERSION.
// Phase 2 bumps STORAGE_VERSION 4 → 5 so v4 users get migrated.
//
// migrateFromV4ToV5 simply sets acknowledgedDisclaimer to undefined
// (which it already is on the new field; the migration is a NO-OP-but-bump).
//
// CRITICAL: do NOT default to 'v1' here. CONTEXT D-10 + D-11 require that
// any v4-migrated user sees the dashboard-render fallback modal on first load.
// 'undefined' triggers the fallback; 'v1' silently grandfathers users in.
```

The `partialize` selector at `src/lib/store.ts:226-245` must add `acknowledgedDisclaimer: state.acknowledgedDisclaimer` so the field persists. [VERIFIED: `store.ts` source]

**Dashboard-render fallback (D-11) wiring in `App.tsx`:**

```typescript
// Add to App.tsx after user selector
const acknowledgedDisclaimer = useStore((s) => s.acknowledgedDisclaimer);
const needsDisclaimer = !!user && acknowledgedDisclaimer !== 'v1';

// In the dashboard return (after AppShell):
{needsDisclaimer && (
  <DisclaimerModal
    open
    onAcknowledge={() => useStore.getState().setAcknowledgedDisclaimer('v1')}
  />
)}
```

The `DisclaimerModal` component composes the existing `src/components/ui/Modal.tsx` with `hideClose` to remove the X icon. CONTEXT D-09 requires no decline path — the modal MUST NOT close on ESC. This requires either (a) adding a `dismissible?: boolean` prop to `Modal.tsx` (cleanest) or (b) using a no-op `onClose` and relying on the disclaimer's only button being "I understand" which calls the acknowledge action. **Recommendation: (a)** — `Modal.tsx` `useEffect` lines 37-48 currently always calls `onClose` on ESC. Add `dismissible?: boolean` (default `true`) and short-circuit when `false`.

**Existing tests to update (D-08 requires both):**

| File | Current state | Phase 2 change |
|------|---------------|----------------|
| `src/components/onboarding/OnboardingFlow.test.tsx` | 7-step happy path with 6× Continue clicks + "Open dashboard" | Add 1 more Continue click at the start (Step 0 acknowledge); update the test name to "8-step happy path" |
| `e2e/onboarding.spec.ts` | 7 step assertions with `getByRole('heading', { name: /welcome|your medication|.../i })` | Add a leading Step-0 block: assert disclaimer heading visible, click "I understand", proceed into existing Step 1 |

**Analytics events (D-13/D-14 + 02-PATTERNS.md row 9):** Extend `EventName` union in `src/lib/analytics.ts`:

```typescript
export type EventName =
  | 'onboarding_started'
  | 'onboarding_step_completed'
  | 'onboarding_completed'
  | 'onboarding_abandoned'
  | 'tab_viewed'
  | 'disclaimer_acknowledged'   // NEW — fires when user clicks "I understand"
  | 'disclaimer_required';      // NEW — fires when dashboard-render fallback shows the modal
```

### Anti-Patterns to Avoid

- **Putting the watermark in HTML/CSS overlay on top of the canvas.** Survives the screenshot requirement only if the screenshot tool captures the DOM, not the canvas alone. Many mobile screenshot tools render the canvas to a separate layer — the HTML overlay is then missing. **Always draw into the canvas via `afterDraw`.** [D-15]
- **Registering the watermark plugin globally via `Chart.register()`.** Would apply it to weight charts, symptom charts, sparkline cards, and Phase 3's uncertainty chart — none of which want the disclaimer. [D-14]
- **`*.sentry.io` in CSP `connect-src`.** Fails to match the actual ingest host shape `o<orgId>.ingest.us.sentry.io` because CSP `*` is single-label. Use `*.ingest.us.sentry.io` AND `*.ingest.sentry.io`. [Pitfall — see Pitfall #2 below]
- **Defaulting `acknowledgedDisclaimer` to `false` in the v4→v5 migration.** Reads as "user has affirmatively declined" — not the same as "we don't know yet." Defaults to `undefined` so dashboard-render fallback (D-11) fires for any pre-Phase-2 user.
- **Letting `sentry-cli` upload land in the Vercel build for Preview deploys.** Preview deploys may run on PRs from forks (no `SENTRY_AUTH_TOKEN` available) — the upload would fail and break the PR. `@sentry/vite-plugin` with `disable: !env.SENTRY_AUTH_TOKEN` short-circuits cleanly.
- **Forgetting `fonts.googleapis.com` + `fonts.gstatic.com` in CSP.** `index.html` loads Google Fonts (Inter, Fraunces, JetBrains Mono). Without the allowlist, fonts fall back to system fonts on first deploy — visible UX regression. [VERIFIED: index.html inspection]
- **Skipping `worker-src 'self' blob:`.** PostHog SDK requirement; omitting causes silent failures of certain analytics features. [CITED: posthog.com/docs/advanced/content-security-policy]

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Source-map upload during build | Custom `npm run build` shell composition with `sentry-cli` | `@sentry/vite-plugin` 5.x | Plugin handles debug-ID injection, release name resolution, glob globbing, post-upload deletion, and graceful no-op when token absent — all of which would be 50+ lines of brittle shell otherwise |
| Bundle analysis | A custom Rollup output-analyzer script | `rollup-plugin-visualizer` | Treemap UI, gzip+brotli sizing, mature library |
| Lighthouse CI | Manually scripted `lighthouse <url>` + JSON parsing in CI | `@lhci/cli` `lhci autorun` | Standard, ships with assertion DSL, has the `temporary-public-storage` upload target so reports survive past the runner's lifetime |
| Waiting for the Vercel preview URL in CI | Custom curl loop polling Vercel deployments API | `patrickedqvist/wait-for-vercel-preview@v1.3.2` | Reads GitHub's deployment status (which Vercel writes) — no Vercel token needed |
| CSP nonce-based hardening of inline styles | A custom Vite plugin that hashes inline `<style>` tags | **DON'T do it in Phase 2** | D-07 explicitly defers Tailwind v4 nonce/hash to Phase 7. Adding `'unsafe-inline'` to `style-src` is the accepted concession |
| Bundle-size monitoring beyond Lighthouse | Custom GitHub action diffing chunk sizes | **DON'T do it in Phase 2** | Lighthouse Performance score IS the gate (D-25). Bundle-size tracking can be a Phase 7 polish item |

**Key insight:** Vercel + Sentry + Lighthouse all have mature first-party tooling. The only place Phase 2 ships custom code is the Chart.js watermark plugin (which has no library equivalent — `chartjs-plugin-watermark` exists but is unmaintained and pre-Chart.js v4) and the `vercel.json` config itself.

## Runtime State Inventory

**This is a code/config/deploy phase, not a rename/migration phase.** Skipping deep-dive runtime state mapping.

The one runtime-state question that DOES apply: **what happens to existing users' Zustand-persisted state when `STORAGE_VERSION` bumps from 4 → 5?**

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data (Zustand persist) | `localStorage["leanshot_v4"]` carries all current user state. Bumping `STORAGE_VERSION` 4→5 triggers the `migrate` callback at `store.ts:246-254` | Extend migrate: when `version === 4`, return `{ ...persistedState, acknowledgedDisclaimer: undefined }`. NO data loss. Existing users see the dashboard-render fallback on their next load (D-11 — by design). |
| Stored data (other localStorage keys) | `leanshot_theme_v4`, `leanshot_anthropic_key`, `leanshot_distinct_id` | None — Phase 2 doesn't touch any of these |
| Live service config | None — Phase 2 introduces Vercel as new service. PostHog dashboards exist from Phase 1 (Production env still gated by `VITE_ANALYTICS_ENABLED=false` until this phase flips it) | New: Vercel project setup (2 projects); Vercel env-var matrix; Sentry "Releases" page will start populating with commit-SHA-tagged entries on first Production deploy |
| OS-registered state | None | — |
| Secrets / env vars | NEW env vars added to Vercel: `VITE_SENTRY_DSN`, `VITE_POSTHOG_KEY`, `VITE_POSTHOG_HOST`, `VITE_ANALYTICS_ENABLED`, `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT`. The Anthropic API key remains user-supplied per-device (`leanshot_anthropic_key` localStorage key, unchanged in Phase 2; Phase 4 replaces with proxy) | Document all 7 in `.env.example`; the SPA project sets all but `SENTRY_AUTH_TOKEN` for all 3 envs; `SENTRY_AUTH_TOKEN` Production-only |
| Build artifacts | `dist/` continues to be the SPA build output; new `dist-marketing/` for marketing | `.gitignore` already excludes `dist/`; add `dist-marketing/` and `stats.html` and `.lighthouseci/` |

## Common Pitfalls

### Pitfall 1: CSP wildcard depth — `*.sentry.io` does NOT match `o123.ingest.us.sentry.io`

**What goes wrong:** The CSP `*` wildcard matches a single subdomain label and does NOT cross dots. `*.sentry.io` matches `app.sentry.io` and `browser.sentry.io` but NOT `o123456.ingest.us.sentry.io`. With only `*.sentry.io` in `connect-src`, Sentry events silently fail to send — the browser blocks the request and reports it only to the CSP report-only endpoint (which isn't configured in Phase 2). Production looks like Sentry is broken.

**Why it happens:** Engineers read MDN's CSP description and assume `*` is glob-like (`**`). It's not. Multi-label hostnames require either explicit hosts or multi-label wildcards (which CSP doesn't support in any browser today).

**How to avoid:** Allowlist `https://*.ingest.us.sentry.io` AND `https://*.ingest.sentry.io` (covers US region + legacy ingest hosts). Test the deployed CSP by visiting the SPA, triggering a Sentry event (via the Dev Tools panel from Phase 1, or `Sentry.captureMessage` from console), and confirming the event lands in the Sentry dashboard.

**Warning signs:** Sentry "Releases" page shows the new release with sourcemaps uploaded but zero events arrive on the next Production deploy. Browser DevTools Network panel shows CSP violations under "Console → Issues" with `Refused to connect to 'https://oXXX.ingest.us.sentry.io/api/...'`. [VERIFIED: getsentry/sentry-docs issue #17202]

### Pitfall 2: Vercel `vercel.json` precedence vs dashboard project settings

**What goes wrong:** Plans assume `vercel.json` is authoritative for build configuration. It's not — the dashboard Project Settings (Build Command, Output Directory, Root Directory, Node version, Framework Preset) take precedence over `vercel.json` for everything EXCEPT headers/redirects/rewrites unless the JSON property is explicitly set. Result: setting `outputDirectory: dist-marketing` in `vercel.json` but leaving the dashboard's Output Directory blank means the marketing project deploys whatever Vite emits at the framework-preset default, which is `dist/` for Vite — wrong directory.

**Why it happens:** Two sources of truth (`vercel.json` + dashboard) with non-obvious precedence rules. Made worse by the fact that the dashboard's "infer from framework" defaults are silently applied when `vercel.json` is absent.

**How to avoid:** Set `buildCommand` AND `outputDirectory` AND `framework` explicitly in `vercel.json` for each project — these properties override dashboard defaults [CITED: Context7 /websites/vercel project-configuration/vercel-json]. Verify the first Production deploy logs show the expected build command and output directory.

**Warning signs:** First Vercel deploy of the marketing project succeeds but lands the SPA build instead of the marketing landing. OR the SPA deploys but `vercel.json` headers don't take effect because the dashboard's Framework Preset is set to "Other" instead of "Vite" and Vercel's header routing assumes a different output structure.

### Pitfall 3: Sentry source-map upload fails the production build when token is wrong

**What goes wrong:** `SENTRY_AUTH_TOKEN` is set in Vercel Production env but the token lacks `project:releases` or `project:write` scope. `@sentry/vite-plugin` fails the build with a 401 from Sentry's API. Deploy is blocked. Per D-20 the upload is intentionally blocking — but the failure mode looks like a Vite build error, not a Sentry config error, and the dev wastes 30 minutes chasing the wrong thing.

**Why it happens:** Sentry's auth-token UI offers many scope checkboxes; the "release" scope is easy to miss. Vercel surfaces the failure as a generic "Build failed" in the deployments list.

**How to avoid:** Generate the auth token with explicit `project:releases` + `project:read` + `org:read` scopes [CITED: docs.sentry.io/account/auth-tokens/]. Add a Verification step (post-merge) where a dev pushes a trivial change to main and confirms the Sentry Release page shows the new commit SHA + the uploaded artifacts count > 0.

**Warning signs:** First Production deploy after Phase 2 lands fails with `Error: HTTP request failed: 401 Unauthorized` in the Vite plugin output. Sentry Releases page is empty or stuck at the last manually-created release.

### Pitfall 4: Lighthouse score depends on cold-start cache state; runs are noisy

**What goes wrong:** A single Lighthouse run against a fresh Vercel preview URL can swing ±5-8 points on Performance based on whether the preview's CDN edge is warm, whether the runner's network is congested, etc. A PR that "should" pass at 91 sometimes scores 87 on a single run.

**Why it happens:** Lighthouse measures real wall-clock metrics (LCP, TBT, CLS) that are inherently noisy on shared CI infrastructure.

**How to avoid:** Configure `lhci autorun` with `--collect.numberOfRuns=3` (median-of-3) — already in the recommended `lighthouserc.json` above [CITED: Context7 /googlechrome/lighthouse-ci]. If flakes persist, drop the asserted floor to 0.85 with a follow-up plan to investigate, rather than disabling the gate.

**Warning signs:** Same PR re-run multiple times produces Performance scores ranging 85-93. Failed assertion logs show only one of three runs below the threshold.

### Pitfall 5: `acknowledgedDisclaimer` migration default of `false` silently grandfathers existing users in

**What goes wrong:** Phase 2's storage migration sets `acknowledgedDisclaimer: false` (or omits the field) for v4→v5 migrants. The dashboard-render fallback at App.tsx checks `acknowledgedDisclaimer !== 'v1'` — both `false` AND `undefined` correctly trigger it. BUT if the migration mistakenly sets `acknowledgedDisclaimer: 'v1'` ("they already accepted before Phase 2"), every existing user skips the disclaimer entirely. SC#2 fails.

**Why it happens:** The instinct to "not surprise existing users with a modal" overrides the legal requirement (D-11) that the disclaimer DOES need to appear for everyone v1.

**How to avoid:** Hard-code the migration to set `acknowledgedDisclaimer: undefined`. Add an assertion in the storage migration test: "v4 user with full state migrates to v5 with `acknowledgedDisclaimer === undefined`."

**Warning signs:** OnboardingFlow tests pass but no existing-user fixture asserts the dashboard-render fallback appears.

### Pitfall 6: CSP blocks the existing Anthropic AI coach in production

**What goes wrong:** The AI coach (Phase 1 — still BYO-key in browser) calls `https://api.anthropic.com` directly. The Phase 2 CSP includes `https://api.anthropic.com` in `connect-src` (D-05) — but if the planner accidentally drops it during the per-project header split, the AI coach silently fails on Production. Dev-mode doesn't catch it because there's no CSP in dev.

**Why it happens:** CSP is a production-only constraint. Local dev runs at `localhost:5173` without `vercel.json`, so the CSP isn't applied. First time anyone exercises the AI coach is post-deploy.

**How to avoid:** Add an explicit acceptance criterion: after Phase 2 ships, the founder opens the deployed SPA, pastes their Anthropic key into Settings, sends a test message, confirms a response arrives. Or: add a Playwright e2e against the Vercel preview URL that asserts an AI fetch to api.anthropic.com is allowed (will require dropping a dummy key into the preview env).

**Warning signs:** AI coach UI shows "Failed to send" or hangs indefinitely on the deployed SPA after Phase 2 lands. Browser DevTools Console shows `Refused to connect to 'https://api.anthropic.com/v1/messages' because it violates the following Content Security Policy directive: connect-src 'self' ...`.

## Code Examples

Verified patterns from official sources, plus the canonical disclaimer modal shape.

### 1. CSP header in `vercel.json` (full SPA shape)

```jsonc
// Source: composed; cited inline in Pattern 2 above
// CRITICAL hostnames:
//  - *.ingest.us.sentry.io  (single-label wildcard limitation — see Pitfall 1)
//  - *.posthog.com  (PostHog official recommendation)
//  - fonts.googleapis.com + fonts.gstatic.com  (existing Google Fonts load in index.html)
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "framework": "vite",
  "buildCommand": "npm run build",
  "outputDirectory": "dist",
  "headers": [
    {
      "source": "/(.*)",
      "headers": [
        {
          "key": "Content-Security-Policy",
          "value": "default-src 'none'; script-src 'self'; connect-src 'self' https://*.ingest.us.sentry.io https://*.ingest.sentry.io https://*.posthog.com https://api.anthropic.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; img-src 'self' data: blob:; font-src 'self' data: https://fonts.gstatic.com; frame-src 'none'; object-src 'none'; base-uri 'self'; form-action 'self'; worker-src 'self' blob:"
        },
        { "key": "Strict-Transport-Security", "value": "max-age=63072000; includeSubDomains; preload" },
        { "key": "X-Content-Type-Options", "value": "nosniff" },
        { "key": "X-Frame-Options", "value": "DENY" },
        { "key": "Referrer-Policy", "value": "strict-origin-when-cross-origin" },
        { "key": "Permissions-Policy", "value": "camera=(), microphone=(), geolocation=()" }
      ]
    }
  ]
}
```

### 2. `vite.config.ts` with all Phase 2 additions

```typescript
// Source: composed from docs.sentry.io/platforms/javascript/sourcemaps/uploading/vite/, Vite 6 build docs, and existing vite.config.ts
import { defineConfig, loadEnv } from 'vitest/config';
import { fileURLToPath, URL } from 'node:url';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { sentryVitePlugin } from '@sentry/vite-plugin';
import { visualizer } from 'rollup-plugin-visualizer';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');

  return {
    plugins: [
      react(),
      tailwindcss(),
      process.env.ANALYZE === 'true' &&
        visualizer({
          filename: 'dist/stats.html',
          template: 'treemap',
          gzipSize: true,
          brotliSize: true,
        }),
      sentryVitePlugin({
        authToken: env.SENTRY_AUTH_TOKEN,
        org: env.SENTRY_ORG,
        project: env.SENTRY_PROJECT,
        release: { name: process.env.VERCEL_GIT_COMMIT_SHA },
        sourcemaps: { filesToDeleteAfterUpload: ['./dist/**/*.map'] },
        disable: !env.SENTRY_AUTH_TOKEN,
      }),
    ].filter(Boolean),
    resolve: {
      alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
    },
    server: { port: 5173, host: true },
    build: {
      sourcemap: 'hidden',
      rollupOptions: {
        output: {
          manualChunks: {
            'vendor-charts': ['chart.js'],
            'vendor-motion': ['framer-motion'],
            'vendor-icons': ['lucide-react'],
            'vendor-react': ['react', 'react-dom'],
          },
        },
      },
    },
    test: {
      environment: 'jsdom',
      globals: true,
      setupFiles: ['./src/test-setup.ts'],
      include: ['src/**/*.test.{ts,tsx}'],
      exclude: ['e2e/**', 'node_modules/**', 'dist/**'],
      css: false,
    },
  };
});
```

### 3. Chart.js per-instance watermark plugin (full file)

```typescript
// src/components/dashboard/charts/medLevelWatermarkPlugin.ts
// Source: Chart.js plugin lifecycle [CITED: Context7 /websites/chartjs] + canvas 2D context save/rotate/fillText pattern
import type { Chart, Plugin } from 'chart.js';

export interface MedLevelWatermarkOptions {
  text?: string;
  fontFamily?: string;
  opacity?: number;
  color?: string;
}

export const medLevelWatermarkPlugin: Plugin<'line', MedLevelWatermarkOptions> = {
  id: 'medLevelWatermark',
  afterDraw(chart: Chart<'line'>, _args, options: MedLevelWatermarkOptions) {
    const { ctx, chartArea } = chart;
    if (!chartArea) return;
    const { left, top, width, height } = chartArea;
    const cx = left + width / 2;
    const cy = top + height / 2;
    const text = options.text ?? 'Estimate — not medical advice';
    const opacity = options.opacity ?? 0.12;
    const color = options.color ?? '120, 120, 120';

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(-Math.PI / 4);
    ctx.font = `bold ${Math.max(14, height * 0.08)}px ${options.fontFamily ?? 'Inter, system-ui, sans-serif'}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = `rgba(${color}, ${opacity})`;
    ctx.fillText(text, 0, 0);
    ctx.restore();
  },
};
```

### 4. Compliance grep CI job

```yaml
# .github/workflows/ci.yml — new compliance-copy job (sixth)
# Source: idiom B from Pattern 7 above
  compliance-copy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Check for forbidden mental-health terms (CMIA AB 2089)
        run: |
          if grep -rniE '\b(depression|anxiety|therapy|mental health treatment)\b' src \
               --include='*.ts' --include='*.tsx' \
               --exclude='*.test.ts' --exclude='*.test.tsx'; then
            echo "::error::Forbidden term found in user-facing string (SC#5 denylist)."
            echo "Allowed: 'mood' (Mood tab name). Disallowed: depression, anxiety, therapy, mental health treatment."
            exit 1
          fi
```

### 5. Disclaimer modal (composed on existing Modal primitive)

```tsx
// src/components/dashboard/DisclaimerModal.tsx (new — composes src/components/ui/Modal.tsx)
// Source: composed; uses existing Modal.tsx with proposed new dismissible? prop (see Pattern 8)
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';

interface DisclaimerModalProps {
  open: boolean;
  onAcknowledge: () => void;
}

export function DisclaimerModal({ open, onAcknowledge }: DisclaimerModalProps) {
  return (
    <Modal
      open={open}
      onClose={() => { /* no-op: D-09 forbids close paths */ }}
      title="Before you start"
      size="md"
      hideClose
      // dismissible={false}  ← new prop (Pattern 8) — disables ESC-to-close
    >
      <div className="space-y-4">
        <p className="text-[14px] text-[var(--color-text-primary)] leading-relaxed">
          <strong>Not medical advice.</strong> LeanShot helps you track GLP-1 medications,
          body metrics, food, activity, and symptoms. The drug-level chart shows a modeled
          estimate based on population pharmacokinetics — not a measured serum level.
          Always consult your healthcare provider for clinical decisions.
        </p>
        <p className="text-[14px] text-[var(--color-text-secondary)] leading-relaxed">
          Your data stays on this device unless you choose to sync. We do not share your
          health data with third parties.
        </p>
        <Button className="w-full" onClick={onAcknowledge}>
          I understand
        </Button>
      </div>
    </Modal>
  );
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `sentry-cli sourcemaps inject && upload` shell calls in build command | `@sentry/vite-plugin` 5.x | 2023+ (plugin GA) | Cleaner integration, automatic debug ID injection, gracefully disables when token absent |
| Single `vercel.json` with all routing | Per-project Vercel dashboard settings + minimal `vercel.json` per origin | Vercel monorepo support (2022) | Multiple projects from one repo without monorepo refactor |
| Global `Chart.register(plugin)` for per-chart behavior | Per-instance `config.plugins: [plugin]` array | Chart.js v3.0+ | Plugins scope to a single chart instance — required pattern for v4 |
| Lighthouse via custom CI script | `@lhci/cli autorun` + `lighthouserc.json` assertions | 2019+ | Standard CI Lighthouse runner; built-in flake mitigation via numberOfRuns |
| `*.sentry.io` in CSP `connect-src` | `*.ingest.us.sentry.io` + `*.ingest.sentry.io` | Always-true; misunderstanding pattern | Single-label wildcards never matched multi-label hosts; recent doc updates clarify [getsentry/sentry-docs#17202] |

**Deprecated/outdated:**
- `chartjs-plugin-watermark`: last published 2018, pre-Chart.js v3. **Do not use.** Hand-roll the plugin (8 lines of code, shown above).
- `lighthouse-ci` standalone Docker image: superseded by `@lhci/cli` 0.15.x.
- Single-region Sentry DSNs without `.us.` / `.de.` infix: still issued but new orgs land on regional hosts that the legacy `*.ingest.sentry.io` wildcard partially covers.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Phase 1 plan 06's `.github/workflows/ci.yml` was NOT committed on the current branch (git ls-tree shows no `.github/` files) and Phase 2 must create it | Architecture Patterns / Critical layout note | Plans would write at the wrong path; CI duplication or replacement collision |
| A2 | The project lives at the repo root (no `leanshot/` subdir) on this branch despite Phase 1 SUMMARY references to `defaults.run.working-directory: leanshot` | Architecture Patterns / Recommended Structure | Plan paths would be wrong; lhci/visualizer/vercel.json placed in the wrong directory |
| A3 | The Vercel "Configuration Override" feature lets a single repo serve two `vercel.json` shapes for two projects without filesystem split | Pattern 2 | Planner may need to fall back to the `marketing/` subdirectory split, which collides with "no monorepo refactor" (D-04) |
| A4 | Tailwind v4 beta CSS pipeline plays nicely with `manualChunks` without any special config | Pattern 5 | If chunking breaks Tailwind's runtime style injection, would need to exclude CSS from the manualChunks rule |
| A5 | `lhci autorun --collect.url=<URL>` against a Vercel preview URL successfully scores Performance ≥ 90 after the manualChunks pass alone | Lighthouse section | If actual score lands 85-89, D-25's "fallback to manual verification" kicks in or the team rolls Phase 2.1 with library swaps |
| A6 | Modal.tsx's existing ESC-to-close behavior (line 39-41) can be safely modified by adding a `dismissible?: boolean` prop without breaking the other 6+ Modal callers in the app | Pattern 8 / Disclaimer wiring | If a `dismissible` prop addition is rejected, the disclaimer modal needs a separate primitive (cost: ~40 LOC, no big deal but a planner decision) |
| A7 | `process.env.VERCEL_GIT_COMMIT_SHA` is auto-populated by Vercel during build | Pattern 3 | If absent on Hobby tier, the Sentry release tag would be missing; alternate is reading `GITHUB_SHA` from the CI env (only useful when GH-triggered) |
| A8 | The dark-theme watermark opacity (0.18 per D-13) reads well against the dark chart backdrop; planner verifies visually | Pattern 4 | Visual judgment; not a blocker, but if it reads as too prominent or too faint, the constant adjusts inside the plugin |

## Open Questions

1. **Does the marketing project need its own separate Sentry project?**
   - What we know: CONTEXT D-19 says "no Sentry [for marketing] (marketing is a static landing — errors here are rare and observable in browser console)."
   - What's unclear: Once marketing has form submissions or any client-side JS interactions, error blindness becomes a real cost.
   - Recommendation: Ship Phase 2 with no marketing Sentry per D-19; reopen if marketing accrues meaningful JS surface.

2. **Should Lighthouse CI run on `main` push as well as on PRs?**
   - What we know: D-25 leaves it to planner.
   - What's unclear: Cost of an extra LHCI run per merge vs. value of catching post-merge regressions.
   - Recommendation: PR-only initially. Each PR is the gate; merges are protected by the PR gate. Revisit if the team starts force-pushing to main.

3. **What about `connect-src` for the marketing origin?**
   - What we know: CONTEXT D-06 says marketing gets HSTS + X-Content-Type + Referrer-Policy only — no CSP.
   - What's unclear: If marketing later loads any third-party scripts (analytics, tracking pixels), absence of CSP means no protection.
   - Recommendation: Ship without CSP per D-06. Revisit alongside Phase 7 marketing analytics work.

4. **Does the disclaimer also need to appear before the marketing landing's "Start" CTA?**
   - What we know: SC#2 says "before any tab is interactive" — that's the SPA, not marketing.
   - What's unclear: Should the marketing landing also display a brief disclaimer banner?
   - Recommendation: No. Marketing copy stays disclaimer-free; the disclaimer is part of the app's first-run flow. Phase 7 legal review may revisit.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js 22 | All builds | ✓ (CI uses 22 per Phase 1; local v22.18.0) | 22.x | — |
| npm | All builds | ✓ | 10.x | — |
| Vercel account | D-01 hosting | ✗ (assumed: founder creates during Phase 2 execution) | — | Hand-built static deploy to Cloudflare Pages (cost: re-engineering ~1 plan worth of work) |
| Sentry project access | D-20 source-map upload | ✓ (Phase 1 wired SDK; existing project) | — | Disable plugin via `disable: true`; lose stack-trace symbolication |
| PostHog project access | D-18 production analytics flip | ✓ (Phase 1 wired SDK) | — | Leave `VITE_ANALYTICS_ENABLED=false`; lose funnel measurement |
| `grep` GNU extended regex | Compliance grep job | ✓ (ubuntu-latest runner) | grep 3.x | git grep (slightly different syntax) |
| `@lhci/cli` | Lighthouse CI gate | Installable in CI | 0.15.1 | Manual Lighthouse runs in browser DevTools (loses CI gate) |

**Missing dependencies with no fallback:** None at code-time. Vercel + Sentry + PostHog accounts must exist before deploy — the team has them from Phase 1.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 4.1.5 (unit) + Playwright 1.59.1 (e2e) |
| Config file | `vite.config.ts` (`test` block); `playwright.config.ts` |
| Quick run command | `npm run test:unit` (Vitest); `npm run test:e2e` (Playwright) |
| Full suite command | `npm test` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| COMPL-04 | Disclaimer modal blocks first-run SPA before any tab interactive | RTL + e2e | `npm run test:unit -- OnboardingFlow.test` + `npm run test:e2e -- onboarding.spec` | ✅ exists (update for 8-step) |
| COMPL-04 | Drug-level chart canvas contains watermark text | unit (canvas mock) | `npm run test:unit -- medLevelWatermarkPlugin.test` | ❌ Wave 0 |
| COMPL-04 | Dashboard-render fallback fires for migrated v3/v4 users | RTL | `npm run test:unit -- App.disclaimer.test` | ❌ Wave 0 |
| COMPL-05 | CI grep blocks PRs containing denylist terms | shell (CI job) | `bash -c "if grep -rniE ..."` (in CI) | ❌ Wave 0 (the `compliance-copy` job itself) |
| PROD-01 | SPA reachable at Vercel preview URL over HTTPS with valid cert | manual | Deploy + browser visit | manual (HUMAN-UAT) |
| PROD-01 | Lighthouse Performance + Accessibility ≥ 90 on preview URL | LHCI | `lhci autorun --collect.url=$URL` (in CI) | ❌ Wave 0 (`lighthouserc.json` + CI job) |
| PROD-06 | Marketing landing served from separate Vercel project | manual | Deploy + browser visit | manual (HUMAN-UAT) |
| (storage) | v4→v5 migration sets `acknowledgedDisclaimer: undefined` | unit | `npm run test:unit -- storage.test` | ✅ exists (extend) |

### Sampling Rate
- **Per task commit:** `npm run test:unit` (fast, <5s)
- **Per wave merge:** `npm test` (unit + e2e)
- **Phase gate:** Full suite green AND a successful Vercel preview deploy with all 7 CI jobs green AND Lighthouse score ≥ 90 captured

### Wave 0 Gaps

- [ ] `src/components/dashboard/charts/medLevelWatermarkPlugin.test.ts` — unit test the plugin's canvas-context calls via a mock Chart instance (jsdom canvas is limited; consider `vitest-canvas-mock`)
- [ ] `src/components/dashboard/DisclaimerModal.test.tsx` — render + click "I understand" + assert acknowledge callback fired
- [ ] `src/App.disclaimer.test.tsx` (or extend existing App test) — render with `acknowledgedDisclaimer: undefined` → assert modal visible; with `'v1'` → assert hidden
- [ ] `src/lib/storage.test.ts` — extend with v4→v5 migration assertion
- [ ] `lighthouserc.json` — new file
- [ ] `.github/workflows/ci.yml` — full file (not just additions — file doesn't exist on this branch)
- [ ] `vercel.json` — new file (root)
- [ ] Update `e2e/onboarding.spec.ts` — Step-0 disclaimer block

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | Phase 5 |
| V3 Session Management | no | Phase 5 |
| V4 Access Control | no | Phase 5 / 8 (RLS) |
| V5 Input Validation | partial | Disclaimer modal has no user input. Phase 2 doesn't introduce new input surfaces. |
| V6 Cryptography | no | Phase 2 does not handle keys (Anthropic key remains user-supplied via localStorage; Phase 4 supersedes) |
| V14 Configuration | **yes** | CSP, HSTS, X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy — all in `vercel.json` per D-05 |
| V11 Business Logic | partial | "Cannot dismiss disclaimer" is a business-logic constraint enforced via UI; not a security control proper |

### Known Threat Patterns for SPA + Static Hosting

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| XSS via inline script injection | Tampering | `script-src 'self'` (D-05) — no inline scripts allowed; React's JSX escapes by default |
| Clickjacking | Repudiation | `X-Frame-Options: DENY` + `frame-src 'none'` (D-05) |
| MIME-sniffing-based file-type confusion | Tampering | `X-Content-Type-Options: nosniff` (D-05) |
| Mixed-content / HTTP downgrade | Information Disclosure | HSTS with `preload` + `max-age=63072000` (D-05); Vercel auto-provides HTTPS |
| Third-party origin exfiltration via fetch | Information Disclosure | `connect-src` allowlist limits fetch destinations to Sentry/PostHog/Anthropic |
| Source-map leakage in production | Information Disclosure | `build.sourcemap: 'hidden'` + `filesToDeleteAfterUpload` strips `.map` files (D-21) |
| CSP misconfiguration silently kills observability | Repudiation | Pitfall 1 above — explicit `*.ingest.us.sentry.io` allowlist |
| Forbidden mental-health framing leaks into UI | Compliance (CMIA AB 2089) | Compliance grep CI job (D-16) |

## Sources

### Primary (HIGH confidence)
- Context7 `/websites/vercel` — `vercel.json` schema, `outputDirectory`, `buildCommand`, headers config
- Context7 `/websites/chartjs` — plugin lifecycle (`beforeDraw`/`afterDraw`), per-instance plugin pattern via `config.plugins`
- Context7 `/getsentry/sentry-javascript` — `@sentry/vite-plugin` config patterns
- Context7 `/googlechrome/lighthouse-ci` — `lhci autorun`, `lighthouserc.json` assertion config, `temporary-public-storage` upload target
- Context7 `/btd/rollup-plugin-visualizer` — `visualizer()` options with Vite plugin integration
- Context7 `/websites/v6_vite_dev` — `build.rollupOptions.output.manualChunks` configuration
- docs.sentry.io/platforms/javascript/sourcemaps/uploading/vite/ — verbatim plugin example with `disable: !env.SENTRY_AUTH_TOKEN`
- posthog.com/docs/advanced/content-security-policy — `*.posthog.com` wildcard recommendation + `worker-src 'self' blob:`
- npm registry — version verification for `@sentry/vite-plugin@5.2.1`, `@lhci/cli@0.15.1`, `rollup-plugin-visualizer@6.0.4`, `vite@8.0.11` (latest), and currently-installed `@sentry/react@10.52.0`, `chart.js@4.4.6`, `posthog-js@1.372.10` [VERIFIED 2026-05-11]
- This repo: `src/components/ui/Modal.tsx`, `src/components/onboarding/OnboardingFlow.tsx`, `src/lib/store.ts`, `src/lib/storage.ts`, `src/App.tsx`, `src/components/dashboard/charts/MedLevelChart.tsx`, `src/components/dashboard/charts/BaseChart.tsx`, `vite.config.ts`, `package.json`, `index.html`, `e2e/onboarding.spec.ts` — all directly inspected for the integration-point notes [VERIFIED 2026-05-11]

### Secondary (MEDIUM confidence)
- getsentry/sentry-docs GitHub issue #17202 — "CSP wildcard depth gotcha for ingest.us.sentry.io" — surfaced via WebSearch, content corroborated by Sentry's own CSP filter help doc + Sentry forum
- patrickedqvist/wait-for-vercel-preview@v1.3.2 — GitHub Marketplace action; widely used pattern for Vercel preview wait-on
- javascript.plainenglish.io 2025 article on lucide-react tree-shaking with Vite — corroborates the "manualChunks groups imported icons but doesn't bloat to all 1000+" claim

### Tertiary (LOW confidence)
- Exact Lighthouse score the manualChunks pass will produce — depends on actual measurement against the deployed preview URL; no source can predict it precisely (Assumption A5)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all versions npm-verified 2026-05-11
- Architecture (Vercel multi-project): HIGH — official docs match, three options enumerated with tradeoffs
- CSP shape: HIGH — wildcard depth gotcha confirmed against Sentry docs issue + PostHog docs
- Chart.js plugin: HIGH — Context7 docs match canvas pattern exactly
- Source-map upload: HIGH — official Sentry Vite plugin docs match
- Lighthouse score floor of 90 after manualChunks alone: MEDIUM — depends on measurement; planner must include a "measure first" task
- Migration default of `undefined`: HIGH — required by D-10/D-11 wording

**Research date:** 2026-05-11
**Valid until:** 2026-06-11 (Vercel/Sentry/Vite are fast-moving — re-verify versions if Phase 2 execution starts > 30 days from now)
