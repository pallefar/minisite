/**
 * Phase 32 Plan 32-01 — LanguageSwitcher (UI primitive).
 *
 * Calls `i18n.changeLanguage(next)`; the `languageChanged` listener wired
 * in init.ts handles `<html lang="…">` reflection.
 *
 * Does NOT write to `profiles.locale` — Plan 32-03 will wrap this component
 * with the supabase upsert via the optional `onChange` callback so this
 * primitive stays composable for the anonymous landing page too.
 *
 * a11y: labels + values come from i18n catalogs (nav.lang_label / nav.lang_en /
 * nav.lang_es) — never English literals in JSX.
 */

import { useTranslation } from 'react-i18next';
import { LOCALE_CHOICES, type Locale } from '@/lib/i18n/types';

export interface LanguageSwitcherProps {
  onChange?: (lng: Locale) => void;
  className?: string;
}

// Per-locale label rendered via STATIC t() calls so i18next-parser can
// extract `nav:lang_en` and `nav:lang_es` without "Key is not a string
// literal" warnings (RESEARCH Pitfall 3). If LOCALE_CHOICES grows in v1.5
// (D-10 single-`es` policy may flip), add new explicit cases here — the
// `Locale` discriminant + `never` fallback gives a compile-time miss.
function LanguageOption({ lng }: { lng: Locale }) {
  const { t } = useTranslation('nav');
  switch (lng) {
    case 'en':
      return <option value="en">{t('nav:lang_en')}</option>;
    case 'es':
      return <option value="es">{t('nav:lang_es')}</option>;
    default: {
      const _exhaustive: never = lng;
      return _exhaustive;
    }
  }
}

export function LanguageSwitcher({ onChange, className }: LanguageSwitcherProps) {
  const { i18n, t } = useTranslation(['nav', 'common']);
  const current = (i18n.resolvedLanguage ?? i18n.language ?? 'en').slice(0, 2) as Locale;

  return (
    <label className={className}>
      <span className="sr-only">{t('nav:lang_label')}</span>
      <select
        value={current}
        onChange={(e) => {
          const next = e.target.value as Locale;
          void i18n.changeLanguage(next);
          onChange?.(next);
        }}
        aria-label={t('nav:lang_label')}
      >
        {LOCALE_CHOICES.map((lng) => (
          <LanguageOption key={lng} lng={lng} />
        ))}
      </select>
    </label>
  );
}
