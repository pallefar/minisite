import type { KnipConfig } from 'knip';

const config: KnipConfig = {
  entry: [
    'src/main.tsx',
    'src/main.marketing.tsx',
  ],
  project: ['src/**/*.{ts,tsx}'],
  ignore: [
    '.planning/**',
    'supabase/**',
    'e2e/**',
    'scripts/**',
    '*.config.{ts,js,mjs}',
    'src/**/__tests__/**',
    'dist/**',
    'dist-marketing/**',
    'node_modules/**',
  ],
  // Dependencies used only via CLI, Capacitor native build system, or indirectly
  // by other devDeps (knip can't trace these from source imports alone).
  ignoreDependencies: [
    // ESLint plugins — invoked by eslint.config.js, not imported in src/
    'eslint-plugin-react',
    'eslint-plugin-react-hooks',
    'eslint-plugin-react-refresh',
    'eslint-plugin-jsx-a11y',
    'eslint-plugin-import-x',
    'eslint-import-resolver-typescript',
    // Tailwind is used via @tailwindcss/vite plugin and CSS @import, not imported in TS
    'tailwindcss',
    // Prettier — CLI only, not imported in src/
    'prettier',
    // Rollup visualizer — vite plugin only
    'rollup-plugin-visualizer',
    // @lhci/cli — CLI only (lhci autorun)
    '@lhci/cli',
    // Capacitor CLI — invoked via npx/CLI, not imported in main src/
    '@capacitor/cli',
    // Capacitor iOS/Android targets — consumed by Capacitor build system (not TS imports)
    '@capacitor/android',
    '@capacitor/ios',
    // Capacitor native plugins consumed by the Capacitor bridge at runtime,
    // not statically imported from main src/ (lazy-loaded via Capacitor bridge)
    '@capacitor/clipboard',
    '@capacitor/filesystem',
    '@capacitor/haptics',
    '@capacitor/keyboard',
    '@capacitor/network',
    '@capacitor/preferences',
    '@capacitor/splash-screen',
    '@capacitor/status-bar',
    // Stripe devDep — used only in edge-function scripts/tests, not in src/
    'stripe',
    // Supabase CLI devDep
    'supabase',
    // Test infrastructure
    '@testing-library/dom',
    '@testing-library/jest-dom',
    '@testing-library/react',
    '@testing-library/user-event',
    '@vitest/coverage-v8',
    'fake-indexeddb',
    'jsdom',
    // tsx — CLI transpiler used in scripts
    'tsx',
    // Playwright — CLI test runner
    '@playwright/test',
    // ts-unused-exports — CLI tool, not imported in src/
    'ts-unused-exports',
  ],
};

export default config;
