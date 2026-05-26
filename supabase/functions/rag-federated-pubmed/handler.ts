/**
 * handler.ts — Pure handler logic for rag-federated-pubmed.
 *
 * Phase 60 Plan 60-07. Task 2.
 *
 * Separated from index.ts so Vitest tests can import without hitting Deno-specific
 * `npm:` specifier resolution (mirrors rag-embed-approved/handler.ts pattern).
 *
 * All external dependencies (Supabase, fetch, PostHog emitters, Slack) are injected
 * via HandlerDeps so the handler can be unit-tested under Node/Vitest.
 *
 * DO NOT register cron here. 60-15 owns Fn deploy + cron registration.
 * [[feedback_fn_deploy_before_cron_db_push]]
 */

import { z } from 'zod';
import { SSRFHostBlockedError } from '../_shared/federated-host-allowlist.ts';
import { RateLimitTruncationError } from './client.ts';
import { esearchByDateRange, efetchByPmids } from './client.ts';
import {
  PubMedArticleSchema,
  normalizePubMedArticle,
} from './normalize.ts';
import type { SupabaseLike } from '../_shared/federated-cache.ts';

// ──────────────────────────────────────────────────────────────────────────────
// Constants
// ──────────────────────────────────────────────────────────────────────────────

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
const G7_COST_CAP_DURATION_MS = 60 * 60 * 1000; // 1 hour wall-clock cap
const PUBMED_SOURCE_DOMAIN = 'pubmed.ncbi.nlm.nih.gov';

// ──────────────────────────────────────────────────────────────────────────────
// Request schema
// ──────────────────────────────────────────────────────────────────────────────

export const RequestSchema = z.object({
  topic_tags: z.array(z.string().min(1)).min(1),
  mode: z.enum(['incremental', 'historical-seed', 'full-historical']).default('incremental'),
});

// ──────────────────────────────────────────────────────────────────────────────
// Dependency injection interface (for testing)
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
// Helper: format date for PubMed (YYYY/MM/DD)
// ──────────────────────────────────────────────────────────────────────────────

function toPubMedDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}/${m}/${day}`;
}

// ──────────────────────────────────────────────────────────────────────────────
// XML→article parser for production efetch responses
// ──────────────────────────────────────────────────────────────────────────────

export function parseXmlToArticle(xml: string): unknown | null {
  try {
    const pmid = xml.match(/<PMID[^>]*>(\d+)<\/PMID>/)?.[1];
    const title = xml.match(/<ArticleTitle>(.+?)<\/ArticleTitle>/s)?.[1]?.replace(/<[^>]+>/g, '');
    const abstractText = xml.match(/<AbstractText[^>]*>(.+?)<\/AbstractText>/s)?.[1]?.replace(/<[^>]+>/g, '');
    const year = xml.match(/<PubDate>[\s\S]*?<Year>(\d{4})<\/Year>/)?.[1];

    if (!pmid || !title) return null;

    return { pmid, title, abstract: abstractText ?? null, year: year ?? '2000' };
  } catch {
    return null;
  }
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

  // Auth: service-role bearer check
  const authHeader = req.headers.get('authorization') ?? '';
  const serviceRoleKey = deps.env?.['SUPABASE_SERVICE_ROLE_KEY'] ??
    // deno-lint-ignore no-explicit-any
    ((globalThis as any).Deno?.env?.get('SUPABASE_SERVICE_ROLE_KEY') as string | undefined) ?? '';
  if (!authHeader.startsWith('Bearer ') || authHeader.slice(7) !== serviceRoleKey) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401 });
  }

  // Parse + validate body
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'invalid_json' }), { status: 400 });
  }
  const parsed = RequestSchema.safeParse(body);
  if (!parsed.success) {
    return new Response(JSON.stringify({ error: 'invalid_body', details: parsed.error.format() }), { status: 400 });
  }
  const { topic_tags, mode } = parsed.data;

  // Resolve emitters (use injected or noop)
  const emitCostEnvelopeBreach = deps.emitCostEnvelopeBreach ?? (() => {});
  const sendSlackAlert = deps.sendSlackAlert ?? (async () => {});

  // Use supabase with from() access
  // deno-lint-ignore no-explicit-any
  const db = deps.supabase as any;

  try {
    // 1. Read federated_sources row
    const { data: sourceRow, error: sourceErr } = await db
      .from('federated_sources')
      .select('enabled, last_sync_at, last_error, initial_seed_completed')
      .eq('name', 'pubmed')
      .maybeSingle();

    if (sourceErr) {
      return new Response(JSON.stringify({ error: 'db_error', message: sourceErr.message }), { status: 500 });
    }
    if (!sourceRow) {
      return new Response(JSON.stringify({ error: 'source_not_found' }), { status: 404 });
    }
    if (!sourceRow.enabled) {
      return new Response(JSON.stringify({ error: 'source_disabled' }), { status: 403 });
    }

    // 2. full-historical requires admin-action-token
    if (mode === 'full-historical') {
      const token = req.headers.get('x-admin-action-token') ?? '';
      if (!token) {
        return new Response(
          JSON.stringify({ error: 'admin_action_token_required' }),
          { status: 403 },
        );
      }
      const { data: authorized } = await deps.supabase.rpc('is_admin_action_authorized', { token });
      if (!authorized) {
        return new Response(JSON.stringify({ error: 'invalid_admin_action_token' }), { status: 403 });
      }
    }

    // 3. Compute date range
    const nowDate = now();
    const thirtyDaysAgo = new Date(nowDate.getTime() - THIRTY_DAYS_MS);
    let mindate: string;

    if (mode === 'incremental' && sourceRow.last_sync_at) {
      mindate = toPubMedDate(new Date(sourceRow.last_sync_at as string));
    } else {
      mindate = toPubMedDate(thirtyDaysAgo);
    }
    const maxdate = toPubMedDate(nowDate);

    // 4. Resolve rag_sources row for pubmed
    const { data: ragSource, error: ragSourceErr } = await db
      .from('rag_sources')
      .select('id')
      .eq('domain', PUBMED_SOURCE_DOMAIN)
      .maybeSingle();

    if (ragSourceErr || !ragSource) {
      return new Response(
        JSON.stringify({ error: 'rag_source_not_found', message: `No rag_sources row for domain=${PUBMED_SOURCE_DOMAIN}` }),
        { status: 500 },
      );
    }
    const sourceId = (ragSource as { id: string }).id;

    // 5. Process each topic_tag
    let queued = 0;
    let skippedDuplicate = 0;
    const errors: string[] = [];

    for (const topicTag of topic_tags) {
      // G7 cost cap — wall-clock guard
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
        await sendSlackAlert('cost', {
          severity: 'P2',
          title: '[rag-federated-pubmed] G7 cost cap exceeded',
          text: `Wall-clock ${Math.round(elapsed / 1000)}s exceeded 1-hour cap. Halting.`,
          trace_id: traceId,
        });
        break;
      }

      // Resolve rag_topics row for this tag
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
        const cacheSupabase = deps.supabase as SupabaseLike;

        // esearch: get PMIDs
        const { pmids } = await esearchByDateRange(
          { topicTag, mindate, maxdate },
          { fetchImpl: deps.fetchImpl, supabase: cacheSupabase, env: deps.env, sleepImpl: deps.sleepImpl },
        );

        if (pmids.length === 0) continue;

        // efetch: get article details
        const rawArticles = await efetchByPmids(pmids, {
          fetchImpl: deps.fetchImpl,
          supabase: cacheSupabase,
          env: deps.env,
          sleepImpl: deps.sleepImpl,
        });

        // For each article: parse → zod-validate → normalize → dedup → insert
        for (const rawArticle of rawArticles) {
          let articleObj: unknown = rawArticle;
          if (typeof rawArticle === 'string') {
            articleObj = parseXmlToArticle(rawArticle);
            if (!articleObj) continue;
          }

          const parseResult = PubMedArticleSchema.safeParse(articleObj);
          if (!parseResult.success) {
            errors.push(`zod validation failed: ${JSON.stringify(parseResult.error.format()).slice(0, 200)}`);
            continue;
          }

          const article = parseResult.data;
          const insertPayload = await normalizePubMedArticle(article, topicTag, topicId, sourceId);

          const { error: insertErr } = await db
            .from('rag_chunks')
            .insert(insertPayload);

          if (insertErr) {
            if (insertErr.message?.includes('rag_chunks_dedup_uq') ||
              insertErr.message?.includes('unique') ||
              insertErr.message?.includes('duplicate')) {
              skippedDuplicate++;
            } else {
              errors.push(`insert error for pmid=${article.pmid}: ${insertErr.message}`);
            }
          } else {
            queued++;
          }
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        errors.push(`topic_tag '${topicTag}': ${message}`);

        if (err instanceof SSRFHostBlockedError) {
          await sendSlackAlert('pharma02', {
            severity: 'P1',
            title: '[rag-federated-pubmed] SSRF host-allowlist blocked',
            text: message,
            trace_id: traceId,
          });
        } else if (err instanceof RateLimitTruncationError) {
          await sendSlackAlert('rag', {
            severity: 'P2',
            title: '[rag-federated-pubmed] Rate-limit truncation detected',
            text: message,
            trace_id: traceId,
          });
          await db
            .from('federated_sources')
            .update({ last_error: message, last_error_at: new Date().toISOString(), updated_at: new Date().toISOString() })
            .eq('name', 'pubmed');
        }
      }
    }

    // 6. Update federated_sources
    if (errors.length === 0) {
      await db
        .from('federated_sources')
        .update({
          last_sync_at: nowDate.toISOString(),
          last_error: null,
          last_error_at: null,
          initial_seed_completed: mode === 'historical-seed' ? true : (sourceRow.initial_seed_completed ?? false),
          updated_at: nowDate.toISOString(),
        })
        .eq('name', 'pubmed');
    } else {
      const errorSummary = errors.slice(0, 3).join('; ');
      await db
        .from('federated_sources')
        .update({
          last_error: errorSummary,
          last_error_at: nowDate.toISOString(),
          updated_at: nowDate.toISOString(),
        })
        .eq('name', 'pubmed');
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
