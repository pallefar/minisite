/**
 * `partner-profile-update` Edge Function — Phase 19 Plan 19-06b (BL-2 Path A).
 *
 * JWT-gated POST endpoint for affiliate self-edits of `affiliates` rows.
 *
 *   POST /functions/v1/partner-profile-update    (verify_jwt = true)
 *
 * Body — partial patch over the 6 allowlisted columns ONLY:
 *   { display_name?:     string (1..80),
 *     photo_path?:       string (<= 200),
 *     blurb?:            string (<= 50),
 *     calendly_url?:     string (empty OR URL ending in calendly.com),
 *     testimonial_quote?:string (<= 200),
 *     template_choice?:  'coach' | 'story' | 'method' }
 *
 * Responses:
 *   200 { ok: true }                  — UPDATE applied
 *   400 { error: 'bad_json' | 'empty_body' | 'invalid_input',
 *         invalid_column?: string,
 *         invalid_field?:  string }
 *   401 { error: 'unauthenticated' }
 *   403 { error: 'not_approved' }
 *   404 { error: 'not_an_affiliate' }
 *   405 { error: 'method_not_allowed' }
 *   429 { error: 'rate_limited' }
 *   500 { error: 'internal' }
 *
 * Why the Edge Function (BL-2 Path A — column allowlist enforcement):
 *   Postgres RLS cannot restrict UPDATE on a per-column basis. An affiliate
 *   with RLS UPDATE permission on their own row could otherwise rewrite
 *   `commission_rate_cents` or `status='approved'` directly from the client.
 *   This function is the canonical write path; RLS on `affiliates` denies
 *   direct UPDATE from affiliate sessions (Plan 19-01) so the only way for
 *   an affiliate to mutate their row is through this allowlist gate.
 *
 * Threat coverage (see threat_model in 19-06b PLAN):
 *   - T-19-06b-S: user.id resolved from JWT, never from the body
 *   - T-19-06b-T: column allowlist + per-column validation
 *   - T-19-06b-E: WHERE user_id = $jwt.user.id (cross-tenant denied)
 *   - T-19-06b-D: per-user rate limit (10 saves / 60s)
 *
 * Test seam: `__internal.setAdminClient(...)` and `__internal.resetRateLimitState()`
 * mirror the affiliate-apply pattern.
 */
import { createClient } from 'npm:@supabase/supabase-js@2';
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders } from './cors.ts';

// =============================================================================
// Env + admin client (service-role; bypasses RLS for the column-gated UPDATE)
// =============================================================================

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

// eslint-disable-next-line prefer-const
let admin: SupabaseClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// =============================================================================
// Allowlist
// =============================================================================

const ALLOWED_COLUMNS = [
  'display_name',
  'photo_path',
  'blurb',
  'calendly_url',
  'testimonial_quote',
  'template_choice',
] as const;
type AllowedColumn = (typeof ALLOWED_COLUMNS)[number];

const ALLOWED_SET: Set<string> = new Set<string>(ALLOWED_COLUMNS);
const ALLOWED_TEMPLATES = new Set<string>(['coach', 'story', 'method']);

// =============================================================================
// Per-user rate limit (10 saves / 60s, in-memory; cold-start clean slate)
// =============================================================================

const RATE_LIMIT_THRESHOLD = 10;
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const rateLimitMap = new Map<string, number[]>();

function checkRateLimit(userId: string): boolean {
  const now = Date.now();
  const cutoff = now - RATE_LIMIT_WINDOW_MS;
  const existing = (rateLimitMap.get(userId) ?? []).filter((ts) => ts > cutoff);
  if (existing.length >= RATE_LIMIT_THRESHOLD) {
    rateLimitMap.set(userId, existing);
    return false;
  }
  existing.push(now);
  rateLimitMap.set(userId, existing);
  return true;
}

// =============================================================================
// Helpers
// =============================================================================

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function jsonError(status: number, code: string, extra?: Record<string, unknown>): Response {
  return jsonResponse(status, { error: code, ...(extra ?? {}) });
}

interface CalendlyValidation {
  ok: boolean;
}

/**
 * Calendly URL gate:
 *  - empty string is allowed (clears the field)
 *  - otherwise must be parseable AND host must be `calendly.com` or end in `.calendly.com`
 */
function validateCalendly(value: string): CalendlyValidation {
  if (value === '') return { ok: true };
  let u: URL;
  try {
    u = new URL(value);
  } catch {
    return { ok: false };
  }
  const host = u.hostname.toLowerCase();
  if (host === 'calendly.com' || host.endsWith('.calendly.com')) {
    return { ok: true };
  }
  return { ok: false };
}

/**
 * Validate body against allowlist + per-column rules.
 * Returns either a `{ ok: true, patch }` shape with the filtered patch ready
 * for UPDATE, or `{ ok: false, response }` with a 400.
 */
type ValidatedPatch =
  | { ok: true; patch: Partial<Record<AllowedColumn, string>> }
  | { ok: false; response: Response };

function validateBody(body: Record<string, unknown>): ValidatedPatch {
  // Column allowlist enforcement (BL-2 Path A core gate).
  for (const key of Object.keys(body)) {
    if (!ALLOWED_SET.has(key)) {
      return {
        ok: false,
        response: jsonError(400, 'invalid_input', { invalid_column: key }),
      };
    }
  }

  if (Object.keys(body).length === 0) {
    return { ok: false, response: jsonError(400, 'empty_body') };
  }

  const patch: Partial<Record<AllowedColumn, string>> = {};

  if ('display_name' in body) {
    const v = body.display_name;
    if (typeof v !== 'string') {
      return { ok: false, response: jsonError(400, 'invalid_input', { invalid_field: 'display_name' }) };
    }
    const trimmed = v.trim();
    if (trimmed.length < 1 || trimmed.length > 80) {
      return { ok: false, response: jsonError(400, 'invalid_input', { invalid_field: 'display_name' }) };
    }
    patch.display_name = trimmed;
  }

  if ('photo_path' in body) {
    const v = body.photo_path;
    if (typeof v !== 'string') {
      return { ok: false, response: jsonError(400, 'invalid_input', { invalid_field: 'photo_path' }) };
    }
    if (v.length > 200) {
      return { ok: false, response: jsonError(400, 'invalid_input', { invalid_field: 'photo_path' }) };
    }
    patch.photo_path = v;
  }

  if ('blurb' in body) {
    const v = body.blurb;
    if (typeof v !== 'string') {
      return { ok: false, response: jsonError(400, 'invalid_input', { invalid_field: 'blurb' }) };
    }
    if (v.length > 50) {
      return { ok: false, response: jsonError(400, 'invalid_input', { invalid_field: 'blurb' }) };
    }
    patch.blurb = v;
  }

  if ('calendly_url' in body) {
    const v = body.calendly_url;
    if (typeof v !== 'string') {
      return { ok: false, response: jsonError(400, 'invalid_input', { invalid_field: 'calendly_url' }) };
    }
    const trimmed = v.trim();
    const r = validateCalendly(trimmed);
    if (!r.ok) {
      return { ok: false, response: jsonError(400, 'invalid_input', { invalid_field: 'calendly_url' }) };
    }
    patch.calendly_url = trimmed;
  }

  if ('testimonial_quote' in body) {
    const v = body.testimonial_quote;
    if (typeof v !== 'string') {
      return { ok: false, response: jsonError(400, 'invalid_input', { invalid_field: 'testimonial_quote' }) };
    }
    if (v.length > 200) {
      return { ok: false, response: jsonError(400, 'invalid_input', { invalid_field: 'testimonial_quote' }) };
    }
    patch.testimonial_quote = v;
  }

  if ('template_choice' in body) {
    const v = body.template_choice;
    if (typeof v !== 'string' || !ALLOWED_TEMPLATES.has(v)) {
      return { ok: false, response: jsonError(400, 'invalid_input', { invalid_field: 'template_choice' }) };
    }
    patch.template_choice = v;
  }

  return { ok: true, patch };
}

// =============================================================================
// Handler
// =============================================================================

async function handlePost(req: Request): Promise<Response> {
  // 1. Auth: extract Bearer JWT.
  const auth = req.headers.get('authorization') ?? req.headers.get('Authorization') ?? '';
  const m = auth.match(/^Bearer\s+(.+)$/i);
  if (!m) {
    return jsonError(401, 'unauthenticated');
  }
  const jwt = m[1].trim();
  if (!jwt) {
    return jsonError(401, 'unauthenticated');
  }

  /* eslint-disable @typescript-eslint/no-explicit-any */
  let userId: string;
  try {
    const u = (await (admin.auth.getUser(jwt) as any)) as {
      data: { user: { id: string } | null };
      error: unknown;
    };
    if (!u?.data?.user?.id) {
      return jsonError(401, 'unauthenticated');
    }
    userId = u.data.user.id;
  } catch {
    return jsonError(401, 'unauthenticated');
  }
  /* eslint-enable @typescript-eslint/no-explicit-any */

  // 2. Per-user rate limit (T-19-06b-D).
  if (!checkRateLimit(userId)) {
    return jsonError(429, 'rate_limited');
  }

  // 3. Parse body.
  let body: Record<string, unknown>;
  try {
    const raw = (await req.json()) as unknown;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      return jsonError(400, 'bad_json');
    }
    body = raw as Record<string, unknown>;
  } catch {
    return jsonError(400, 'bad_json');
  }

  // 4. Allowlist + validation.
  const v = validateBody(body);
  if (!v.ok) return v.response;

  // 5. Resolve affiliate row.
  /* eslint-disable @typescript-eslint/no-explicit-any */
  let aff: { id: string; status: string } | null = null;
  try {
    const res = (await (admin
      .from('affiliates')
      .select('id, status')
      .eq('user_id', userId)
      .maybeSingle() as any)) as { data: { id: string; status: string } | null };
    aff = res.data;
  } catch (e) {
    console.error('[partner-profile-update] affiliate lookup threw', e instanceof Error ? e.name : 'unknown');
    return jsonError(500, 'internal');
  }
  /* eslint-enable @typescript-eslint/no-explicit-any */

  if (!aff) return jsonError(404, 'not_an_affiliate');
  if (aff.status !== 'approved') return jsonError(403, 'not_approved');

  // 6. UPDATE — service-role bypass of RLS; WHERE clause uses the JWT-resolved id.
  try {
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const upd = (await (admin
      .from('affiliates')
      .update({ ...v.patch, updated_at: new Date().toISOString() })
      .eq('id', aff.id) as any)) as { error: { message?: string; code?: string } | null };
    /* eslint-enable @typescript-eslint/no-explicit-any */
    if (upd?.error) {
      console.error('[partner-profile-update] update error', upd.error.message ?? 'unknown');
      return jsonError(500, 'internal');
    }
  } catch (e) {
    console.error('[partner-profile-update] update threw', e instanceof Error ? e.name : 'unknown');
    return jsonError(500, 'internal');
  }

  return jsonResponse(200, { ok: true });
}

// =============================================================================
// Dispatcher
// =============================================================================

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return jsonError(405, 'method_not_allowed');
  }
  try {
    return await handlePost(req);
  } catch (e) {
    console.error('[partner-profile-update] unhandled', e instanceof Error ? e.message : 'unknown');
    return jsonError(500, 'internal');
  }
});

// =============================================================================
// Internal exports for the Deno test suite
// =============================================================================

export const __internal = {
  handlePost,
  validateBody,
  validateCalendly,
  ALLOWED_COLUMNS,
  setAdminClient(client: unknown): void {
    admin = client as SupabaseClient;
  },
  resetRateLimitState(): void {
    rateLimitMap.clear();
  },
};
