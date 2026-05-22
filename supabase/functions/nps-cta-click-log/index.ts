/**
 * Phase 36 Plan 36-02 REVIEW-04 — `nps-cta-click-log` Edge Function.
 *
 * POST /functions/v1/nps-cta-click-log
 *
 * Server-side log of an external CTA click. Closes Pitfall 10 — the
 * Surface B "click out to Trustpilot/G2/Capterra" flow is client-side
 * `window.open` with no Edge Fn hop, so PostHog's `external_review_clicked`
 * would never dual-write into events_mirror (the funnel-anomaly cron's
 * source of truth). This Fn fires captureServer({event, properties:{platform}})
 * BEFORE the client opens the external URL.
 *
 * Auth:
 *   Authorization: Bearer <user-jwt>   (user.id derived from JWT, T-36-12)
 *
 * Body:
 *   { platform: 'trustpilot' | 'g2' | 'capterra' }
 *
 * Response (204): No Content — fire-and-forget; client opens window.open in parallel.
 *
 * Error responses:
 *   401 unauthenticated — bearer missing or invalid
 *   400 invalid_platform — platform not in allow-list
 *   400 invalid_body — request body malformed
 *
 * Per project memory [[reference_deno_test_discovery]]: tests at index.test.ts.
 */
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { captureServer, shutdownPostHog } from '../_shared/posthog-server.ts';

// ============================================================================
// CORS + helpers
// ============================================================================

const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
};

function jsonError(status: number, code: string): Response {
  return new Response(JSON.stringify({ error: code }), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function jwtFromReq(req: Request): string | null {
  const h = req.headers.get('Authorization') ?? '';
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m ? (m[1] ?? null) : null;
}

const ALLOWED_PLATFORMS = ['trustpilot', 'g2', 'capterra'] as const;
type Platform = (typeof ALLOWED_PLATFORMS)[number];

function isPlatform(v: unknown): v is Platform {
  return typeof v === 'string' && (ALLOWED_PLATFORMS as readonly string[]).includes(v);
}

// ============================================================================
// Lazy admin singleton + test override
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
// captureServer seam (test-injectable)
// ============================================================================

type CaptureFn = (args: { event: string; userId: string; properties?: Record<string, unknown> }) => void;
let _capture: CaptureFn = captureServer;
function setCaptureForTest(fn: CaptureFn): void {
  _capture = fn;
}
function resetCaptureForTest(): void {
  _capture = captureServer;
}

// ============================================================================
// Core handler
// ============================================================================

async function handleClickLog(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return jsonError(405, 'method_not_allowed');
  }

  // 1. Bearer JWT (user.id is derived from JWT — T-36-12 PII discipline).
  const bearer = jwtFromReq(req);
  if (!bearer) return jsonError(401, 'unauthenticated');

  // 2. Validate JWT.
  let callerUid: string;
  try {
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const { data: userData, error: userErr } = (await ((admin.auth as any).getUser(bearer))) as {
      data: { user?: { id?: string } | null };
      error: { message?: string } | null;
    };
    /* eslint-enable @typescript-eslint/no-explicit-any */
    if (userErr || !userData?.user?.id) return jsonError(401, 'unauthenticated');
    callerUid = userData.user.id;
  } catch (_e) {
    return jsonError(401, 'unauthenticated');
  }

  // 3. Parse + validate platform.
  let body: { platform?: unknown };
  try {
    body = (await req.json()) as { platform?: unknown };
  } catch {
    return jsonError(400, 'invalid_body');
  }
  if (!isPlatform(body.platform)) {
    return jsonError(400, 'invalid_platform');
  }
  const platform = body.platform;

  try {
    // 4. Server-side capture — properties contain only the platform literal
    //    (T-36-12: NO rating, NO feedback text, NO PII).
    _capture({
      event: 'external_review_clicked',
      userId: callerUid,
      properties: { platform },
    });

    // 5. 204 No Content — fire-and-forget; client opens window.open in parallel.
    return new Response(null, { status: 204, headers: corsHeaders });
  } finally {
    // 6. Flush + shutdown — MUST in finally per Deno isolate teardown.
    await shutdownPostHog();
  }
}

// ============================================================================
// Deno.serve entrypoint
// ============================================================================

// deno-lint-ignore no-explicit-any
const denoGlobal: any = (globalThis as any).Deno;
if (denoGlobal?.serve) {
  denoGlobal.serve(handleClickLog);
}

// ============================================================================
// Test internals
// ============================================================================

export const __internal = {
  handleClickLog,
  setAdminForTest,
  resetAdminForTest,
  setCaptureForTest,
  resetCaptureForTest,
};
