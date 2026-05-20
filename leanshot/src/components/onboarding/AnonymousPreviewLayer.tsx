/**
 * Phase 34 Plan 34-06 (ONBOARD-01 / ONBOARD-04) — AnonymousPreviewLayer.
 *
 * Wraps the anonymous preview body (hero, CTA, social proof) with two
 * side-effects that must run BEFORE first paint of any child surface:
 *
 *   1. **Cookie bootstrap.** On mount, idempotently POST to
 *      /functions/v1/create-anon-session — the Edge Fn returns either the
 *      caller's existing cookie_id (warm-touch update) or a freshly
 *      server-generated UUID. We write the response value to the `_ls_anon`
 *      cookie via {@link writeAnonCookie}.
 *
 *      StrictMode double-mount safety: an in-flight ref dedupes a second
 *      effect tick before the first request resolves, so we never issue two
 *      POSTs from one mount cycle. (React 19 + StrictMode fires effects
 *      twice in development.)
 *
 *      Fail-open: a fetch error is logged via console.warn and the children
 *      still render — per CLAUDE.md the local-first invariant means a missing
 *      Edge Fn must never block the surface.
 *
 *   2. **Smart defaults (D-04).** We derive `locale`, `units`, and `timezone`
 *      from the browser context and expose them as `data-*` attributes on
 *      the wrapper. Consumers (ConsumerOnboardingRenderer, FirstActionSurface)
 *      can read these via `document.querySelector('[data-anonymous-preview]')`
 *      without us spinning up a React Context. The values flow into
 *      anonymous_sessions.preferences on the first persist call.
 *
 *      Locale: `navigator.language || 'en-US'`.
 *      Units: imperial iff locale is en-US, en-LR, or en-MM (the three
 *             countries that still use imperial weight). Everything else is
 *             metric — including en-GB, which moved to metric for medical.
 *      Timezone: `Intl.DateTimeFormat().resolvedOptions().timeZone`.
 *
 * Cookie attributes are owned by `leanshot/src/lib/anonymous/cookie.ts`
 * (Plan 34-02) — Path=/, Max-Age=30d, SameSite=Lax, Secure on https.
 *
 * Per memory `reference_vite_static_env_inlining` — env reads use literal
 * `import.meta.env.VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` keys, the
 * same pattern as `src/lib/supabase.ts`.
 */

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { readAnonCookie, writeAnonCookie } from '@/lib/anonymous/cookie';

// ──────────────────────────────────────────────────────────────────────────
// Smart defaults
// ──────────────────────────────────────────────────────────────────────────

export type Locale = string;
export type Units = 'metric' | 'imperial';

export interface SmartDefaults {
  locale: Locale;
  units: Units;
  timezone: string;
}

const IMPERIAL_LOCALES = new Set(['en-US', 'en-LR', 'en-MM']);

export function deriveSmartDefaults(): SmartDefaults {
  let locale: Locale = 'en-US';
  try {
    if (typeof navigator !== 'undefined' && typeof navigator.language === 'string') {
      locale = navigator.language || 'en-US';
    }
  } catch {
    /* keep default */
  }

  const units: Units = IMPERIAL_LOCALES.has(locale) ? 'imperial' : 'metric';

  let timezone = 'UTC';
  try {
    timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    /* keep default */
  }

  return { locale, units, timezone };
}

// ──────────────────────────────────────────────────────────────────────────
// Cookie bootstrap
// ──────────────────────────────────────────────────────────────────────────

interface CreateAnonSessionResponse {
  cookie_id?: string;
}

async function bootstrapAnonCookie(): Promise<string | null> {
  const url =
    (import.meta.env.VITE_SUPABASE_URL as string | undefined) ??
    'https://placeholder.invalid';
  const anonKey =
    (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) ?? 'placeholder';

  const existing = readAnonCookie();
  const body = existing ? JSON.stringify({ cookie_id: existing }) : JSON.stringify({});

  try {
    const res = await fetch(`${url}/functions/v1/create-anon-session`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: anonKey,
        Authorization: `Bearer ${anonKey}`,
      },
      body,
    });
    if (!res.ok) {
      console.warn('[AnonymousPreviewLayer] create-anon-session non-2xx:', res.status);
      return null;
    }
    const json = (await res.json()) as CreateAnonSessionResponse;
    if (typeof json.cookie_id === 'string' && json.cookie_id.length > 0) {
      if (json.cookie_id !== existing) writeAnonCookie(json.cookie_id);
      return json.cookie_id;
    }
    return null;
  } catch (err) {
    console.warn('[AnonymousPreviewLayer] create-anon-session failed:', err);
    return null;
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Component
// ──────────────────────────────────────────────────────────────────────────

export interface AnonymousPreviewLayerProps {
  children: ReactNode;
  /** Override smart defaults at the boundary (e.g. for Storybook). */
  defaults?: Partial<SmartDefaults>;
  className?: string;
}

export function AnonymousPreviewLayer({
  children,
  defaults,
  className,
}: AnonymousPreviewLayerProps) {
  const [cookieId, setCookieId] = useState<string | null>(() => readAnonCookie());
  const inflight = useRef<Promise<string | null> | null>(null);

  // Smart defaults are stable for the component lifetime (browser locale +
  // timezone don't change mid-render). Derive once on first call.
  const [resolvedDefaults] = useState<SmartDefaults>(() => ({
    ...deriveSmartDefaults(),
    ...defaults,
  }));

  useEffect(() => {
    let cancelled = false;
    if (inflight.current) return;
    inflight.current = bootstrapAnonCookie();
    inflight.current
      .then((id) => {
        if (cancelled) return;
        if (id) setCookieId(id);
      })
      .finally(() => {
        // Allow a future remount (after unmount) to re-issue the request,
        // but keep dedup intact within a single mount cycle.
        inflight.current = null;
      });
    return () => {
      cancelled = true;
    };
    // empty deps: bootstrap is a one-shot per mount cycle
  }, []);

  return (
    <div
      data-anonymous-preview
      data-locale={resolvedDefaults.locale}
      data-units={resolvedDefaults.units}
      data-tz={resolvedDefaults.timezone}
      data-anon-cookie={cookieId ?? ''}
      className={className}
    >
      {children}
    </div>
  );
}

export default AnonymousPreviewLayer;
