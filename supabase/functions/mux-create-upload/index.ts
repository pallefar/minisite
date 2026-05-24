/**
 * mux-create-upload Edge Function — Phase 44 Plan 04
 *
 * POST /functions/v1/mux-create-upload
 *
 * Auth: User JWT bearer (NOT service-role — this Fn is called from the browser
 * as the authenticated user). Tier gate: only Pro/Lifetime/Trial users may
 * upload video (D-06). Free tier → 403 VIDEO_TIER_REQUIRED.
 *
 * Flow:
 *   1. CORS preflight OPTIONS → 204.
 *   2. Method guard (POST only).
 *   3. Extract Bearer from Authorization header; call admin.auth.getUser(bearer).
 *   4. Parse body { post_id: string }.
 *   5. Tier check: tier_effective.tier_label ∈ {pro, lifetime, trial} → else 403.
 *   6. Create Mux direct-upload URL with max_duration_seconds=300 (D-05 5-min cap)
 *      and passthrough = JSON.stringify({ user_id, post_id }) for mux-webhook
 *      to use when routing the UPDATE back to community_posts.
 *   7. Return { url, upload_id }.
 *
 * Security:
 *   - T-44-02 (Elevation of Privilege): tier_effective check on caller's auth.uid().
 *     Free users cannot bypass via direct API call — Edge Fn enforces the gate.
 *   - Mux API keys (MUX_TOKEN_ID, MUX_TOKEN_SECRET) NEVER sent to browser.
 *   - user_id baked into passthrough is server-trusted (auth.uid()), not
 *     client-supplied.
 */

import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';
import Mux from 'npm:@mux/mux-node@14';

// ============================================================================
// CORS + response helpers (verbatim from notification-send/index.ts lines 48–63)
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
// Bearer extraction + constant-time comparison
// (verbatim from notification-send/index.ts lines 65–76)
// ============================================================================

function bearerFromReq(req: Request): string | null {
  const h = req.headers.get('Authorization') ?? '';
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m ? (m[1] ?? null) : null;
}

// deno-lint-ignore no-unused-vars
function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// ============================================================================
// Lazy admin singleton (verbatim from notification-send/index.ts lines 82–111)
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
// Mux client factory — not cached so tests can inject via env mock
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

  // User JWT auth — this Fn uses user-context auth, not service-role
  const bearer = bearerFromReq(req);
  if (!bearer) {
    return jsonError(401, 'unauthorized');
  }

  // Verify the JWT via admin.auth.getUser (validates against Supabase's JWKS)
  const { data: userData } = await (admin as SupabaseClient).auth.getUser(bearer);
  const user = userData?.user ?? null;
  if (!user) {
    return jsonError(401, 'unauthorized');
  }

  // Parse body — extended for course-lesson kind (Plan 46-05)
  let body: { post_id?: string; lesson_id?: string; course_id?: string; kind?: string };
  try {
    body = await req.json() as { post_id?: string; lesson_id?: string; course_id?: string; kind?: string };
  } catch {
    return jsonError(400, 'invalid_json');
  }

  const kind = body?.kind ?? 'community-post';

  // ==========================================================================
  // Plan 46-05: course-lesson branch — admin-only, signed playback, 30-min cap
  //   T-46-01 (Information Disclosure): is_staff gate BEFORE Mux call.
  //   T-46-07 (Elevation of Privilege): is_staff is separate from tier_effective;
  //     a Pro/Trial user without is_staff=true cannot mint a course-lesson upload.
  //   Critical divergences from community-post path:
  //     - playback_policies:['signed']  (NOT 'public')   — Plan 46-04 JWT required
  //     - max_duration_seconds: 1800    (NOT 300)        — D-05: 30 min cap
  //     - generated_subtitles: en       (D-06: caption auto-gen)
  //     - passthrough envelope: { kind, lesson_id, course_id } (no user_id/post_id)
  // ==========================================================================
  if (kind === 'course-lesson') {
    const { data: profile } = await admin
      .from('profiles')
      .select('is_staff')
      .eq('id', user.id)
      .single();
    if (!(profile as { is_staff?: boolean } | null)?.is_staff) {
      return jsonError(403, 'ADMIN_REQUIRED');
    }

    const lessonId = body?.lesson_id;
    const courseId = body?.course_id;
    if (typeof lessonId !== 'string' || typeof courseId !== 'string') {
      return jsonError(400, 'invalid_lesson_id');
    }

    try {
      const mux = getMux();
      const upload = await mux.video.uploads.create({
        cors_origin: req.headers.get('origin') ?? '*',
        new_asset_settings: {
          playback_policies: ['signed'],     // CRITICAL: signed (NOT public)
          max_duration_seconds: 1800,         // D-05: 30 min
          passthrough: JSON.stringify({
            kind: 'course-lesson',
            lesson_id: lessonId,
            course_id: courseId,
          }),
          generated_subtitles: [{ language_code: 'en', name: 'English (auto)' }], // D-06
        },
        timeout: 3600,
      });
      return jsonResponse(200, { url: upload.url, upload_id: upload.id });
    } catch (_e) {
      console.error('[mux-create-upload] Mux API error (course-lesson)', _e instanceof Error ? _e.message : 'unknown');
      return jsonError(500, 'mux_error');
    }
  }
  // End course-lesson branch — existing community-post branch continues below.

  const postId = body?.post_id;
  if (typeof postId !== 'string' || postId.trim() === '') {
    return jsonError(400, 'invalid_post_id');
  }

  // Tier check (D-06): only Pro / Lifetime / Trial users may upload video
  // T-44-02 mitigation: tier_effective.tier_label read server-side from auth.uid()
  const { data: tier } = await admin
    .from('tier_effective')
    .select('tier_label')
    .eq('user_id', user.id)
    .single();

  const tierLabel = (tier?.tier_label as string) ?? 'free';
  if (!['pro', 'lifetime', 'trial'].includes(tierLabel)) {
    return jsonError(403, 'VIDEO_TIER_REQUIRED');
  }

  // Mux direct-upload creation (RESEARCH Pattern 3)
  // passthrough is the authoritative contract chain: mux-webhook reads it to
  // route the UPDATE back to community_posts.id.
  try {
    const mux = getMux();
    const upload = await mux.video.uploads.create({
      cors_origin: req.headers.get('origin') ?? '*',
      new_asset_settings: {
        playback_policies: ['public'],
        max_duration_seconds: 300, // D-05: 5-min cap
        passthrough: JSON.stringify({ user_id: user.id, post_id: postId }),
      },
      timeout: 3600,
    });
    return jsonResponse(200, { url: upload.url, upload_id: upload.id });
  } catch (_e) {
    console.error('[mux-create-upload] Mux API error', _e instanceof Error ? _e.message : 'unknown');
    return jsonError(500, 'mux_error');
  }
}

// ============================================================================
// Deno.serve guard — prevents top-level serve trap in deno test
// (per reference_deno_test_top_level_serve_trap)
// Using import.meta.main ensures that `deno test` importing this module
// does NOT spawn a dangling HTTP server. denoGlobal?.serve check is kept as
// a secondary safety net for environments where Deno.serve may not exist.
// ============================================================================

// deno-lint-ignore no-explicit-any
const denoGlobal: any = (globalThis as any).Deno;
if (import.meta.main && denoGlobal?.serve) {
  denoGlobal.serve(handler);
}
