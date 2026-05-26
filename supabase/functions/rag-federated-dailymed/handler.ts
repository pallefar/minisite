/**
 * handler.ts — Pure handler logic for rag-federated-dailymed.
 *
 * Phase 60 Plan 60-07. Task 4.
 *
 * Separated from index.ts so Vitest tests can import without npm: specifiers.
 *
 * Pipeline per topic_tag:
 *   searchSPLs → for each setid: getSPLDetail → DailyMedSPLSchema.parse → normalizeDailyMed → INSERT
 * Dedup: (topic_id, source_id, content_hash) unique index in rag_chunks.
 *
 * DO NOT register cron. 60-15 owns Fn deploy + cron registration.
 */

import { z } from 'zod';
import { SSRFHostBlockedError } from '../_shared/federated-host-allowlist.ts';
import { searchSPLs, getSPLDetail } from './client.ts';
import type { DailyMedClientDeps } from './client.ts';
import { DailyMedSPLSchema, normalizeDailyMed } from './normalize.ts';
import type { SupabaseLike } from '../_shared/federated-cache.ts';

// ──────────────────────────────────────────────────────────────────────────────
// Constants
// ──────────────────────────────────────────────────────────────────────────────

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
const G7_COST_CAP_DURATION_MS = 60 * 60 * 1000;
const DAILYMED_SOURCE_DOMAIN = 'dailymed.nlm.nih.gov';

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
// Date helper (ISO YYYY-MM-DD for DailyMed)
// ──────────────────────────────────────────────────────────────────────────────

function toIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
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
  try { body = await req.json(); } catch {
    return new Response(JSON.stringify({ error: 'invalid_json' }), { status: 400 });
  }
  const parsed = RequestSchema.safeParse(body);
  if (!parsed.success) return new Response(JSON.stringify({ error: 'invalid_body' }), { status: 400 });
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
      .eq('name', 'dailymed')
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

    // 3. Compute date range (ISO YYYY-MM-DD for DailyMed)
    const nowDate = now();
    const thirtyDaysAgo = new Date(nowDate.getTime() - THIRTY_DAYS_MS);
    const dateGte = mode === 'incremental' && sourceRow.last_sync_at
      ? toIsoDate(new Date(sourceRow.last_sync_at as string))
      : toIsoDate(thirtyDaysAgo);
    const dateLte = toIsoDate(nowDate);

    // 4. Resolve rag_sources row for DailyMed
    const { data: ragSource, error: ragSourceErr } = await db
      .from('rag_sources')
      .select('id')
      .eq('domain', DAILYMED_SOURCE_DOMAIN)
      .maybeSingle();

    if (ragSourceErr || !ragSource) {
      return new Response(
        JSON.stringify({ error: 'rag_source_not_found', message: `No rag_sources row for domain=${DAILYMED_SOURCE_DOMAIN}` }),
        { status: 500 },
      );
    }
    const sourceId = (ragSource as { id: string }).id;

    // 5. Process each topic_tag
    let queued = 0;
    let skippedDuplicate = 0;
    const errors: string[] = [];

    const clientDeps: DailyMedClientDeps = {
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
          properties: { scope: 'per_cron', cron_kind: 'federated_sync', cost_usd: 0, envelope_usd: 2, trace_id: traceId },
        });
        await sendSlackAlert('cost', { severity: 'P2', title: '[rag-federated-dailymed] G7 cap', text: `${Math.round(elapsed / 1000)}s elapsed`, trace_id: traceId });
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
        // searchSPLs → list of setids
        const { data: splList } = await searchSPLs({
          topicTag,
          published_date_gte: dateGte,
          published_date_lte: dateLte,
        }, clientDeps);

        for (const splEntry of splList) {
          // G7 check per SPL too
          if (Date.now() - runStartMs > G7_COST_CAP_DURATION_MS) break;

          // getSPLDetail → full SPL with sections
          const splDetail = await getSPLDetail(splEntry.setid, clientDeps);
          if (!splDetail) continue; // 404 → skip

          const parseResult = DailyMedSPLSchema.safeParse(splDetail);
          if (!parseResult.success) {
            errors.push(`SPL zod: ${JSON.stringify(parseResult.error.format()).slice(0, 100)}`);
            continue;
          }

          const insertPayload = await normalizeDailyMed(parseResult.data, topicTag, topicId, sourceId);
          const { error: insertErr } = await db.from('rag_chunks').insert(insertPayload);
          if (insertErr) {
            if (insertErr.message?.includes('unique') || insertErr.message?.includes('duplicate')) {
              skippedDuplicate++;
            } else {
              errors.push(`insert error for setid=${splEntry.setid}: ${insertErr.message}`);
            }
          } else {
            queued++;
          }
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        errors.push(`topic_tag '${topicTag}': ${message}`);
        if (err instanceof SSRFHostBlockedError) {
          await sendSlackAlert('pharma02', { severity: 'P1', title: '[rag-federated-dailymed] SSRF blocked', text: message, trace_id: traceId });
        } else {
          await sendSlackAlert('rag', { severity: 'P2', title: '[rag-federated-dailymed] error', text: message, trace_id: traceId });
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
      }).eq('name', 'dailymed');
    } else {
      await db.from('federated_sources').update({
        last_error: errors.slice(0, 3).join('; '),
        last_error_at: nowDate.toISOString(),
        updated_at: nowDate.toISOString(),
      }).eq('name', 'dailymed');
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
