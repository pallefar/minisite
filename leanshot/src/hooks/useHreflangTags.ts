import { useEffect } from 'react';

/**
 * useHreflangTags — Phase 32 Plan 32-07 (I18N-01, SEO).
 *
 * Injects three <link rel="alternate"> tags into <head> so search engines can
 * index the English + Spanish variants of an indexable page:
 *   <link rel="alternate" hreflang="en"        href="<origin><path>" />
 *   <link rel="alternate" hreflang="es"        href="<origin><path>?lang=es" />
 *   <link rel="alternate" hreflang="x-default" href="<origin><path>" />
 *
 * Use only on indexable public surfaces (marketing landing, onboarding). Do
 * NOT mount inside the authenticated dashboard — those routes are robots-noindex.
 *
 * The hook is intentionally side-effecting (mutates document.head) rather
 * than reactive. The injected nodes carry `data-i18n-hreflang="true"` so they
 * can be located + removed on unmount (cleanup path verified by the unit test).
 */
export function useHreflangTags(opts: { path?: string } = {}): void {
  const optPath = opts.path;
  useEffect(() => {
    if (typeof document === 'undefined' || typeof window === 'undefined') return;
    const path = optPath ?? window.location.pathname;
    const base = `${window.location.origin}${path}`;
    const tags: Array<[string, string]> = [
      ['en', base],
      ['es', `${base}?lang=es`],
      ['x-default', base],
    ];
    const created: HTMLLinkElement[] = [];
    for (const [lng, href] of tags) {
      const link = document.createElement('link');
      link.rel = 'alternate';
      link.hreflang = lng;
      link.href = href;
      link.dataset.i18nHreflang = 'true';
      document.head.appendChild(link);
      created.push(link);
    }
    return () => {
      for (const el of created) el.remove();
    };
  }, [optPath]);
}
