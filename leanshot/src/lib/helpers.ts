/**
 * Pure utility helpers — date, formatting, escape.
 * Ported from v1 (leanshot.html:3654-3672).
 */

export const todayStr = (): string => new Date().toISOString().slice(0, 10);

export const shortLabel = (s: string): string => {
  const d = new Date(s);
  return `${d.getMonth() + 1}/${d.getDate()}`;
};

/**
 * Phase 32 Plan 32-02 — `locale` parameter (default `'en'`).
 *
 * React components SHOULD prefer the `useLocale()` hook from
 * `src/lib/i18n/useLocale.ts` (memoized Intl.DateTimeFormat). Non-React
 * call sites (share-card templates, AI prompt builders, PDF exporters)
 * pass `locale` explicitly. Default `'en'` preserves backward compatibility
 * with every pre-Phase-32 callsite that didn't supply a locale.
 *
 * Note: previously this function used the browser's default locale via
 * `toLocaleDateString` with `undefined` as the first arg. Phase 32 D-09
 * makes the app's display language explicit — that pattern would silently
 * differ between EN-default and ES-default browsers even when the user
 * picked "English" in our switcher. Explicit locale closes that loop.
 */
export const formatShort = (s: string, locale: string = 'en'): string => {
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s;
  return new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric' }).format(d);
};

export const formatLong = (s: string, locale: string = 'en'): string => {
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s;
  return new Intl.DateTimeFormat(locale, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(d);
};

export const lastNDays = (n: number): string[] => {
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
};

export const daysBetween = (a: string | Date, b: string | Date): number =>
  Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86_400_000);

export const hoursSince = (iso: string): number =>
  (Date.now() - new Date(iso).getTime()) / 3_600_000;

export const escapeHtml = (s: string | null | undefined): string =>
  (s ?? '')
    .toString()
    .replace(
      /[&<>"']/g,
      (c) =>
        (
          ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }) as Record<
            string,
            string
          >
        )[c],
    );

export const cn = (...parts: Array<string | false | null | undefined>): string =>
  parts.filter(Boolean).join(' ');

export const clamp = (v: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, v));

export const pct = (v: number, target: number): number =>
  target > 0 ? clamp((v / target) * 100, 0, 100) : 0;

/** Greeting based on local time. */
export const greeting = (): 'morning' | 'afternoon' | 'evening' => {
  const h = new Date().getHours();
  if (h < 5) return 'evening';
  if (h < 12) return 'morning';
  if (h < 18) return 'afternoon';
  return 'evening';
};

/**
 * Friendly relative time.
 *
 * Phase 32 Plan 32-02 — when `locale` is supplied, uses
 * `Intl.RelativeTimeFormat` so Spanish renders correctly ("hace 2 días"
 * vs the legacy "2d ago"). Default `'en'` preserves the legacy abbreviated
 * format for backward compatibility with every existing share-card / chart
 * tooltip / PDF caller that relies on the compact `2d ago` / `3w ago` shape.
 *
 * For React components, prefer `useLocale().relative` from
 * `src/lib/i18n/useLocale.ts` directly — it's memoized per language change.
 */
export const relTime = (iso: string, locale?: string): string => {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);

  if (locale && locale !== 'en') {
    const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
    if (days === 0) return rtf.format(0, 'day');
    if (days < 7) return rtf.format(-days, 'day');
    if (days < 30) return rtf.format(-Math.floor(days / 7), 'week');
    return rtf.format(-Math.floor(days / 30), 'month');
  }

  // Legacy abbreviated format (preserved for backward compatibility).
  if (days === 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  return `${Math.floor(days / 30)}mo ago`;
};

/** Format a duration in hours into a human-readable string. */
export const formatDuration = (hours: number): string => {
  if (hours < 1) return `${Math.round(hours * 60)}m`;
  if (hours < 24) return `${Math.round(hours)}h`;
  const d = Math.floor(hours / 24);
  const h = Math.round(hours - d * 24);
  return h > 0 ? `${d}d ${h}h` : `${d}d`;
};
