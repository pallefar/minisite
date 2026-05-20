/**
 * Phase 34 Plan 34-03 (ONBOARD-05/06) — `record-activation` Edge Function.
 *
 * POST /functions/v1/record-activation
 *
 * Auth:
 *   Authorization: Bearer <user-jwt>
 *
 * Body:
 *   { goal_type: <8-enum>, action_type: string }
 *
 * Responses (always 200 for non-error paths — see D-04 fire-once semantics):
 *   - 200 { activated: true, days_since_signup }  → first qualifying action within 7-day window
 *   - 200 { already_activated: true }             → re-invocation post-activation (NO PostHog capture)
 *   - 200 { skipped: true, reason: 'outside_window' } → signup > 7 days ago (NO row insert, NO capture)
 *   - 400 { error: 'invalid_body' }               → missing/invalid goal_type or action_type
 *   - 401 { error: 'unauthenticated' }            → missing/invalid Authorization
 *   - 500 { error: 'profile_missing' | 'db_error' } → unrecoverable
 *
 * Architecture invariants:
 *   1. Fire-once per user (D-04 + D-15) — guarded by `record_activation_event` SECDEF RPC
 *      using `pg_advisory_xact_lock(hashtext('record_activation:' || user_id))` + activated_at check.
 *      Concurrent invocations race-safe: only ONE captureServer fires.
 *   2. 7-day window (D-02) — `days_since_signup = floor((now - profiles.created_at) / 86400)`.
 *      Outside window → skipped, no DB write, no event.
 *   3. server_only event per D-05 — client must NEVER emit `activation_completed`; only this Fn does.
 *   4. shutdownPostHog() in `finally` per PITFALL 1 — events.batch dropped if Deno isolate exits early.
 *   5. Phase38Event union widened in SAME plan as this Fn (memory feedback_planner_missed_status_enum_widening).
 *
 * Threat-model (34-03-PLAN.md <threat_model>):
 *   - T-34-03-01 Tampering: zod BodySchema; days_since_signup server-computed (never trust client).
 *   - T-34-03-02 EoP replay: SECDEF + advisory lock.
 *   - T-34-03-03 InfoDisclosure: server_only event; payload PHI-free.
 *   - T-34-03-04 Spoofing: admin.auth.getUser() verifies JWT signature.
 *   - T-34-03-06 DoS / dropped events: try/finally + shutdownPostHog.
 *
 * Internals (`__internal`) exported for Deno test suite.
 */

import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { captureServer, shutdownPostHog } from '../_shared/posthog-server.ts';

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

function jwtFromReq(req: Request): string | null {
  const h = req.headers.get('authorization') ?? req.headers.get('Authorization') ?? '';
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m ? (m[1] ?? null) : null;
}

// ============================================================================
// Lazy admin singleton + test seams
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

// deno-lint-ignore no-explicit-any
function admin(): any {
  return _adminOverride ?? getAdmin();
}

// ============================================================================
// Capture / shutdown test seams (Pattern 2 — try/finally with spy hooks)
// ============================================================================

type CaptureFn = (args: { userId: string; event: string; properties: Record<string, unknown> }) => void;
type ShutdownFn = () => void | Promise<void>;

let _captureOverride: CaptureFn | null = null;
let _shutdownOverride: ShutdownFn | null = null;

function setCaptureSpyForTest(fn: CaptureFn): void {
  _captureOverride = fn;
}
function setShutdownSpyForTest(fn: ShutdownFn): void {
  _shutdownOverride = fn;
}

function doCapture(args: { userId: string; event: 'activation_completed'; properties: Record<string, unknown> }): void {
  if (_captureOverride) {
    _captureOverride(args);
    return;
  }
  // Real path — uses the Phase38Event-typed captureServer.
  captureServer(args);
}

async function doShutdown(): Promise<void> {
  if (_shutdownOverride) {
    await _shutdownOverride();
    return;
  }
  await shutdownPostHog();
}

// ============================================================================
// Body validation (zod-free — keep cold-start lean; the 8-enum + string check
// is small enough to inline. Matches the schema in events.ts:activation_completed).
// ============================================================================

const VALID_GOAL_TYPES: ReadonlyArray<string> = [
  'lose-weight',
  'build-muscle',
  'new-prescription',
  'build-habit',
  'doctor-monitored',
  'family-supporter',
  'manage-symptoms',
  'track-with-vial-supply',
];

interface ParsedBody {
  goal_type: string;
  action_type: string;
}

function parseBody(raw: unknown): { ok: true; body: ParsedBody } | { ok: false } {
  if (typeof raw !== 'object' || raw === null) return { ok: false };
  const r = raw as Record<string, unknown>;
  if (typeof r.goal_type !== 'string' || !VALID_GOAL_TYPES.includes(r.goal_type)) {
    return { ok: false };
  }
  if (typeof r.action_type !== 'string' || r.action_type.length < 1) {
    return { ok: false };
  }
  return { ok: true, body: { goal_type: r.goal_type, action_type: r.action_type } };
}

// ============================================================================
// Core handler
// ============================================================================

async function handleRecordActivation(req: Request): Promise<Response> {
  // CORS preflight — never wraps shutdownPostHog because no capture happens.
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  try {
    if (req.method !== 'POST') {
      return jsonError(405, 'method_not_allowed');
    }

    // 1. Auth — verify Bearer JWT.
    const bearer = jwtFromReq(req);
    if (!bearer) return jsonError(401, 'unauthenticated');

    /* eslint-disable @typescript-eslint/no-explicit-any */
    const { data: userRes, error: authErr } = (await (admin().auth as any).getUser(bearer)) as {
      data: { user?: { id?: string } | null };
      error: { message?: string } | null;
    };
    /* eslint-enable @typescript-eslint/no-explicit-any */
    if (authErr || !userRes?.user?.id) return jsonError(401, 'unauthenticated');
    const userId = userRes.user.id;

    // 2. Validate body.
    let raw: unknown;
    try {
      raw = await req.json();
    } catch {
      return jsonError(400, 'invalid_body');
    }
    const parsed = parseBody(raw);
    if (!parsed.ok) return jsonError(400, 'invalid_body');
    const { goal_type, action_type } = parsed.body;

    // 3. Compute days_since_signup from profiles.created_at (server-authoritative — never from body).
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const { data: signupRow, error: signupErr } = (await admin()
      .from('profiles')
      .select('created_at')
      .eq('id', userId)
      .maybeSingle()) as {
      data: { created_at?: string } | null;
      error: { message?: string } | null;
    };
    /* eslint-enable @typescript-eslint/no-explicit-any */
    if (signupErr) return jsonError(500, 'db_error');
    if (!signupRow?.created_at) return jsonError(500, 'profile_missing');

    const daysSinceSignup = Math.floor(
      (Date.now() - new Date(signupRow.created_at).getTime()) / 86400000,
    );

    // 4. 7-day window guard (D-02).
    if (daysSinceSignup > 7) {
      return jsonResponse(200, { skipped: true, reason: 'outside_window' });
    }

    // 5. SECDEF RPC — atomic advisory_xact_lock + activated_at check + UPSERT.
    //    Per memory feedback_state_counter_table_needs_upsert_on_event: UPSERT, not bare UPDATE.
    //    Per memory feedback_planner_iter1_anti_patterns: no defensive jsonb — typed contract.
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const { data: rpcData, error: rpcErr } = (await (admin() as any).rpc('record_activation_event', {
      p_user_id: userId,
      p_goal_type: goal_type,
      p_action: action_type,
      p_days: daysSinceSignup,
    })) as {
      data:
        | { did_fire?: boolean; reason?: string; days_since_signup?: number }
        | null;
      error: { message?: string } | null;
    };
    /* eslint-enable @typescript-eslint/no-explicit-any */
    if (rpcErr) return jsonError(500, 'db_error');

    const didFire = rpcData?.did_fire === true;
    if (!didFire) {
      // RPC saw activated_at IS NOT NULL inside the advisory lock — fire-once won.
      return jsonResponse(200, { already_activated: true });
    }

    // 6. Fire server-side PostHog event (Phase38Event 'activation_completed').
    //    Payload contract mirrors EVENTS.activation_completed.payload exactly.
    doCapture({
      userId,
      event: 'activation_completed',
      properties: {
        goal_type,
        action_type,
        window_days: 7,
        days_since_signup: daysSinceSignup,
        source: 'first_log',
      },
    });

    return jsonResponse(200, { activated: true, days_since_signup: daysSinceSignup });
  } finally {
    // PITFALL 1: always flush PostHog batch before isolate teardown,
    // even on error paths (auth, validation, RPC failure).
    try {
      await doShutdown();
    } catch (e) {
      console.error('[record-activation] shutdown failed', e);
    }
  }
}

// ============================================================================
// Deno.serve entrypoint
// ============================================================================

// deno-lint-ignore no-explicit-any
const denoGlobal: any = (globalThis as any).Deno;
if (denoGlobal?.serve) {
  denoGlobal.serve(handleRecordActivation);
}

// ============================================================================
// Test internals
// ============================================================================

export const __internal = {
  handleRecordActivation,
  setAdminForTest,
  resetAdminForTest,
  setCaptureSpyForTest,
  setShutdownSpyForTest,
  parseBody,
  VALID_GOAL_TYPES,
};
