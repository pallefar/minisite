import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  // Phase 16 Plan 16-02 Task 4 — TSX component tests (BiometricGate) need the
  // React plugin so JSX transforms via the automatic runtime (matches
  // tsconfig.app.json's jsx: "react-jsx"). Plan 16-00 omitted it because Wave
  // 1's native-bridge tests were all .ts.
  plugins: [react()],
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
    setupFiles: ['./src/lib/native/__mocks__/vitest-mobile-setup.ts'],
    include: [
      'src/lib/native/**/*.test.ts',
      'src/lib/native/**/*.test.tsx',
      // Phase 16 Plan 16-02 Task 4 — BiometricGate component test lives under
      // src/components/ and shares the @capgo/capacitor-native-biometric +
      // @capacitor/core aliases from this config.
      'src/components/BiometricGate.test.tsx',
    ],
    testTimeout: 30000,
  },
});
