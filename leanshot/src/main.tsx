import * as Sentry from '@sentry/react';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './index.css';
import { applyThemeToDOM } from './hooks/useTheme';
import { initAnalytics } from './lib/analytics';
import { beforeSend } from './lib/sentry';
import { hydrate } from './lib/store';
import type { Theme } from './types';

// 0) Sentry FIRST — captures errors during theme read, hydrate(), lazy chunks (D-12)
Sentry.init({
  dsn: import.meta.env.VITE_SENTRY_DSN as string | undefined,
  environment: import.meta.env.MODE,
  enabled: !!import.meta.env.VITE_SENTRY_DSN, // no-op when DSN absent (local dev)
  integrations: [], // D-11: errors-only — no Replay, Tracing, Profiling
  beforeSend,
});

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

// 2) Synchronously rehydrate Zustand from localStorage BEFORE first render.
//    This avoids flashing the marketing page for already-onboarded users.
void hydrate().then(() => {
  // 3) Analytics AFTER hydrate so persisted distinct_id (if any) is available (D-15)
  initAnalytics();

  const root = createRoot(document.getElementById('root')!);
  root.render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
});
