/**
 * Phase 22 Plan 22-10 — GDPR-02 audit writer for cookie consent decisions.
 *
 * Append-only contract: `public.consent_records` has NO DELETE policy and NO
 * unique constraint on (user_id, anonymous_id). Every consent decision
 * (first grant, change, withdraw) writes a NEW row — this is the GDPR
 * Article 7(1) burden-of-proof audit trail, NOT a UPSERT-style "current
 * state" table.
 *
 *   ↳ This is a deviation from 22-10-PLAN.md `key_links` which described an
 *     UPSERT with `onConflict: 'user_id,anonymous_id'`. The migration
 *     `20270601000005_consent_records_table.sql` explicitly comments
 *     "consent history is append-only for GDPR Article 7(1) burden-of-proof".
 *     Append-only is the correct semantic (Rule 1 — bug fix in plan contract).
 *
 * Failure mode: network/RLS failures are logged + swallowed. The banner UX
 * must NOT break on consent_records write failure (user has already made
 * the consent decision in the cookie; the audit row is a best-effort
 * GDPR Art. 7(1) burden-of-proof record we re-attempt on next consent
 * action).
 */
import { supabase } from '@/lib/supabase';

/**
 * Subset of vanilla-cookieconsent's `CookieValue` shape that we persist.
 * Re-declared structurally (not `import type`) so this module never depends
 * on the lazy vanilla-cookieconsent chunk at typecheck time — keeps the
 * audit-writer chunk small and decoupled.
 */
export interface CookieConsentSnapshot {
  /** Unique consent-id (uuid v4) issued by vanilla-cookieconsent per visitor. */
  consentId?: string;
  /** Equivalent legacy field name in some library versions. */
  uid?: string;
  /** Accepted top-level categories. */
  categories: string[];
  /** Accepted services per category (Pitfall 7 — Consent Mode v2 granularity). */
  services?: { [category: string]: string[] };
  /** Library-managed revision counter. */
  revision?: number;
  /** Library-managed consent timestamps (ISO strings). */
  consentTimestamp?: string;
  lastConsentTimestamp?: string;
  /** Library-managed language code. */
  languageCode?: string;
}

interface VercelGeoWindow extends Window {
  __VERCEL_GEO__?: { country?: string };
}

function readGeoCountry(): string | null {
  if (typeof window === 'undefined') return null;
  return (window as VercelGeoWindow).__VERCEL_GEO__?.country ?? null;
}

function readAnonymousId(snap: CookieConsentSnapshot): string | null {
  return snap.consentId ?? snap.uid ?? null;
}

/**
 * GDPR-02 — append a consent_records row for the current decision.
 *
 * Authenticated user → user_id populated, anonymous_id null.
 * Anonymous visitor  → user_id null, anonymous_id = cookie.consentId.
 *
 * Always resolves; never throws. Network or RLS failures are warned + swallowed.
 */
export async function upsertConsentRecord(snap: CookieConsentSnapshot): Promise<void> {
  try {
    const { data: authData } = await supabase.auth.getUser();
    const user = authData?.user ?? null;
    const anonymousId = user ? null : readAnonymousId(snap);

    const cookieCategories: Record<string, unknown> = {
      categories: snap.categories,
      services: snap.services ?? {},
      revision: snap.revision ?? 1,
      consentTimestamp: snap.consentTimestamp ?? null,
      lastConsentTimestamp: snap.lastConsentTimestamp ?? null,
      languageCode: snap.languageCode ?? null,
    };

    const payload = {
      user_id: user?.id ?? null,
      anonymous_id: anonymousId,
      cookie_categories: cookieCategories,
      consent_revision: snap.revision ?? 1,
      // navigator.userAgent capped at 500 chars to fit any reasonable text column
      // (ip_inet stays NULL — server-side capture deferred to Edge Function
      //  variant; client cannot read its own IP without an extra round-trip).
      user_agent:
        typeof navigator !== 'undefined'
          ? navigator.userAgent.slice(0, 500)
          : null,
      country_code: readGeoCountry(),
      // recorded_at defaulted server-side via DEFAULT now()
    };

    const { error } = await supabase.from('consent_records').insert(payload);
    if (error) {
      console.warn('[leanshot] consent_records insert failed', error.message);
    }
  } catch (e) {
    console.warn('[leanshot] consent_records insert threw', e);
  }
}
