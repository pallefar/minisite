/**
 * Phase 39 Plan 39-03 — `slack-alert-experiments` Edge Function.
 *
 * POST /functions/v1/slack-alert-experiments
 *
 * Single Slack channel (#growth-experiments per D-04) fan-out endpoint for
 * variant kill / ship-winner / 42-day archive / NPS-1★ kill events. Called by
 * pg_cron kill-scan SQL functions via net.http_post AND by admin RPCs via
 * supabase.functions.invoke.
 *
 * Auth:
 *   Authorization: Bearer <service-role-key>   (constantTimeEqual against
 *   SUPABASE_SERVICE_ROLE_KEY — sb_secret_* format per memory
 *   reference_supabase_service_role_key_format_divergence)
 *
 * Body:
 *   {
 *     kind: 'variant_kill' | 'ship_winner' | 'archive_42d' | 'archive_warn_35d'
 *         | 'nps_kill' | 'refund_kill',
 *     variant_id: string,
 *     message: string,
 *     context?: Record<string, unknown>
 *   }
 *
 * Response:
 *   200 { ok: true }                        — Slack returned 2xx
 *   401 { error: 'unauthenticated' }        — bearer missing or wrong
 *   400 { error: 'invalid_body' }           — kind/variant_id/message invalid
 *   502 { error: 'slack_upstream', status } — Slack returned non-2xx
 *   503 { error: 'vendor_unconfigured', service: 'slack' }
 *                                            — SLACK_WEBHOOK_EXPERIMENTS_URL unset
 *
 * Outbound semantics: this Fn is called from pg_cron via net.http_post which
 * is async (pg_cron does not await). If Slack flaps, alerts are silently
 * dropped — operator detects via Sentry dashboard. Documented in threat
 * register T-39-03-05 (accept residual).
 *
 * No PostHog usage here — pure outbound webhook. No try/finally needed.
 */

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
  const h = req.headers.get('Authorization') ?? '';
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m ? (m[1] ?? null) : null;
}

// ============================================================================
// Constant-time string compare (mitigates timing-attack against bearer match)
// ============================================================================

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

// ============================================================================
// Body validation
// ============================================================================

const KIND_LITERALS = new Set([
  'variant_kill',
  'ship_winner',
  'archive_42d',
  'archive_warn_35d',
  'nps_kill',
  'refund_kill',
]);

interface AlertBody {
  kind: string;
  variant_id: string;
  message: string;
  context?: Record<string, unknown>;
}

function parseBody(raw: unknown): { ok: true; body: AlertBody } | { ok: false; code: string } {
  if (typeof raw !== 'object' || raw === null) return { ok: false, code: 'invalid_body' };
  const r = raw as Record<string, unknown>;
  if (typeof r.kind !== 'string' || !KIND_LITERALS.has(r.kind)) {
    return { ok: false, code: 'invalid_body' };
  }
  if (typeof r.variant_id !== 'string' || r.variant_id.length === 0 || r.variant_id.length > 64) {
    return { ok: false, code: 'invalid_body' };
  }
  if (typeof r.message !== 'string' || r.message.length === 0 || r.message.length > 2000) {
    return { ok: false, code: 'invalid_body' };
  }
  const out: AlertBody = { kind: r.kind, variant_id: r.variant_id, message: r.message };
  if (typeof r.context === 'object' && r.context !== null) {
    out.context = r.context as Record<string, unknown>;
  }
  return { ok: true, body: out };
}

// ============================================================================
// Core handler
// ============================================================================

async function handleSlackAlert(req: Request): Promise<Response> {
  // CORS preflight.
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return jsonError(405, 'method_not_allowed');
  }

  // Vendor health check — short-circuit BEFORE any outbound traffic.
  const webhook = Deno.env.get('SLACK_WEBHOOK_EXPERIMENTS_URL');
  if (!webhook) {
    console.warn(
      '[slack-alert-experiments] vendor_unconfigured: SLACK_WEBHOOK_EXPERIMENTS_URL unset — alert dropped.',
    );
    return jsonResponse(503, { error: 'vendor_unconfigured', service: 'slack' });
  }

  // Service-role bearer gate (sb_secret_* per memory reference).
  const bearer = jwtFromReq(req);
  if (!bearer) return jsonError(401, 'unauthenticated');
  const expected = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (expected.length === 0 || !constantTimeEqual(bearer, expected)) {
    return jsonError(401, 'unauthenticated');
  }

  // Body validation.
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return jsonError(400, 'invalid_body');
  }
  const parsed = parseBody(raw);
  if (!parsed.ok) return jsonError(400, parsed.code);
  const { kind, variant_id, message, context } = parsed.body;

  // Build Slack payload — simple text block formatting.
  const text = `[${kind}] variant=${variant_id} — ${message}`;
  const slackPayload: Record<string, unknown> = { text };
  if (context && Object.keys(context).length > 0) {
    slackPayload.attachments = [
      {
        color: kind === 'ship_winner' ? '#36a64f' : '#cc4b3f',
        text: '```' + JSON.stringify(context, null, 2) + '```',
        mrkdwn_in: ['text'],
      },
    ];
  }

  // 5-second outbound timeout (AbortController).
  const ac = new AbortController();
  const timeoutId = setTimeout(() => ac.abort(), 5000);
  let slackRes: Response;
  try {
    slackRes = await fetch(webhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(slackPayload),
      signal: ac.signal,
    });
  } catch (err) {
    clearTimeout(timeoutId);
    console.error('[slack-alert-experiments] outbound fetch threw:', (err as Error).message);
    return jsonResponse(502, { error: 'slack_upstream', status: 0 });
  }
  clearTimeout(timeoutId);

  if (!slackRes.ok) {
    const status = slackRes.status;
    const body = await slackRes.text().catch(() => '');
    console.error('[slack-alert-experiments] Slack non-2xx:', status, body);
    return jsonResponse(502, { error: 'slack_upstream', status });
  }

  return jsonResponse(200, { ok: true });
}

// ============================================================================
// Deno.serve entrypoint (guarded so test imports do not start a server)
// ============================================================================

// deno-lint-ignore no-explicit-any
const denoGlobal: any = (globalThis as any).Deno;
if (denoGlobal?.serve && import.meta.main) {
  denoGlobal.serve(handleSlackAlert);
}

// ============================================================================
// Test internals
// ============================================================================

export const __internal = {
  handleSlackAlert,
  parseBody,
  constantTimeEqual,
};
