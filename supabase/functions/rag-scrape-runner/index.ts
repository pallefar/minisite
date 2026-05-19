/**
 * rag-scrape-runner Edge Function — Phase 50 Plan 50-04.
 *
 *   POST /functions/v1/rag-scrape-runner       (verify_jwt = false — service-role bearer only)
 *   GET  /functions/v1/rag-scrape-runner/healthz
 *
 * Invoked every 5 minutes by pg_cron entry `rag-scrape-tick` (Plan 50-04 migration).
 * Pipeline:
 *   1. Pick topics where next_scrape_at <= now() AND deleted_at IS NULL.
 *      (Body { topic_id } overrides for one-off scrapes.)
 *   2. For each topic:
 *      - INSERT rag_scrape_runs row (status=running)
 *      - Resolve source list (curated → all active non-paused rag_sources;
 *        open-web → Firecrawl /v1/crawl on duckduckgo seed URL)
 *      - For each source:
 *          gateOrThrow(firecrawl)              # cost gate (D-30)
 *          respectsRobots                       # D-03
 *          isExcludedDomain                     # D-07 belt-and-braces
 *          scrapeSingle with 3-attempt backoff  # D-31
 *          logVendorCost                        # D-30
 *          computeContentHash + dedup check
 *          shouldRequeue vs prior approved chunk # D-19
 *          INSERT rag_chunks (queued | re-queued)
 *      - On 3 consecutive failed runs: paused_at + sentryCapture(rag.scraper.failed)
 *      - UPDATE rag_scrape_runs (status=ok|partial|failed, completed_at, chunks_found)
 *      - Advance rag_topics.next_scrape_at per cadence
 *      - captureRagEvent('rag_scrape_run', {topic_id, source_count, chunks_found, duration_ms, status, cost_usd})
 *      - Chain to rag-summarize-and-chunk (fire-and-forget; Plan 50-05 owner)
 *   3. Response: 200 { ok: true, topics_scraped, chunks_found }
 *
 * Auth: Requires `Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>` (cron-supplied).
 *
 * Decision refs: D-01, D-02, D-03, D-07, D-09, D-19, D-22, D-30, D-31.
 */

import { createClient } from 'npm:@supabase/supabase-js@2';
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';

import { captureRagEvent, shutdownPostHog } from '../_shared/posthog-server.ts';
import { sentryCapture } from '../_shared/sentry.ts';

import {
  CostCapExceededError,
  ESTIMATED_COST_USD,
  gateOrThrow,
  logVendorCost,
} from './cost-ledger.ts';
import { computeContentHash, shouldRequeue } from './diff-detector.ts';
import {
  FirecrawlClient,
  FirecrawlError,
  isExcludedDomain,
} from './firecrawl.ts';

// ---------------------------------------------------------------------------
// Types — mirror the Plan 50-01 schema columns we touch.
// ---------------------------------------------------------------------------

interface RagTopic {
  id: string;
  query: string;
  tag: string;
  posture: 'curated' | 'open-web';
  cadence: 'daily' | 'weekly' | 'monthly' | 'manual';
  next_scrape_at: string | null;
  last_scraped_at: string | null;
  deleted_at: string | null;
}

interface RagSource {
  id: string;
  name: string;
  domain: string;
  tier: 'A' | 'B' | 'C';
  health: 'ok' | 'paused' | 'failing';
  consecutive_failures: number;
  paused_at: string | null;
}

interface ScrapeRunSummary {
  topic_id: string;
  status: 'ok' | 'partial' | 'failed';
  chunks_found: number;
  source_count: number;
  duration_ms: number;
  cost_usd: number;
  error_message?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const RETRY_BACKOFF_MS = [60_000, 300_000, 900_000] as const; // 1m / 5m / 15m per D-31

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function nextScrapeAtFromCadence(cadence: RagTopic['cadence']): string | null {
  const now = new Date();
  switch (cadence) {
    case 'daily':
      return new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();
    case 'weekly':
      return new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();
    case 'monthly':
      return new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString();
    case 'manual':
      return null;
    default:
      return new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();
  }
}

function makeAdmin(): SupabaseClient {
  const url = Deno.env.get('SUPABASE_URL') ?? '';
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!url || !key) {
    throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing');
  }
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

function getFirecrawl(): FirecrawlClient {
  const key = Deno.env.get('FIRECRAWL_API_KEY') ?? '';
  return new FirecrawlClient(key);
}

/**
 * Pick the topics that are due for scraping. If `topicId` is provided, returns
 * just that topic (ignoring next_scrape_at). Otherwise: due topics only.
 */
async function pickTopicsToScrape(
  admin: SupabaseClient,
  topicId: string | null,
): Promise<RagTopic[]> {
  let query = admin
    .from('rag_topics')
    .select(
      'id, query, tag, posture, cadence, next_scrape_at, last_scraped_at, deleted_at',
    )
    .is('deleted_at', null);
  if (topicId) {
    query = query.eq('id', topicId);
  } else {
    query = query.or('next_scrape_at.is.null,next_scrape_at.lte.' + new Date().toISOString());
  }
  const { data, error } = await query.limit(50);
  if (error) {
    throw new Error(`pickTopicsToScrape failed: ${error.message}`);
  }
  return (data ?? []) as RagTopic[];
}

/**
 * Atomically claim the topic by UPDATE-with-RETURNING on last_scraped_at.
 * If another cron tick already advanced last_scraped_at within the last
 * minute, we skip (returns null) to avoid double-scrape on concurrent crons.
 */
async function claimTopic(
  admin: SupabaseClient,
  topic: RagTopic,
): Promise<RagTopic | null> {
  const cutoff = new Date(Date.now() - 60_000).toISOString();
  const { data, error } = await admin
    .from('rag_topics')
    .update({ last_scraped_at: new Date().toISOString() })
    .eq('id', topic.id)
    .or(`last_scraped_at.is.null,last_scraped_at.lt.${cutoff}`)
    .select(
      'id, query, tag, posture, cadence, next_scrape_at, last_scraped_at, deleted_at',
    )
    .maybeSingle();
  if (error) {
    console.warn(`[rag-scrape-runner] claimTopic ${topic.id} error: ${error.message}`);
    return null;
  }
  return data as RagTopic | null;
}

async function resolveSources(
  admin: SupabaseClient,
  topic: RagTopic,
): Promise<RagSource[]> {
  if (topic.posture === 'open-web') {
    // Open-web mode emits a synthetic source from a search-engine seed; the
    // discovered URLs are scraped via crawlDiscover. We don't pre-list them
    // in rag_sources (those are admin-curated allowlist rows). The runner
    // handles open-web inline in scrapeTopic.
    return [];
  }
  // Curated: all non-paused active sources for v1 (admin per-topic source pinning
  // deferred to v1.4 per plan note).
  const { data, error } = await admin
    .from('rag_sources')
    .select('id, name, domain, tier, health, consecutive_failures, paused_at')
    .is('paused_at', null)
    .neq('health', 'paused');
  if (error) {
    throw new Error(`resolveSources failed: ${error.message}`);
  }
  return (data ?? []) as RagSource[];
}

/**
 * Wrap scrapeSingle in 3-attempt exponential backoff per D-31.
 * Sleeps are skipped when SCRAPE_FAST_RETRY=1 (test seam — integration tests
 * set this to keep total runtime sane).
 */
async function scrapeWithBackoff(
  fc: FirecrawlClient,
  url: string,
): Promise<{ markdown: string; canonicalUrl: string; scrapedAt: string }> {
  const fastRetry = Deno.env.get('SCRAPE_FAST_RETRY') === '1';
  let lastErr: unknown = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await fc.scrapeSingle(url);
    } catch (err) {
      lastErr = err;
      const isRetriable = err instanceof FirecrawlError ? err.retriable : true;
      if (!isRetriable) break;
      if (attempt < 2) {
        const wait = fastRetry ? 1 : RETRY_BACKOFF_MS[attempt];
        await sleep(wait);
      }
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('scrape failed');
}

async function bumpSourceFailure(
  admin: SupabaseClient,
  sourceId: string,
): Promise<{ consecutive: number; nowPaused: boolean }> {
  // Read-then-update; the field is small int so the race window is bounded.
  // We accept rare double-increment under concurrent cron ticks because the
  // claimTopic guard already keeps per-topic concurrency to one.
  const { data: src } = await admin
    .from('rag_sources')
    .select('consecutive_failures')
    .eq('id', sourceId)
    .maybeSingle();
  const next = (src?.consecutive_failures ?? 0) + 1;
  const nowPaused = next >= 3;
  const patch: Record<string, unknown> = { consecutive_failures: next };
  if (nowPaused) {
    patch.health = 'failing';
    patch.paused_at = new Date().toISOString();
    patch.paused_reason = '3 consecutive failed scrapes';
  }
  await admin.from('rag_sources').update(patch).eq('id', sourceId);
  return { consecutive: next, nowPaused };
}

async function resetSourceFailure(
  admin: SupabaseClient,
  sourceId: string,
): Promise<void> {
  await admin
    .from('rag_sources')
    .update({ consecutive_failures: 0 })
    .eq('id', sourceId);
}

async function insertChunkIfNew(
  admin: SupabaseClient,
  args: {
    topicId: string;
    sourceId: string;
    canonicalUrl: string;
    markdown: string;
    topicTag: string;
    sourceTier: 'A' | 'B' | 'C';
  },
): Promise<{ inserted: boolean; status: 'queued' | 're-queued' | 'skip-dup' }> {
  const contentHash = await computeContentHash(args.markdown);
  // Dedup check on (topic_id, source_id, content_hash).
  const { data: existing } = await admin
    .from('rag_chunks')
    .select('id')
    .eq('topic_id', args.topicId)
    .eq('source_id', args.sourceId)
    .eq('content_hash', contentHash)
    .limit(1);
  if (existing && existing.length > 0) {
    return { inserted: false, status: 'skip-dup' };
  }
  // Diff vs prior approved chunk for this (topic, source).
  const { data: prior } = await admin
    .from('rag_chunks')
    .select('source_text_excerpt')
    .eq('topic_id', args.topicId)
    .eq('source_id', args.sourceId)
    .not('published_at', 'is', null)
    .order('created_at', { ascending: false })
    .limit(1);
  const priorText: string | null = prior?.[0]?.source_text_excerpt ?? null;
  const isRequeue = priorText !== null && shouldRequeue(priorText, args.markdown);
  const status: 'queued' | 're-queued' = isRequeue ? 're-queued' : 'queued';

  // Cap excerpt at 4000 chars (D-03: excerpt only, not full text).
  const excerpt = args.markdown.slice(0, 4000);
  // Summary stays empty here — Plan 50-05 rag-summarize-and-chunk populates it.
  const summary = '';

  const { error } = await admin.from('rag_chunks').insert({
    topic_id: args.topicId,
    source_id: args.sourceId,
    canonical_url: args.canonicalUrl,
    source_text_excerpt: excerpt,
    summary,
    content_hash: contentHash,
    topic_tag: args.topicTag,
    source_tier: args.sourceTier,
    status,
    scraped_at: new Date().toISOString(),
  });
  if (error) {
    // 23505 = unique violation; can happen in narrow concurrency window. Skip.
    if (error.code === '23505') {
      return { inserted: false, status: 'skip-dup' };
    }
    throw new Error(`rag_chunks INSERT failed: ${error.message}`);
  }
  return { inserted: true, status };
}

// ---------------------------------------------------------------------------
// Per-topic pipeline
// ---------------------------------------------------------------------------

async function scrapeTopic(
  admin: SupabaseClient,
  fc: FirecrawlClient,
  topic: RagTopic,
): Promise<ScrapeRunSummary> {
  const start = Date.now();
  const claimed = await claimTopic(admin, topic);
  if (!claimed) {
    return {
      topic_id: topic.id,
      status: 'partial',
      chunks_found: 0,
      source_count: 0,
      duration_ms: 0,
      cost_usd: 0,
      error_message: 'concurrent-claim-skip',
    };
  }

  const { data: runRow, error: runErr } = await admin
    .from('rag_scrape_runs')
    .insert({
      topic_id: topic.id,
      started_at: new Date().toISOString(),
      status: 'running',
      attempt: 1,
    })
    .select('id')
    .maybeSingle();
  if (runErr || !runRow) {
    throw new Error(`rag_scrape_runs INSERT failed: ${runErr?.message ?? 'no row'}`);
  }
  const runId = runRow.id;

  let chunksFound = 0;
  let sourcesTried = 0;
  let costUsd = 0;
  let lastErr: string | undefined;
  let overallStatus: 'ok' | 'partial' | 'failed' = 'ok';

  try {
    let sources: RagSource[] = [];
    let openWebPages: Array<{ url: string; markdown: string; sourceId: string; sourceTier: 'A' | 'B' | 'C' }> = [];

    if (topic.posture === 'curated') {
      sources = await resolveSources(admin, topic);
    } else {
      // Open-web mode: gate cost, then crawl seed URL.
      await gateOrThrow(admin, 'firecrawl');
      const seedUrl = `https://duckduckgo.com/html/?q=${encodeURIComponent(topic.query)}`;
      try {
        const discovered = await fc.crawlDiscover(seedUrl, { limit: 10 });
        // For open-web, we use a synthetic "open-web" source if one exists,
        // else log cost only (no source_id FK). v1 simplification: skip
        // INSERT for open-web pages until a synthetic source row is seeded.
        // (Researcher note: v1.4 should add a built-in 'open-web' source.)
        await logVendorCost(admin, {
          vendor: 'firecrawl',
          amountUsd: discovered.length * ESTIMATED_COST_USD.firecrawlCrawlPage,
          topicId: topic.id,
          action: 'crawl_discover',
          meta: { discovered_count: discovered.length, seed: seedUrl },
        });
        costUsd += discovered.length * ESTIMATED_COST_USD.firecrawlCrawlPage;
        openWebPages = discovered.map((p) => ({
          url: p.url,
          markdown: p.markdown,
          sourceId: '',
          sourceTier: 'C' as const,
        }));
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        lastErr = `open-web crawl: ${msg}`;
        overallStatus = 'failed';
        sentryCapture(err, { 'rag.scraper.failed': '1', topic_id: topic.id, mode: 'open-web' });
      }
    }

    for (const source of sources) {
      sourcesTried += 1;
      const url = `https://${source.domain}/`;
      if (source.paused_at) continue;
      if (isExcludedDomain(url)) {
        // Defensive D-07 — admin shouldn't have allowlisted this, but if so, skip.
        continue;
      }
      try {
        await gateOrThrow(admin, 'firecrawl');
      } catch (err) {
        if (err instanceof CostCapExceededError) {
          // Auto-pause the source so it doesn't immediately retry next tick.
          await admin
            .from('rag_sources')
            .update({
              paused_at: new Date().toISOString(),
              paused_reason: `cost-cap: ${err.vendor} MTD $${err.mtdUsd}/${err.capUsd}`,
            })
            .eq('id', source.id);
          lastErr = err.message;
          overallStatus = 'partial';
          // Stop the whole topic-run; the cap is global per vendor.
          break;
        }
        throw err;
      }

      const robotsOk = await fc.respectsRobots(url);
      if (!robotsOk) {
        lastErr = `robots-disallow:${source.domain}`;
        overallStatus = overallStatus === 'failed' ? 'failed' : 'partial';
        continue;
      }

      try {
        const result = await scrapeWithBackoff(fc, url);
        await logVendorCost(admin, {
          vendor: 'firecrawl',
          amountUsd: ESTIMATED_COST_USD.firecrawlSingleScrape,
          topicId: topic.id,
          sourceId: source.id,
          action: 'scrape_single',
          meta: { url, canonical_url: result.canonicalUrl },
        });
        costUsd += ESTIMATED_COST_USD.firecrawlSingleScrape;
        await resetSourceFailure(admin, source.id);

        const ins = await insertChunkIfNew(admin, {
          topicId: topic.id,
          sourceId: source.id,
          canonicalUrl: result.canonicalUrl,
          markdown: result.markdown,
          topicTag: topic.tag,
          sourceTier: source.tier,
        });
        if (ins.inserted) chunksFound += 1;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        lastErr = `source:${source.domain}: ${msg}`;
        overallStatus = overallStatus === 'failed' ? 'failed' : 'partial';
        const { nowPaused } = await bumpSourceFailure(admin, source.id);
        if (nowPaused) {
          sentryCapture(err, {
            'rag.scraper.failed': '1',
            source_id: source.id,
            topic_id: topic.id,
            domain: source.domain,
          });
        }
      }
    }

    // Open-web pages — already cost-logged; we just need to INSERT chunks if
    // a synthetic source row is configured. Skipped for now (see note above).
    // Tracked for v1.4.
    if (openWebPages.length > 0) {
      lastErr = `open-web-pages-skipped:${openWebPages.length}`;
      if (overallStatus === 'ok') overallStatus = 'partial';
    }

    if (sourcesTried === 0 && topic.posture === 'curated') {
      overallStatus = 'partial';
      lastErr = lastErr ?? 'no-active-sources';
    }
  } catch (err) {
    overallStatus = 'failed';
    lastErr = err instanceof Error ? err.message : String(err);
    sentryCapture(err, { 'rag.scraper.failed': '1', topic_id: topic.id });
  }

  // Update run row + advance topic cadence.
  const durationMs = Date.now() - start;
  await admin
    .from('rag_scrape_runs')
    .update({
      completed_at: new Date().toISOString(),
      status: overallStatus,
      chunks_found: chunksFound,
      error_message: lastErr ?? null,
    })
    .eq('id', runId);

  // Advance next_scrape_at only on non-failed runs (failed → retry next tick).
  if (overallStatus !== 'failed') {
    await admin
      .from('rag_topics')
      .update({ next_scrape_at: nextScrapeAtFromCadence(claimed.cadence) })
      .eq('id', topic.id);
  }

  // Telemetry per-topic.
  try {
    captureRagEvent({
      name: 'rag_scrape_run',
      properties: {
        topic_id: topic.id,
        source_count: sourcesTried,
        chunks_found: chunksFound,
        duration_ms: durationMs,
        status: overallStatus,
        cost_usd: costUsd,
      },
    });
  } catch (e) {
    console.warn(
      `[rag-scrape-runner] captureRagEvent failed: ${e instanceof Error ? e.message : String(e)}`,
    );
  }

  // Chain to summarize step (fire-and-forget; Plan 50-05 owns).
  if (chunksFound > 0) {
    try {
      void admin.functions.invoke('rag-summarize-and-chunk', {
        body: { topic_id: topic.id },
      });
    } catch (e) {
      console.warn(
        `[rag-scrape-runner] chain to rag-summarize-and-chunk failed (Plan 50-05 not deployed?): ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  return {
    topic_id: topic.id,
    status: overallStatus,
    chunks_found: chunksFound,
    source_count: sourcesTried,
    duration_ms: durationMs,
    cost_usd: costUsd,
    error_message: lastErr,
  };
}

// ---------------------------------------------------------------------------
// HTTP handler
// ---------------------------------------------------------------------------

async function handleRequest(req: Request): Promise<Response> {
  const url = new URL(req.url);

  // Health probe — vendor-gated, never errors on missing keys.
  if (req.method === 'GET' && url.pathname.endsWith('/healthz')) {
    const fc = getFirecrawl();
    const firecrawl = await fc.healthCheck();
    return new Response(
      JSON.stringify({
        ok: firecrawl.ok,
        vendors: { firecrawl, openai: { ok: true }, anthropic: { ok: true } },
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      },
    );
  }

  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 });
  }

  // Service-role bearer check.
  const auth = req.headers.get('Authorization') ?? '';
  const expected = `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''}`;
  if (!Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || auth !== expected) {
    return new Response('Forbidden', { status: 403 });
  }

  let body: { topic_id?: string } = {};
  try {
    const raw = await req.text();
    if (raw && raw.trim()) body = JSON.parse(raw);
  } catch {
    // Empty body = cron tick; ignore parse error.
  }

  // Vendor-gated startup: if FIRECRAWL_API_KEY missing, log + no-op
  // (per [[reference_vendor_gated_send_health_check]]).
  if (!Deno.env.get('FIRECRAWL_API_KEY')) {
    console.warn(
      '[rag-scrape-runner] FIRECRAWL_API_KEY missing — scrape no-op. Returning 200 to keep cron silent.',
    );
    return new Response(
      JSON.stringify({ ok: false, reason: 'FIRECRAWL_API_KEY missing', topics_scraped: 0, chunks_found: 0 }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  }

  const admin = makeAdmin();
  const fc = getFirecrawl();

  try {
    const topics = await pickTopicsToScrape(admin, body.topic_id ?? null);
    const results: ScrapeRunSummary[] = [];
    for (const t of topics) {
      try {
        results.push(await scrapeTopic(admin, fc, t));
      } catch (err) {
        sentryCapture(err, { 'rag.scraper.failed': '1', topic_id: t.id });
        results.push({
          topic_id: t.id,
          status: 'failed',
          chunks_found: 0,
          source_count: 0,
          duration_ms: 0,
          cost_usd: 0,
          error_message: err instanceof Error ? err.message : String(err),
        });
      }
    }
    const chunksFound = results.reduce((acc, r) => acc + r.chunks_found, 0);
    return new Response(
      JSON.stringify({ ok: true, topics_scraped: results.length, chunks_found: chunksFound, results }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  } catch (err) {
    sentryCapture(err, { 'rag.scraper.failed': '1' });
    return new Response(
      JSON.stringify({
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }
}

Deno.serve(async (req: Request): Promise<Response> => {
  try {
    return await handleRequest(req);
  } finally {
    // D-13 mandate: flush PostHog batch before isolate teardown.
    await shutdownPostHog();
  }
});

// Test seam: re-export internals for integration tests without re-binding Deno.serve.
export {
  claimTopic,
  handleRequest,
  insertChunkIfNew,
  nextScrapeAtFromCadence,
  pickTopicsToScrape,
  scrapeWithBackoff,
};
