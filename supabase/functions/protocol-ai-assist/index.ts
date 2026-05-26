/**
 * protocol-ai-assist/index.ts — Deno Edge Function entrypoint.
 *
 * Phase 61 Plan 03. Wires Deno runtime + env vars to handler.ts.
 *
 * Handler is in handler.ts for Vitest unit-testability — this file MUST NOT
 * be imported by tests (contains Deno.serve at module level when run as main).
 *
 * `if (import.meta.main) Deno.serve(...)` guard per [[reference_deno_test_top_level_serve_trap]]:
 * Without this guard, `deno test path/` triggers a real HTTP server on import
 * → dangling promise → all tests abort. Guard ensures Deno.serve only fires
 * when invoked as the main module (not during test discovery).
 *
 * Auth: Bearer JWT from admin browser → extract actor_id via admin.auth.getUser(jwt).
 * Admin access gate: confirmed via profiles.is_staff OR Supabase admin role.
 *
 * Deps injected into handleAiAssist:
 *   - supabaseClient: service-role createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
 *   - fetchImpl: global fetch
 *   - ragRetrieve: retrieveRagChunks from _shared/rag-retrieve.ts
 *   - emitAiGenerationFn: emitAiGeneration from _shared/posthog-rag-events.ts
 *   - sendSlackAlertFn: sendSlackGuardrailAlert from _shared/slack-guardrail-alert.ts
 *   - isPharma02GatedTopicFn: isPharma02GatedTopic from _shared/pharma-02-carveout.ts
 *
 * CORS: admin browser calls this Fn directly via supabase.functions.invoke.
 *
 * NOT deployed in this plan — Plan 08 close-out runs:
 *   supabase functions deploy protocol-ai-assist --project-ref ytnsipxxmzgaebkqmokp
 */

import { createClient } from 'npm:@supabase/supabase-js@2';
import { retrieveRagChunks } from '../_shared/rag-retrieve.ts';
import { emitAiGeneration } from '../_shared/posthog-rag-events.ts';
import { sendSlackGuardrailAlert } from '../_shared/slack-guardrail-alert.ts';
import { isPharma02GatedTopic } from '../_shared/pharma-02-carveout.ts';
import { handleAiAssist, type HandlerRequest } from './handler.ts';

// ──────────────────────────────────────────────────────────────────────────────
// CORS headers (admin browser → Edge Fn direct call via supabase.functions.invoke)
// ──────────────────────────────────────────────────────────────────────────────

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// ──────────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────────

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...CORS_HEADERS,
    },
  });
}

// ──────────────────────────────────────────────────────────────────────────────
// Request handler
// ──────────────────────────────────────────────────────────────────────────────

async function serveHandler(req: Request): Promise<Response> {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: CORS_HEADERS });
  }

  if (req.method !== 'POST') {
    return jsonResponse(405, { error: 'method_not_allowed' });
  }

  // ── Extract actor_id from Authorization Bearer JWT ──────────────────────────
  // Pattern mirrors push-subscribe/index.ts and notification-snooze/index.ts
  const authHeader = req.headers.get('authorization') ?? '';
  const jwt = authHeader.replace(/^bearer\s+/i, '');

  if (!jwt) {
    return jsonResponse(401, { error: 'unauthenticated' });
  }

  // Use a Supabase admin client to verify JWT and extract user.id
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: userData, error: userErr } = (await ((admin.auth as any).getUser(jwt))) as {
    data: { user?: { id?: string } | null };
    error: { message?: string } | null;
  };

  if (userErr || !userData?.user?.id) {
    return jsonResponse(401, { error: 'unauthenticated' });
  }

  const actor_id = userData.user.id;

  // ── Parse request body ──────────────────────────────────────────────────────
  let body: Record<string, unknown>;
  try {
    body = await req.json() as Record<string, unknown>;
  } catch {
    return jsonResponse(400, { error: 'invalid_json' });
  }

  const handlerReq: HandlerRequest = {
    protocol_id: typeof body.protocol_id === 'string' ? body.protocol_id : null,
    step_week: Number(body.step_week ?? 0),
    compound: String(body.compound ?? '').trim(),
    prior_steps_context: typeof body.prior_steps_context === 'string' ? body.prior_steps_context : '[]',
    actor_id,
  };

  if (!handlerReq.compound) {
    return jsonResponse(400, { error: 'compound is required' });
  }

  // ── Wire production deps ─────────────────────────────────────────────────────
  const serviceClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const deps = {
    openrouterApiKey: Deno.env.get('OPENROUTER_API_KEY') ?? '',
    supabaseUrl,
    supabaseServiceKey: serviceRoleKey,
    posthogKey: Deno.env.get('POSTHOG_PROJECT_KEY'),
    slackWebhookUrl: Deno.env.get('SLACK_GUARDRAIL_WEBHOOK_URL'),
    supabaseClient: serviceClient,
    fetchImpl: fetch as HandlerDeps['fetchImpl'],
    ragRetrieve: retrieveRagChunks,
    emitAiGenerationFn: emitAiGeneration,
    sendSlackAlertFn: sendSlackGuardrailAlert,
    isPharma02GatedTopicFn: isPharma02GatedTopic,
  };

  const result = await handleAiAssist(handlerReq, deps);

  return jsonResponse(result.status, result.body);
}

// ──────────────────────────────────────────────────────────────────────────────
// Entrypoint — import.meta.main guard per [[reference_deno_test_top_level_serve_trap]]
// Without this guard, `deno test` triggers a real HTTP server on import.
// ──────────────────────────────────────────────────────────────────────────────

if (import.meta.main) {
  Deno.serve(serveHandler);
}

export { serveHandler };

// Type import for TypeScript correctness
type HandlerDeps = import('./handler.ts').HandlerDeps;
