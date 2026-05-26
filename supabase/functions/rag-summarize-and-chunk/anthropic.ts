/**
 * anthropic.ts — OpenRouter HTTP client wrapper for rag-summarize-and-chunk.
 *
 * Phase 60 Plan 60-04. Override (2026-05-26): routes via OpenRouter instead of
 * direct Anthropic API. Uses OpenAI-compatible Chat Completions endpoint.
 *
 * VENDOR SUBSTITUTION NOTE:
 *   Original plan used Anthropic SDK + direct API. Operator direction (2026-05-26):
 *   "lets use openrouter and choose the models rather than anthropic".
 *   This file implements OpenRouter HTTP client with the same exported class shape
 *   (AnthropicSummarizer) and the same 3-attempt backoff contract.
 *
 * Model: 'anthropic/claude-haiku-4.5' (OpenRouter dotted convention — distinct from
 *   direct Anthropic API's hyphenated format per [[reference_anthropic_model_id_hyphenated_format]];
 *   the hyphenated rule applies ONLY when calling Anthropic's API directly).
 *
 * PHI-safe logging discipline: NEVER log raw prompt content or raw response text.
 * Only attempt number, error class, first 200 chars of error message, model ID.
 *
 * Cost rates exported for index.ts cost calc (Haiku pricing):
 *   $0.80 per 1M input tokens / $4.00 per 1M output tokens
 */

import { addBreadcrumb } from '../_shared/sentry.ts';

// ──────────────────────────────────────────────────────────────────────────────
// Model ID (OpenRouter dotted convention)
// The hyphenated-Anthropic-model grep gates are SUSPENDED for this Fn per
// the override block — OpenRouter's model ID format is the source of truth.
// ──────────────────────────────────────────────────────────────────────────────

/** OpenRouter model ID for this Fn (dotted convention, NOT hyphenated). */
export const SUMMARIZE_MODEL = 'anthropic/claude-haiku-4.5' as const;

/** PostHog model field (includes vendor prefix for provenance clarity). */
export const POSTHOG_MODEL = 'openrouter/anthropic/claude-haiku-4.5' as const;

/** OpenRouter base URL for chat completions. */
const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';

// ──────────────────────────────────────────────────────────────────────────────
// Cost rate constants (Haiku pricing — $0.80 in / $4.00 out per 1M tokens)
// ──────────────────────────────────────────────────────────────────────────────

export const HAIKU_INPUT_USD_PER_TOKEN = 0.80 / 1_000_000;
export const HAIKU_OUTPUT_USD_PER_TOKEN = 4.00 / 1_000_000;

// ──────────────────────────────────────────────────────────────────────────────
// Retry delays (ms)
// ──────────────────────────────────────────────────────────────────────────────

const RETRY_DELAYS_MS = [1000, 3000, 9000] as const;
const MAX_ATTEMPTS = 3;

// ──────────────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────────────

export interface SummarizeResult {
  json: unknown;
  inputTokens: number;
  outputTokens: number;
  model: string;
}

export interface HealthCheckResult {
  ok: boolean;
  reason?: string;
}

// ──────────────────────────────────────────────────────────────────────────────
// Custom error
// ──────────────────────────────────────────────────────────────────────────────

export class AnthropicSummarizerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AnthropicSummarizerError';
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// AnthropicSummarizer class
// ──────────────────────────────────────────────────────────────────────────────

export interface AnthropicSummarizerOptions {
  /** OpenRouter API key. Defaults to Deno.env.get('OPENROUTER_API_KEY'). */
  apiKey?: string;
  /** Override base URL (used for testing). Defaults to OPENROUTER_BASE_URL. */
  baseUrl?: string;
}

/**
 * OpenRouter-backed summarizer. Named AnthropicSummarizer for import compatibility.
 *
 * OVERRIDE: uses OpenRouter Chat Completions API instead of direct Anthropic SDK.
 * Response shape: OpenAI-compatible `data.choices[0].message.content` + `data.usage`.
 */
export class AnthropicSummarizer {
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(opts?: AnthropicSummarizerOptions) {
    this.apiKey = opts?.apiKey ?? Deno.env.get('OPENROUTER_API_KEY') ?? '';
    this.baseUrl = opts?.baseUrl ?? OPENROUTER_BASE_URL;
  }

  /**
   * Summarize the given prompt via OpenRouter Chat Completions.
   *
   * 3-attempt exponential backoff on 429/5xx/network errors.
   * Delays: 1s → 3s → 9s.
   *
   * On parse failure returns {json: {error: 'unparseable_model_response'}, ...} (no throw).
   * After 3 failures throws AnthropicSummarizerError.
   */
  async summarize(
    prompt: string,
    opts?: { maxTokens?: number; timeoutMs?: number },
  ): Promise<SummarizeResult> {
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      addBreadcrumb({
        category: 'openrouter.summarize.attempt',
        data: { attempt, model: SUMMARIZE_MODEL },
        level: 'info',
      });

      try {
        const result = await this._doRequest(prompt, opts?.maxTokens ?? 1200, opts?.timeoutMs);
        return result;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));

        // PHI-safe logging: NEVER include prompt or response body
        console.error('[AnthropicSummarizer] attempt failed', {
          attempt,
          errorClass: lastError.constructor.name,
          errorSummary: lastError.message.slice(0, 200),
          model: SUMMARIZE_MODEL,
        });

        if (attempt < MAX_ATTEMPTS) {
          await delay(RETRY_DELAYS_MS[attempt - 1]);
        }
      }
    }

    throw new AnthropicSummarizerError(
      `All ${MAX_ATTEMPTS} attempts failed. Last: ${lastError?.message?.slice(0, 200) ?? 'unknown'}`,
    );
  }

  /**
   * Health-check: send a minimal prompt and verify response shape.
   * Returns {ok: false, reason} on any failure — NEVER throws.
   */
  async healthCheck(): Promise<HealthCheckResult> {
    const healthPrompt =
      'Reply with the single JSON object: {"summary":"ok","quote_blocks":[]}';
    try {
      const result = await this._doRequest(healthPrompt, 10, 5000);
      const content = result.json;
      if (
        typeof content === 'object' &&
        content !== null &&
        !('error' in content)
      ) {
        return { ok: true };
      }
      return { ok: false, reason: 'unexpected_response_shape' };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { ok: false, reason: msg.slice(0, 200) };
    }
  }

  /**
   * Internal: perform one HTTP request to OpenRouter.
   * Throws on non-2xx status (so retry loop can catch).
   * On 2xx with unparseable JSON returns {json: {error: 'unparseable_model_response'}, ...}.
   */
  private async _doRequest(
    prompt: string,
    maxTokens: number,
    timeoutMs?: number,
  ): Promise<SummarizeResult> {
    const url = `${this.baseUrl}/chat/completions`;

    const reqBody = {
      model: SUMMARIZE_MODEL,
      max_tokens: maxTokens,
      temperature: 0.1,
      messages: [{ role: 'user', content: prompt }],
    };

    const headers: Record<string, string> = {
      'Authorization': `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://leanshot.app',
      'X-Title': 'LeanShot',
    };

    const signal = timeoutMs != null ? AbortSignal.timeout(timeoutMs) : undefined;

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(reqBody),
      ...(signal ? { signal } : {}),
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      throw new Error(
        `OpenRouter HTTP ${response.status}: ${errText.slice(0, 200)}`,
      );
    }

    const data = await response.json() as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number; total_cost?: number };
    };

    const inputTokens = data.usage?.prompt_tokens ?? 0;
    const outputTokens = data.usage?.completion_tokens ?? 0;
    const rawText = data.choices?.[0]?.message?.content ?? '';

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(rawText);
    } catch {
      parsedJson = { error: 'unparseable_model_response' };
    }

    return {
      json: parsedJson,
      inputTokens,
      outputTokens,
      model: POSTHOG_MODEL,
    };
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Internal helpers
// ──────────────────────────────────────────────────────────────────────────────

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
