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
      // Phase 62 Plan 62-06 — Research hub prebuild hook (INSIGHTS-08).
      // Runs build-research-rss.mjs + build-research-sitemap.mjs at buildStart:
      //   1. Copies content/research/*.md → public/research-content/ (for fetchResearchMarkdown)
      //   2. Generates public/research/rss.xml (RSS 2.0 feed of published papers)
      //   3. Appends /research/* URLs to public/sitemap.xml
      // Set SKIP_RESEARCH_PREBUILD=1 to skip (e.g., in tsconfig-only CI checks).
      {
        name: 'leanshot-research-prebuild',
        buildStart: async () => {
          if (process.env['SKIP_RESEARCH_PREBUILD']) return;
          const { spawnSync } = await import('node:child_process');
          spawnSync('node', ['scripts/build-research-rss.mjs'], {
            stdio: 'inherit',
            cwd: process.cwd(),
          });
          spawnSync('node', ['scripts/build-research-sitemap.mjs'], {
            stdio: 'inherit',
            cwd: process.cwd(),
          });
        },
      },
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
        // Phase 60 Plan 60-07 — resolve 'zod' bare specifier for Edge Fn tests.
        // Edge Fn source files use 'zod' (resolves via deno.json in Deno, but Vite
        // needs an explicit path when test files live outside the leanshot/ root).
        zod: fileURLToPath(new URL('./node_modules/zod/v3/index.js', import.meta.url)),
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
    // Phase 70-07 cascade-38 — same-origin proxy for the doctor-share drill.
    // The Playwright preview server runs on http://localhost:4173. When the
    // share-revocation-drill build sets VITE_SUPABASE_FUNCTIONS_URL='/functions/v1'
    // (see .github/workflows/ci.yml share-security-drill job), the SPA's
    // share-client FN_BASE becomes that RELATIVE path, so fetchSnapshot()/redeem
    // hit the preview origin instead of supabase.co. That makes the request
    // SAME-SITE, so the recipient_session cookie (SameSite=Strict, injected on
    // `localhost`) actually travels — the cross-site Strict-cookie drop was why
    // drill tests (a) token-cache and (d) forwarded-link saw no "LeanShot record"
    // heading. This proxy forwards those same-origin calls to the live Edge Fn.
    //
    // `share` has no [functions.share] block in supabase/config.toml → it defaults
    // to verify_jwt=true, so the Edge gateway 401s before the function body unless
    // a Bearer is present. The SPA's share-client deliberately sends no auth header
    // (the cookie is the auth), so we inject the anon key here — mirroring the
    // proven e2e/fixtures/shares.ts headers. See
    // reference_supabase_edge_fn_jwt_gateway_healthz. Dormant when
    // VITE_SUPABASE_URL is unset (e.g. the general test-e2e job, which fetches
    // supabase.co directly and never routes through /functions/v1).
    preview: {
      port: 4173,
      proxy: env.VITE_SUPABASE_URL
        ? {
            '/functions/v1': {
              target: env.VITE_SUPABASE_URL,
              changeOrigin: true,
              secure: true,
              configure: (proxy) => {
                const anon = env.VITE_SUPABASE_ANON_KEY;
                if (!anon) return;
                proxy.on('proxyReq', (proxyReq) => {
                  if (!proxyReq.getHeader('authorization')) {
                    proxyReq.setHeader('authorization', `Bearer ${anon}`);
                  }
                  if (!proxyReq.getHeader('apikey')) {
                    proxyReq.setHeader('apikey', anon);
                  }
                });
              },
            },
          }
        : undefined,
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
            )
              return 'helpdesk-article';
            if (
              id.includes('/src/helpdesk/MacroTypeahead') ||
              id.includes('/src/components/helpdesk/MacroTypeahead')
            )
              return 'helpdesk-macros';
            if (
              id.includes('/src/helpdesk/TicketForm') ||
              id.includes('/src/helpdesk/TicketList') ||
              id.includes('/src/helpdesk/TicketThread') ||
              id.includes('/src/helpdesk/ReplyComposer') ||
              id.includes('/src/helpdesk/TypingIndicator') ||
              id.includes('/src/helpdesk/hooks/')
            )
              return 'helpdesk-tickets';
            if (
              id.includes('/src/helpdesk/') ||
              id.includes('/src/components/helpdesk/') ||
              id.includes('/src/lib/helpdesk/')
            )
              return 'helpdesk-widget';
            if (id.includes('/src/lib/i18n/') || id.includes('/src/components/i18n/'))
              return 'i18n-runtime';
            if (
              id.includes('/src/lib/gamification/') ||
              id.includes('/src/components/gamification/')
            )
              return 'gamification-burst';
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
            // Phase 45 Plan 45-07b — community-directory + community-dm sub-chunks.
            // ORDER MATTERS: must appear BEFORE the community-feed catch-all below
            // (per 45-RESEARCH Pitfall 6 + memory reference_bundle_budget_hash_hyphen).
            // community-directory groups the directory surface (45-07a) so the
            // member-directory + ReportButton + LeaderboardChip stay out of
            // community-feed (which already carries 44-09 feed + reactions).
            if (
              id.includes('/src/components/community/CommunityDirectoryView') ||
              id.includes('/src/components/community/ProfileCard') ||
              id.includes('/src/components/community/LeaderboardChip') ||
              id.includes('/src/components/community/ReportButton')
            )
              return 'community-directory';
            // community-dm groups every DM surface (45-07b) + its realtime hook
            // so DMInboxView + DMThreadView + DMComposer + DMAttachmentUploader
            // and use-dm-inbox-realtime stay together and load on demand from
            // CommunityTabShell's lazy import.
            if (
              id.includes('/src/components/community/dm/') ||
              id.includes('/src/components/community/use-dm-inbox-realtime')
            )
              return 'community-dm';
            if (id.includes('/src/components/community/')) return 'community-feed';
            if (id.includes('/src/components/course/')) return 'course-player';
            // Phase 47 Plan 10 — events chunk (EVENT-01 / 02 / 03).
            // Target ≤25 kB gz per D-14 (list-only, no Mux Player; past-event
            // recordings link out to the classroom chunk per D-17). Catches
            // EventsTab + EventCard + EventDetailSheet + RsvpPills +
            // JoinMeetingButton; the rsvp-client lib is co-located by
            // import-graph because EventsTab is the sole consumer.
            if (id.includes('/src/components/events/')) return 'events';

            // Phase 49 Plan 09 — consumer cmd+k Spotlight search chunk
            // (D-05; ~20 kB gz target excluding shared cmdk). Inserts AFTER
            // consumer-feature chunks (community-*, events) and BEFORE the
            // admin-shell catch-all so search components land in their own
            // lazy chunk. cmdk is shared with the admin-shell chunk; D-22
            // audit (Task 3) verifies cmdk lives in exactly one chunk; if
            // it duplicates, the `cmdk-shared` rule below de-dupes it.
            if (id.includes('node_modules/cmdk/')) return 'cmdk-shared';
            if (id.includes('/src/components/search/')) return 'search';
            if (id.includes('/src/lib/search/')) return 'search';

            // Phase 48 Plan 10 — admin-moderation chunk (≤30 kB gz per CONTEXT).
            // Owns ModerationLayout + 5 sub-views + api.ts + shared types.
            // MUST precede the generic /src/components/admin/ → 'admin-shell'
            // rule below so moderation bytes land in their own chunk and the
            // admin-moderation budget script asserts its own ceiling.
            if (id.includes('/src/admin/modules/moderation/')) return 'admin-moderation';
            if (id.includes('/src/lib/moderation/')) return 'admin-moderation';

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
              // Phase 70-07 cascade-56 — react-router family (added P60-13 for
              // /knowledge + /research routes, lazy-loaded via KnowledgeRoute /
              // ResearchRoute). Their package entry is `dist/index.js`, so with
              // no manualChunks rule Rollup named the emitted chunk `index-*.js`
              // — one of the spurious `index-*.js` chunks that tripped
              // assert-vendor-react-size.sh. Pin them to a named vendor-router
              // chunk (cache-stable; loads only with the knowledge/research
              // routes). Anchored regex avoids matching unrelated `*router*`
              // packages.
              if (
                /node_modules\/(react-router|react-router-dom|@remix-run\/router)(\/|$)/.test(id)
              ) {
                return 'vendor-router';
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
        // Phase 60 Plan 60-05 — vitest unit tests for rag-embed-approved Edge Fn.
        // Placed here (not Deno) because the handler tests use vi.fn() injection seam.
        '../supabase/functions/rag-embed-approved/__tests__/openai.test.ts',
        '../supabase/functions/rag-embed-approved/__tests__/embed-pipeline.test.ts',
        // Phase 60 Plan 60-07 — vitest unit tests for federated adapter Edge Fns.
        // Dependency injection seam (fetchImpl + supabase) used for mocking.
        '../supabase/functions/_shared/__tests__/federated-host-allowlist.test.ts',
        '../supabase/functions/_shared/__tests__/federated-cache.test.ts',
        '../supabase/functions/_shared/__tests__/federated-integration.test.ts',
        '../supabase/functions/rag-federated-pubmed/__tests__/client.test.ts',
        '../supabase/functions/rag-federated-pubmed/__tests__/normalize.test.ts',
        '../supabase/functions/rag-federated-pubmed/__tests__/index.test.ts',
        '../supabase/functions/rag-federated-fda/__tests__/client.test.ts',
        '../supabase/functions/rag-federated-fda/__tests__/normalize.test.ts',
        '../supabase/functions/rag-federated-fda/__tests__/index.test.ts',
        '../supabase/functions/rag-federated-dailymed/__tests__/client.test.ts',
        '../supabase/functions/rag-federated-dailymed/__tests__/normalize.test.ts',
        '../supabase/functions/rag-federated-dailymed/__tests__/index.test.ts',
        'eslint-rules/**/*.test.{js,ts,cjs}',
        // Phase 61 Plan 03 — protocol-ai-assist Edge Fn handler tests.
        // Dependency injection seam (fetchImpl + ragRetrieve) used for mocking.
        '../supabase/functions/protocol-ai-assist/__tests__/handler.test.ts',
      ],
      // Phase 70-07 cascade-14 — native bridge tests are owned by
      // vitest-mobile.config.ts which aliases @capacitor/* and @revenuecat/*
      // to vi.fn() mocks under src/lib/native/__mocks__/. Running them under
      // the default config picks up the REAL modules → 77+ failures with
      // `Capacitor.getPlatform.mockReturnValue is not a function`. Exclude
      // here so `npm run test:unit` skips them; `npm run test:mobile-unit`
      // continues to own that surface.
      exclude: [
        'e2e/**',
        'node_modules/**',
        'dist/**',
        'src/lib/native/**',
        'src/components/BiometricGate.test.tsx',
      ],
      // Avoid React 19 StrictMode double-invoke flake (RESEARCH.md Pitfall 6)
      css: false,
    },
  };
});
