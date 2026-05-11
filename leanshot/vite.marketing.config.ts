import { defineConfig } from 'vite';
import { fileURLToPath, URL } from 'node:url';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

/**
 * Marketing build (D-04). Emits to dist-marketing/ with marketing.html as the sole entry.
 *
 * No Sentry, no manualChunks (marketing is tiny — a single Landing component +
 * its lazy SVG illustrations; default Rollup chunking is fine).
 *
 * Note: __dirname is undefined in ESM. We use fileURLToPath(new URL(...)) instead
 * of __dirname-based resolve() so the config works under Node ESM without a shim.
 */
export default defineConfig({
  plugins: [react(), tailwindcss()],
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
