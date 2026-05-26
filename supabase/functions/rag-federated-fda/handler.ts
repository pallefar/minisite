/**
 * handler.ts — Pure handler logic for rag-federated-fda.
 *
 * Phase 60 Plan 60-07. Task 3.
 *
 * Separated from index.ts so Vitest tests can import without hitting Deno-specific
 * `npm:` specifier resolution (mirrors rag-federated-pubmed/handler.ts pattern).
 *
 * Iterates BOTH drug/label and drug/event endpoints per topic_tag.
 * PII guard: normalizeOpenFDADrugEvent strips patient demographics (T-60-07-03).
 *
 * DO NOT register cron here. 60-15 owns Fn deploy + cron registration.
 */

import { z } from 'zod';
import { SSRFHostBlockedError } from '../_shared/federated-host-allowlist.ts';
import { searchDrugLabels, searchDrugEvents } from './client.ts';
import type { FDAClientDeps } from './client.ts';
import {
  OpenFDADrugLabelSchema,
  OpenFDADrugEventSchema,
  normalizeOpenFDADrugLabel,
  normalizeOpenFDADrugEvent,
} from './normalize.ts';
import type { SupabaseLike } from '../_shared/federated-cache.ts';

// ──────────────────────────────────────────────────────────────────────────────
// Constants
// ──────────────────────────────────────────────────────────────────────────────

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
const G7_COST_CAP_DURATION_MS = 60 * 60 * 1000;
const FDA_SOURCE_DOMAIN = 'api.fda.gov';

// ──────────────────────────────────────────────────────────────────────────────
// Request schema
// ──────────────────────────────────────────────────────────────────────────────

export const RequestSchema = z.object({
  topic_tags: z.array(z.string().min(1)).min(1),
  mode: z.enum(['incremental', 'historical-seed', 'full-historical']).default('incremental'),
});

// ──────────────────────────────────────────────────────────────────────────────
// Dependency injection interface
// ──────────────────────────────────────────────────────────────────────────────

export interface HandlerDeps {
  supabase: SupabaseLike & {
    from(table: string): unknown;
    rpc(name: string, params?: Record<string, unknown>): Promise<{ data: unknown; error: { message: string } | null }>;
  };
  fetchImpl?: typeof fetch;
  env?: Record<string, string | undefined>;
  sleepImpl?: (ms: number) => Promise<void>;
  now?: () => Date;
  emitCostEnvelopeBreach?: (opts: {
    properties: { scope: string; cron_kind: string; cost_usd: number; envelope_usd: number; trace_id: string };
  }) => void;
  sendSlackAlert?: (
    channel: string,
    payload: { severity: string; title: string; text: string; trace_id?: string }
  ) => Promise<void>;
}

// ──────────────────────────────────────────────────────────────────────────────
// Date helpers (YYYYMMDD format for OpenFDA)
// ──────────────────────────────────────────────────────────────────────────────

function toFdaDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}${m}${day}`;
}

// ──────────────────────────────────────────────────────────────────────────────
// Main handler
// ──────────────────────────────────────────────────────────────────────────────

export async function handleRequest(
  req: Request,
  deps: HandlerDeps,
): Promise<Response> {
  const traceId = crypto.randomUUID();
  const runStartMs = Date.now();
  const now = deps.now ?? (() => new Date());

  // Auth
  const authHeader = req.headers.get('authorization') ?? '';
  const serviceRoleKey = deps.env?.['SUPABASE_SERVICE_ROLE_KEY'] ??
    // deno-lint-ignore no-explicit-any
    ((globalThis as any).Deno?.env?.get('SUPABASE_SERVICE_ROLE_KEY') as string | undefined) ?? '';
  if (!authHeader.startsWith('Bearer ') || authHeader.slice(7) !== serviceRoleKey) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'invalid_json' }), { status: 400 });
  }
  const parsed = RequestSchema.safeParse(body);
  if (!parsed.success) {
    return new Response(JSON.stringify({ error: 'invalid_body' }), { status: 400 });
  }
  const { topic_tags, mode } = parsed.data;

  const emitCostEnvelopeBreach = deps.emitCostEnvelopeBreach ?? (() => {});
  const sendSlackAlert = deps.sendSlackAlert ?? (async () => {});
  // deno-lint-ignore no-explicit-any
  const db = deps.supabase as any;

  try {
    // 1. Read federated_sources row
    const { data: sourceRow, error: sourceErr } = await db
      .from('federated_sources')
      .select('enabled, last_sync_at, initial_seed_completed')
      .eq('name', 'openfda')
      .maybeSingle();

    if (sourceErr) return new Response(JSON.stringify({ error: 'db_error' }), { status: 500 });
    if (!sourceRow) return new Response(JSON.stringify({ error: 'source_not_found' }), { status: 404 });
    if (!sourceRow.enabled) return new Response(JSON.stringify({ error: 'source_disabled' }), { status: 403 });

    // 2. full-historical requires admin token
    if (mode === 'full-historical') {
      const token = req.headers.get('x-admin-action-token') ?? '';
      if (!token) return new Response(JSON.stringify({ error: 'admin_action_token_required' }), { status: 403 });
      const { data: authorized } = await deps.supabase.rpc('is_admin_action_authorized', { token });
      if (!authorized) return new Response(JSON.stringify({ error: 'invalid_admin_action_token' }), { status: 403 });
    }

    // 3. Compute date range (YYYYMMDD for OpenFDA)
    const nowDate = now();
    const thirtyDaysAgo = new Date(nowDate.getTime() - THIRTY_DAYS_MS);
    const dateGte = mode === 'incremental' && sourceRow.last_sync_at
      ? toFdaDate(new Date(sourceRow.last_sync_at as string))
      : toFdaDate(thirtyDaysAgo);
    const dateLte = toFdaDate(nowDate);

    // 4. Resolve rag_sources row for FDA
    const { data: ragSource, error: ragSourceErr } = await db
      .from('rag_sources')
      .select('id')
      .eq('domain', FDA_SOURCE_DOMAIN)
      .maybeSingle();

    if (ragSourceErr || !ragSource) {
      return new Response(
        JSON.stringify({ error: 'rag_source_not_found', message: `No rag_sources row for domain=${FDA_SOURCE_DOMAIN}` }),
        { status: 500 },
      );
    }
    const sourceId = (ragSource as { id: string }).id;

    // 5. Process each topic_tag
    let queued = 0;
    let skippedDuplicate = 0;
    const errors: string[] = [];

    const clientDeps: FDAClientDeps = {
      fetchImpl: deps.fetchImpl,
      supabase: deps.supabase as SupabaseLike,
      env: deps.env,
      sleepImpl: deps.sleepImpl,
    };

    for (const topicTag of topic_tags) {
      // G7 cost cap
      const elapsed = Date.now() - runStartMs;
      if (elapsed > G7_COST_CAP_DURATION_MS) {
        emitCostEnvelopeBreach({
          properties: {
            scope: 'per_cron',
            cron_kind: 'federated_sync',
            cost_usd: 0,
            envelope_usd: 2,
            trace_id: traceId,
          },
        });
        await sendSlackAlert('cost', { severity: 'P2', title: '[rag-federated-fda] G7 cap exceeded', text: `${Math.round(elapsed / 1000)}s elapsed`, trace_id: traceId });
        break;
      }

      // Resolve topic
      const { data: topicRow, error: topicErr } = await db
        .from('rag_topics')
        .select('id')
        .eq('tag', topicTag)
        .is('deleted_at', null)
        .maybeSingle();

      if (topicErr || !topicRow) {
        errors.push(`topic_tag '${topicTag}': no rag_topics row found`);
        continue;
      }
      const topicId = (topicRow as { id: string }).id;

      try {
        // Fetch drug/label records
        const { results: labels } = await searchDrugLabels({
          topicTag,
          effective_time_gte: dateGte,
          effective_time_lte: dateLte,
        }, clientDeps);

        for (const rawLabel of labels) {
          const parseResult = OpenFDADrugLabelSchema.safeParse(rawLabel);
          if (!parseResult.success) {
            errors.push(`label zod: ${JSON.stringify(parseResult.error.format()).slice(0, 100)}`);
            continue;
          }
          const insertPayload = await normalizeOpenFDADrugLabel(parseResult.data, topicTag, topicId, sourceId);
          const { error: insertErr } = await db.from('rag_chunks').insert(insertPayload);
          if (insertErr) {
            if (insertErr.message?.includes('unique') || insertErr.message?.includes('duplicate')) {
              skippedDuplicate++;
            } else {
              errors.push(`label insert: ${insertErr.message}`);
            }
          } else {
            queued++;
          }
        }

        // Fetch drug/event records
        const { results: events } = await searchDrugEvents({
          topicTag,
          receivedate_gte: dateGte,
          receivedate_lte: dateLte,
        }, clientDeps);

        for (const rawEvent of events) {
          const parseResult = OpenFDADrugEventSchema.safeParse(rawEvent);
          if (!parseResult.success) {
            errors.push(`event zod: ${JSON.stringify(parseResult.error.format()).slice(0, 100)}`);
            continue;
          }
          // T-60-07-03 PII guard: normalizeOpenFDADrugEvent only includes allowlisted fields
          const insertPayload = await normalizeOpenFDADrugEvent(parseResult.data, topicTag, topicId, sourceId);
          const { error: insertErr } = await db.from('rag_chunks').insert(insertPayload);
          if (insertErr) {
            if (insertErr.message?.includes('unique') || insertErr.message?.includes('duplicate')) {
              skippedDuplicate++;
            } else {
              errors.push(`event insert: ${insertErr.message}`);
            }
          } else {
            queued++;
          }
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        errors.push(`topic_tag '${topicTag}': ${message}`);

        if (err instanceof SSRFHostBlockedError) {
          await sendSlackAlert('pharma02', { severity: 'P1', title: '[rag-federated-fda] SSRF blocked', text: message, trace_id: traceId });
        } else {
          await sendSlackAlert('rag', { severity: 'P2', title: '[rag-federated-fda] error', text: message, trace_id: traceId });
        }
      }
    }

    // 6. Update federated_sources
    if (errors.length === 0) {
      await db.from('federated_sources').update({
        last_sync_at: nowDate.toISOString(),
        last_error: null,
        last_error_at: null,
        initial_seed_completed: mode === 'historical-seed' ? true : (sourceRow.initial_seed_completed ?? false),
        updated_at: nowDate.toISOString(),
      }).eq('name', 'openfda');
    } else {
      await db.from('federated_sources').update({
        last_error: errors.slice(0, 3).join('; '),
        last_error_at: nowDate.toISOString(),
        updated_at: nowDate.toISOString(),
      }).eq('name', 'openfda');
    }

    return new Response(
      JSON.stringify({ queued, skipped_duplicate: skippedDuplicate, errors }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ error: 'internal_error', message }), { status: 500 });
  }
}
