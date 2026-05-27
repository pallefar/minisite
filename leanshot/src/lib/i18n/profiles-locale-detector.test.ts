/**
 * Phase 32 Plan 32-03 (I18N-02): profiles-locale custom detector.
 *
 * Asserts the detector contract (read-only lookup from Zustand store) and
 * the precedence invariant: when registered at order-position 0 in init.ts,
 * the authenticated user's `profiles.locale` overrides querystring / cookie
 * / localStorage / navigator (the default chain from Plan 32-01 detector-config).
 *
 * Test boundaries:
 *   Cases A-C → unit-only: drive lookup() through a mocked useStore.getState.
 *   Case D    → integration: boot a real i18next instance with
 *               LanguageDetector + profilesLocaleDetector at position 0,
 *               populate the store + querystring, and assert i18next.language
 *               resolves to the store-side value.
 *
 * Per RESEARCH §Anti-Patterns the detector must NEVER scatter region tags;
 * it returns the Locale union ('en' | 'es') directly.
 */

import i18next from 'i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useStore } from '@/lib/store';
import { detectionOptions } from './detector-config';
import { profilesLocaleDetector } from './profiles-locale-detector';

// Hoisted mock so vi.mock can replace the module before the detector imports it.
vi.mock('@/lib/store', () => ({
  useStore: {
    getState: vi.fn(),
  },
}));

// (Imports above resolve AFTER the vi.mock declaration so the detector picks
// up the mocked store module — the no-blank-line layout above is required
// by import-x/order; the mock-then-import sequence is semantic, not lexical.)

type Mocked = ReturnType<typeof vi.fn>;
const getStateMock = useStore.getState as unknown as Mocked;

function setURL(search: string) {
  window.history.replaceState({}, '', `/?${search.replace(/^\?/, '')}`);
}

function clearAllCookies() {
  for (const c of document.cookie.split(';')) {
    const name = c.split('=')[0].trim();
    if (name) document.cookie = `${name}=; Max-Age=0; path=/`;
  }
}

describe('I18N-02 profilesLocaleDetector — unit', () => {
  beforeEach(() => {
    getStateMock.mockReset();
  });

  it('returns undefined when no authenticated user (Case A — anonymous fall-through)', () => {
    getStateMock.mockReturnValue({ user: null });
    expect(profilesLocaleDetector.lookup?.({} as never)).toBeUndefined();
  });

  it('returns the user.locale value when set (Case B — authenticated `es`)', () => {
    getStateMock.mockReturnValue({ user: { id: 'u1', locale: 'es' } });
    expect(profilesLocaleDetector.lookup?.({} as never)).toBe('es');
  });

  it('returns the user.locale value `en` even when set explicitly', () => {
    getStateMock.mockReturnValue({ user: { id: 'u1', locale: 'en' } });
    expect(profilesLocaleDetector.lookup?.({} as never)).toBe('en');
  });

  it('returns undefined when user exists without a locale field', () => {
    getStateMock.mockReturnValue({ user: { id: 'u1' } });
    expect(profilesLocaleDetector.lookup?.({} as never)).toBeUndefined();
  });

  it('returns undefined when getState throws (Case C — defensive catch)', () => {
    getStateMock.mockImplementation(() => {
      throw new Error('store not hydrated yet');
    });
    expect(profilesLocaleDetector.lookup?.({} as never)).toBeUndefined();
  });

  it('cacheUserLanguage is a safe no-op (writes are owned by SettingsPage, not the detector)', () => {
    expect(() => profilesLocaleDetector.cacheUserLanguage?.('es', {} as never)).not.toThrow();
  });
});

describe('I18N-02 profilesLocaleDetector — integration (precedence at position 0)', () => {
  beforeEach(() => {
    clearAllCookies();
    try {
      window.localStorage.removeItem('leanshot_locale');
    } catch {
      /* private mode noop */
    }
    window.history.replaceState({}, '', '/');
    getStateMock.mockReset();
  });

  afterEach(() => {
    clearAllCookies();
    try {
      window.localStorage.removeItem('leanshot_locale');
    } catch {
      /* private mode noop */
    }
    window.history.replaceState({}, '', '/');
  });

  it('Case D — profilesLocale wins over querystring `?lang=en` when user.locale="es"', async () => {
    setURL('lang=en');
    getStateMock.mockReturnValue({ user: { id: 'u1', locale: 'es' } });

    const ld = new LanguageDetector();
    ld.addDetector(profilesLocaleDetector);

    const inst = i18next.createInstance();
    await inst.use(ld).init({
      supportedLngs: ['en', 'es'],
      fallbackLng: 'en',
      load: 'languageOnly',
      detection: {
        ...detectionOptions,
        order: ['profilesLocale', ...detectionOptions.order!],
      },
      resources: { en: { translation: {} }, es: { translation: {} } },
      initImmediate: false,
    });

    const tag = inst.resolvedLanguage ?? inst.language ?? '';
    expect(tag.slice(0, 2)).toBe('es');
  });

  it('Case D-inverse — when no authed locale, querystring `?lang=es` wins as before', async () => {
    setURL('lang=es');
    getStateMock.mockReturnValue({ user: null });

    const ld = new LanguageDetector();
    ld.addDetector(profilesLocaleDetector);

    const inst = i18next.createInstance();
    await inst.use(ld).init({
      supportedLngs: ['en', 'es'],
      fallbackLng: 'en',
      load: 'languageOnly',
      detection: {
        ...detectionOptions,
        order: ['profilesLocale', ...detectionOptions.order!],
      },
      resources: { en: { translation: {} }, es: { translation: {} } },
      initImmediate: false,
    });

    const tag = inst.resolvedLanguage ?? inst.language ?? '';
    expect(tag.slice(0, 2)).toBe('es');
  });
});
