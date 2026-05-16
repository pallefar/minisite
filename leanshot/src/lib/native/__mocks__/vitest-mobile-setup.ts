// Phase 16 Plan 16-02 Task 4 — global jsdom setup for vitest-mobile.
//
// jsdom doesn't ship `window.matchMedia` by default. `useReducedMotion`
// (transitively used by HeroOrbital → BiometricGate) calls it during mount,
// which throws TypeError. Stub it out per Vitest jsdom recipe.
//
// This setup file is referenced from vitest-mobile.config.ts via
// `test.setupFiles`. It runs ONCE before each test file.

if (typeof window !== 'undefined' && typeof window.matchMedia !== 'function') {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  });
}
