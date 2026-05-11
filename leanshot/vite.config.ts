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
    server: { port: 5173, host: true },
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
      // Avoid React 19 StrictMode double-invoke flake (RESEARCH.md Pitfall 6)
      css: false,
    },
  };
});
