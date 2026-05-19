/// <reference types="vitest/globals" />
import '@testing-library/jest-dom';

// jsdom does not implement window.matchMedia — required by useReducedMotion + framer-motion
Object.defineProperty(window, 'matchMedia', {
  writable: true,
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

// Phase 42 Plan 42-02 (POLISH-09): @axe-core/react is wired into dev mode in
// the React tree (see RESEARCH §Project Structure src/lib/a11y/axe-dev.ts —
// stub-only here; the runtime registration ships in a future a11y dev plan).
// The vitest a11y baseline gate (tests/a11y/axe-baseline.test.ts) uses the
// `axe-core` ES module directly via `axe.run(document, ...)` so no
// React-tree registration is needed at test time.
