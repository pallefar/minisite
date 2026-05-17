/**
 * PostHog identify + alias bridge — Phase 24 D-13.
 *
 * identify(supabaseUid): maps the current browser session to a Supabase user.
 *   Call once after sign-in.
 *
 * aliasAnonymousToUid(anonDistinctId, supabaseUid): merges pre-auth anonymous
 *   events under the Supabase uid. Idempotent — uses localStorage to fire
 *   posthog.alias() exactly once per (uid) per session/device.
 *   PostHog merges idempotently server-side; the localStorage guard just avoids
 *   redundant alias calls which can confuse PostHog's identity merging.
 *
 * TODO[24-02]: verify alias arg order against posthog-js version in use.
 *   posthog.alias(newAlias, originalDistinctId) — newAlias = supabaseUid,
 *   originalDistinctId = the anon id. Verify against posthog-js changelog if
 *   identity merge behavior differs.
 */
import posthog from 'posthog-js';

const ALIAS_MARKER = (uid: string) => `leanshot_posthog_aliased_${uid}`;

export function identify(supabaseUid: string): void {
  posthog.identify(supabaseUid);
}

export function aliasAnonymousToUid(anonDistinctId: string, supabaseUid: string): void {
  try {
    if (typeof localStorage !== 'undefined' && localStorage.getItem(ALIAS_MARKER(supabaseUid))) {
      return;
    }
    // TODO[24-02]: verify alias arg order against posthog-js version in use.
    posthog.alias(supabaseUid, anonDistinctId);
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(ALIAS_MARKER(supabaseUid), String(Date.now()));
    }
  } catch {
    // localStorage may be blocked (private-mode browsers).
    // alias may double-fire across sessions; PostHog server-side merges idempotently.
  }
}
