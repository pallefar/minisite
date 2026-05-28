/**
 * Phase 32 Plan 32-01 — `useLocale` hook (memoized Intl.* formatters).
 *
 * Per 32-RESEARCH Open Item #3 (lines 436-457): single hook returning
 * memoized `Intl.DateTimeFormat` / `Intl.NumberFormat` / `Intl.RelativeTimeFormat`
 * instances keyed by `i18n.language`. Allocating formatters per render is
 * an anti-pattern — memoize once per locale change.
 *
 * ⚠ Pitfall 4 (32-RESEARCH lines 705-710): locale changes do NOT re-derive
 * `profiles.weight_unit`. The `kg`/`lb` choice is a SIGNUP-TIME decision
 * (D-12) — flipping locale mid-session does NOT silently convert historical
 * weight logs. Callers must read `profiles.weight_unit` separately and pass
 * it explicitly into `formatters.weight(unit)`.
 *
 * No side effects. No store reads. Just a memoized formatter bag.
 */

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

export interface LocaleFormatters {
  /** Resolved BCP-47 language tag (e.g. `'en'`, `'es'`). */
  readonly lng: string;
  readonly dateShort: Intl.DateTimeFormat;
  readonly dateLong: Intl.DateTimeFormat;
  readonly time: Intl.DateTimeFormat;
  readonly number: Intl.NumberFormat;
  readonly integer: Intl.NumberFormat;
  readonly decimal: (digits: number) => Intl.NumberFormat;
  readonly currency: (currency?: string) => Intl.NumberFormat;
  readonly weight: (unit: 'kilogram' | 'pound') => Intl.NumberFormat;
  readonly relative: Intl.RelativeTimeFormat;
}

export function useLocale(): LocaleFormatters {
  const { i18n } = useTranslation();
  const lng = i18n.language;

  return useMemo<LocaleFormatters>(
    () => ({
      lng,
      dateShort: new Intl.DateTimeFormat(lng, { month: 'short', day: 'numeric' }),
      dateLong: new Intl.DateTimeFormat(lng, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      }),
      time: new Intl.DateTimeFormat(lng, { hour: 'numeric', minute: '2-digit' }),
      number: new Intl.NumberFormat(lng),
      integer: new Intl.NumberFormat(lng, { maximumFractionDigits: 0 }),
      decimal: (digits: number) =>
        new Intl.NumberFormat(lng, {
          minimumFractionDigits: digits,
          maximumFractionDigits: digits,
        }),
      currency: (currency = 'USD') => new Intl.NumberFormat(lng, { style: 'currency', currency }),
      weight: (unit: 'kilogram' | 'pound') =>
        new Intl.NumberFormat(lng, {
          style: 'unit',
          unit,
          maximumFractionDigits: 1,
        }),
      relative: new Intl.RelativeTimeFormat(lng, { numeric: 'auto' }),
    }),
    [lng],
  );
}
