/**
 * handler.ts — Core logic for protocol-ai-assist Edge Function.
 *
 * Phase 61 Plan 03. Handler/index.ts split per [[reference_deno_test_top_level_serve_trap]].
 *
 * This file MUST NOT import Deno.* or any npm:* packages that use Deno.* at
 * module level. The seam allows Vitest to unit-test the handler without
 * triggering Deno.serve or Deno.env resolution.
 *
 * All external dependencies (Supabase, fetch, PostHog, Slack, PHARMA-02, RAG)
 * are injected via HandlerDeps for test isolation.
 *
 * index.ts owns: Deno.env wiring, createClient, import of _shared/* helpers,
 * and the `if (import.meta.main) Deno.serve(...)` guard.
 *
 * Purpose:
 *   - Provides AI-assisted dose suggestion for protocol step-builder UI (Plan 05)
 *   - Enforces PHARMA-02 carveout (Layer 2 of 3-layer invariant)
 *   - Rate limits to 50 AI-assist calls per UTC-day per admin actor
 *   - Forces refusal when no RAG evidence is cited (server-side override)
 *   - Routes via OpenRouter (not direct Anthropic) per Phase 60.5 vendor decision
 *
 * Vendor: OpenRouter (https://openrouter.ai/api/v1)
 *   Model: anthropic/claude-sonnet-4-5 (dotted OpenRouter convention)
 *   PostHog model: openrouter/anthropic/claude-sonnet-4-5 (vendor-prefixed)
 *   PostHog vendor: openrouter_anthropic
 *   Required headers: HTTP-Referer, X-Title
 *
 * Placeholder runtime guard per [[feedback_placeholder_string_runtime_guard_pattern]]:
 *   If OPENROUTER_API_KEY is missing or starts with placeholder pattern →
 *   return 503 + Slack P1 regulatory alert (NOT a TODO comment — actual runtime).
 *
 * Rate limit: UTC-day window via Date.UTC() (no Postgres date_trunc needed).
 *
 * THREAT: T-61-03-01 (PHARMA-02 violation) — refusal when cited_chunk_ids=[]
 * THREAT: T-61-03-02 (prompt injection) — structured JSON + monitoring enum filter
 * THREAT: T-61-03-03 (DoS) — 50/day rate limit via admin_ai_assist_log COUNT
 * THREAT: T-61-03-05 (placeholder key) — 503 + Slack P1 at runtime
 */

// ──────────────────────────────────────────────────────────────────────────────
// Constants (no imports needed — all deps injected via HandlerDeps)
// ──────────────────────────────────────────────────────────────────────────────

/** OpenRouter model ID (dotted convention — NOT hyphenated direct-Anthropic form). */
const MODEL = 'anthropic/claude-sonnet-4-5';

/** PostHog model field — prefixed with 'openrouter/' per Phase 60 CR-01 vendor provenance. */
export const POSTHOG_MODEL = 'openrouter/anthropic/claude-sonnet-4-5';

/** PostHog vendor semantic tag (per Phase 60 CR-01). */
export const POSTHOG_VENDOR = 'openrouter_anthropic';

/** Surface identifier for log + telemetry. */
const SURFACE = 'protocol_ai_assist';

/** Rate limit: 50 AI-assist calls per UTC-day per admin actor_id. */
const RATE_LIMIT_PER_DAY = 50;

/** OpenRouter base URL. */
const OPENROUTER_BASE = 'https://openrouter.ai/api/v1';

/**
 * Placeholder runtime guard pattern per [[feedback_placeholder_string_runtime_guard_pattern]].
 * Match: 'placeholder*', 'TODO*', 'REPLACE_ME*' (case-insensitive).
 */
const PLACEHOLDER_KEY_PATTERN = /^(placeholder|TODO|REPLACE_ME)/i;

/** Allowed monitoring categories (server-side filter against model output). */
const ALLOWED_MONITORING: ReadonlySet<string> = new Set([
  'weight',
  'glucose',
  'bp',
  'mood',
  'gi-symptoms',
]);

/** Maximum sane dose_mg (server-side clamp). */
const MAX_DOSE_MG = 500;

// ──────────────────────────────────────────────────────────────────────────────
// Duck-typed interfaces for injected dependencies (avoids npm: imports in tests)
// ──────────────────────────────────────────────────────────────────────────────

/** Minimal Supabase client shape for rate-limit query + INSERT. */
export interface SupabaseLike {
  from(table: string): {
    select(cols: string, opts?: { count?: string; head?: boolean }): {
      eq(col: string, val: unknown): {
        gte(col: string, val: unknown): Promise<{ count: number | null; data: unknown[]; error: unknown }>;
      };
    };
    insert(row: Record<string, unknown>): {
      select(): Promise<{ data: unknown[] | null; error: unknown }>;
    };
  };
}

/** RAG chunk shape returned by retrieveRagChunks (subset we consume). */
export interface RagChunk {
  chunk_id: string;
  source_text_excerpt?: string;
  summary: string;
  source_type: string;
  tier: string;
  topic_tag: string;
  similarity: number;
  [key: string]: unknown;
}

/** Full result shape from rag-retrieve (supports refused + chunks). */
export interface RagRetrieveResultLike {
  refused: boolean;
  refusal_reason: string | null;
  chunks: RagChunk[];
  trace_id: string;
  reranker_provider: string;
  embed_cost_usd: number;
  rerank_cost_usd: number;
}

/** Request shape for retrieveRagChunks injectable. */
export interface RagRetrieveRequestLike {
  query: string;
  k?: number;
  filters?: { surface?: string; [key: string]: unknown };
}

/** Slack alert payload injected into deps. */
export interface SlackAlertArgs {
  channel: 'regulatory' | 'pharma02' | 'rag' | 'cost' | 'research';
  payload: {
    severity: 'P1' | 'P2' | 'P3';
    title: string;
    text: string;
    fields?: Array<{ title: string; value: string; short?: boolean }>;
    trace_id?: string;
  };
}

/** PostHog $ai_generation emit args. */
export interface AiGenerationArgs {
  userId: string;
  properties: {
    model: string;
    vendor_field: string;
    prompt_tokens?: number;
    completion_tokens?: number;
    trace_id: string;
    surface?: string;
    [key: string]: unknown;
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// HandlerDeps — full injection surface
// ──────────────────────────────────────────────────────────────────────────────

export interface HandlerDeps {
  openrouterApiKey: string;
  supabaseUrl: string;
  supabaseServiceKey: string;
  posthogKey?: string;
  slackWebhookUrl?: string;
  // Injectable for tests (production deps wired in index.ts):
  fetchImpl?: (url: string, init?: RequestInit) => Promise<{ ok: boolean; json(): Promise<unknown>; text(): Promise<string> }>;
  ragRetrieve?: (req: RagRetrieveRequestLike) => Promise<RagRetrieveResultLike>;
  supabaseClient?: SupabaseLike;
  emitAiGenerationFn?: (args: AiGenerationArgs) => void;
  sendSlackAlertFn?: (channel: SlackAlertArgs['channel'], payload: SlackAlertArgs['payload']) => Promise<void>;
  isPharma02GatedTopicFn?: (compound: string) => boolean;
  now?: () => Date;
}

// ──────────────────────────────────────────────────────────────────────────────
// Request / response types
// ──────────────────────────────────────────────────────────────────────────────

export interface HandlerRequest {
  protocol_id: string | null;
  step_week: number;
  compound: string;
  prior_steps_context: string;  // serialized JSON of prior steps for prompt injection
  actor_id: string;             // auth.uid() extracted from JWT in index.ts
}

type SuccessBody = {
  dose_mg: number;
  monitoring: string[];
  cited_chunk_ids: string[];
  refusal: boolean;
  refusal_reason?: string;
};

type RateLimitBody = {
  error: 'rate_limit_exceeded';
  resets_at: string;
};

type ServiceUnavailableBody = {
  error: 'service_unavailable';
  reason: string;
};

export interface HandlerResponse {
  status: 200 | 429 | 503;
  body: SuccessBody | RateLimitBody | ServiceUnavailableBody;
}

// ──────────────────────────────────────────────────────────────────────────────
// Prompt builder (exported for testing)
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Build system prompt for the OpenRouter chat completions call.
 *
 * Instructs the model to:
 *   1. Cite at least one chunk_id from the RAG chunks
 *   2. Output JSON only: { dose_mg, monitoring, cited_chunk_ids }
 *   3. Force refusal: true if no chunk supports the dose
 */
export function buildSystemPrompt(compound: string, ragChunks: RagChunk[]): string {
  const chunkTexts = ragChunks
    .map((c) => `[${c.chunk_id}] ${c.source_text_excerpt ?? c.summary}`)
    .join('\n');

  return [
    `You are a clinical dose-suggestion assistant. The administrator is building a titration step for ${compound}.`,
    `Below are ${ragChunks.length} retrieved RAG chunks; cite at least one by chunk_id in \`cited_chunk_ids\`.`,
    `If no chunk supports a safe dose for this step, return refusal:true.`,
    `Output JSON only: { dose_mg: number, monitoring: string[] subset of ['weight','glucose','bp','mood','gi-symptoms'], cited_chunk_ids: string[] }.`,
    `Do not include prose.`,
    ``,
    `RAG CHUNKS:`,
    chunkTexts,
  ].join('\n');
}

// ──────────────────────────────────────────────────────────────────────────────
// Primary handler
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Handle a protocol-ai-assist request.
 *
 * Exported for Vitest unit-test injection. index.ts calls this with production deps.
 * MUST NOT import or call Deno.* anywhere in this file.
 */
export async function handleAiAssist(
  req: HandlerRequest,
  deps: HandlerDeps,
): Promise<HandlerResponse> {
  const now = deps.now ? deps.now() : new Date();

  // ── Step 1: Placeholder runtime guard ────────────────────────────────────────
  // Per [[feedback_placeholder_string_runtime_guard_pattern]]: 503 + Slack P1 at request time
  if (!deps.openrouterApiKey || PLACEHOLDER_KEY_PATTERN.test(deps.openrouterApiKey)) {
    // Best-effort Slack P1 regulatory alert — swallow errors (non-blocking)
    if (deps.sendSlackAlertFn) {
      try {
        await deps.sendSlackAlertFn('regulatory', {
          severity: 'P1',
          title: 'protocol-ai-assist OPENROUTER_API_KEY missing/placeholder',
          text: 'The OPENROUTER_API_KEY environment variable is missing or contains a placeholder value. All AI-assist requests will fail until this is resolved.',
          fields: [{ title: 'surface', value: SURFACE, short: true }],
        });
      } catch {
        // best-effort — do not let Slack failure block the 503 response
      }
    }
    return {
      status: 503,
      body: {
        error: 'service_unavailable',
        reason: 'OPENROUTER_API_KEY missing or placeholder — contact platform admin',
      },
    };
  }

  // ── Step 2: Get Supabase client ───────────────────────────────────────────────
  // In production: injected by index.ts via createClient(Deno.env...)
  // In tests: provided by test via deps.supabaseClient mock
  const sb = deps.supabaseClient!;

  // ── Step 3: Rate-limit check ──────────────────────────────────────────────────
  // UTC-day window: count rows for this actor_id since UTC midnight today
  const utcMidnight = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
  ));
  const nextUtcMidnight = new Date(utcMidnight.getTime() + 24 * 60 * 60 * 1000);

  const { count } = await sb
    .from('admin_ai_assist_log')
    .select('id', { count: 'exact', head: true })
    .eq('actor_id', req.actor_id)
    .gte('created_at', utcMidnight.toISOString());

  if ((count ?? 0) >= RATE_LIMIT_PER_DAY) {
    return {
      status: 429,
      body: {
        error: 'rate_limit_exceeded',
        resets_at: nextUtcMidnight.toISOString(),
      },
    };
  }

  // ── Step 4: PHARMA-02 carveout (Layer 2 of 3-layer invariant) ────────────────
  // isPharma02GatedTopic injected via deps (production: from _shared/pharma-02-carveout.ts)
  const isPharma02Gated = deps.isPharma02GatedTopicFn ?? (() => false);
  if (isPharma02Gated(req.compound)) {
    // INSERT log row for audit trail
    await sb
      .from('admin_ai_assist_log')
      .insert({
        actor_id: req.actor_id,
        protocol_id: req.protocol_id,
        step_week: req.step_week,
        compound: req.compound,
        refusal: true,
        cited_chunk_count: 0,
        refusal_reason: 'PHARMA-02 carveout',
      })
      .select();

    return {
      status: 200,
      body: {
        dose_mg: 0,
        monitoring: [],
        cited_chunk_ids: [],
        refusal: true,
        refusal_reason: 'PHARMA-02 carveout — compound is gated',
      },
    };
  }

  // ── Step 5: RAG retrieve ──────────────────────────────────────────────────────
  let chunks: RagChunk[] = [];
  if (deps.ragRetrieve) {
    try {
      const result = await deps.ragRetrieve({
        query: `Safe dose for ${req.compound} step ${req.step_week} given prior context: ${req.prior_steps_context}`,
        k: 5,
        filters: { surface: 'coach' },
      });
      chunks = result.chunks ?? [];
    } catch {
      chunks = [];
    }
  }

  if (chunks.length === 0) {
    // INSERT log row for audit trail
    await sb
      .from('admin_ai_assist_log')
      .insert({
        actor_id: req.actor_id,
        protocol_id: req.protocol_id,
        step_week: req.step_week,
        compound: req.compound,
        refusal: true,
        cited_chunk_count: 0,
        refusal_reason: 'No qualifying RAG evidence',
      })
      .select();

    return {
      status: 200,
      body: {
        dose_mg: 0,
        monitoring: [],
        cited_chunk_ids: [],
        refusal: true,
        refusal_reason: 'No qualifying RAG evidence retrieved',
      },
    };
  }

  // ── Step 6: Build prompts and call OpenRouter ────────────────────────────────
  const systemPrompt = buildSystemPrompt(req.compound, chunks);
  const userMessage = `Suggest a safe titration step for week ${req.step_week} of ${req.compound}.`;

  const fetchFn = deps.fetchImpl ?? (fetch as HandlerDeps['fetchImpl'])!;
  const openRouterResp = await fetchFn(`${OPENROUTER_BASE}/chat/completions`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${deps.openrouterApiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://leanshot.app',
      'X-Title': 'LeanShot',
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
      max_tokens: 512,
      response_format: { type: 'json_object' },
    }),
    signal: AbortSignal.timeout(30_000),
  } as RequestInit);

  if (!openRouterResp.ok) {
    const errText = await openRouterResp.text().catch(() => '');
    throw new Error(`OpenRouter HTTP error: ${errText.slice(0, 200)}`);
  }

  // ── Step 7: Parse and validate OpenRouter response ────────────────────────────
  const data = await openRouterResp.json() as {
    choices?: Array<{ message?: { content?: string } }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };

  const rawContent = data.choices?.[0]?.message?.content ?? '{}';
  const usage = {
    prompt_tokens: data.usage?.prompt_tokens ?? 0,
    completion_tokens: data.usage?.completion_tokens ?? 0,
  };

  let parsed: { dose_mg?: unknown; monitoring?: unknown; cited_chunk_ids?: unknown } = {};
  try {
    parsed = JSON.parse(rawContent) as typeof parsed;
  } catch {
    parsed = {};
  }

  // Server-side normalization: clamp dose_mg to sane range 0–500
  const rawDoseMg = typeof parsed.dose_mg === 'number' ? parsed.dose_mg : 0;
  const dose_mg = Math.max(0, Math.min(MAX_DOSE_MG, rawDoseMg));

  // Filter monitoring to allowed set (T-61-03-02: prompt injection mitigation)
  const rawMonitoring = Array.isArray(parsed.monitoring) ? (parsed.monitoring as unknown[]) : [];
  const monitoring = rawMonitoring
    .filter((m): m is string => typeof m === 'string' && ALLOWED_MONITORING.has(m));

  // Filter cited_chunk_ids: only UUIDs that appear in the retrieved chunks (not hallucinated)
  const validChunkIds = new Set(chunks.map((c) => c.chunk_id));
  const rawCited = Array.isArray(parsed.cited_chunk_ids) ? (parsed.cited_chunk_ids as unknown[]) : [];
  const cited_chunk_ids = rawCited
    .filter((id): id is string => typeof id === 'string' && validChunkIds.has(id));

  // ── Step 8: Server-side refusal override (T-61-03-01 — PHARMA-02 Layer 2) ────
  // If model failed to cite any chunk — force refusal regardless of dose output.
  let refusal = false;
  let refusal_reason: string | undefined;
  if (cited_chunk_ids.length === 0) {
    refusal = true;
    refusal_reason = 'No qualifying evidence cited by model';
  }

  // ── Step 9: INSERT into admin_ai_assist_log ───────────────────────────────────
  await sb
    .from('admin_ai_assist_log')
    .insert({
      actor_id: req.actor_id,
      protocol_id: req.protocol_id,
      step_week: req.step_week,
      compound: req.compound,
      refusal,
      cited_chunk_count: cited_chunk_ids.length,
      refusal_reason: refusal_reason ?? null,
    })
    .select();

  // ── Step 10: PostHog $ai_generation event (best-effort) ──────────────────────
  if (deps.emitAiGenerationFn) {
    try {
      deps.emitAiGenerationFn({
        userId: req.actor_id,
        properties: {
          model: POSTHOG_MODEL,
          vendor_field: POSTHOG_VENDOR,
          prompt_tokens: usage.prompt_tokens,
          completion_tokens: usage.completion_tokens,
          trace_id: crypto.randomUUID(),
          surface: SURFACE,
        },
      });
    } catch {
      // PostHog is best-effort — failure MUST NOT block the response
    }
  }

  // ── Step 11: Return result ────────────────────────────────────────────────────
  const responseBody: SuccessBody = {
    dose_mg: refusal ? 0 : dose_mg,
    monitoring: refusal ? [] : monitoring,
    cited_chunk_ids,
    refusal,
  };
  if (refusal_reason !== undefined) {
    responseBody.refusal_reason = refusal_reason;
  }

  return {
    status: 200,
    body: responseBody,
  };
}
