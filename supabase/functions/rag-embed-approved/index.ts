/**
 * rag-embed-approved/index.ts — Deno Edge Function entry point.
 *
 * Phase 60 Plan 60-05.
 *
 * Wires production dependencies and starts Deno.serve.
 * Handler logic lives in handler.ts for testability (dependency-injected).
 *
 * Env vars:
 *   OPENROUTER_API_KEY         — required (embed calls via OpenRouter)
 *   SUPABASE_URL               — required
 *   SUPABASE_SERVICE_ROLE_KEY  — required (bypasses RLS for curation writes)
 *   POSTHOG_PROJECT_KEY        — optional (telemetry no-op if absent)
 *   RAG_PER_BATCH_BUDGET_USD   — optional, default 0.05
 *   RAG_DAILY_BUDGET_USD       — optional, default 50
 *
 * NO cron schedule — cron registration is owned by 60-15.
 * Deno.serve guarded by import.meta.main per [[reference_deno_test_top_level_serve_trap]].
 */

import { createClient } from 'npm:@supabase/supabase-js@2';
import { OpenAIEmbedBatchClient } from './openai.ts';
import { handleRequest, EMBED_MODEL } from './handler.ts';
import type { HandlerDeps } from './handler.ts';
import {
  emitAiGeneration as _emitAiGeneration,
  emitCostEnvelopeBreach as _emitCostEnvelopeBreach,
  shutdownPostHog,
} from '../_shared/posthog-rag-events.ts';
import { sendSlackGuardrailAlert } from '../_shared/slack-guardrail-alert.ts';

export { handleRequest } from './handler.ts';
export type { HandlerDeps } from './handler.ts';

const SYSTEM_USER_ID = 'rag-system';

function buildProdDeps(): HandlerDeps {
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  const embedClient = new OpenAIEmbedBatchClient();

  return {
    supabase: supabase as unknown as HandlerDeps['supabase'],
    embedClient,
    emitAiGeneration: (args) => {
      _emitAiGeneration({
        userId: SYSTEM_USER_ID,
        properties: {
          model: args.model,
          vendor: 'openai_embed',  // required by cost dashboard HogQL vendor filter
          prompt_tokens: args.inputTokens,
          usage_total_cost: args.costUsd,
          latency_ms: args.latencyMs,
          trace_id: crypto.randomUUID(),
        },
      });
    },
    emitRagCostEnvelopeBreach: (args) => {
      _emitCostEnvelopeBreach({
        properties: {
          scope: args.scope,
          cron_kind: args.cron_kind as 'tip_of_day' | 'newsletter' | 'federated_sync' | undefined,
          cost_usd: args.cost_usd,
          envelope_usd: args.envelope_usd,
          trace_id: args.trace_id,
        },
      });
    },
    alertSlack: (message, _severity) => {
      void sendSlackGuardrailAlert('cost', {
        severity: 'P2',
        title: 'RAG embed cost alert',
        text: message,
      });
    },
    now: () => Date.now(),
    env: {
      RAG_PER_BATCH_BUDGET_USD: Deno.env.get('RAG_PER_BATCH_BUDGET_USD'),
      RAG_DAILY_BUDGET_USD: Deno.env.get('RAG_DAILY_BUDGET_USD'),
    },
  };

  void EMBED_MODEL; // referenced for tree-shake safety
}

// ── Entry point — ONLY bound when run as entrypoint ──────────────────────────
// Per [[reference_deno_test_top_level_serve_trap]]: Deno.serve() is called
// ONLY when this file is the entry point (import.meta.main === true), never
// at import time.
if (import.meta.main) {
  const prodDeps = buildProdDeps();
  Deno.serve(async (req: Request): Promise<Response> => {
    try {
      return await handleRequest(req, prodDeps);
    } finally {
      await shutdownPostHog();
    }
  });
}
