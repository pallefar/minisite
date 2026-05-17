/**
 * Server-side PostHog helper for Supabase Edge Functions.
 *
 * Phase 24 D-11/D-13. See 24-CONTEXT.md + 24-RESEARCH.md Pattern 3 + PITFALL 1.
 *
 * CRITICAL: every consumer MUST wrap its handler in try/finally and call
 * `await shutdownPostHog()` before returning the Response — otherwise
 * batched events are dropped when the Deno isolate is torn down.
 *
 * TAXO-02 requirement: Edge Functions emit signup / payment / activation / refund
 * events that adblockers eat in the browser. This helper ensures those events
 * are captured server-side with Supabase auth.users.id as the distinct_id (D-13).
 *
 * Vendor-gated health-check pattern (reference_vendor_gated_send_health_check):
 * If POSTHOG_PROJECT_KEY is not set, captureServer is a no-op with a one-time warning.
 * This allows Edge Functions to deploy before the secret is configured without crashing.
 */

import { PostHog } from 'npm:posthog-node@5.10.4';

let _client: PostHog | null = null;
let _missingKeyWarned = false;

function getClient(): PostHog | null {
  if (_client) return _client;
  const key = Deno.env.get('POSTHOG_PROJECT_KEY');
  if (!key) {
    if (!_missingKeyWarned) {
      console.warn('[posthog-server] POSTHOG_PROJECT_KEY missing — captureServer is a no-op until set.');
      _missingKeyWarned = true;
    }
    return null;
  }
  const host = Deno.env.get('POSTHOG_HOST') ?? 'https://us.i.posthog.com';
  _client = new PostHog(key, { host });
  return _client;
}

export type CaptureArgs = {
  /** Supabase auth.users.id — REQUIRED per D-13. Always use the Supabase uid, never anon id. */
  userId: string;
  /** Event name from src/lib/analytics/events*.ts */
  event: string;
  /** Optional event properties. Must NOT contain PHI (D-12). */
  properties?: Record<string, unknown>;
};

/**
 * Capture an event server-side via posthog-node.
 *
 * userId is required (D-13 invariant: Edge Functions always use Supabase auth.users.id
 * as the distinct_id). If userId is empty, throws immediately.
 *
 * If POSTHOG_PROJECT_KEY is not set, this is a no-op (vendor-gated health-check pattern).
 */
export function captureServer(args: CaptureArgs): void {
  if (!args.userId) {
    throw new Error('[posthog-server] userId required (D-13 — always use Supabase auth.users.id as distinct_id)');
  }
  const c = getClient();
  if (!c) return; // vendor-gated no-op
  c.capture({ distinctId: args.userId, event: args.event, properties: args.properties });
}

/**
 * Flush all queued events and shut down the posthog-node client.
 *
 * MUST be called in the `finally` block of every Edge Function handler that
 * uses captureServer(). The Deno isolate is torn down immediately after the
 * Response is returned — any in-flight HTTP requests to PostHog are dropped.
 * `await shutdownPostHog()` forces the client to flush its batch queue before
 * the isolate exits (RESEARCH PITFALL 1).
 *
 * Idempotent: safe to call multiple times or when no client was created.
 */
export async function shutdownPostHog(): Promise<void> {
  if (!_client) return;
  try {
    await _client.shutdown();
  } catch (e) {
    console.error('[posthog-server] shutdown failed', e);
  }
  _client = null;
}
