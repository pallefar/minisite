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
            if (id.endsWith('.css')) return undefined;

            if (id.includes('node_modules')) {
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
              if (
                /node_modules\/(@sentry\/react|@sentry\/core|@sentry\/browser|@sentry-internal\/browser-utils|posthog-js)(\/|$)/.test(
                  id,
                )
              ) {
                return 'vendor-telemetry';
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
      // runner exercises in CI (`supabase/functions/tests/ai-chat-refusal-test.ts`).
      include: ['src/**/*.test.{ts,tsx}', '../shared/**/*.test.ts'],
      exclude: ['e2e/**', 'node_modules/**', 'dist/**'],
      // Avoid React 19 StrictMode double-invoke flake (RESEARCH.md Pitfall 6)
      css: false,
    },
  };
});
