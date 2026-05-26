/**
 * rag-tip-of-day-generate/index.ts — Edge Function entry point.
 *
 * Phase 60 Plan 60-11 Task 4. OpenRouter override (2026-05-26).
 *
 * Per-user daily tip generation pipeline:
 *   1. Auth gate (service-role bearer only)
 *   2. Parse + validate body { user_id, date_utc, reroll? }
 *   3. Idempotency check (SKIP if row already exists for user/date, unless reroll=true)
 *   4. Cost gate (gateOrThrow BEFORE OpenRouter call — T-60-11-06)
 *   5. Load user profile (drug, active_themes)
 *   6. ragRetrieve (shared helper — applies tier-A boost + rerank + k≥5 floor from 60-06)
 *   7. k-anon floor assertion (leanshot_research/community cohort_n ≥ 5)
 *   8. PHARMA-02 gate (isPharma02GatedTopic — Layer 2 of 3-layer invariant)
 *   9. Build prompts; call OpenRouter Haiku via native fetch
 *   10. Push payload validation (prescriptive-verb/equivalence/dose gates)
 *   11. INSERT via SECDEF write_kb_tip_of_day RPC
 *   12. Invoke push-dispatch (research_tips category, Phase 54 freq-cap honored)
 *   13. Update push_dispatched_at (best-effort)
 *
 * Vendor: OpenRouter (https://openrouter.ai/api/v1/chat/completions)
 *   Auth: Authorization: Bearer ${OPENROUTER_API_KEY}
 *   Model: anthropic/claude-haiku-4.5 (OpenRouter dotted convention)
 *   Required headers: HTTP-Referer: https://leanshot.app, X-Title: LeanShot
 *   Response: OpenAI shape (data.choices[0].message.content + data.usage)
 *
 * Security:
 *   - Service-role bearer only (constant-time compare)
 *   - AI-04 fence in user prompt (user_drug + active_themes in <user_data>)
 *   - k-anon floor on leanshot_research/community chunks
 *   - PHARMA-02 layer 2 runtime check
 *   - push-payload layer 3 grep gates
 *
 * import.meta.main guard per [[reference_deno_test_top_level_serve_trap]]:
 *   Deno.serve is guarded so importing this module from tests does NOT bind a port.
 *
 * PostHog model field: 'openrouter/anthropic/claude-haiku-4.5'
 * COST_VENDOR: 'anthropic_tip_of_day' (semantic vendor tag for cost-ledger)
 */

import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { retrieveRagChunks, type RagRetrievedChunk } from '../_shared/rag-retrieve.ts';
import { emitAiGeneration, emitRefusalEmitted } from '../_shared/posthog-rag-events.ts';
import { sendSlackGuardrailAlert } from '../_shared/slack-guardrail-alert.ts';
import { isPharma02GatedTopic } from '../_shared/pharma-02-carveout.ts';
import { gateOrThrow, logVendorCost } from '../rag-scrape-runner/cost-ledger.ts';
import { buildTipSystemPrompt, buildTipUserPrompt } from './prompt.ts';
import { buildPushPayload, TipPayloadRejected } from './push-payload.ts';

// ──────────────────────────────────────────────────────────────────────────────
// Constants
// ──────────────────────────────────────────────────────────────────────────────

/** OpenRouter model ID (dotted convention — NOT hyphenated direct-Anthropic rule). */
const SYNTH_MODEL = 'anthropic/claude-haiku-4.5';

/** PostHog model field for $ai_generation events. */
const POSTHOG_MODEL = 'openrouter/anthropic/claude-haiku-4.5';

/** Cost-ledger semantic vendor tag. */
const COST_VENDOR = 'anthropic_tip_of_day';

/** Estimated cost per generation (Haiku ~$0.005/run target per AI-SPEC §4). */
const ESTIMATED_COST_USD = 0.005;

/** K-anon floor — matches rag-retrieve 60-06 G8 invariant. */
const KANON_FLOOR = 5;

// ──────────────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────────────

export interface TipDeps {
  supabase: SupabaseClient;
  ragRetrieve: typeof retrieveRagChunks;
  openrouterGenerate: (opts: { systemPrompt: string; userPrompt: string }) => Promise<{ text: string; usage: { prompt_tokens: number; completion_tokens: number } }>;
  gateOrThrow: (client: SupabaseClient, vendor: string) => Promise<void>;
  emitAiGeneration: typeof emitAiGeneration;
  emitRefusalEmitted: typeof emitRefusalEmitted;
  emitTipImpression: (args: { user_id: string; chunk_id: string; topic_tag: string; source_tier: string }) => Promise<void>;
  logVendorCost: typeof logVendorCost;
  sendSlackGuardrailAlert: typeof sendSlackGuardrailAlert;
  isPharma02Gated: (chunk: { topic_tag: string }) => boolean;
  now: Date;
}

// ──────────────────────────────────────────────────────────────────────────────
// Auth helper
// ──────────────────────────────────────────────────────────────────────────────

function constantTimeEqual(a: string, b: string): boolean {
  const len = b.length;
  let diff = 0;
  for (let i = 0; i < len; i++) {
    diff |= (a.charCodeAt(i) ?? 0) ^ b.charCodeAt(i);
  }
  diff |= a.length ^ b.length;
  return diff === 0;
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// ──────────────────────────────────────────────────────────────────────────────
// OpenRouter call (native fetch, OpenAI-compatible)
// ──────────────────────────────────────────────────────────────────────────────

async function callOpenRouter(opts: {
  systemPrompt: string;
  userPrompt: string;
}): Promise<{ text: string; usage: { prompt_tokens: number; completion_tokens: number } }> {
  const apiKey = Deno.env.get('OPENROUTER_API_KEY') ?? '';
  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
      'HTTP-Referer': 'https://leanshot.app',
      'X-Title': 'LeanShot',
    },
    body: JSON.stringify({
      model: SYNTH_MODEL,
      messages: [
        { role: 'system', content: opts.systemPrompt },
        { role: 'user', content: opts.userPrompt },
      ],
      max_tokens: 200,
      temperature: 0.1,
    }),
    signal: AbortSignal.timeout(15_000),
  });

  if (!response.ok) {
    throw new Error(`OpenRouter error: ${response.status}`);
  }

  const data = await response.json();
  const text = data.choices?.[0]?.message?.content ?? '';
  const usage = {
    prompt_tokens: data.usage?.prompt_tokens ?? 0,
    completion_tokens: data.usage?.completion_tokens ?? 0,
  };

  return { text, usage };
}

// ──────────────────────────────────────────────────────────────────────────────
// Production deps factory
// ──────────────────────────────────────────────────────────────────────────────

function getProductionDeps(): TipDeps {
  const url = Deno.env.get('SUPABASE_URL')!;
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  return {
    supabase,
    ragRetrieve: retrieveRagChunks,
    openrouterGenerate: callOpenRouter,
    gateOrThrow,
    emitAiGeneration,
    emitRefusalEmitted,
    emitTipImpression: async (args) => {
      // Server-side impression via captureServer (ad-block immune per 50-08 pattern)
      // Best-effort — failure does not block tip generation
      try {
        await supabase.functions.invoke('server-rag-event-relay', {
          body: {
            event: 'rag_tip_impression',
            properties: {
              chunk_id: args.chunk_id,
              topic_tag: args.topic_tag,
              source_tier: args.source_tier,
              surface: 'home_bento',
            },
            distinct_id: args.user_id,
          },
        });
      } catch {
        // best-effort
      }
    },
    logVendorCost,
    sendSlackGuardrailAlert,
    isPharma02Gated: (chunk) => isPharma02GatedTopic(chunk.topic_tag),
    now: new Date(),
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// Main handler (exported for dependency-injection testing)
// ──────────────────────────────────────────────────────────────────────────────

export async function handler(req: Request, deps: TipDeps): Promise<Response> {
  // ── Auth gate ──────────────────────────────────────────────────────────────
  const authHeader = req.headers.get('Authorization') ?? '';
  const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (serviceRoleKey && !constantTimeEqual(bearer, serviceRoleKey)) {
    return jsonResponse(401, { error: 'unauthorized' });
  }

  // ── Parse body ─────────────────────────────────────────────────────────────
  let body: { user_id: string; date_utc: string; reroll?: boolean };
  try {
    body = await req.json();
  } catch {
    return jsonResponse(400, { error: 'invalid_json' });
  }

  const { user_id, date_utc, reroll = false } = body;

  if (!user_id || !date_utc) {
    return jsonResponse(400, { error: 'missing_required_fields' });
  }

  // ── Idempotency short-circuit ──────────────────────────────────────────────
  if (!reroll) {
    const { data: existing } = await deps.supabase
      .from('kb_tip_of_day')
      .select('id')
      .eq('user_id', user_id)
      .eq('date_utc', date_utc)
      .limit(1)
      .maybeSingle();

    if (existing) {
      return jsonResponse(200, { wrote: false, refusal_reason: 'already_written' });
    }
  }

  // ── Cost gate (BEFORE OpenRouter call) ────────────────────────────────────
  try {
    await deps.gateOrThrow(deps.supabase, COST_VENDOR);
  } catch (err) {
    void deps.sendSlackGuardrailAlert('cost', {
      severity: 'P2',
      title: 'Cost envelope breached: anthropic_tip_of_day',
      text: `Daily cost cap hit for ${COST_VENDOR}. Tip generation paused.`,
      fields: [{ title: 'user_id', value: user_id, short: true }],
    });
    return jsonResponse(429, { error: 'cost_envelope_breached' });
  }

  // ── Load user profile ──────────────────────────────────────────────────────
  const { data: profile } = await deps.supabase
    .from('profiles')
    .select('drug, active_themes')
    .eq('id', user_id)
    .maybeSingle();

  const userDrug: string | null = profile?.drug ?? null;
  const activeThemes: string[] = profile?.active_themes ?? [];

  // ── Retrieve relevant chunk via rag-retrieve ───────────────────────────────
  let retrieveResult;
  try {
    retrieveResult = await deps.ragRetrieve({
      query: userDrug ? `${userDrug} ${activeThemes.join(' ')}` : 'GLP-1 health insight',
      k: 5,
      filters: {
        source_type: 'fda_label', // Prefer Tier-A FDA labels for tips
        surface: 'tip_of_day',
      },
    });
  } catch {
    return jsonResponse(500, { error: 'retrieve_failed' });
  }

  // ── Check for out-of-corpus ────────────────────────────────────────────────
  if (retrieveResult.refused || retrieveResult.chunks.length === 0) {
    deps.emitRefusalEmitted({
      userId: user_id,
      properties: {
        reason: 'out_of_corpus',
        surface: 'tip_of_day',
        trace_id: retrieveResult.trace_id ?? 'unknown',
      },
    });
    return jsonResponse(200, { wrote: false, refusal_reason: 'no_chunk_eligible' });
  }

  // ── Pick first (highest-ranked) chunk ─────────────────────────────────────
  const chunk = retrieveResult.chunks[0] as RagRetrievedChunk & { cohort_n?: number };

  // ── k-anon floor check (G8) ────────────────────────────────────────────────
  if (
    (chunk.source_type === 'leanshot_research' || chunk.source_type === 'community') &&
    chunk.cohort_n !== undefined &&
    chunk.cohort_n < KANON_FLOOR
  ) {
    deps.emitRefusalEmitted({
      userId: user_id,
      properties: {
        reason: 'kanon_floor',
        surface: 'tip_of_day',
        trace_id: retrieveResult.trace_id ?? 'unknown',
      },
    });
    return jsonResponse(200, { wrote: false, refusal_reason: 'kanon_floor' });
  }

  // ── PHARMA-02 gate (Layer 2 of 3-layer invariant) ─────────────────────────
  if (deps.isPharma02Gated(chunk)) {
    deps.emitRefusalEmitted({
      userId: user_id,
      properties: {
        reason: 'pharma_02_carveout',
        surface: 'tip_of_day',
        trace_id: retrieveResult.trace_id ?? 'unknown',
      },
    });
    void deps.sendSlackGuardrailAlert('pharma02', {
      severity: 'P1',
      title: 'PHARMA-02 carveout triggered: tip-of-day',
      text: `Chunk topic_tag '${chunk.topic_tag}' blocked by PHARMA-02 layer 2 runtime check.`,
      fields: [
        { title: 'user_id', value: user_id, short: true },
        { title: 'chunk_id', value: chunk.chunk_id, short: true },
        { title: 'topic_tag', value: chunk.topic_tag, short: true },
      ],
    });
    return jsonResponse(200, { wrote: false, refusal_reason: 'pharma_02_carveout' });
  }

  // ── Build prompts ──────────────────────────────────────────────────────────
  const systemPrompt = buildTipSystemPrompt(chunk);
  const userPrompt = buildTipUserPrompt({
    user_drug: userDrug,
    active_themes: activeThemes,
  });

  // ── Call OpenRouter (Haiku synthesis) ─────────────────────────────────────
  let synthResult: { text: string; usage: { prompt_tokens: number; completion_tokens: number } };
  const traceId = `tip-${user_id}-${date_utc}`;
  const synthStart = Date.now();

  try {
    synthResult = await deps.openrouterGenerate({ systemPrompt, userPrompt });
  } catch {
    return jsonResponse(500, { error: 'synthesis_failed' });
  }

  const synthLatencyMs = Date.now() - synthStart;
  const synthText = synthResult.text.trim();

  // ── Emit cost telemetry ────────────────────────────────────────────────────
  deps.emitAiGeneration({
    userId: user_id,
    properties: {
      model: POSTHOG_MODEL,
      prompt_tokens: synthResult.usage.prompt_tokens,
      completion_tokens: synthResult.usage.completion_tokens,
      usage_total_cost: ESTIMATED_COST_USD,
      latency_ms: synthLatencyMs,
      trace_id: traceId,
      surface: 'tip_of_day',
    },
  });
  void deps.logVendorCost(deps.supabase, {
    vendor: COST_VENDOR,
    amountUsd: ESTIMATED_COST_USD,
    action: 'tip_of_day_generate',
  });

  // ── Extract headline + body_first_sentence from Haiku output ──────────────
  // The prompt contract asks for 1 sentence ending with a period.
  // Headline = first sentence (up to first period); body = full text.
  const periodIdx = synthText.indexOf('.');
  const headline = periodIdx > 0 ? synthText.slice(0, periodIdx + 1) : synthText;
  const bodyFirstSentence = synthText;

  // ── Push payload validation (Layer 3: grep gates on LLM output) ───────────
  let pushPayload: ReturnType<typeof buildPushPayload>;
  const topicSlug = chunk.topic_tag.toLowerCase().replace(/[^a-z0-9-]/g, '-');
  try {
    pushPayload = buildPushPayload({
      headline,
      body_first_sentence: bodyFirstSentence,
      topic: chunk.topic_tag,
      slug: topicSlug,
    });
  } catch (err) {
    const reason = err instanceof TipPayloadRejected ? err.reason : 'unknown';
    deps.emitRefusalEmitted({
      userId: user_id,
      properties: {
        reason: reason === 'prescriptive_verb_rejected' ? 'prescriptive_verb'
          : reason === 'dose_number_in_push' ? 'prescriptive_verb' // treated same
          : 'pharma_02_carveout',
        surface: 'tip_of_day',
        trace_id: traceId,
      },
    });
    void deps.sendSlackGuardrailAlert('rag', {
      severity: 'P2',
      title: `Tip synthesis rejected: ${reason}`,
      text: `Haiku output failed push-payload grep gate (${reason}). Tip NOT written for today.`,
      fields: [
        { title: 'user_id', value: user_id, short: true },
        { title: 'chunk_id', value: chunk.chunk_id, short: true },
      ],
      trace_id: traceId,
    });
    // Return the primary reason — prescriptive_verb or dose_number_in_push maps to 'prescriptive_verb'
    const refusalReason = reason.startsWith('prescriptive') ? 'prescriptive_verb' : reason.replace('_rejected', '').replace('_in_push', '');
    return jsonResponse(200, { wrote: false, refusal_reason: refusalReason });
  }

  // ── INSERT via SECDEF RPC ──────────────────────────────────────────────────
  const { data: insertedId } = await deps.supabase.rpc('write_kb_tip_of_day', {
    p_user_id: user_id,
    p_date_utc: date_utc,
    p_chunk_id: chunk.chunk_id,
    p_source_tier: chunk.tier,
    p_topic_tag: chunk.topic_tag,
    p_topic_slug: topicSlug,
    p_headline: headline,
    p_body: bodyFirstSentence,
    p_source_name: chunk.source_type,       // best available; rag_chunks.source_name in future
    p_evidence_date: chunk.evidence_date,
    p_canonical_url: `https://leanshot.app/knowledge/${chunk.topic_tag}/${topicSlug}`,
  });

  // ── Dispatch push notification ─────────────────────────────────────────────
  let pushDispatched = false;
  try {
    await deps.supabase.functions.invoke('push-dispatch', {
      body: {
        user_id,
        category: 'research_tips',
        payload: {
          title: pushPayload.title,
          body: pushPayload.body,
          deep_link: pushPayload.deep_link,
        },
      },
    });
    pushDispatched = true;
  } catch {
    // best-effort — tip row is already written; push failure is non-fatal
    pushDispatched = false;
  }

  // ── Update push_dispatched_at (best-effort) ───────────────────────────────
  if (pushDispatched && insertedId) {
    void deps.supabase
      .from('kb_tip_of_day')
      .update({ push_dispatched_at: deps.now.toISOString() })
      .eq('id', insertedId as string);
  }

  // ── Emit server-side tip impression ───────────────────────────────────────
  void deps.emitTipImpression({
    user_id,
    chunk_id: chunk.chunk_id,
    topic_tag: chunk.topic_tag,
    source_tier: chunk.tier,
  });

  return jsonResponse(200, {
    wrote: true,
    chunk_id: chunk.chunk_id,
    push_dispatched: pushDispatched,
    refusal_reason: null,
  });
}

// ──────────────────────────────────────────────────────────────────────────────
// Entrypoint — import.meta.main guard per [[reference_deno_test_top_level_serve_trap]]
// ──────────────────────────────────────────────────────────────────────────────

if (import.meta.main) Deno.serve((req) => handler(req, getProductionDeps()));
