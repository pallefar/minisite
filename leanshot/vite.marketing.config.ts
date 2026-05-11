import { defineConfig } from 'vite';
import { fileURLToPath, URL } from 'node:url';
import { renameSync, existsSync } from 'node:fs';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

/**
 * Marketing build (D-04). Emits to dist-marketing/ with index.html as the sole
 * entry, so Vercel's `/` route resolves out of the box.
 *
 * The source HTML is `marketing.html` (kept distinct from the SPA's index.html)
 * but is renamed to `index.html` in the output by the closeBundle hook below.
 * Without the rename, `/` returns 404 because Vercel looks for index.html in
 * the configured outputDirectory.
 *
 * No Sentry, no manualChunks (marketing is tiny — a single Landing component +
 * its lazy SVG illustrations; default Rollup chunking is fine).
 */
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    {
      name: 'rename-marketing-html-to-index',
      closeBundle() {
        const from = fileURLToPath(new URL('./dist-marketing/marketing.html', import.meta.url));
        const to = fileURLToPath(new URL('./dist-marketing/index.html', import.meta.url));
        if (existsSync(from)) {
          renameSync(from, to);
        }
      },
    },
  ],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  build: {
    outDir: 'dist-marketing',
    emptyOutDir: true,
    rollupOptions: {
      input: fileURLToPath(new URL('./marketing.html', import.meta.url)),
    },
  },
});
