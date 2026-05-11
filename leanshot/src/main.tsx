import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './index.css';
import { applyThemeToDOM } from './hooks/useTheme';
import { initAnalytics } from './lib/analytics';
import { beforeSend } from './lib/sentry';
import { hydrate } from './lib/store';
import { deferAnalyticsInit, deferSentryInit } from './lib/telemetry-defer';
import type { Theme } from './types';

// Phase 2.1 perf fix: telemetry init is now DEFERRED to after first paint
// (was static `Sentry.init(...)` here in Phase 2; that pulled @sentry/* into
// the entry static graph, auto-preloaded a 93 kB gz vendor-telemetry chunk,
// and pinned SPA Lighthouse Performance at ~0.76).
//
// D-12 (Phase 1) error-capture floor is preserved by `deferSentryInit`'s
// pre-init `error`/`unhandledrejection` listeners that buffer events until
// Sentry's dynamic import resolves and drains them.
deferSentryInit(beforeSend);

// 1) Apply the saved/system theme to the DOM immediately so the first
//    paint matches and we don't show a flash of the wrong palette.
const initialTheme: Theme = ((): Theme => {
  try {
    const saved = localStorage.getItem('leanshot_theme_v4');
    if (saved === 'light' || saved === 'dark') return saved;
  } catch {
    /* noop */
  }
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
})();
applyThemeToDOM(initialTheme);

// Phase 4 D-03 cleanup: remove any stale BYO Anthropic API key from
// localStorage (the old pasted-key UX is gone in v4 — AI now flows
// through the server-side ai-chat Edge Function). Silent try/catch
// (S-3) so private-mode browsers don't crash.
try {
  localStorage.removeItem('leanshot_anthropic_key');
} catch {
  /* noop */
}

// 2) Synchronously rehydrate Zustand from localStorage BEFORE first render.
//    This avoids flashing the marketing page for already-onboarded users.
void hydrate().then(() => {
  const root = createRoot(document.getElementById('root')!);
  root.render(
    <StrictMode>
      <App />
    </StrictMode>,
  );

  // 3) Analytics AFTER first render, scheduled at idle so the posthog-js
  //    bundle never blocks the cold-load critical path. `initAnalytics()`
  //    handles its own dynamic import + queue draining internally.
  deferAnalyticsInit(initAnalytics);
});
