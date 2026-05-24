/**
 * zoom-create-meeting Edge Function — Phase 47 Plan 06 (EVENT-03 / D-06 + D-07)
 *
 * POST /functions/v1/zoom-create-meeting
 * Body: { event_id: string }
 *
 * Auth: caller passes user JWT (Authorization: Bearer <jwt>). Fn verifies the
 * caller is_staff() admin before any Zoom API hit (T-47-21 mitigation).
 *
 * Flow:
 *   1. CORS preflight OPTIONS → 204.
 *   2. Method guard (POST only).
 *   3. JWT auth + is_staff() admin gate → 401 unauthorized / 403 forbidden.
 *   4. Load events row by event_id → 404 event_not_found if missing.
 *   5. Fetch / cache Zoom S2S OAuth token (TTL 3600s, 60s safety margin).
 *   6. POST https://api.zoom.us/v2/users/me/meetings → on 401, null cache +
 *      refetch token + retry once. Subsequent failure → 502 zoom_create_<status>.
 *   7. Service-role write-back: events.zoom_meeting_id + events.join_url +
 *      events.zoom_managed=true (T-47-26: never serialized into response).
 *   8. Return { ok: true, meeting_id, join_url }.
 *
 * Security:
 *   - T-47-21 (S): is_staff() RPC gate before Zoom API call.
 *   - T-47-23 (I): NEVER log Authorization header or Basic auth string.
 *   - T-47-26 (E): service-role bearer used only for events.update; never in response.
 *
 * Per memory reference_supabase_functions_deploy_import_map_flag: sibling
 *   deno.json pins @supabase/supabase-js@2 (CLI v2.101.0 ignores --import-map).
 * Per memory reference_deno_test_top_level_serve_trap: Deno.serve() is guarded
 *   by import.meta.main to prevent test-import dangling-promise abort.
 * Per memory reference_supabase_service_role_key_format_divergence: production
 *   SUPABASE_SERVICE_ROLE_KEY env is the sb_secret_* token.
 */

import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';

// ============================================================================
// CORS + response helpers (verbatim pattern from mux-create-upload)
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

function textResponse(status: number, code: string): Response {
  return new Response(code, { status, headers: corsHeaders });
}

// ============================================================================
// Zoom S2S OAuth token cache (per-instance; TTL 3600s, 60s safety margin)
// Pitfall 2: 401 from Zoom API → null cache + retry once.
// ============================================================================

let _cachedToken: { value: string; expiresAt: number } | null = null;

export function _resetTokenCacheForTest(): void {
  _cachedToken = null;
}

async function getZoomToken(): Promise<string> {
  const now = Date.now();
  if (_cachedToken && _cachedToken.expiresAt > now + 60_000) return _cachedToken.value;

  const accountId = Deno.env.get('ZOOM_S2S_ACCOUNT_ID') ?? '';
  const clientId = Deno.env.get('ZOOM_S2S_CLIENT_ID') ?? '';
  const clientSecret = Deno.env.get('ZOOM_S2S_CLIENT_SECRET') ?? '';
  if (!accountId || !clientId || !clientSecret) {
    throw new Error('zoom_not_configured');
  }
  const basic = btoa(`${clientId}:${clientSecret}`);

  const r = await fetch(
    `https://zoom.us/oauth/token?grant_type=account_credentials&account_id=${accountId}`,
    { method: 'POST', headers: { Authorization: `Basic ${basic}` } },
  );
  if (!r.ok) throw new Error(`zoom_oauth_${r.status}`);
  const json = (await r.json()) as { access_token: string; expires_in: number };
  _cachedToken = {
    value: json.access_token,
    expiresAt: now + (json.expires_in - 60) * 1000,
  };
  return _cachedToken.value;
}

// ============================================================================
// Lazy admin singleton (verbatim pattern from mux-create-upload)
// Service-role client; used only for events.update write-back.
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
export function setAdminForTest(client: unknown): void {
  _adminOverride = client;
}
export function resetAdminForTest(): void {
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
// User-context Supabase client factory (carries caller JWT for is_staff() RPC)
// Separate test-injection seam from admin so unit tests can mock either side.
// ============================================================================

let _supaOverride: ((authHeader: string) => SupabaseClient) | null = null;
export function setSupaForTest(factory: (authHeader: string) => SupabaseClient): void {
  _supaOverride = factory;
}
export function resetSupaForTest(): void {
  _supaOverride = null;
}

function getSupa(authHeader: string): SupabaseClient {
  if (_supaOverride !== null) return _supaOverride(authHeader);
  return createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_ANON_KEY') ?? '',
    { global: { headers: { Authorization: authHeader } } },
  );
}

// ============================================================================
// Handler
// ============================================================================

interface CreateMeetingBody {
  event_id?: string;
}
interface ZoomMeetingResponse {
  id: number | string;
  join_url: string;
  password?: string;
}

export async function handler(req: Request): Promise<Response> {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  // Method guard
  if (req.method !== 'POST') {
    return jsonResponse(405, { error: 'method_not_allowed' });
  }

  // Caller JWT — required for is_staff() RPC.
  const authHeader = req.headers.get('Authorization') ?? '';
  if (!authHeader) {
    return textResponse(401, 'unauthorized');
  }

  const supa = getSupa(authHeader);
  const { data: userData } = await supa.auth.getUser();
  const user = userData?.user ?? null;
  if (!user) {
    return textResponse(401, 'unauthorized');
  }

  // T-47-21 mitigation: is_staff() RPC gate before any Zoom API hit.
  const { data: isAdmin, error: rpcErr } = await supa.rpc('is_staff');
  if (rpcErr || !isAdmin) {
    return textResponse(403, 'forbidden');
  }

  // Parse body.
  let body: CreateMeetingBody;
  try {
    body = (await req.json()) as CreateMeetingBody;
  } catch {
    return jsonResponse(400, { error: 'invalid_json' });
  }
  const eventId = body?.event_id;
  if (typeof eventId !== 'string' || eventId.trim() === '') {
    return jsonResponse(400, { error: 'event_id_required' });
  }

  // Load event row.
  const { data: ev } = await (admin as SupabaseClient)
    .from('events')
    .select('title, start_at, end_at')
    .eq('id', eventId)
    .maybeSingle();
  if (!ev) {
    return textResponse(404, 'event_not_found');
  }
  const event = ev as { title: string; start_at: string; end_at: string };

  // Get / refresh Zoom S2S token.
  let token: string;
  try {
    token = await getZoomToken();
  } catch (e) {
    const code = e instanceof Error ? e.message : 'zoom_oauth_error';
    return jsonResponse(502, { error: code });
  }

  // POST /v2/users/me/meetings — retry once on 401.
  const meetingReq = {
    topic: event.title,
    type: 2, // scheduled meeting
    start_time: event.start_at, // ISO 8601
    duration: Math.ceil((Date.parse(event.end_at) - Date.parse(event.start_at)) / 60_000),
    timezone: 'UTC',
    settings: { join_before_host: false, waiting_room: true },
  };

  let zr = await fetch('https://api.zoom.us/v2/users/me/meetings', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(meetingReq),
  });
  if (zr.status === 401) {
    // Pitfall 2: token may have race-expired; null cache + refetch + retry once.
    _cachedToken = null;
    try {
      token = await getZoomToken();
    } catch (e) {
      const code = e instanceof Error ? e.message : 'zoom_oauth_error';
      return jsonResponse(502, { error: code });
    }
    zr = await fetch('https://api.zoom.us/v2/users/me/meetings', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(meetingReq),
    });
  }
  if (!zr.ok) {
    return jsonResponse(502, { error: `zoom_create_${zr.status}` });
  }
  const meeting = (await zr.json()) as ZoomMeetingResponse;

  // Service-role write-back. T-47-26: service-role client used only here,
  // never serialized into the response body.
  await (admin as SupabaseClient)
    .from('events')
    .update({
      zoom_meeting_id: String(meeting.id),
      join_url: meeting.join_url,
      zoom_managed: true,
    })
    .eq('id', eventId);

  return jsonResponse(200, {
    ok: true,
    meeting_id: meeting.id,
    join_url: meeting.join_url,
  });
}

// ============================================================================
// Deno.serve guard — prevents top-level serve trap in deno test
// (per reference_deno_test_top_level_serve_trap)
// ============================================================================

// deno-lint-ignore no-explicit-any
const denoGlobal: any = (globalThis as any).Deno;
if (import.meta.main && denoGlobal?.serve) {
  denoGlobal.serve(handler);
}
