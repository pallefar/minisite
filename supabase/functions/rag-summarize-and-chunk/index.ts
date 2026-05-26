/**
 * rag-summarize-and-chunk/index.ts — Edge Function entry point.
 *
 * Phase 60 Plan 60-04. AI-SPEC §3 entry point + §6 G1 PHARMA-02 + §7 PostHog events.
 *
 * Vendor: OpenRouter (override 2026-05-26) — see anthropic.ts for details.
 *
 * Accepts POST with {chunk_id?} or {topic_id?}.
 * GET /healthz returns {ok, openrouter: {ok, reason?}}.
 *
 * Pipeline (per chunk):
 *   1. Pre-call injection sentinel guard → reject if match
 *   2. Cost gate (gateOrThrow) → 429 if budget exceeded
 *   3. OpenRouter summarize → {summary, quote_blocks}
 *   4. Validate model response shape
 *   5. PHARMA-02 Layer 2 check → reject if dose quote on gated topic
 *   6. Persist summary + quote_blocks to rag_chunks
 *   7. Dual-emit cost telemetry (PostHog $ai_generation + rag_cost_ledger)
 *
 * Security: service-role bearer token required (T-60-04-05).
 * PHI boundary: this Fn processes external public content only, NOT user health data.
 *
 * import.meta.main guard per [[reference_deno_test_top_level_serve_trap]]:
 *   Deno.serve is guarded so that importing this module from tests does NOT
 *   trigger a port-bind / dangling promise.
 */

import { createClient } from 'npm:@supabase/supabase-js@2';
import { buildPrompt, containsInjectionSentinel, isValidSummaryResponse } from './prompt.ts';
import { AnthropicSummarizer, HAIKU_INPUT_USD_PER_TOKEN, HAIKU_OUTPUT_USD_PER_TOKEN, POSTHOG_MODEL } from './anthropic.ts';
import { assertNoPharma02DoseQuotes } from '../_shared/pharma-02-carveout.ts';
import { captureRagEvent, shutdownPostHog } from '../_shared/posthog-server.ts';
import { sendSlackGuardrailAlert } from '../_shared/slack-guardrail-alert.ts';
import { gateOrThrow, logVendorCost } from '../rag-scrape-runner/cost-ledger.ts';
import { captureException, addBreadcrumb } from '../_shared/sentry.ts';

// ──────────────────────────────────────────────────────────────────────────────
// Constants
// ──────────────────────────────────────────────────────────────────────────────

const FN_NAME = 'rag-summarize-and-chunk';

// ──────────────────────────────────────────────────────────────────────────────
// Supabase client factory (service-role)
// ──────────────────────────────────────────────────────────────────────────────

function makeServiceClient() {
  const url = Deno.env.get('SUPABASE_URL')!;
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

// ──────────────────────────────────────────────────────────────────────────────
// Sentinel: constant-time bearer token comparison
// ──────────────────────────────────────────────────────────────────────────────

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

// ──────────────────────────────────────────────────────────────────────────────
// Main handler (exported for tests — NOT wrapped in Deno.serve at module scope)
// ──────────────────────────────────────────────────────────────────────────────

export async function handler(req: Request): Promise<Response> {
  // Auth gate: service-role bearer required (T-60-04-05)
  const authHeader = req.headers.get('Authorization') ?? '';
  const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (serviceRoleKey && !constantTimeEqual(bearer, serviceRoleKey)) {
    return jsonResponse({ error: 'unauthorized' }, 401);
  }

  const url = new URL(req.url);

  // GET /healthz
  if (req.method === 'GET' && url.pathname.endsWith('/healthz')) {
    const summarizer = new AnthropicSummarizer();
    const check = await summarizer.healthCheck();
    return jsonResponse({ ok: check.ok, openrouter: check }, 200);
  }

  // POST — summarize chunks
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'method_not_allowed' }, 405);
  }

  let body: { chunk_id?: string; topic_id?: string };
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: 'invalid_json' }, 400);
  }

  if (!body.chunk_id && !body.topic_id) {
    return jsonResponse({ error: 'chunk_id_or_topic_id_required' }, 400);
  }

  const client = makeServiceClient();
  const summarizer = new AnthropicSummarizer();

  try {
    let chunks: Array<{
      id: string;
      topic_id: string;
      source_id: string;
      source_text_excerpt: string;
      canonical_url: string | null;
      scraped_at: string | null;
      topic_tag: string | null;
    }>;

    if (body.chunk_id) {
      const { data, error } = await client
        .from('rag_chunks')
        .select('id, topic_id, source_id, source_text_excerpt, canonical_url, scraped_at, topic_tag')
        .eq('id', body.chunk_id)
        .maybeSingle();

      if (error) {
        captureException(error, { tags: { fn: FN_NAME } });
        return jsonResponse({ error: 'database_error' }, 500);
      }
      if (!data) {
        return jsonResponse({ error: 'chunk_not_found' }, 404);
      }
      chunks = [data];
    } else {
      // topic_id mode: fetch all queued chunks without summary
      const { data, error } = await client
        .from('rag_chunks')
        .select('id, topic_id, source_id, source_text_excerpt, canonical_url, scraped_at, topic_tag')
        .eq('topic_id', body.topic_id!)
        .is('summary', null)
        .eq('status', 'queued')
        .limit(50);

      if (error) {
        captureException(error, { tags: { fn: FN_NAME } });
        return jsonResponse({ error: 'database_error' }, 500);
      }
      chunks = data ?? [];
    }

    const results: Array<{ id: string; status: string }> = [];

    for (const chunk of chunks) {
      try {
        await processChunk(client, summarizer, chunk);
        results.push({ id: chunk.id, status: 'processed' });
      } catch (err) {
        // Per-chunk failure does NOT abort siblings
        captureException(err, { tags: { fn: FN_NAME, chunk_id: chunk.id } });
        results.push({ id: chunk.id, status: 'error' });
      }
    }

    return jsonResponse({ ok: true, processed: results.length, results }, 200);
  } catch (err) {
    captureException(err, { tags: { fn: FN_NAME } });
    return jsonResponse({ error: 'internal_error' }, 500);
  } finally {
    await shutdownPostHog();
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// processChunk — main pipeline for a single rag_chunks row
// ──────────────────────────────────────────────────────────────────────────────

async function processChunk(
  client: ReturnType<typeof makeServiceClient>,
  summarizer: AnthropicSummarizer,
  chunk: {
    id: string;
    topic_id: string;
    source_id: string;
    source_text_excerpt: string;
    canonical_url: string | null;
    scraped_at: string | null;
    topic_tag: string | null;
  },
): Promise<void> {
  addBreadcrumb({ category: `${FN_NAME}.processChunk.start`, data: { chunk_id: chunk.id } });

  // ── Step 1: Pre-call injection sentinel guard ─────────────────────────────
  if (containsInjectionSentinel(chunk.source_text_excerpt)) {
    const sentinelMatched = detectSentinel(chunk.source_text_excerpt);

    await client
      .from('rag_chunks')
      .update({ status: 'rejected', reject_reason: 'safety-concern', reviewed_at: new Date().toISOString() })
      .eq('id', chunk.id);

    captureRagEvent({
      name: 'rag_prompt_injection_blocked',
      properties: { chunk_id: chunk.id, sentinel_matched: sentinelMatched, function: FN_NAME },
    });

    await sendSlackGuardrailAlert('rag', {
      severity: 'P2',
      title: 'Prompt injection sentinel blocked',
      text: `chunk_id=${chunk.id} sentinel=${sentinelMatched}`,
      fields: [{ title: 'function', value: FN_NAME, short: true }],
    });

    return;
  }

  // ── Step 2: Cost gate ─────────────────────────────────────────────────────
  try {
    await gateOrThrow(client, 'anthropic_summary');
  } catch {
    captureRagEvent({
      name: 'rag_cost_envelope_breach',
      properties: { fn: FN_NAME, vendor: 'anthropic_summary', chunk_id: chunk.id },
    });
    throw new Error('cost_budget_exceeded');
  }

  // ── Step 3: Summarize ─────────────────────────────────────────────────────
  const prompt = buildPrompt({
    markdown: chunk.source_text_excerpt,
    canonicalUrl: chunk.canonical_url ?? '',
    scrapedAt: chunk.scraped_at ?? new Date().toISOString(),
    sourceLanguage: undefined, // language detection is out-of-scope for this plan
  });

  const { json, inputTokens, outputTokens, model } = await summarizer.summarize(prompt);

  // ── Step 4: Validate model response ──────────────────────────────────────
  // Check for model-self-reported injection
  if (
    typeof json === 'object' &&
    json !== null &&
    'error' in (json as Record<string, unknown>) &&
    (json as Record<string, unknown>).error === 'prompt_injection_detected'
  ) {
    await client
      .from('rag_chunks')
      .update({ status: 'rejected', reject_reason: 'safety-concern', reviewed_at: new Date().toISOString() })
      .eq('id', chunk.id);

    captureRagEvent({
      name: 'rag_prompt_injection_blocked',
      properties: { chunk_id: chunk.id, sentinel_matched: 'model_self_report', function: FN_NAME },
    });

    await sendSlackGuardrailAlert('rag', {
      severity: 'P2',
      title: 'Model self-reported prompt injection',
      text: `chunk_id=${chunk.id} source=model_self_report`,
      fields: [{ title: 'function', value: FN_NAME, short: true }],
    });

    return;
  }

  // Low quality / unparseable
  if (!isValidSummaryResponse(json)) {
    await client
      .from('rag_chunks')
      .update({ status: 'rejected', reject_reason: 'low-quality', reviewed_at: new Date().toISOString() })
      .eq('id', chunk.id);
    return;
  }

  // ── Step 5: PHARMA-02 Layer 2 runtime helper ──────────────────────────────
  const guard = assertNoPharma02DoseQuotes(chunk.topic_tag, json.quote_blocks);

  if (!guard.ok) {
    await client
      .from('rag_chunks')
      .update({ status: 'rejected', reject_reason: 'safety-concern', reviewed_at: new Date().toISOString() })
      .eq('id', chunk.id);

    captureRagEvent({
      name: 'rag_pharma02_carveout_blocked',
      properties: {
        chunk_id: chunk.id,
        topic_tag: chunk.topic_tag,
        offending_quote_count: guard.offending.length,
        function: FN_NAME,
      },
    });

    await sendSlackGuardrailAlert('pharma02', {
      severity: 'P1',
      title: 'PHARMA-02 carveout blocked dose quote',
      text: `${guard.offending.length} dose quote(s) on gated topic_tag=${chunk.topic_tag ?? 'null'}`,
      fields: [
        { title: 'chunk_id', value: chunk.id, short: true },
        { title: 'function', value: FN_NAME, short: true },
      ],
    });

    return;
  }

  // ── Step 6: Persist ──────────────────────────────────────────────────────
  const { error: updateError } = await client
    .from('rag_chunks')
    .update({
      summary: json.summary,
      quote_blocks: json.quote_blocks,
    })
    .eq('id', chunk.id);

  if (updateError) {
    throw new Error(`Failed to update rag_chunks: ${updateError.message}`);
  }

  // ── Step 7: Dual-emit cost telemetry ──────────────────────────────────────
  const usd = inputTokens * HAIKU_INPUT_USD_PER_TOKEN + outputTokens * HAIKU_OUTPUT_USD_PER_TOKEN;

  await logVendorCost(client, {
    vendor: 'anthropic_summary',
    amountUsd: usd,
    topicId: chunk.topic_id,
    sourceId: chunk.source_id,
    action: 'summarize',
  });

  captureRagEvent({
    name: '$ai_generation',
    properties: {
      function: FN_NAME,
      model,
      prompt_tokens: inputTokens,
      completion_tokens: outputTokens,
      usage_total_cost: usd,
      chunk_id: chunk.id,
      topic_tag: chunk.topic_tag,
    },
  });
}

// ──────────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────────

function detectSentinel(text: string): string {
  const upper = text.toUpperCase();
  const sentinels = [
    'IGNORE INSTRUCTIONS',
    'IGNORE ALL PREVIOUS',
    'YOU ARE NOW',
    'SYSTEM:',
    'OVERRIDE:',
  ];
  for (const s of sentinels) {
    if (upper.includes(s)) return s;
  }
  return 'unknown';
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// ──────────────────────────────────────────────────────────────────────────────
// Deno.serve guard — import.meta.main prevents port-bind on test import
// [[reference_deno_test_top_level_serve_trap]]
// ──────────────────────────────────────────────────────────────────────────────

if (import.meta.main) {
  Deno.serve(handler);
}
