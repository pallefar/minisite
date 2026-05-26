/**
 * Phase 60 eval harness — PostHog $ai_evaluation event emitter.
 *
 * Uses direct HTTP POST to the PostHog Capture API (Node.js `fetch` global).
 * No dependency on `posthog-js` (browser-only) or the Edge Fn shared helper.
 *
 * Usage in test files:
 *   emitAiEvaluation({ dimension: 'Dim #1', suite: 'citation', pass, score,
 *                      bucket: example.bucket, gold_example_id: example.id });
 *   // ... after all tests in the file:
 *   afterAll(async () => { await flushAiEvaluations(); });
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AiEvaluationEvent {
  dimension: string;
  suite: string;
  pass: boolean;
  score?: number;
  bucket: string;
  gold_example_id: string;
  trace_id?: string;
  metadata?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Queue (module-level — shared across all test files in this Vitest worker)
// ---------------------------------------------------------------------------

const _queue: AiEvaluationEvent[] = [];

/**
 * Enqueues a `$ai_evaluation` PostHog event for later flush.
 *
 * This is a synchronous enqueue — the HTTP POST happens in `flushAiEvaluations()`.
 * Call this inside `it()` bodies (and on RED-failure paths) so observability is
 * preserved regardless of pass/fail.
 */
export function emitAiEvaluation(event: AiEvaluationEvent): void {
  _queue.push(event);
}

// ---------------------------------------------------------------------------
// Flush — call in `afterAll()` exactly once per test file
// ---------------------------------------------------------------------------

/**
 * POSTs all queued events to the PostHog Capture API in a single batch.
 *
 * No-op (queue clears, no HTTP call) when POSTHOG_PROJECT_API_KEY is unset.
 *
 * On flush failure, logs to stderr but does NOT throw — eval observability is
 * best-effort; test pass/fail must never be blocked on PostHog availability.
 */
export async function flushAiEvaluations(): Promise<void> {
  if (_queue.length === 0) return;

  const apiKey = process.env['POSTHOG_PROJECT_API_KEY'];
  if (!apiKey) {
    // Local dev path — drain queue silently
    _queue.splice(0);
    return;
  }

  const host = process.env['POSTHOG_HOST'] ?? 'https://us.posthog.com';
  const captureUrl = `${host}/capture/`;

  // Build batch payload
  const batch = _queue.map((evt) => ({
    event: '$ai_evaluation',
    distinct_id: 'phase60-eval-harness',
    properties: {
      phase: 60,
      dimension: evt.dimension,
      suite: evt.suite,
      pass: evt.pass,
      score: evt.score,
      bucket: evt.bucket,
      gold_example_id: evt.gold_example_id,
      trace_id: evt.trace_id,
      ...(evt.metadata ?? {}),
    },
  }));

  // Drain queue before the async operation so a second flush is a no-op
  _queue.splice(0);

  const payload = JSON.stringify({ api_key: apiKey, batch });

  // Bounded retry: 1 retry with a 2s timeout per AI-SPEC §6 G6 cost-budget envelope.
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(captureUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payload,
        signal: AbortSignal.timeout(2_000),
      });
      if (res.ok) return;
      // Non-2xx — log and retry once
      if (attempt === 0) {
        process.stderr.write(
          `[phase60-eval] PostHog flush attempt ${attempt + 1} failed: ${res.status} — retrying\n`,
        );
      } else {
        process.stderr.write(
          `[phase60-eval] PostHog flush failed after 2 attempts: ${res.status} ${await res.text().catch(() => '')}\n`,
        );
      }
    } catch (err: unknown) {
      if (attempt === 0) {
        process.stderr.write(
          `[phase60-eval] PostHog flush attempt ${attempt + 1} error: ${(err as Error).message} — retrying\n`,
        );
      } else {
        process.stderr.write(
          `[phase60-eval] PostHog flush failed after 2 attempts: ${(err as Error).message}\n`,
        );
      }
    }
  }
}
