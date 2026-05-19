/**
 * Firecrawl client wrapper for Phase 50 Plan 50-04 rag-scrape-runner.
 *
 * Wraps @mendable/firecrawl-js v1.x with:
 *   - vendor-gated health check (no-throw on missing FIRECRAWL_API_KEY, per
 *     [[reference_vendor_gated_send_health_check]]).
 *   - robots.txt enforcement (D-03 — User-agent: * Disallow rules).
 *   - on-label gating (D-07 — peptide-bro forum exclusion list).
 *   - retriable FirecrawlError sentinel for the runner's exponential-backoff loop.
 *
 * Imported from esm.sh per [[reference_supabase_edge_function_deploy]]:
 *   the Edge Fn bundler ignores import_map.json so we use a direct URL specifier.
 *   NOT the npm specifier scheme (would not resolve in the Deno deploy bundler).
 *
 * Decision references:
 *   - D-01: curated topic refuses non-allowlist domains (caller enforces via
 *     `rag_sources` lookup); open-web topic uses /v1/crawl (this module exposes
 *     both scrapeSingle and crawlDiscover).
 *   - D-02: Firecrawl backend; JS SDK v1.x.
 *   - D-03: robots.txt honored before scraping; storage = excerpt + summary + URL.
 *   - D-07: EXCLUDED_DOMAINS guards against peptide-bro forums even if admin
 *     mis-adds one to the allowlist.
 *
 * @internal Edge Function / Deno runtime only. Do not import from src/.
 */

import { FirecrawlApp } from 'https://esm.sh/@mendable/firecrawl-js@1';

/**
 * Sentinel thrown by scrapeSingle / crawlDiscover when Firecrawl rejects.
 * `retriable=true` means the caller (rag-scrape-runner) should apply
 * exponential backoff per D-31. `retriable=false` means the URL is permanently
 * unavailable (404, robots-disallow already filtered upstream, etc.).
 */
export class FirecrawlError extends Error {
  public readonly retriable: boolean;
  public readonly status?: number;
  constructor(msg: string, retriable: boolean, status?: number) {
    super(msg);
    this.name = 'FirecrawlError';
    this.retriable = retriable;
    this.status = status;
  }
}

/**
 * On-label gating per D-07. Even if an admin mis-adds one of these domains to
 * `rag_sources`, the scraper refuses. RAG only surfaces FDA-approved GLP-1
 * content from peer-reviewed / regulator / mainstream-health sources — never
 * gray-market peptide-bro forums.
 */
export const EXCLUDED_DOMAINS = [
  'peptidesources.com',
  'peptidesciences.com',
  'reddit.com/r/peptides',
  'reddit.com/r/Peptides',
  'musclechemistry.com',
  'anabolicminds.com',
] as const;

/**
 * Case-insensitive substring match against EXCLUDED_DOMAINS. URLs whose host
 * (or host+pathprefix for Reddit subreddits) appears in the excluded set are
 * refused before any Firecrawl call.
 */
export function isExcludedDomain(url: string): boolean {
  let host: string;
  let path = '';
  try {
    const u = new URL(url);
    host = u.hostname.toLowerCase();
    path = u.pathname.toLowerCase();
  } catch {
    // Unparseable URL — defensively refuse.
    return true;
  }
  for (const excluded of EXCLUDED_DOMAINS) {
    const ex = excluded.toLowerCase();
    if (ex.includes('/')) {
      // e.g. 'reddit.com/r/peptides' — match host + path prefix.
      const [exHost, ...exPathParts] = ex.split('/');
      const exPath = '/' + exPathParts.join('/');
      if (host === exHost && path.startsWith(exPath)) return true;
    } else {
      // bare hostname — match exact or subdomain.
      if (host === ex || host.endsWith('.' + ex)) return true;
    }
  }
  return false;
}

export interface ScrapeResult {
  /** Cleaned markdown from Firecrawl (`onlyMainContent: true`). */
  markdown: string;
  /** Canonical URL Firecrawl resolved (after redirects). */
  canonicalUrl: string;
  /** ISO timestamp of when the scrape completed. */
  scrapedAt: string;
}

export interface CrawlDiscoveredPage {
  url: string;
  markdown: string;
}

/**
 * Tiny robots.txt parser. Only implements the subset relevant to D-03:
 * matches User-agent: * blocks and evaluates Allow / Disallow rules with
 * longest-match-wins precedence. Returns true if the path is allowed.
 *
 * Not fully spec-compliant (no wildcards in path, no crawl-delay, no
 * per-bot rules) — sufficient for our allowlisted sources (PubMed, FDA,
 * Lilly, drugs.com, etc.) which use plain prefix rules.
 */
export function parseRobots(robotsTxt: string, pathToCheck: string): boolean {
  const lines = robotsTxt.split(/\r?\n/);
  let inStarBlock = false;
  // Each rule: { type: 'allow' | 'disallow', path: string }
  const rules: Array<{ type: 'allow' | 'disallow'; path: string }> = [];
  for (const rawLine of lines) {
    const line = rawLine.split('#')[0].trim(); // strip comments
    if (!line) continue;
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim().toLowerCase();
    const value = line.slice(colonIdx + 1).trim();
    if (key === 'user-agent') {
      // A new user-agent block — restart tracking only if it's '*'.
      inStarBlock = value === '*';
      continue;
    }
    if (!inStarBlock) continue;
    if (key === 'allow' && value) {
      rules.push({ type: 'allow', path: value });
    } else if (key === 'disallow') {
      if (value) rules.push({ type: 'disallow', path: value });
      // Empty Disallow means "allow all" in the User-agent: * block.
    }
  }
  // Longest-match-wins. Default = allowed (no matching rule).
  let best: { type: 'allow' | 'disallow'; path: string } | null = null;
  for (const rule of rules) {
    if (pathToCheck.startsWith(rule.path)) {
      if (!best || rule.path.length > best.path.length) {
        best = rule;
      }
    }
  }
  if (!best) return true;
  return best.type === 'allow';
}

/**
 * Firecrawl client. Constructed with an API key; methods are vendor-gated
 * (healthCheck never throws even when key is missing).
 */
export class FirecrawlClient {
  private readonly apiKey: string;
  private _app: InstanceType<typeof FirecrawlApp> | null = null;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  private getApp(): InstanceType<typeof FirecrawlApp> {
    if (this._app) return this._app;
    if (!this.apiKey) {
      throw new FirecrawlError('FIRECRAWL_API_KEY missing', false);
    }
    this._app = new FirecrawlApp({ apiKey: this.apiKey });
    return this._app;
  }

  /**
   * Vendor-gated health check. Returns `{ ok: true }` if Firecrawl is callable
   * with the configured key. Returns `{ ok: false, reason }` on missing key
   * OR network failure OR Firecrawl error — never throws.
   *
   * Caller (rag-scrape-runner /healthz handler) logs the reason and serves a
   * 200 response with `{ ok: false }` so the deploy never fails on a missing
   * key, per [[reference_vendor_gated_send_health_check]].
   */
  async healthCheck(): Promise<{ ok: boolean; reason?: string }> {
    if (!this.apiKey) {
      return { ok: false, reason: 'FIRECRAWL_API_KEY missing' };
    }
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5_000);
      try {
        const app = this.getApp();
        // Probe with a tiny, known-good URL.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const result: any = await app.scrapeUrl('https://example.com', {
          formats: ['markdown'],
          onlyMainContent: true,
          timeout: 5_000,
        });
        clearTimeout(timer);
        if (result && (result.success === true || result.markdown || result.data)) {
          return { ok: true };
        }
        return { ok: false, reason: 'unexpected Firecrawl response shape' };
      } finally {
        clearTimeout(timer);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { ok: false, reason: `Firecrawl health probe failed: ${msg}` };
    }
  }

  /**
   * Fetch and parse robots.txt for the URL's origin. Returns true if scraping
   * the URL's path is allowed for User-agent: *. Returns true on fetch failure
   * (defensive: if robots.txt is unreachable, we proceed — Firecrawl itself
   * also respects robots).
   *
   * Decision ref: D-03.
   */
  async respectsRobots(url: string): Promise<boolean> {
    let origin: string;
    let pathToCheck: string;
    try {
      const u = new URL(url);
      origin = `${u.protocol}//${u.host}`;
      pathToCheck = u.pathname + u.search;
    } catch {
      return false;
    }
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5_000);
      const res = await fetch(`${origin}/robots.txt`, {
        signal: controller.signal,
        headers: { 'User-Agent': 'leanshot-rag-scraper/1.0' },
      });
      clearTimeout(timer);
      if (!res.ok) {
        // No robots.txt or fetch error — default-allow per RFC 9309 §2.2.1.
        return true;
      }
      const text = await res.text();
      return parseRobots(text, pathToCheck);
    } catch {
      // Fetch failed (network, timeout) — default-allow.
      return true;
    }
  }

  /**
   * Single-URL scrape. Returns markdown + canonical URL + scraped-at timestamp.
   * Throws FirecrawlError on failure; caller decides whether to retry based
   * on `retriable`.
   *
   * Default timeout 30s — Firecrawl's own waitFor is 1500ms so 30s is plenty
   * for slow-rendering pages.
   */
  async scrapeSingle(
    url: string,
    opts: { timeoutMs?: number } = {},
  ): Promise<ScrapeResult> {
    const app = this.getApp();
    const scrapedAt = new Date().toISOString();
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result: any = await app.scrapeUrl(url, {
        formats: ['markdown'],
        onlyMainContent: true,
        waitFor: 1500,
        timeout: opts.timeoutMs ?? 30_000,
      });
      // Firecrawl JS SDK v1 returns either { success, markdown, metadata } at
      // top level, or { success, data: { markdown, metadata } } depending on
      // SDK version. Normalize both.
      const md: string = result?.markdown ?? result?.data?.markdown ?? '';
      const canonicalUrl: string =
        result?.metadata?.sourceURL ??
        result?.data?.metadata?.sourceURL ??
        url;
      if (!md) {
        throw new FirecrawlError(
          `Firecrawl returned empty markdown for ${url}`,
          true,
        );
      }
      return { markdown: md, canonicalUrl, scrapedAt };
    } catch (err) {
      if (err instanceof FirecrawlError) throw err;
      const msg = err instanceof Error ? err.message : String(err);
      // Heuristic: 4xx (except 408/429) = non-retriable; everything else =
      // retriable so the runner's exponential backoff kicks in.
      const status = (err as { statusCode?: number } | null)?.statusCode;
      const retriable =
        status === undefined ||
        status >= 500 ||
        status === 408 ||
        status === 429;
      throw new FirecrawlError(`Firecrawl scrape failed: ${msg}`, retriable, status);
    }
  }

  /**
   * Open-web discovery crawl per D-01. Seeds Firecrawl with a single URL and
   * returns up to `opts.limit` discovered pages (default 10).
   */
  async crawlDiscover(
    seedUrl: string,
    opts: { limit?: number } = {},
  ): Promise<CrawlDiscoveredPage[]> {
    const app = this.getApp();
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result: any = await app.crawlUrl(seedUrl, {
        limit: opts.limit ?? 10,
        scrapeOptions: {
          formats: ['markdown'],
          onlyMainContent: true,
        },
      });
      const data: Array<{ markdown?: string; metadata?: { sourceURL?: string } }> =
        result?.data ?? [];
      return data
        .filter((p) => Boolean(p.markdown))
        .map((p) => ({
          url: p.metadata?.sourceURL ?? seedUrl,
          markdown: p.markdown ?? '',
        }));
    } catch (err) {
      if (err instanceof FirecrawlError) throw err;
      const msg = err instanceof Error ? err.message : String(err);
      const status = (err as { statusCode?: number } | null)?.statusCode;
      const retriable =
        status === undefined ||
        status >= 500 ||
        status === 408 ||
        status === 429;
      throw new FirecrawlError(`Firecrawl crawl failed: ${msg}`, retriable, status);
    }
  }
}
