import { useCallback, useEffect, useState } from 'react';
import type { Theme } from '@/types';

const THEME_KEY = 'leanshot_theme_v4';

function readInitialTheme(): Theme {
  try {
    const saved = localStorage.getItem(THEME_KEY) as Theme | null;
    if (saved === 'light' || saved === 'dark') return saved;
    if (window.matchMedia?.('(prefers-color-scheme: dark)').matches) return 'dark';
  } catch {
    /* noop */
  }
  return 'light';
}

/** Applied immediately by an inline script in main.tsx so the first paint is correct. */
export function applyThemeToDOM(theme: Theme): void {
  document.documentElement.setAttribute('data-theme', theme);
}

export function useTheme(): { theme: Theme; toggle: () => void; setTheme: (t: Theme) => void } {
  const [theme, setThemeState] = useState<Theme>(readInitialTheme);

  useEffect(() => {
    applyThemeToDOM(theme);
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch {
      /* noop */
    }
  }, [theme]);

  const setTheme = useCallback((t: Theme) => setThemeState(t), []);
  const toggle = useCallback(() => setThemeState((t) => (t === 'light' ? 'dark' : 'light')), []);

  return { theme, toggle, setTheme };
}
