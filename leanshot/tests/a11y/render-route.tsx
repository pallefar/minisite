/**
 * Phase 42 Plan 42-02 (POLISH-09): renderRoute helper for a11y baseline tests.
 *
 * Mounts a route's React tree into jsdom's `document.body` and returns the
 * live DOM handles that axe-core scans (`window`, `document`, `unmount`).
 *
 * Design notes:
 *   - jsdom is provided by vitest's `environment: 'jsdom'` (vite.config.ts
 *     `test.environment`). We do NOT import the `jsdom` package directly —
 *     using vitest's instance keeps Suspense / lazy / framer-motion / theme
 *     hooks aligned with the rest of the test suite.
 *   - The LeanShot SPA has a single global Zustand store (CLAUDE.md
 *     "One global Zustand store"). Several dashboard tabs short-circuit
 *     on `!user` — `seedTestStore()` writes a minimal hydrated user so
 *     those routes render their real card tree instead of redirecting
 *     to marketing/onboarding.
 *   - Failures-on-mount must NOT crash the whole test suite. axe-core is
 *     designed to scan whatever DOM is present; if a route throws partway
 *     through render the test reports its initial DOM state. The
 *     ErrorBoundary catches the throw so axe still gets a valid document.
 */

import { act, render, type RenderResult } from '@testing-library/react';
import {
  Component,
  createElement,
  Suspense,
  type ErrorInfo,
  type ReactElement,
  type ReactNode,
} from 'react';
import type { RouteEntry } from './routes-manifest';

class A11yErrorBoundary extends Component<
  { children: ReactNode; routePath: string },
  { error: Error | null }
> {
  constructor(props: { children: ReactNode; routePath: string }) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    // eslint-disable-next-line no-console
    console.warn(
      `[a11y] ${this.props.routePath} threw during render: ${error.message}`,
      info.componentStack,
    );
  }

  override render() {
    if (this.state.error) {
      return createElement(
        'main',
        { role: 'main', 'aria-label': 'render-error fallback' },
        createElement('h1', {}, 'Render error'),
        createElement('pre', {}, this.state.error.message),
      );
    }
    return this.props.children;
  }
}

/**
 * Seed the Zustand store with a minimal user so authenticated routes render
 * their normal content instead of bouncing to marketing/onboarding.
 *
 * Called once before any renderRoute() in the suite; idempotent.
 */
let _storeSeeded = false;
async function seedTestStore(): Promise<void> {
  if (_storeSeeded) return;
  const { useStore } = await import('@/lib/store');
  // Minimal hydrated user — the gate-checks on dashboard/admin routes only
  // look at `!user`, so any truthy user object satisfies the redirect-guard.
  // Cast through `as never` since the User type evolves across phases and
  // this seed is intentionally minimal for a11y scanning only.
  const seedUser = {
    name: 'Test User',
    units: 'metric',
    medication: 'tirzepatide',
    dose: '5',
    doseUnit: 'mg',
    startDate: '2024-01-01',
    startWeight: 80,
    height: 170,
    age: 35,
    sex: 'female',
    bodyFat: null,
    goalWeight: 70,
    goal: 'weight-loss',
    proteinTarget: 120,
    calorieTarget: 1800,
    fiberTarget: 25,
    waterTarget: 8,
    injectionDay: 0,
    activityLevel: 'moderate',
    liftingLevel: 'beginner',
    createdAt: new Date('2024-01-01').toISOString(),
  } as never;
  useStore.setState({ user: seedUser } as never);
  _storeSeeded = true;
}

export interface RenderedRoute {
  /** The jsdom window (axe-core scans `window.document`). */
  window: Window & typeof globalThis;
  /** Shorthand for `window.document`. */
  document: Document;
  /** Unmount + clean DOM (call in afterEach). */
  unmount: () => void;
}

/**
 * Mount the route's component into jsdom and return scan-ready handles.
 *
 * Renders are wrapped in:
 *   - `<Suspense>` so React.lazy chunks resolve before axe scans
 *   - `<A11yErrorBoundary>` so a render-throw produces a valid (error)
 *     document rather than crashing the whole test
 */
export async function renderRoute(route: RouteEntry): Promise<RenderedRoute> {
  await seedTestStore();
  const el: ReactElement = await route.mountComponent();

  let result: RenderResult | undefined;
  await act(async () => {
    result = render(
      createElement(
        A11yErrorBoundary,
        { routePath: route.path },
        createElement(
          Suspense,
          {
            fallback: createElement(
              'div',
              { 'aria-busy': 'true', 'aria-label': 'loading' },
              'Loading…',
            ),
          },
          el,
        ),
      ),
    );
  });

  // Flush microtasks for any post-mount effects (theme apply, query fire).
  await new Promise((r) => setTimeout(r, 0));

  if (!result) throw new Error(`renderRoute(${route.path}): render produced no result`);

  return {
    window: window as Window & typeof globalThis,
    document,
    unmount: () => result!.unmount(),
  };
}
