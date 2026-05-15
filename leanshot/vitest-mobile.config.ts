import { defineConfig } from 'vitest/config';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@capacitor/core': fileURLToPath(
        new URL('./src/lib/native/__mocks__/capacitor-core.ts', import.meta.url)
      ),
      '@capacitor/app': fileURLToPath(
        new URL('./src/lib/native/__mocks__/capacitor-app.ts', import.meta.url)
      ),
      '@capacitor/share': fileURLToPath(
        new URL('./src/lib/native/__mocks__/capacitor-share.ts', import.meta.url)
      ),
      '@revenuecat/purchases-capacitor': fileURLToPath(
        new URL('./src/lib/native/__mocks__/revenuecat-purchases-capacitor.ts', import.meta.url)
      ),
      '@capgo/capacitor-native-biometric': fileURLToPath(
        new URL('./src/lib/native/__mocks__/capgo-native-biometric.ts', import.meta.url)
      ),
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['src/lib/native/**/*.test.ts', 'src/lib/native/**/*.test.tsx'],
    testTimeout: 30000,
  },
});
