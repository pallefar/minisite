/**
 * Phase 38 Plan 38-02 — OpenAI embeddings wrapper (via Vercel AI Gateway).
 *
 * Wraps `${AI_GATEWAY_BASE_URL}/embeddings` and returns a 1536-float vector
 * suitable for pgvector cosine matching against `content_embeddings`. Used by:
 *   - recommend-next-best-action: embeds the user-context string per request.
 *   - content embed cron: embeds KB / blog / community / course bodies nightly.
 *
 * AbortController 25s timeout (AI-SPEC §4b Async-First Design); 429
 * Retry-After exponential backoff up to 3 attempts (RESEARCH Pitfall #3).
 *
 * PRE-EMBED REFUSAL SCRUB (RESEARCH Pitfall #9): user-context text can contain
 * adversarial dose-change phrasing that the embedding model would faithfully
 * embed without semantic awareness, producing a vector that retrieves
 * dose-change content. We strip such phrasing via `isDoseChangeAdvice` from
 * `shared/refusal` BEFORE embedding and emit `recommendation.refusal_stripped`
 * for telemetry (Guardrail O6).
 *
 * Credential default: AI_GATEWAY_API_KEY_CONSUMER — embeddings call OpenAI
 * (not Anthropic), and the user-context-embed flow handles non-PHI text
 * (sanitized via render-user-context.ts which omits drug names + raw weights).
 * Clinical-tenant embed calls SHOULD pass `AI_GATEWAY_API_KEY_CLINICAL`
 * explicitly via the `credential` argument — this wrapper does not auto-route
 * (no Supabase client passed; that's the consumer's responsibility).
 */

import { isDoseChangeAdvice } from '../../../shared/refusal.ts';
import { captureServer } from './posthog-server.ts';

const DEFAULT_TIMEOUT_MS = 25_000;
const MAX_RETRIES = 3;

interface EmbedOptions {
  credential?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  /** Optional distinctId for telemetry events; omitted means no-op telemetry. */
  userId?: string;
  /** Skip pre-embed refusal scrub — used for cron content-embed where input is curated. */
  skipScrub?: boolean;
}

/**
 * Embed `text` via Vercel AI Gateway and return the 1536-d vector.
 *
 * @throws {Error} on non-2xx after retries or AbortError on timeout
 */
export async function embed(text: string, options: EmbedOptions = {}): Promise<number[]> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const credential = options.credential ?? Deno.env.get('AI_GATEWAY_API_KEY_CONSUMER');
  if (!credential) {
    throw new Error('embed: AI_GATEWAY_API_KEY_CONSUMER unset and no credential passed');
  }
  const baseUrl = Deno.env.get('AI_GATEWAY_BASE_URL');
  if (!baseUrl) throw new Error('embed: AI_GATEWAY_BASE_URL unset');
  const model = Deno.env.get('OPENAI_EMBED_MODEL');
  if (!model) throw new Error('embed: OPENAI_EMBED_MODEL unset');

  // ── Pre-embed refusal scrub (RESEARCH Pitfall #9) ─────────────────────
  let inputText = text;
  if (!options.skipScrub && isDoseChangeAdvice(text)) {
    // Scrub: replace with a neutral placeholder. The embedding will then be
    // semantically close to "GLP-1 user context" generally — NOT to a
    // dose-change vector that would retrieve clinical-action content.
    inputText = '[redacted user-context contained dose-change phrasing]';
    if (options.userId) {
      try {
        captureServer({
          userId: options.userId,
          event: 'recommendation.refusal_stripped',
          properties: {
            surface: 'embed',
            length_before: text.length,
            length_after: inputText.length,
          },
        });
      } catch {
        // Telemetry never blocks embed.
      }
    }
  }

  // ── Fetch loop with 429 Retry-After backoff ──────────────────────────
  let lastError: Error = new Error('embed: unreachable');
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetchImpl(`${baseUrl}/embeddings`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${credential}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ model, input: inputText }),
        signal: ctrl.signal,
      });

      if (res.status === 429 && attempt < MAX_RETRIES) {
        // Honor Retry-After (seconds). Cap at 30s defensively.
        const retryAfterRaw = res.headers.get('Retry-After') ?? '1';
        const retryAfterSec = Math.min(Math.max(parseInt(retryAfterRaw, 10) || 1, 1), 30);
        if (options.userId) {
          try {
            captureServer({
              userId: options.userId,
              event: 'embed.rate_limit_429',
              properties: { attempt, retry_after_sec: retryAfterSec },
            });
          } catch {
            // ignore
          }
        }
        await res.body?.cancel().catch(() => {});
        await new Promise((r) => setTimeout(r, retryAfterSec * 1000));
        continue;
      }

      if (!res.ok) {
        const body = await res.text();
        throw new Error(`embed failed: ${res.status} ${body.slice(0, 200)}`);
      }

      const j = (await res.json()) as { data?: Array<{ embedding?: number[] }> };
      const embedding = j.data?.[0]?.embedding;
      if (!embedding || !Array.isArray(embedding)) {
        throw new Error(`embed: malformed response (no data[0].embedding)`);
      }
      return embedding;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt === MAX_RETRIES) throw lastError;
      // For non-429 errors, retry with light backoff.
      if (!(err instanceof Error) || !err.message.startsWith('embed failed: 429')) {
        await new Promise((r) => setTimeout(r, 250 * attempt));
      }
    } finally {
      clearTimeout(timeout);
    }
  }
  throw lastError;
}
