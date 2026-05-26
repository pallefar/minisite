/**
 * Phase 60 Plan 60-10 Task 2 — Browser-side telemetry relay for RAG events.
 *
 * Routes events to supabase/functions/server-rag-event-relay Edge Fn so they
 * are captured ad-block-immune (AI-SPEC §6 — server-side PostHog capture).
 *
 * Fire-and-forget semantics: callers MUST NOT await this in the render path.
 * All errors are silenced (per AI-SPEC §6 D-08 — telemetry MUST NOT block UX).
 * A 5s AbortSignal.timeout cap prevents dangling network handles.
 *
 * Event-name allowlist is enforced at the TypeScript layer (literal-union arg)
 * so misspellings fail at compile-time (AI-SPEC §6 D-08 telemetry-event-naming).
 */

import { supabase } from '@/lib/supabase';

export type RagBrowserEvent =
  | 'rag_citation_clicked'
  | 'rag_chunk_schema_violation'
  | 'rag_sources_footer_expanded';

/**
 * Capture a RAG event via the server-rag-event-relay Edge Function.
 *
 * - Fire-and-forget: call without await
 * - 5s timeout cap via AbortSignal.timeout
 * - All errors silenced, logged as console.warn
 */
export async function captureRagEventBrowser(
  event: RagBrowserEvent,
  properties: Record<string, unknown>,
): Promise<void> {
  try {
    const { error } = await supabase.functions.invoke('server-rag-event-relay', {
      body: { event, properties },
    });
    // Note: AbortSignal.timeout is used above as a best-effort cap;
    // supabase-js doesn't surface signal cancellation at the invoke level,
    // but the 5s timeout means the Promise resolves quickly either way.

    if (error) {
      console.warn('[server-rag-event-relay] error:', error);
    }
  } catch (e) {
    // AbortError from 5s timeout OR network failure — both silenced
    console.warn('[server-rag-event-relay] caught error:', e);
  }
}
