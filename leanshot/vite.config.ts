import { defineConfig } from 'vitest/config';
import { loadEnv, type PluginOption } from 'vite';
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
            if (id.includes('/src/components/helpdesk/') || id.includes('/src/lib/helpdesk/')) return 'helpdesk-widget';
            if (id.includes('/src/lib/i18n/') || id.includes('/src/components/i18n/')) return 'i18n-runtime';
            if (id.includes('/src/lib/gamification/') || id.includes('/src/components/gamification/')) return 'gamification-burst';
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
      include: [
        'src/**/*.test.{ts,tsx}',
        'tests/**/*.test.ts',
        'scripts/**/*.test.ts',
        '../shared/**/*.test.ts',
        'eslint-rules/**/*.test.{js,ts}',
      ],
      exclude: ['e2e/**', 'node_modules/**', 'dist/**'],
      // Avoid React 19 StrictMode double-invoke flake (RESEARCH.md Pitfall 6)
      css: false,
    },
  };
});
