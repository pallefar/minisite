/**
 * Phase 32 Plan 32-01 — anonymous-visitor detection precedence (I18N-03).
 *
 * Exercises i18next-browser-languagedetector against `detectionOptions`
 * exported from `detector-config.ts`. Boots a tiny i18next instance per
 * test case (no React, no http-backend) and asserts the resolved language
 * against the configured detector chain:
 *
 *   querystring (`?lang=es`) > cookie > localStorage > navigator
 *
 * Authenticated `profiles.locale` injection is ADDITIVE — Plan 32-03 owns
 * it and ships its own coverage. This file MUST NOT regress when 32-03
 * adds a higher-priority detector (the existing precedence must hold for
 * anonymous visitors).
 *
 * NOTE: i18next-browser-languagedetector reads `window.location.search`
 * directly for querystring detection, and `document.cookie` for cookie
 * detection. jsdom (vitest's environment) exposes both, but we must
 * carefully control them per-test via JSDOM URL navigation + cookie wipe.
 */
import i18next from 'i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { detectionOptions } from './detector-config';

function resolved(lng: string | readonly string[] | undefined): string | undefined {
  if (!lng) return undefined;
  const tag = Array.isArray(lng) ? lng[0] : (lng as string);
  // load: 'languageOnly' collapses region tags (e.g. es-MX → es).
  return tag.slice(0, 2);
}

async function bootDetectorOnly() {
  const inst = i18next.createInstance();
  await inst.use(LanguageDetector).init({
    supportedLngs: ['en', 'es'],
    fallbackLng: 'en',
    load: 'languageOnly',
    detection: detectionOptions,
    // Inline resource so init resolves synchronously without http-backend.
    resources: { en: { translation: {} }, es: { translation: {} } },
    initImmediate: false,
  });
  return inst;
}

function setURL(search: string) {
  // jsdom's history.replaceState updates window.location.search in place.
  // Path is irrelevant for querystring detection.
  window.history.replaceState({}, '', `/?${search.replace(/^\?/, '')}`);
}

function clearAllCookies() {
  for (const c of document.cookie.split(';')) {
    const name = c.split('=')[0].trim();
    if (name) document.cookie = `${name}=; Max-Age=0; path=/`;
  }
}

function clearLocalStorage() {
  try {
    window.localStorage.removeItem('leanshot_locale');
  } catch {
    /* private mode noop */
  }
}

describe('I18N-03 anonymous-visitor detection precedence', () => {
  beforeEach(() => {
    clearAllCookies();
    clearLocalStorage();
    // Reset URL to a known state every test.
    window.history.replaceState({}, '', '/');
  });

  afterEach(() => {
    clearAllCookies();
    clearLocalStorage();
    window.history.replaceState({}, '', '/');
  });

  it('resolves `es` when ?lang=es is present (querystring wins)', async () => {
    setURL('lang=es');
    const inst = await bootDetectorOnly();
    expect(resolved(inst.resolvedLanguage ?? inst.language)).toBe('es');
  });

  it('falls back to `en` when no signal is present', async () => {
    // navigator.language defaults to 'en-US' in jsdom — collapses to 'en'.
    const inst = await bootDetectorOnly();
    expect(resolved(inst.resolvedLanguage ?? inst.language)).toBe('en');
  });

  it('honors cookie `leanshot_locale=es` when querystring is absent', async () => {
    document.cookie = 'leanshot_locale=es; path=/';
    const inst = await bootDetectorOnly();
    expect(resolved(inst.resolvedLanguage ?? inst.language)).toBe('es');
  });

  it('querystring `?lang=en` wins over cookie `leanshot_locale=es`', async () => {
    document.cookie = 'leanshot_locale=es; path=/';
    setURL('lang=en');
    const inst = await bootDetectorOnly();
    expect(resolved(inst.resolvedLanguage ?? inst.language)).toBe('en');
  });

  it('localStorage `leanshot_locale=es` resolves when cookie + querystring absent', async () => {
    window.localStorage.setItem('leanshot_locale', 'es');
    const inst = await bootDetectorOnly();
    expect(resolved(inst.resolvedLanguage ?? inst.language)).toBe('es');
  });
});
