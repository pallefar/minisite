/**
 * mux-sign-playback Edge Function — Phase 46 Plan 04
 *
 * POST /functions/v1/mux-sign-playback
 *
 * Auth: User JWT bearer (browser-called as the authenticated learner).
 * Mints time-limited RS256 JWT tokens for Mux signed playback (course videos).
 *
 * Flow:
 *   1. CORS preflight OPTIONS → 204.
 *   2. Method guard (POST only).
 *   3. Extract Bearer; admin.auth.getUser(bearer) → 401 on null.
 *   4. Parse body { lesson_id: string } → 400 invalid_body on type fail.
 *   5. Load course_lessons row → 404 lesson_not_found if missing;
 *      404 lesson_not_ready if mux_playback_id null OR mux_status != 'ready'.
 *   6. Tier gate (unless lesson.is_free_preview): read
 *      tier_effective.has_active for caller's auth.uid() → 403 tier_required.
 *   7. Sign two RS256 JWTs (video + thumbnail) via mux.jwt.signPlaybackId with
 *      EXPLICIT { keyId, keySecret } options (decoupling from SDK env-var
 *      auto-read per RESEARCH Pitfall 4). exp = 4h. Thumbnail params { time: 1 }.
 *   8. Return { playback, thumbnail, playback_id }.
 *
 * Security (threat_refs T-46-01, T-46-04):
 *   - T-46-01 (Information Disclosure): tier_effective.has_active checked
 *     server-side from auth.uid(); free-preview bypass only when lesson row
 *     itself has is_free_preview=true. Free users cannot fetch a signed URL
 *     for a paid lesson.
 *   - T-46-04 (Information Disclosure): MUX_SIGNING_KEY_ID +
 *     MUX_SIGNING_KEY_PRIVATE read from Supabase Function Secrets; NEVER
 *     returned to client; NEVER in VITE_* vars. Explicit keyId/keySecret
 *     options decouple from SDK env-var auto-read (Mux SDK v14 defaults to
 *     MUX_SIGNING_KEY/MUX_PRIVATE_KEY which collide with VITE_* naming and
 *     are easy to leak via misconfigured CI).
 *
 * Anti-skip note (per reference_mux_video_view_event_for_antiskip):
 *   No view-event webhook references in this file (that webhook does not
 *   exist in Mux). Anti-skip is handled client-side via onTimeUpdate → DB
 *   write → server `complete_lesson` Fn double-checks ≥95% from DB.
 */

import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';
import Mux from 'npm:@mux/mux-node@14';

// ============================================================================
// CORS + response helpers (verbatim from mux-create-upload/index.ts)
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
// Bearer extraction (verbatim from mux-create-upload/index.ts)
// ============================================================================

function bearerFromReq(req: Request): string | null {
  const h = req.headers.get('Authorization') ?? '';
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m ? (m[1] ?? null) : null;
}

// ============================================================================
// Lazy admin singleton + test override hooks
// (verbatim from mux-create-upload/index.ts)
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
// Mux client factory — overridable for tests
// ============================================================================

let _muxOverride: unknown | null = null;
export function setMuxForTest(client: unknown): void {
  _muxOverride = client;
}
export function resetMuxForTest(): void {
  _muxOverride = null;
}

function getMux(): Mux {
  if (_muxOverride !== null) return _muxOverride as Mux;
  const tokenId = Deno.env.get('MUX_TOKEN_ID');
  const tokenSecret = Deno.env.get('MUX_TOKEN_SECRET');
  if (!tokenId || !tokenSecret) {
    throw new Error('MUX_TOKEN_ID and MUX_TOKEN_SECRET must be set');
  }
  return new Mux({ tokenId, tokenSecret });
}

// ============================================================================
// Lesson row shape
// ============================================================================

interface CourseLessonRow {
  id: string;
  mux_playback_id: string | null;
  is_free_preview: boolean;
  mux_status: string | null;
}

// ============================================================================
// Handler
// ============================================================================

export async function handler(req: Request): Promise<Response> {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  // Method guard
  if (req.method !== 'POST') {
    return jsonError(405, 'method_not_allowed');
  }

  // User JWT auth — browser-context, not service-role
  const bearer = bearerFromReq(req);
  if (!bearer) {
    return jsonError(401, 'unauthorized');
  }

  const { data: userData } = await (admin as SupabaseClient).auth.getUser(bearer);
  const user = userData?.user ?? null;
  if (!user) {
    return jsonError(401, 'unauthorized');
  }

  // Parse body
  let body: { lesson_id?: unknown };
  try {
    body = await req.json() as { lesson_id?: unknown };
  } catch {
    return jsonError(400, 'invalid_body');
  }

  const lessonId = body?.lesson_id;
  if (typeof lessonId !== 'string' || lessonId.trim() === '') {
    return jsonError(400, 'invalid_body');
  }

  // Load lesson row (id, mux_playback_id, is_free_preview, mux_status)
  const { data: lessonData } = await admin
    .from('course_lessons')
    .select('id, mux_playback_id, is_free_preview, mux_status')
    .eq('id', lessonId)
    .maybeSingle();

  const lesson = lessonData as CourseLessonRow | null;
  if (!lesson) {
    return jsonError(404, 'lesson_not_found');
  }
  if (!lesson.mux_playback_id || lesson.mux_status !== 'ready') {
    return jsonError(404, 'lesson_not_ready');
  }

  // Tier gate (T-46-01 mitigation): bypass only for free-preview lessons.
  if (!lesson.is_free_preview) {
    const { data: tier } = await admin
      .from('tier_effective')
      .select('has_active')
      .eq('user_id', user.id)
      .maybeSingle();
    const hasActive = (tier?.has_active as boolean | undefined) ?? false;
    if (!hasActive) {
      return jsonError(403, 'tier_required');
    }
  }

  // Signing key env (T-46-04: NEVER returned to client; NEVER in VITE_*).
  // Explicit keyId/keySecret options pattern (RESEARCH Pitfall 4) decouples
  // from SDK env-var auto-read (MUX_SIGNING_KEY/MUX_PRIVATE_KEY defaults).
  const signingKeyId = Deno.env.get('MUX_SIGNING_KEY_ID') ?? '';
  const signingKeyPrivate = Deno.env.get('MUX_SIGNING_KEY_PRIVATE') ?? '';
  if (!signingKeyId || !signingKeyPrivate) {
    return jsonError(500, 'signing_key_missing');
  }

  try {
    const mux = getMux();
    const playbackToken = await mux.jwt.signPlaybackId(lesson.mux_playback_id, {
      type: 'video',
      expiration: '4h',
      keyId: signingKeyId,
      keySecret: signingKeyPrivate,
    });
    const thumbnailToken = await mux.jwt.signPlaybackId(lesson.mux_playback_id, {
      type: 'thumbnail',
      expiration: '4h',
      keyId: signingKeyId,
      keySecret: signingKeyPrivate,
      params: { time: 1 },
    });
    return jsonResponse(200, {
      playback: playbackToken,
      thumbnail: thumbnailToken,
      playback_id: lesson.mux_playback_id,
    });
  } catch (_e) {
    console.error('[mux-sign-playback] Mux signing error', _e instanceof Error ? _e.message : 'unknown');
    return jsonError(500, 'mux_error');
  }
}

// ============================================================================
// Deno.serve guard — prevents top-level serve trap in `deno test`
// (per reference_deno_test_top_level_serve_trap). import.meta.main ensures
// importing this module from a test file does NOT spawn a dangling HTTP
// server.
// ============================================================================

// deno-lint-ignore no-explicit-any
const denoGlobal: any = (globalThis as any).Deno;
if (import.meta.main && denoGlobal?.serve) {
  denoGlobal.serve(handler);
}
