/**
 * Phase 38 Plan 38-02 — Anthropic Messages API wrapper for the weekly digest.
 *
 * CRITICAL ROUTING: this wrapper POSTs to `${BASE}/v1/messages` (the Anthropic
 * Messages API surface) NOT `/chat/completions`. Per AI-SPEC §3 Pitfall #2:
 * OpenAI-compatible structured outputs DO NOT WORK against Anthropic models
 * routed through `/chat/completions` — only `/v1/messages` with the
 * `output_config.format.json_schema` GA shape constrains output reliably.
 *
 * MODEL ID FORMAT (hyphenated, NOT dotted): the AI Gateway expects
 * `anthropic/claude-sonnet-4-6` — dotted variants (`4.6`) get rejected by
 * the Anthropic surface per [[reference_anthropic_model_id_hyphenated_format]].
 *
 * BAA-SCOPE ORDER (load-bearing audit signal — Phase 25 HIPAA-01):
 *   1. resolveBaaScope() → emits `baa.scope.resolved` breadcrumb
 *   2. assertBaaScope() → asserts model is allowlisted on clinical path
 *   3. addBreadcrumb('anthropic.messages.create') → just before fetch
 *   4. fetch(/v1/messages)
 * If the order is broken in production, audit replay fails. The unit test
 * in `anthropic-summarize.test.ts` Test 5 asserts the breadcrumb order on a
 * fresh in-memory buffer.
 *
 * RETRY POLICY (AI-SPEC §4b verbatim):
 *   - 3 attempts total
 *   - backoff 500ms after attempt 1, 2s after attempt 2
 *   - emit `digest.validation_failed` PostHog event on each retry
 *   - on 3rd failure throw — caller decides fallback (skip user / popularity)
 *
 * LOGGING DISCIPLINE: NEVER log raw model output, raw user facts, prompt,
 * email, or any PHI. Only attempt number, error class, error summary (first
 * 200 chars), tenant scope (org_id), model ID.
 */

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.105.0';
import { z } from 'https://esm.sh/zod@3.23.8';
import {
  DigestOutputSchema,
  digestJsonSchema,
  validateNoClinicalKeywords,
  type DigestOutput,
} from './digest-schema.ts';
import { renderUserFacts, type UserFactsForDigest } from './render-user-facts.ts';
import { assertBaaScope, BaaScopeError, resolveBaaScope } from './baa-scope.ts';
import { addBreadcrumb, captureException } from './sentry.ts';
import { captureServer } from './posthog-server.ts';

const REQUEST_TIMEOUT_MS = 25_000;

/**
 * AI-SPEC §4b verbatim system prompt. Locked content; ANY change requires
 * re-running the §5 evaluation set (faithfulness + whitelist drift).
 *
 * Anthropic prompt caching keys on the system block — keep this stable so
 * the ~90% cache discount applies (AI-SPEC §4b Cost and Latency Budget §3).
 */
export const SYSTEM_PROMPT_DIGEST = `
You are LeanShot's weekly progress summarizer. You receive a deterministic
template of facts about ONE user's last 7 days. You produce a short narrative
and 1-3 next-action suggestions.

HARD RULES:
1. NEVER mention any number, date, or event that is not explicitly in the
   <user_facts> block. If you cannot find a number to support a statement,
   omit the statement.
2. NEVER suggest a dose, medication, or clinical action. Suggestions must be
   chosen ONLY from the action whitelist in <whitelist>.
3. NEVER use the user's first name unless it appears verbatim in <user_facts>.
4. Output JSON only — no preamble, no markdown, no commentary.

Audience: GLP-1 patient. Tone: warm, concrete, second-person ("you"). Length:
narrative 40-150 words; reasons ≤120 chars.
`.trim();

interface SummarizeDigestOptions {
  /** Override fetch — used by tests; defaults to globalThis.fetch. */
  fetchImpl?: typeof fetch;
  /** Override AbortController timeout in ms — used by tests. */
  timeoutMs?: number;
}

/**
 * POST a user-facts template to AI Gateway's `/v1/messages` and return the
 * raw parsed JSON object (before Zod validation).
 *
 * Caller is `generateDigestWithRetry` — do NOT call directly from edge fns.
 *
 * @throws {Error} on non-2xx response (status + body slice, no PHI)
 * @throws {AbortError} on 25s timeout
 */
export async function summarizeDigest(
  supabase: SupabaseClient,
  userFacts: UserFactsForDigest,
  options: SummarizeDigestOptions = {},
): Promise<unknown> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? REQUEST_TIMEOUT_MS;

  // ── Step 1: resolve BAA scope (emits baa.scope.resolved breadcrumb) ─────
  const scope = await resolveBaaScope(supabase, userFacts.userId);

  // ── Step 2: read model ID + assert BAA scope (clinical path only) ───────
  const modelId = Deno.env.get('ANTHROPIC_MODEL_DIGEST');
  if (!modelId) {
    throw new BaaScopeError('summarizeDigest: ANTHROPIC_MODEL_DIGEST env unset');
  }
  // Throws Response 403 on clinical-path allowlist miss — caller must catch.
  assertBaaScope(scope, modelId);

  // ── Step 3: build base URL + body ───────────────────────────────────────
  const rawBase = Deno.env.get('AI_GATEWAY_BASE_URL');
  if (!rawBase) {
    throw new BaaScopeError('summarizeDigest: AI_GATEWAY_BASE_URL env unset');
  }
  const baseUrl = rawBase.replace(/\/v1$/, '');

  const userMessageContent = renderUserFacts(userFacts);

  const body = {
    model: modelId,
    max_tokens: 1024, // REQUIRED by Anthropic — 400 if missing (RESEARCH Pitfall §4)
    temperature: 0.4, // AI-SPEC §4 — some narrative flex, low hallucination
    system: SYSTEM_PROMPT_DIGEST,
    messages: [{ role: 'user', content: userMessageContent }],
    output_config: {
      format: { type: 'json_schema', schema: digestJsonSchema },
    },
  };

  // ── Step 4: emit anthropic.messages.create breadcrumb (audit signal) ────
  addBreadcrumb({
    category: 'anthropic.messages.create',
    level: 'info',
    data: {
      model_id: modelId,
      is_clinical: scope.isClinical,
      base_url_host: new URL(baseUrl).host,
    },
  });

  // ── Step 5: fetch with AbortController timeout ──────────────────────────
  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetchImpl(`${baseUrl}/v1/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${scope.credential}`,
        'Content-Type': 'application/json',
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });

    if (!res.ok) {
      // Slice response body to bound log size + avoid PHI leakage.
      const bodyText = await res.text();
      throw new Error(
        `digest fetch failed: ${res.status} ${bodyText.slice(0, 200)}`,
      );
    }

    const j = (await res.json()) as { content?: Array<{ type: string; text?: string }> };
    const textBlock = (j.content ?? []).find((b) => b.type === 'text');
    if (!textBlock?.text) {
      throw new Error('digest: no text content block in response');
    }
    return JSON.parse(textBlock.text);
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * 3-attempt retry wrapper per AI-SPEC §4b verbatim. Validates the parsed
 * model output via Zod (`DigestOutputSchema.parse`) AND the post-Zod
 * clinical-keyword blocklist (`validateNoClinicalKeywords` on each reason).
 *
 * Failure logging — per AI-SPEC §4b:
 *   - PostHog event `digest.validation_failed` with attempt, error_type
 *     ('schema' | 'transport' | 'clinical_keyword'), error_summary (≤200ch)
 *   - NEVER log raw model output / user facts / prompt
 *
 * @throws final error on 3rd failure — caller chooses fallback
 *   (skip-user-this-week / popularity-baseline). The error type can be
 *   distinguished via `instanceof z.ZodError` vs other Error.
 */
export async function generateDigestWithRetry(
  supabase: SupabaseClient,
  userFacts: UserFactsForDigest,
  options: SummarizeDigestOptions = {},
): Promise<DigestOutput> {
  let lastError: unknown = new Error('unreachable');
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const raw = await summarizeDigest(supabase, userFacts, options);
      const parsed = DigestOutputSchema.parse(raw);
      // Belt-and-suspenders post-Zod clinical-keyword scan (AI-SPEC §6 O2).
      for (const action of parsed.actions) {
        validateNoClinicalKeywords(action.reason);
      }
      return parsed;
    } catch (err) {
      lastError = err;
      const errorType =
        err instanceof z.ZodError
          ? 'schema'
          : err instanceof Error && err.message.includes('clinical-keyword')
          ? 'clinical_keyword'
          : 'transport';

      // Telemetry — never logs the prompt or model output.
      try {
        captureServer({
          userId: userFacts.userId,
          event: 'digest.validation_failed',
          properties: {
            attempt,
            error_type: errorType,
            error_summary: String(err).slice(0, 200),
            org_id: userFacts.orgId,
            // Don't include model_id here — captureServer scrubs are
            // unnecessary for non-PHI but stay terse.
          },
        });
      } catch (telemetryErr) {
        // PostHog dual-write should never break the retry loop.
        captureException(telemetryErr, { level: 'warning', tags: { surface: 'digest.retry' } });
      }

      if (attempt === 3) {
        // Surface to Sentry — alert path lives at >0.5%/hr aggregation.
        captureException(err, {
          level: 'error',
          tags: {
            surface: 'digest.retry.exhausted',
            error_type: errorType,
            org_id: userFacts.orgId ?? 'consumer',
          },
        });
        throw err;
      }

      const backoffMs = attempt === 1 ? 500 : 2000;
      await new Promise((r) => setTimeout(r, backoffMs));
    }
  }
  // Unreachable — the loop either returns or throws.
  throw lastError instanceof Error ? lastError : new Error('digest: unreachable');
}
