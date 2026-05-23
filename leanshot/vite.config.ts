import { defineConfig } from 'vitest/config';
import { loadEnv, type PluginOption } from 'vite';
import { fileURLToPath, URL } from 'node:url';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { sentryVitePlugin } from '@sentry/vite-plugin';
import { visualizer } from 'rollup-plugin-visualizer';
// Phase 42 Plan 04 (POLISH-07) — PWA + offline foundation. injectManifest
// strategy is required because Plan 42-08 adds a `push` event listener inside
// the SW context (generateSW does not support arbitrary listeners).
import { VitePWA } from 'vite-plugin-pwa';

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
      // Phase 42 Plan 04 — VitePWA plugin (POLISH-07).
      //
      // HIPAA constraint (Pitfall 1 / T-42-04-01): Workbox's runtime cache key
      // is the request URL. `Authorization` headers do NOT discriminate cached
      // responses, so caching authenticated Supabase API responses would leak
      // PHI across users on the same PWA install. The runtime caching is
      // owned entirely by src/sw.ts (injectManifest strategy) — see the
      // explicit URL allowlist there for the three public-read endpoints:
      //   /rest/v1/(kb_articles|changelog_entries|status_components)
      // NEVER add an authenticated endpoint to that allowlist without first
      // attaching a per-user cache-key plugin.
      //
      // Pitfall 9 mitigation: `injectRegister: false` keeps the auto-register
      // glue OFF the index chunk; SW registration is lazy-imported via
      // dynamic import() from src/App.tsx useEffect.
      //
      // Pitfall 5 mitigation: `devOptions.enabled: false` keeps the SW out of
      // `vite` dev server so HMR is not intercepted by a stale precache.
      //
      // D-17: `skipWaiting: false` so the user controls the update via the
      // "New version available — Reload" toast (Toast click → postMessage
      // SKIP_WAITING → src/sw.ts handler skipWaiting()s).
      VitePWA({
        registerType: 'autoUpdate',
        injectRegister: false,
        strategies: 'injectManifest',
        srcDir: 'src',
        filename: 'sw.ts',
        devOptions: { enabled: false },
        injectManifest: {
          // Inherit the build-time precache manifest defaults; src/sw.ts owns
          // the runtime caching strategies (workbox-routing registerRoute).
          // No globPatterns override — VitePWA's defaults precache the build
          // output (html/js/css/png/svg/woff2).
        },
        workbox: {
          // injectManifest mode only consumes workbox.skipWaiting and
          // workbox.clientsClaim from this block; everything else lives in
          // src/sw.ts. D-17: do not auto-skipWaiting.
          skipWaiting: false,
          clientsClaim: true,
        },
        manifest: {
          name: 'LeanShot',
          short_name: 'LeanShot',
          description:
            'Clinical-grade GLP-1 medication tracker — drug-level curves, vial supply, AI coaching, and doctor-ready reports.',
          theme_color: '#0B1413',
          background_color: '#EFEBE0',
          display: 'standalone',
          start_url: '/',
          scope: '/',
          icons: [
            { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
            { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
            {
              src: 'maskable-icon-512x512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'maskable',
            },
            {
              src: 'apple-touch-icon.png',
              sizes: '180x180',
              type: 'image/png',
              purpose: 'any',
            },
          ],
        },
      }),
      // Sentry plugin MUST be last per official guidance.
      // disable: !env.SENTRY_AUTH_TOKEN makes Preview + Development complete no-ops (D-22).
      // In Vercel Production (token set), the plugin uploads source maps then deletes
      // the .map files via filesToDeleteAfterUpload so they never ship to clients.
      sentryVitePlugin({
        authToken: env.SENTRY_AUTH_TOKEN,
        org: env.SENTRY_ORG,
        project: env.SENTRY_PROJECT,
        release: { name: process.env.VERCEL_GIT_COMMIT_SHA },
        sourcemaps: { filesToDeleteAfterUpload: ['./dist/**/*.map'] },
        disable: !env.SENTRY_AUTH_TOKEN,
      }),
    ].filter(Boolean) as PluginOption[],
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },
    server: {
      port: 5173,
      host: true,
      // Phase 4 D-04: allow vitest to resolve files in the repo-root `shared/`
      // directory (one level UP from leanshot/). Without this, vite's default
      // fs.allow only permits the project root, blocking `../shared/*.test.ts`.
      fs: { allow: ['..'] },
    },
    build: {
      // 'hidden' generates .map files but does NOT add the sourceMappingURL comment to .js.
      // Even if a .map slips past filesToDeleteAfterUpload, clients can't fetch it (D-21).
      sourcemap: 'hidden',
      rollupOptions: {
        output: {
          // D-23 — manualChunks per the human-approved 02-02 measurement output.
          // Decision (Human-verified, see 02-02-BUNDLE-MEASUREMENT.md):
          //   Q1 No  — vendor-telemetry stays merged (no consent toggle in Phase 02)
          //   Q2 Yes — vendor-charts promoted out of BaseChart for cache-stability
          //   Q3 Yes — vendor-icons split (~8 kB gz isolated chunk for cache stability)
          // 2.1 update — function form per .planning/phases/02.1-spa-lighthouse-perf/02.1-RESEARCH.md
          // root-cause: object form left react-dom in `index` because the entry was the only
          // static consumer; function form forces ANY id matching the anchored regex into the
          // named chunk regardless of static-vs-lazy graph reachability.
          // Anchored regex (`/node_modules\/(...)(\/|$)/`) avoids `id.includes('react')`
          // false-positives such as `@use-gesture/react` polluting `vendor-react` (RESEARCH P1).
          manualChunks: (id: string): string | undefined => {
            // CSS-module guard — manualChunks receives ALL ids including .css ones;
            // routing CSS into a JS chunk breaks the CSS pipeline (RESEARCH pitfall #1).
            if (id.endsWith('.css') || id.includes('?css')) return undefined;

            // Phase 24 D-18..20 — per-chunk ceilings for v1.3 Platform Expansion.
            // Routes are no-ops for code not yet shipped (helpdesk, i18n, gamification,
            // community, course); assert-bundle-budget.sh tolerates MISSING chunks.
            // NOTE: admin-shell MUST precede the legacy 'admin-bundle' rule below so
            // Phase 24 admin code lands in 'admin-shell' (ceiling 30 kB gz) rather
            // than the older Phase 15 'admin-bundle' (page-builder editor chunk).
            // The Phase 15 src/components/admin/ → admin-bundle rule below is
            // intentionally kept for page-builder backward-compat; Phase 24 admin
            // components are under src/components/admin/ but the admin-shell rule
            // fires first because it also checks src/lib/admin/.
            if (id.includes('/src/lib/admin/')) return 'admin-shell';
            // Phase 37 Plan 06 — helpdesk chunk topology (D-16 / D-18 / T-37-06-06).
            //
            // The widget root chunk (`helpdesk-widget`) MUST stay ≤25 kB gz —
            // mounted on every screen via App.tsx. Heavy sub-components are
            // routed to SEPARATE chunks so their bytes only download when the
            // user actually navigates to them inside the widget:
            //   - KBArticleView pulls in react-markdown + remark-gfm + rehype-raw + dompurify
            //     → 'helpdesk-article' chunk (only loads when opening an article).
            //   - MacroTypeahead pulls in fuse.js
            //     → 'helpdesk-macros' chunk (only loads when the agent types '/').
            //   - TicketForm + TicketList + TicketThread + hooks → 'helpdesk-tickets'
            //     (loads on opening the ticket form/thread; modest because supabase-js
            //     is already in vendor-supabase).
            // The widget root (HelpdeskWidget + KBSearchTypeahead + index barrel)
            // stays in 'helpdesk-widget'. ORDER MATTERS — more-specific rules first.
            if (
              id.includes('/src/helpdesk/KBArticleView') ||
              id.includes('/src/components/helpdesk/KBArticleView')
            ) return 'helpdesk-article';
            if (
              id.includes('/src/helpdesk/MacroTypeahead') ||
              id.includes('/src/components/helpdesk/MacroTypeahead')
            ) return 'helpdesk-macros';
            if (
              id.includes('/src/helpdesk/TicketForm') ||
              id.includes('/src/helpdesk/TicketList') ||
              id.includes('/src/helpdesk/TicketThread') ||
              id.includes('/src/helpdesk/ReplyComposer') ||
              id.includes('/src/helpdesk/TypingIndicator') ||
              id.includes('/src/helpdesk/hooks/')
            ) return 'helpdesk-tickets';
            if (
              id.includes('/src/helpdesk/') ||
              id.includes('/src/components/helpdesk/') ||
              id.includes('/src/lib/helpdesk/')
            ) return 'helpdesk-widget';
            if (id.includes('/src/lib/i18n/') || id.includes('/src/components/i18n/')) return 'i18n-runtime';
            if (id.includes('/src/lib/gamification/') || id.includes('/src/components/gamification/')) return 'gamification-burst';
            // Phase 44 Plan 09 — community sub-chunk rules.
            // ORDER MATTERS: more-specific rules must appear BEFORE the community/ catch-all.
            // community-media: Mux player (~170 kB gz) + Mux uploader (~16 kB gz) kept out of community-feed.
            if (id.includes('/src/components/community/media/')) return 'community-media';
            // community-mentions: Fuse.js (8 kB gz) kept out of community-feed (mirrors helpdesk-macros).
            if (id.includes('/src/components/community/mentions/')) return 'community-mentions';
            // Mux player + uploader npm packages + all transitive @mux deps → community-media.
            // Catches mux-player-react, mux-uploader-react, mux-player (custom element), mux-uploader,
            // playback-core, upchunk, mux-video, mux-data-* and any other @mux/* transitive deps.
            if (id.includes('node_modules/@mux/')) {
              return 'community-media';
            }
            if (id.includes('/src/components/community/')) return 'community-feed';
            if (id.includes('/src/components/course/')) return 'course-player';

            // Phase 8 Plan 08-06 — group all `src/components/share/*` files
            // into a single `share` chunk. SharePage is already lazy-loaded
            // from App.tsx, so this just ensures CodeEntryScreen,
            // ShareRevokedScreen, and share-client land in the same lazy
            // chunk rather than fragmenting into multiple small chunks
            // (which would each pay the per-chunk HTTP + parse overhead).
            // Plan 08-04 Task 2b owns the actual share-chunk size assertion
            // (gz ≤ 18 kB ceiling, currently ~4 kB) — this rule is purely
            // about grouping. Plan 08-06's static-import CI guard
            // (.github/workflows/ci.yml) is the regression-prevention layer.
            if (id.includes('src/components/share/')) return 'share';

            // Phase 10 Plan 10-05 — group the shared ReadOnlyPatientView +
            // section components into a dedicated 'read-only-patient-view' chunk.
            // Both 'share' and 'clinic' lazy chunks depend on this shared chunk.
            // This reduces the 'share' chunk size by ~8 kB gz (body-section
            // rendering moves out) and enables the 'clinic' drill-in chunk to
            // reuse the same section components without duplication.
            // Chunk ceiling: ≤12 kB gz (enforced by assert-clinic-bundle-budget.sh).
            if (id.includes('src/components/shared/')) return 'read-only-patient-view';

            // Phase 9 — group clinic surfaces into separate lazy chunks
            // (consolidates 09-02 operator surface + 09-03 settings tabs
            // + 09-04 invite acceptance). Each chunk is lazy-loaded from
            // App.tsx; splitting matters because each chunk pays per-HTTP
            // + parse overhead, but grouping by surface keeps the index gz
            // ceiling intact and preserves cache locality.
            // Order matters: clinic-invite first (most specific), then
            // clinic/settings/, then catch-all clinic/. Bundle ceilings
            // enforced by assert-clinic-bundle-budget.sh.
            if (id.includes('src/components/clinic-invite/')) return 'clinic-invite';
            if (id.includes('src/components/clinic/settings/')) return 'clinic-settings';
            if (id.includes('src/components/clinic/')) return 'clinic';

            // Phase 15 Plan 15-02 — PAGE-02: the entire admin page-builder editor
            // (BlockTreePanel, PropertyPanel, PreviewPane, TemplatePicker,
            // AssetLibraryPicker, the 12 block-component editors, etc.) must be
            // lazy-loaded behind a React.lazy() boundary so public visitors never
            // download the editor. Source-path rule MUST come before the
            // node_modules block so editor source files are routed by path, not
            // swept into a vendor chunk.
            // Phase 24 D-18..20 — renamed from 'admin-bundle' → 'admin-shell' to
            // unify the Phase 24 AdminShell + Phase 15 page-builder editor into
            // one named chunk with a 30 kB gz ceiling enforced by
            // assert-bundle-budget.sh. The dnd-kit index-leak guard in
            // assert-clinic-bundle-budget.sh is still enforced separately.
            if (id.includes('src/components/admin/')) return 'admin-shell';

            // Phase 15 Plan 15-02 — D-03: page-builder runtime helpers
            // (block-schema.ts, json-ld.ts, templates.ts) load on published
            // /{slug} pages rendered via the page-render Edge Function. Kept in
            // a separate `page-builder-runtime` chunk with a ≤25 kB gz ceiling
            // (enforced by assert-clinic-bundle-budget.sh). dnd-kit is
            // explicitly NOT counted against this ceiling — it lives in
            // `vendor-dnd-kit` (see node_modules rule below).
            if (id.includes('src/lib/page-builder/')) return 'page-builder-runtime';

            if (id.includes('node_modules')) {
              // Phase 19 Plan 19-07 — pin @thumbmarkjs/thumbmarkjs to its own
              // `fingerprint` chunk so it loads ONLY on /signup + the affiliate
              // apply form (dynamic-import in src/lib/affiliate/fingerprint.ts).
              // Per 19-RESEARCH.md Pitfall 3: a static import would push index gz
              // past the Phase 12 ceiling (~21.49 kB → ~35 kB) — the manualChunks
              // rule plus the dynamic-import in fingerprint.ts together keep the
              // bundle clean. Target ≤12 kB gz for this chunk.
              if (/node_modules\/@thumbmarkjs\/thumbmarkjs(\/|$)/.test(id)) {
                return 'fingerprint';
              }
              // Phase 9 Plan 09-02 — pin @supabase/* to its own vendor chunk
              // so the operator-clinic surface (which static-imports
              // src/lib/supabase via src/lib/clinic.ts) doesn't drag the
              // full Realtime+Postgrest+GoTrue bundle into the 12 kB clinic
              // chunk ceiling. Multiple lazy chunks consume supabase-js
              // (clinic + auth-loaded routes + lazy `sync`) so a shared
              // vendor-supabase chunk is correct.
              if (
                /node_modules\/(@supabase\/(supabase-js|realtime-js|postgrest-js|auth-js|gotrue-js|storage-js|functions-js|node-fetch))(\/|$)/.test(
                  id,
                )
              ) {
                return 'vendor-supabase';
              }
              if (/node_modules\/(react|react-dom|scheduler)(\/|$)/.test(id)) {
                return 'vendor-react';
              }
              if (/node_modules\/(framer-motion|motion-dom|motion-utils)(\/|$)/.test(id)) {
                return 'vendor-motion';
              }
              if (/node_modules\/(chart\.js|@kurkle\/color)(\/|$)/.test(id)) {
                return 'vendor-charts';
              }
              if (/node_modules\/lucide-react(\/|$)/.test(id)) {
                return 'vendor-icons';
              }
              // Phase 15 Plan 15-02 — PAGE-02: pin all three dnd-kit packages
              // to their own `vendor-dnd-kit` chunk so they are NOT counted
              // against PAGE_BUILDER_RUNTIME_CEILING and remain staff-only
              // (both vendor-dnd-kit and admin-bundle are lazy). Anchored
              // regex avoids `id.includes('dnd-kit')` false-positives. The
              // scripts/assert-clinic-bundle-budget.sh `dnd-kit index-leak`
              // guard fails CI on any static @dnd-kit import in the index
              // chunk (15-RESEARCH.md Pitfall 2). Use legacy `@dnd-kit/core`
              // API only — DO NOT USE `@dnd-kit/react` (unstable).
              if (/node_modules\/(@dnd-kit\/(core|sortable|utilities))(\/|$)/.test(id)) {
                return 'vendor-dnd-kit';
              }
              // Phase 16 Plan 16-01 Task 3 — capacitor-bridge chunk.
              // Routes the four native-bridge package families that ship at
              // P16 into a single shared chunk so the existing 15 kB gz
              // ceiling at scripts/assert-clinic-bundle-budget.sh:155
              // (CAPACITOR_BRIDGE_CEILING=15000) actively enforces from this
              // commit forward instead of logging `wave-0 skip`.
              //
              // Coverage:
              //   - @capacitor/<any>        — core, app, share, preferences, etc.
              //   - @revenuecat/purchases-capacitor — IAP (Plan 16-05/06)
              //   - @capgo/capacitor-native-biometric — biometric (Plan 16-02)
              //   - @sentry/capacitor       — native crash reporting (Plan 16-04)
              //
              // MUST be placed BEFORE the vendor-telemetry rule below so that
              // @sentry/capacitor lands in capacitor-bridge rather than being
              // swept into vendor-telemetry. (@sentry/capacitor is NOT in
              // the vendor-telemetry regex, but forward-compat: if a future
              // edit broadens that regex, this rule still wins via ordering.)
              if (
                /node_modules\/(@capacitor\/[^/]+|@revenuecat\/purchases-capacitor|@capgo\/capacitor-native-biometric|@sentry\/capacitor)(\/|$)/.test(
                  id,
                )
              ) {
                return 'capacitor-bridge';
              }
              if (
                /node_modules\/(@sentry\/react|@sentry\/core|@sentry\/browser|@sentry-internal\/browser-utils|posthog-js)(\/|$)/.test(
                  id,
                )
              ) {
                return 'vendor-telemetry';
              }
              // Phase 9 Plan 09-03 — group all supabase-js + auth-js + functions-js
              // + realtime-js + postgrest-js + storage-js into a single
              // `supabase` chunk. Without this, the supabase client inlines
              // into whichever lazy chunk first imports it (clinic-settings
              // would balloon to ~70 kB gz from supabase alone). Plan 09-01
              // already established `sync-defer` to keep the supabase client
              // OFF the index static graph; this rule keeps the supabase
              // payload as ONE shared chunk so multiple clinic surfaces
              // (settings/workspace/invite) reuse the cached download.
              if (/node_modules\/@supabase\//.test(id)) {
                return 'supabase';
              }
              // Any remaining node_modules → fall through to Vite's automatic chunking.
            }
            return undefined;
          },
        },
      },
    },
    test: {
      environment: 'jsdom',
      globals: true,
      setupFiles: ['./src/test-setup.ts'],
      // Phase 4 D-04 — pull in the dual-runtime shared/refusal.test.ts at the
      // repo root so vitest exercises the SAME corpus that the Deno test
      // runner exercises in CI (`supabase/functions/tests/ai-chat-refusal.test.ts`).
      // Phase 12 D-10/D-11 — extend to include tests/**/*.test.ts for the CSP snapshot test (see leanshot/tests/csp/csp-snapshot.test.ts).
      // Phase 14 D-11 — extend to include scripts/**/*.test.ts for the stripe-bootstrap smoke test.
      // Phase 24 Plan 24-02 — extend to include eslint-rules/**/*.test.js for the additive-only-events rule test.
      // Phase 28 Plan 28-02 — extend to include .test.cjs (CJS rule tests: no-raw-service-role-client).
      // Phase 38 Plan 38-06 — extend to include tests/perf/**/*.spec.ts for the plan-personalize P99 budget gate (D-17 hot-conversion-path).
      include: [
        'src/**/*.test.{ts,tsx}',
        'tests/**/*.test.ts',
        'tests/perf/**/*.spec.ts',
        'scripts/**/*.test.ts',
        '../shared/**/*.test.ts',
        'eslint-rules/**/*.test.{js,ts,cjs}',
      ],
      exclude: ['e2e/**', 'node_modules/**', 'dist/**'],
      // Avoid React 19 StrictMode double-invoke flake (RESEARCH.md Pitfall 6)
      css: false,
    },
  };
});
