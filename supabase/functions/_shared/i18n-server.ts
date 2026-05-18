/**
 * `_shared/i18n-server.ts` — Phase 32 plan 32-05 (I18N-04).
 *
 * Edge-side i18n helper. ONE i18next instance per Deno isolate, cached at
 * module top-level (RESEARCH Pitfall 5 — avoids re-init churn across
 * requests within the same warm isolate).
 *
 * Design notes:
 *   - Full esm.sh URL with `?target=deno` per reference_supabase_edge_function_deploy.md
 *     (Edge bundler ignores import_map.json so we cannot route through it).
 *   - JSON catalogs imported with `with { type: 'json' }` (Deno's modern JSON-modules syntax).
 *   - safelng coercion: only 'en' or 'es'; anything else maps to 'en' (D-08 fallback contract).
 *   - interpolation.escapeValue: false — emails are plain text (subject + body);
 *     HTML structure is built by the consumer, which is responsible for escaping
 *     user-controlled vars if it embeds rendered strings in HTML (T-32-05-04).
 *   - renderInLocale returns a string or throws — no { status, data } envelope
 *     per feedback_planner_iter1_anti_patterns.md (defensive jsonb).
 *
 * Vendor-agnostic stance per D-09: when Phase 25 splits PHI emails to AWS SES,
 * the new SES Edge Fns reuse this exact helper and the same `_shared/locales/`
 * tree with zero translation work.
 */
import i18nextDefault from 'https://esm.sh/i18next@26.2.0?target=deno';
import en from './locales/en/emails.json' with { type: 'json' };
import es from './locales/es/emails.json' with { type: 'json' };

export type Locale = 'en' | 'es';

// esm.sh's default-export type for i18next omits the instance API surface
// (`init`, `getFixedT`, `isInitialized`) and types the default as the `i18n`
// namespace. At RUNTIME the default IS the singleton instance and exposes
// the full API. Cast through a minimal structural type so callers stay typed.
interface I18nLite {
  init(opts: Record<string, unknown>): Promise<unknown>;
  getFixedT(lng: string, ns?: string): (key: string, vars?: Record<string, unknown>) => string;
  readonly isInitialized: boolean;
}
const i18next = i18nextDefault as unknown as I18nLite;

// Module-top-level init — runs ONCE per Deno isolate cold start.
// `ready` resolves on init completion; renderInLocale awaits it (cheap after
// the first invocation since the promise stays resolved).
const ready: Promise<unknown> = i18next.init({
  lng: 'en',
  fallbackLng: 'en',
  ns: ['emails'],
  defaultNS: 'emails',
  resources: {
    en: { emails: en },
    es: { emails: es },
  },
  interpolation: { escapeValue: false },
  // saveMissing not needed Edge-side; missing-key telemetry happens client-side
  // (Plan 32-07 PostHog `i18n_missing_key` dashboard).
});

function safelng(lng: string | null | undefined): Locale {
  return lng === 'es' ? 'es' : 'en';
}

/**
 * Render an email key into the requested locale, interpolating `vars`.
 * Falls back to 'en' for null/undefined/unsupported lng (D-08).
 *
 * @param lng  'en' | 'es' | null | undefined  — anything not 'es' becomes 'en'
 * @param key  flat key e.g. 'welcome.subject' from the `emails` namespace
 * @param vars optional interpolation map e.g. { name: 'Ada' }
 * @returns rendered string (or the key itself if missing, per i18next default)
 */
export async function renderInLocale(
  lng: string | null | undefined,
  key: string,
  vars?: Record<string, unknown>,
): Promise<string> {
  await ready;
  const t = i18next.getFixedT(safelng(lng), 'emails');
  return t(key, vars ?? {});
}

/**
 * Returns a bound `t` function for the requested locale — useful when a caller
 * renders multiple keys in one request (e.g. subject + body).
 */
export function getFixedT(lng: string | null | undefined) {
  return i18next.getFixedT(safelng(lng), 'emails');
}

/** Test seam — assert module-top-level init already ran. */
export const __internal = {
  isInitialized: () => i18next.isInitialized,
  ready,
};
