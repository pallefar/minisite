/**
 * Vitest-friendly mirror of the pure helpers from
 * supabase/functions/rag-scrape-runner/index.ts.
 *
 * Phase 50 Plan 50-04 — the Deno-runtime index.ts cannot be imported in vitest
 * because of `npm:` specifiers + Deno.serve / Deno.env globals. This mirror
 * exposes the pure-function pieces so we can test:
 *   - cadence → next_scrape_at advancement (D-09)
 *   - on-label gating reuse via re-export
 *   - retry-backoff loop (with injected sleep)
 *
 * If you modify any function here, also modify
 * `supabase/functions/rag-scrape-runner/index.ts` to match.
 */

export type Cadence = 'daily' | 'weekly' | 'monthly' | 'manual';

export function nextScrapeAtFromCadence(cadence: Cadence, now: Date = new Date()): string | null {
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

export const RETRY_BACKOFF_MS = [60_000, 300_000, 900_000] as const;

/**
 * Generic 3-attempt exponential-backoff loop. The runner's scrapeWithBackoff
 * specializes this with the Firecrawl client; this helper is the testable
 * inner loop.
 *
 * `op` returns the success value; if it throws, the loop sleeps and retries
 * UP TO 3 attempts. `isRetriable(err)` controls whether to keep going.
 * `sleep` is injectable for tests.
 */
export async function retryWithBackoff<T>(
  op: () => Promise<T>,
  opts: {
    isRetriable?: (err: unknown) => boolean;
    sleep?: (ms: number) => Promise<void>;
    backoffMs?: readonly number[];
  } = {},
): Promise<T> {
  const isRetriable = opts.isRetriable ?? (() => true);
  const sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  const backoff = opts.backoffMs ?? RETRY_BACKOFF_MS;
  let lastErr: unknown = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await op();
    } catch (err) {
      lastErr = err;
      if (!isRetriable(err)) break;
      if (attempt < 2) {
        await sleep(backoff[attempt]);
      }
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('retryWithBackoff failed');
}

/**
 * On-label gating mirror — must match the Deno EXCLUDED_DOMAINS list verbatim
 * for tests to assert D-07 invariants.
 */
export const EXCLUDED_DOMAINS = [
  'peptidesources.com',
  'peptidesciences.com',
  'reddit.com/r/peptides',
  'reddit.com/r/Peptides',
  'musclechemistry.com',
  'anabolicminds.com',
] as const;

export function isExcludedDomain(url: string): boolean {
  let host: string;
  let path = '';
  try {
    const u = new URL(url);
    host = u.hostname.toLowerCase();
    path = u.pathname.toLowerCase();
  } catch {
    return true;
  }
  for (const excluded of EXCLUDED_DOMAINS) {
    const ex = excluded.toLowerCase();
    if (ex.includes('/')) {
      const [exHost, ...exPathParts] = ex.split('/');
      const exPath = '/' + exPathParts.join('/');
      if (host === exHost && path.startsWith(exPath)) return true;
    } else {
      if (host === ex || host.endsWith('.' + ex)) return true;
    }
  }
  return false;
}

/**
 * Tiny robots.txt parser mirror (D-03).
 */
export function parseRobots(robotsTxt: string, pathToCheck: string): boolean {
  const lines = robotsTxt.split(/\r?\n/);
  let inStarBlock = false;
  const rules: Array<{ type: 'allow' | 'disallow'; path: string }> = [];
  for (const rawLine of lines) {
    const line = rawLine.split('#')[0].trim();
    if (!line) continue;
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim().toLowerCase();
    const value = line.slice(colonIdx + 1).trim();
    if (key === 'user-agent') {
      inStarBlock = value === '*';
      continue;
    }
    if (!inStarBlock) continue;
    if (key === 'allow' && value) {
      rules.push({ type: 'allow', path: value });
    } else if (key === 'disallow') {
      if (value) rules.push({ type: 'disallow', path: value });
    }
  }
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
