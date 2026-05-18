/**
 * Phase 32 Plan 32-01 — ICU plural fixture (I18N-07).
 *
 * Closes 32-RESEARCH Open Item #4 / SC#5. Boots a fresh i18next instance
 * with inline resources (no React, no http-backend) and asserts that
 * `t('injection', { count: N })` resolves to the correct CLDR category
 * (`one` / `other` / `zero`) for English + Spanish across N ∈ {0,1,2,5,100}.
 *
 * Spanish has CLDR `one` + `other` cardinal categories — identical
 * categories to English. The explicit `_zero` key fires when count === 0
 * (i18next's `_zero` suffix is a hard-override, not a CLDR category).
 *
 * Arabic + 6-category coverage is intentionally DEFERRED — per
 * `feedback_planner_iter1_anti_patterns.md` no-hedge rule, only ship what
 * v1.3 needs. Plan 32-NN (RTL prep, v1.5) will add it.
 */
import i18next from 'i18next';
import { beforeAll, describe, expect, it } from 'vitest';

beforeAll(async () => {
  await i18next.init({
    lng: 'en',
    fallbackLng: 'en',
    supportedLngs: ['en', 'es'],
    load: 'languageOnly',
    interpolation: { escapeValue: false },
    initImmediate: false,
    resources: {
      en: {
        translation: {
          injection_zero: 'No injections logged',
          injection_one: '{{count}} injection logged',
          injection_other: '{{count}} injections logged',
          day_remaining_one: '{{count}} day remaining',
          day_remaining_other: '{{count}} days remaining',
        },
      },
      es: {
        translation: {
          injection_zero: 'Sin inyecciones registradas',
          injection_one: '{{count}} inyección registrada',
          injection_other: '{{count}} inyecciones registradas',
          day_remaining_one: 'Queda {{count}} día',
          day_remaining_other: 'Quedan {{count}} días',
        },
      },
    },
  });
});

describe('I18N-07 ICU pluralization — English', () => {
  beforeAll(async () => {
    await i18next.changeLanguage('en');
  });

  it.each([
    [0, 'No injections logged'],
    [1, '1 injection logged'],
    [2, '2 injections logged'],
    [5, '5 injections logged'],
    [100, '100 injections logged'],
  ])('injection count=%i → "%s"', (count, expected) => {
    expect(i18next.t('injection', { count })).toBe(expected);
  });

  it.each([
    [1, '1 day remaining'],
    [2, '2 days remaining'],
    [100, '100 days remaining'],
  ])('day_remaining count=%i → "%s"', (count, expected) => {
    expect(i18next.t('day_remaining', { count })).toBe(expected);
  });
});

describe('I18N-07 ICU pluralization — Spanish', () => {
  beforeAll(async () => {
    await i18next.changeLanguage('es');
  });

  it.each([
    [0, 'Sin inyecciones registradas'],
    [1, '1 inyección registrada'],
    [2, '2 inyecciones registradas'],
    [5, '5 inyecciones registradas'],
    [100, '100 inyecciones registradas'],
  ])('injection count=%i → "%s"', (count, expected) => {
    expect(i18next.t('injection', { count })).toBe(expected);
  });

  it.each([
    [1, 'Queda 1 día'],
    [2, 'Quedan 2 días'],
    [100, 'Quedan 100 días'],
  ])('day_remaining count=%i → "%s"', (count, expected) => {
    expect(i18next.t('day_remaining', { count })).toBe(expected);
  });
});
