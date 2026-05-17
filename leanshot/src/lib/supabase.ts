/**
 * Browser-side Supabase client singleton.
 *
 * Phase 4 D-02 (anonymous auth): the AI Coach + Nutrition macro-estimator
 * call this client's `auth.signInAnonymously()` so every browser session
 * gets a real `auth.users` row (with `is_anonymous = true`) and a JWT that
 * the `ai-chat` Edge Function verifies via its default JWT-gate. That row
 * is later upgraded to a full account by Phase 5's email-link flow.
 *
 * `storageKey: 'sb-leanshot-auth'` (NOT the default `sb-<ref>-auth-token`)
 * is chosen so the anon-JWT key is greppable + namespaced under our app
 * rather than a Supabase-generated literal. Phase 5 will migrate any
 * existing anon JWT to a permanent session without touching this key name.
 *
 * Fail-soft: if `VITE_SUPABASE_URL` or `VITE_SUPABASE_ANON_KEY` are missing
 * at build time, we log via `console.error('[leanshot] …')` (S-1 prefix)
 * and still export a non-throwing client so the rest of the app continues
 * to render (CLAUDE.md: "AI outage = degraded coach UX, not full-app
 * outage"). Phase 1 quality-gates + Phase 2 marketing build stay green
 * even if the envs are absent.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

// Fail-soft placeholders. `createClient` validates the URL on construction
// and throws if it is empty / malformed — but we want the module to load
// even if the envs are missing so the rest of the app keeps rendering
// (any actual `.auth.*` / `.from(...)` call against a placeholder will
// surface as a network error inside `callAIChat`'s typed catch — never a
// module-load crash).
const RESOLVED_URL = url && url.length > 0 ? url : 'https://placeholder.invalid';
const RESOLVED_ANON_KEY = anonKey && anonKey.length > 0 ? anonKey : 'placeholder';

if (!url || !anonKey) {
  console.error('[leanshot] Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY');
}

export const supabase: SupabaseClient = createClient(RESOLVED_URL, RESOLVED_ANON_KEY, {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true,
    storageKey: 'sb-leanshot-auth',
  },
});

/**
 * Phase 24 Plan 24-05 — Pattern S1 aal2 assertion helper.
 *
 * D-09: every admin session requires aal2 step-up (TOTP verified).
 * Reads the current session's access_token JWT and checks the `aal` claim.
 *
 * Returns true if the active session has aal='aal2' (TOTP step-up completed).
 * Returns false if no session or aal='aal1' (step-up required).
 *
 * NOTE: This is a UX-layer check only (Pattern S1 client gate).
 * The server-side enforcement is in every admin SECURITY DEFINER function
 * which checks `(auth.jwt() ->> 'aal') = 'aal2'` directly in Postgres.
 */
export async function assertAal2(): Promise<boolean> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) return false;
  const aal = parseJwtAal(token);
  return aal === 'aal2';
}

function parseJwtAal(token: string): string | null {
  try {
    const parts = token.split('.');
    const payload = parts[1];
    if (!payload) return null;
    const json = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')));
    return typeof json.aal === 'string' ? json.aal : null;
  } catch {
    return null;
  }
}
