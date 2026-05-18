import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useHreflangTags } from './useHreflangTags';

function getHreflangLinks(): HTMLLinkElement[] {
  return Array.from(
    document.head.querySelectorAll<HTMLLinkElement>('link[data-i18n-hreflang="true"]'),
  );
}

describe('useHreflangTags', () => {
  beforeEach(() => {
    for (const link of getHreflangLinks()) link.remove();
  });
  afterEach(() => {
    for (const link of getHreflangLinks()) link.remove();
  });

  it('injects en + es + x-default <link> tags into <head>', () => {
    renderHook(() => useHreflangTags());
    const links = getHreflangLinks();
    expect(links).toHaveLength(3);
    const hreflangs = links.map((l) => l.hreflang).sort();
    expect(hreflangs).toEqual(['en', 'es', 'x-default']);
    for (const l of links) {
      expect(l.rel).toBe('alternate');
    }
  });

  it('es variant carries the ?lang=es query param', () => {
    renderHook(() => useHreflangTags());
    const es = getHreflangLinks().find((l) => l.hreflang === 'es');
    expect(es).toBeDefined();
    expect(es!.href).toMatch(/\?lang=es$/);
  });

  it('en + x-default share the canonical (no query) href', () => {
    renderHook(() => useHreflangTags());
    const links = getHreflangLinks();
    const en = links.find((l) => l.hreflang === 'en')!.href;
    const xd = links.find((l) => l.hreflang === 'x-default')!.href;
    expect(en).toBe(xd);
    expect(en).not.toContain('?lang=');
  });

  it('removes all injected tags on unmount', () => {
    const { unmount } = renderHook(() => useHreflangTags());
    expect(getHreflangLinks()).toHaveLength(3);
    unmount();
    expect(getHreflangLinks()).toHaveLength(0);
  });

  it('honors explicit opts.path override', () => {
    renderHook(() => useHreflangTags({ path: '/pricing' }));
    const links = getHreflangLinks();
    for (const l of links) {
      const expected = l.hreflang === 'es' ? '/pricing?lang=es' : '/pricing';
      expect(l.href.endsWith(expected)).toBe(true);
    }
  });

  it('re-mount produces fresh tags (no accumulation across mounts)', () => {
    const { unmount } = renderHook(() => useHreflangTags());
    unmount();
    renderHook(() => useHreflangTags());
    expect(getHreflangLinks()).toHaveLength(3);
  });
});
