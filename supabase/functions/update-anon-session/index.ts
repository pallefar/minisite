/**
 * Phase 34 Plan 34-06 (ONBOARD-04) — `update-anon-session` Edge Function.
 *
 * POST /functions/v1/update-anon-session
 *
 * Body:
 *   {
 *     cookie_id: string,                    // UUID v4 shape — required
 *     preferences_patch?: {                  // ALLOWLIST: locale, units, timezone, primary_goal
 *       locale?: string,
 *       units?: 'metric' | 'imperial',
 *       timezone?: string,
 *       primary_goal?: string,               // D-11 8-goal catalog
 *     },
 *     draft_entries_append?: unknown[],     // Appended verbatim to draft_entries[]
 *     aff_code?: string,                    // Optional affiliate code attribution
 *   }
 *
 * Response (200): { ok: true, population_score: number }
 *
 * Behavior:
 *   - Looks up the un-merged anonymous_sessions row by cookie_id (service-role).
 *   - Filters preferences_patch via an explicit allowlist (T-34-06-01:
 *     untrusted keys are silently dropped).
 *   - Recomputes population_score from the post-patch row:
 *       +1 per filled preferences key (locale/units/timezone/primary_goal),
 *       +1 per draft entry,
 *       capped at 10.
 *   - Touches last_activity_at so the row's TTL clock resets.
 *
 * Architecture invariants (mirror create-anon-session):
 *   - Service-role UPDATE only on public.anonymous_sessions.
 *   - No JWT requirement (caller is pre-auth; the cookie_id IS the identifier).
 *     Service-role writes are gated by the UUID-shape regex + merged_user_id=NULL
 *     filter (T-34-02-01 / T-34-06-01 / T-34-06-03).
 *   - Mirrors the lazy-admin singleton + Proxy + test-injection seam from
 *     `create-anon-session/index.ts`.
 *
 * Allowlisted preference keys correspond to D-11 (primary_goal) + D-04 (locale,
 * units, timezone). Plan 34-07 may extend the allowlist when the first-action
 * surface adds new keys.
 */

import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';

// ============================================================================
// CORS
// ============================================================================

const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function jsonError(status: number, code: string): Response {
  return jsonResponse(status, { error: code });
}

// ============================================================================
// Lazy admin singleton + test seam (mirrors create-anon-session)
// ============================================================================

let _adminInstance: SupabaseClient | null = null;
function getAdmin(): SupabaseClient {
  if (_adminInstance === null) {
    const url = Deno.env.get('SUPABASE_URL') ?? '';
    const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    _adminInstance = createClient(url, key, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  }
  return _adminInstance;
}

let _adminOverride: unknown | null = null;
function setAdminForTest(client: unknown): void {
  _adminOverride = client;
}
function resetAdminForTest(): void {
  _adminOverride = null;
  _adminInstance = null;
}

const admin = new Proxy({} as Record<string | symbol, unknown>, {
  get(_t: unknown, prop: string | symbol): unknown {
    // deno-lint-ignore no-explicit-any
    const a: any = (_adminOverride ?? getAdmin()) as any;
    const val = a[prop];
    return typeof val === 'function' ? (val as (...args: unknown[]) => unknown).bind(a) : val;
  },
}) as unknown as SupabaseClient;

// ============================================================================
// Validation + allowlists
// ============================================================================

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const PREFERENCE_KEYS = ['locale', 'units', 'timezone', 'primary_goal'] as const;
type PreferenceKey = (typeof PREFERENCE_KEYS)[number];

const ALLOWED_UNITS = new Set(['metric', 'imperial']);
const ALLOWED_GOALS = new Set([
  'lose-weight',
  'build-muscle',
  'new-prescription',
  'build-habit',
  'doctor-monitored',
  'family-supporter',
  'manage-symptoms',
  'track-with-vial-supply',
]);

function normalizeCookieId(input: unknown): string | null {
  return typeof input === 'string' && UUID_RE.test(input) ? input : null;
}

/**
 * Allowlist-filter preferences_patch. Unknown keys are silently dropped
 * (T-34-06-01 tampering mitigation). Per-key shape validation:
 *   locale/timezone: non-empty string ≤ 64 chars
 *   units: enum {'metric','imperial'}
 *   primary_goal: enum D-11 catalog
 */
function sanitizePreferencesPatch(input: unknown): Partial<Record<PreferenceKey, unknown>> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {};
  const src = input as Record<string, unknown>;
  const out: Partial<Record<PreferenceKey, unknown>> = {};
  for (const key of PREFERENCE_KEYS) {
    if (!(key in src)) continue;
    const v = src[key];
    if (key === 'locale' || key === 'timezone') {
      if (typeof v === 'string' && v.length > 0 && v.length <= 64) out[key] = v;
    } else if (key === 'units') {
      if (typeof v === 'string' && ALLOWED_UNITS.has(v)) out[key] = v;
    } else if (key === 'primary_goal') {
      if (typeof v === 'string' && ALLOWED_GOALS.has(v)) out[key] = v;
    }
  }
  return out;
}

function sanitizeDraftEntriesAppend(input: unknown): unknown[] {
  return Array.isArray(input) ? input.slice(0, 50) : [];
}

function computePopulationScore(prefs: Record<string, unknown>, draftCount: number): number {
  let score = 0;
  for (const key of PREFERENCE_KEYS) {
    if (key in prefs && prefs[key] != null && prefs[key] !== '') score += 1;
  }
  score += draftCount;
  return Math.min(score, 10);
}

// ============================================================================
// Handler
// ============================================================================

interface AnonymousSessionRow {
  cookie_id: string;
  preferences: Record<string, unknown> | null;
  draft_entries: unknown[] | null;
  aff_code: string | null;
}

async function handleUpdateAnonSession(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return jsonError(405, 'method_not_allowed');
  }

  let body: {
    cookie_id?: unknown;
    preferences_patch?: unknown;
    draft_entries_append?: unknown;
    aff_code?: unknown;
  } = {};
  try {
    body = await req.json();
  } catch {
    return jsonError(400, 'invalid_json');
  }

  const cookieId = normalizeCookieId(body.cookie_id);
  if (!cookieId) {
    return jsonError(400, 'invalid_cookie_id');
  }

  const prefsPatch = sanitizePreferencesPatch(body.preferences_patch);
  const draftAppend = sanitizeDraftEntriesAppend(body.draft_entries_append);
  const affCode =
    typeof body.aff_code === 'string' && body.aff_code.length > 0 && body.aff_code.length <= 64
      ? body.aff_code
      : null;

  // Read current row
  const { data: row, error: selErr } = await admin
    .from('anonymous_sessions')
    .select('cookie_id, preferences, draft_entries, aff_code')
    .eq('cookie_id', cookieId)
    .is('merged_user_id', null)
    .maybeSingle();
  if (selErr) {
    return jsonError(500, 'db_error');
  }
  if (!row) {
    return jsonError(404, 'not_found');
  }

  const current = row as AnonymousSessionRow;
  const mergedPrefs: Record<string, unknown> = {
    ...(current.preferences ?? {}),
    ...prefsPatch,
  };
  const mergedDraft: unknown[] = [
    ...((current.draft_entries ?? []) as unknown[]),
    ...draftAppend,
  ];
  const populationScore = computePopulationScore(mergedPrefs, mergedDraft.length);

  // Persist
  const patch: Record<string, unknown> = {
    preferences: mergedPrefs,
    draft_entries: mergedDraft,
    population_score: populationScore,
    last_activity_at: new Date().toISOString(),
  };
  if (affCode && !current.aff_code) {
    patch.aff_code = affCode;
  }

  const { error: updErr } = await admin
    .from('anonymous_sessions')
    .update(patch)
    .eq('cookie_id', cookieId)
    .is('merged_user_id', null);
  if (updErr) {
    return jsonError(500, 'db_error');
  }

  return jsonResponse(200, { ok: true, population_score: populationScore });
}

// ============================================================================
// Deno.serve entrypoint
// ============================================================================

// deno-lint-ignore no-explicit-any
const denoGlobal: any = (globalThis as any).Deno;
if (denoGlobal?.serve) {
  denoGlobal.serve(handleUpdateAnonSession);
}

// ============================================================================
// Test internals
// ============================================================================

export const __internal = {
  handleUpdateAnonSession,
  setAdminForTest,
  resetAdminForTest,
  sanitizePreferencesPatch,
  sanitizeDraftEntriesAppend,
  computePopulationScore,
  normalizeCookieId,
  UUID_RE,
  ALLOWED_GOALS,
};
