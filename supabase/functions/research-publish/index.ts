/**
 * research-publish/index.ts — Deno Edge Function entrypoint.
 *
 * Phase 62 Plan 03. Task 2. Wires Deno runtime + env vars to handler.ts.
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
 * Admin access gate: confirmed via is_staff() + publish_research SECDEF RPC.
 *
 * Deps injected into handleResearchPublish:
 *   - supabaseClient: service-role createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
 *   - sendSlackAlertFn: wrapper around Slack webhook
 *   - markdownRenderer: markdown-it render function (memoized at module load)
 *
 * CORS: admin browser calls this Fn directly via supabase.functions.invoke.
 *
 * NOT deployed in this plan — Plan 62-08 close-out runs:
 *   supabase functions deploy research-publish --project-ref ytnsipxxmzgaebkqmokp
 */

import { createClient } from 'npm:@supabase/supabase-js@2';
import { handleResearchPublish, type HandlerRequest } from './handler.ts';

// ──────────────────────────────────────────────────────────────────────────────
// CORS headers (admin browser → Edge Fn direct call via supabase.functions.invoke)
// ──────────────────────────────────────────────────────────────────────────────

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// ──────────────────────────────────────────────────────────────────────────────
// markdown-it renderer — memoized at module load (not per-request) for perf.
// Using dynamic import to keep this file importable without markdown-it at test time.
// ──────────────────────────────────────────────────────────────────────────────

let markdownRenderer: ((md: string) => string) | undefined;

async function getMarkdownRenderer(): Promise<(md: string) => string> {
  if (markdownRenderer) return markdownRenderer;
  const MarkdownIt = await import('npm:markdown-it@14').then((m) => m.default ?? m);
  const md = new MarkdownIt({ typographer: true, linkify: true, html: false });
  markdownRenderer = (text: string) => md.render(text);
  return markdownRenderer;
}

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
// Slack alert sender (wired from Deno.env)
// ──────────────────────────────────────────────────────────────────────────────

async function sendSlackAlert(
  level: 'P1' | 'P2' | 'P3',
  message: string,
  slackWebhookUrl?: string,
): Promise<void> {
  if (!slackWebhookUrl) return;
  try {
    await fetch(slackWebhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: `[${level}] research-publish: ${message}`,
      }),
    });
  } catch {
    // best-effort — do not let Slack failure block the response
  }
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
  // Pattern mirrors protocol-ai-assist/index.ts
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
    publication_id: typeof body.publication_id === 'string' ? body.publication_id : '',
    actor_id,
  };

  // ── Wire production deps ─────────────────────────────────────────────────────
  const serviceClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const slackWebhookUrl = Deno.env.get('SLACK_GUARDRAIL_WEBHOOK_URL');
  const renderer = await getMarkdownRenderer();

  const deps = {
    supabaseUrl,
    supabaseServiceKey: serviceRoleKey,
    slackWebhookUrl,
    supabaseClient: serviceClient,
    fetchImpl: fetch as HandlerDeps['fetchImpl'],
    sendSlackAlertFn: (level: 'P1' | 'P2' | 'P3', message: string) =>
      sendSlackAlert(level, message, slackWebhookUrl),
    markdownRenderer: renderer,
  };

  const result = await handleResearchPublish(handlerReq, deps);

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
