import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './index.css';
import { applyThemeToDOM } from './hooks/useTheme';
import { hydrate } from './lib/store';
import type { Theme } from './types';

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
  const root = createRoot(document.getElementById('root')!);
  root.render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
});
