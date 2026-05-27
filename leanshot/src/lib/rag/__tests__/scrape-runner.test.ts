/**
 * Phase 50 Plan 50-04 — rag-scrape-runner behavior tests.
 *
 * Covers D-01 (curated vs open-web), D-02 (Firecrawl backend), D-03 (robots.txt),
 * D-07 (on-label gating), D-31 (3-attempt exponential backoff + auto-pause).
 *
 * Pure-function assertions against the vitest-side mirror at
 * `src/lib/rag/scrape/runner-helpers.ts` + the Firecrawl wrapper's exclusion
 * list (also mirrored). Contract assertions against the Deno index.ts are
 * done via fs.readFileSync grep — see "runner contract grep" suite.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  EXCLUDED_DOMAINS,
  isExcludedDomain,
  parseRobots,
  retryWithBackoff,
  RETRY_BACKOFF_MS,
} from '../scrape/runner-helpers';

// Repo root = three levels up from leanshot/src/lib/rag/__tests__/ (we are
// inside the leanshot subdir of the minisite monorepo).
const REPO_ROOT = resolve(__dirname, '../../../../..');
const RUNNER_INDEX_PATH = resolve(
  REPO_ROOT,
  'supabase/functions/rag-scrape-runner/index.ts',
);
const FIRECRAWL_PATH = resolve(
  REPO_ROOT,
  'supabase/functions/rag-scrape-runner/firecrawl.ts',
);

function readRunnerIndex(): string {
  return readFileSync(RUNNER_INDEX_PATH, 'utf-8');
}
function readFirecrawl(): string {
  return readFileSync(FIRECRAWL_PATH, 'utf-8');
}

describe('Phase 50 Plan 50-04 — rag-scrape-runner', () => {
  describe('D-07: on-label gating (EXCLUDED_DOMAINS)', () => {
    it('lists the 6 peptide-bro forum domains', () => {
      expect(EXCLUDED_DOMAINS).toContain('peptidesources.com');
      expect(EXCLUDED_DOMAINS).toContain('peptidesciences.com');
      expect(EXCLUDED_DOMAINS).toContain('reddit.com/r/peptides');
      expect(EXCLUDED_DOMAINS).toContain('reddit.com/r/Peptides');
      expect(EXCLUDED_DOMAINS).toContain('musclechemistry.com');
      expect(EXCLUDED_DOMAINS).toContain('anabolicminds.com');
    });

    it('refuses scrape on excluded domain (bare hostname)', () => {
      expect(isExcludedDomain('https://peptidesources.com/some/path')).toBe(true);
      expect(isExcludedDomain('https://www.peptidesciences.com/')).toBe(true);
    });

    it('refuses scrape on excluded Reddit subreddit (host+path)', () => {
      expect(isExcludedDomain('https://reddit.com/r/peptides/comments/abc')).toBe(true);
      expect(isExcludedDomain('https://reddit.com/r/Peptides/wiki')).toBe(true);
    });

    it('allows scrape on non-excluded domain', () => {
      expect(isExcludedDomain('https://pubmed.ncbi.nlm.nih.gov/12345')).toBe(false);
      expect(isExcludedDomain('https://lilly.com/products')).toBe(false);
      expect(isExcludedDomain('https://reddit.com/r/diabetes/comments/abc')).toBe(false);
    });

    it('refuses unparseable URLs (defensive)', () => {
      expect(isExcludedDomain('not-a-url')).toBe(true);
      expect(isExcludedDomain('')).toBe(true);
    });

    it('Deno-side firecrawl.ts also exports the same exclusion list (D-07 invariant)', () => {
      const src = readFirecrawl();
      for (const d of EXCLUDED_DOMAINS) {
        expect(src).toContain(d);
      }
    });
  });

  describe('D-03: robots.txt enforcement (parseRobots)', () => {
    it('default-allows when no rules present', () => {
      expect(parseRobots('', '/path')).toBe(true);
      expect(parseRobots('User-agent: Googlebot\nDisallow: /', '/path')).toBe(true);
    });

    it('honors Disallow: / under User-agent: *', () => {
      const txt = 'User-agent: *\nDisallow: /';
      expect(parseRobots(txt, '/anything')).toBe(false);
    });

    it('honors path-prefix Disallow', () => {
      const txt = 'User-agent: *\nDisallow: /admin/\nAllow: /admin/public/';
      expect(parseRobots(txt, '/admin/secret')).toBe(false);
      expect(parseRobots(txt, '/admin/public/page')).toBe(true);
      expect(parseRobots(txt, '/products')).toBe(true);
    });

    it('strips comments', () => {
      const txt = 'User-agent: *  # all bots\nDisallow: /private # private area';
      expect(parseRobots(txt, '/private/x')).toBe(false);
      expect(parseRobots(txt, '/public/x')).toBe(true);
    });

    it('Disallow with empty value means allow-all', () => {
      const txt = 'User-agent: *\nDisallow:';
      expect(parseRobots(txt, '/anything')).toBe(true);
    });
  });

  describe('D-31: 3-attempt exponential backoff', () => {
    it('exposes the 1m / 5m / 15m schedule constants', () => {
      expect(RETRY_BACKOFF_MS).toEqual([60_000, 300_000, 900_000]);
    });

    it('retries 3x on retriable errors, sleeping with the backoff schedule', async () => {
      const sleeps: number[] = [];
      const op = vi
        .fn<() => Promise<string>>()
        .mockRejectedValueOnce(new Error('fail1'))
        .mockRejectedValueOnce(new Error('fail2'))
        .mockResolvedValueOnce('ok');
      const result = await retryWithBackoff(op, {
        sleep: async (ms) => {
          sleeps.push(ms);
        },
      });
      expect(result).toBe('ok');
      expect(op).toHaveBeenCalledTimes(3);
      expect(sleeps).toEqual([60_000, 300_000]);
    });

    it('throws after 3 failed attempts with the last error', async () => {
      const sleeps: number[] = [];
      const op = vi
        .fn<() => Promise<string>>()
        .mockRejectedValue(new Error('always-fails'));
      await expect(
        retryWithBackoff(op, {
          sleep: async (ms) => {
            sleeps.push(ms);
          },
        }),
      ).rejects.toThrow(/always-fails/);
      expect(op).toHaveBeenCalledTimes(3);
      expect(sleeps).toEqual([60_000, 300_000]); // 2 sleeps between 3 attempts
    });

    it('does NOT retry when isRetriable returns false', async () => {
      const op = vi.fn<() => Promise<string>>().mockRejectedValue(new Error('hard-fail'));
      await expect(
        retryWithBackoff(op, {
          isRetriable: () => false,
          sleep: async () => {},
        }),
      ).rejects.toThrow(/hard-fail/);
      expect(op).toHaveBeenCalledTimes(1);
    });

    it('succeeds on first try without sleeping', async () => {
      const sleeps: number[] = [];
      const op = vi.fn<() => Promise<string>>().mockResolvedValueOnce('first');
      const result = await retryWithBackoff(op, {
        sleep: async (ms) => {
          sleeps.push(ms);
        },
      });
      expect(result).toBe('first');
      expect(op).toHaveBeenCalledTimes(1);
      expect(sleeps).toEqual([]);
    });
  });

  describe('D-01 + D-02: Firecrawl backend contract (runner contract grep)', () => {
    it('imports @mendable/firecrawl-js from esm.sh (NOT npm: scheme)', () => {
      const src = readFirecrawl();
      expect(src).toMatch(/from\s+['"]https:\/\/esm\.sh\/@mendable\/firecrawl-js@1['"]/);
      // Strip comments before checking forbidden pattern per
      // [[reference_grep_gate_comment_strip]].
      const codeOnly = src
        .split('\n')
        .filter((l) => !/^\s*\*/.test(l) && !/^\s*\/\//.test(l) && !/^\s*\/\*/.test(l))
        .join('\n');
      expect(codeOnly).not.toMatch(/from\s+['"]npm:@mendable/);
    });

    it('curated topic refuses non-allowlist URL (Firecrawl client gated by source row presence)', () => {
      // The runner only iterates rag_sources rows for curated topics; this is
      // enforced by the Postgres FK + the resolveSources query. The grep here
      // confirms the runner's curated path calls resolveSources and never
      // accepts a bare URL from request body for curated topics.
      const src = readRunnerIndex();
      expect(src).toMatch(/resolveSources/);
      expect(src).toMatch(/topic\.posture === ['"]curated['"]/);
    });

    it('open-web topic calls Firecrawl /v1/crawl with seed URL', () => {
      const src = readRunnerIndex();
      expect(src).toMatch(/crawlDiscover/);
      expect(src).toMatch(/duckduckgo\.com\/html/);
    });

    it('stores excerpt + canonical URL (not full text)', () => {
      const src = readRunnerIndex();
      // excerpt slice at 4000 chars
      expect(src).toMatch(/markdown\.slice\(0,\s*4000\)/);
      expect(src).toMatch(/canonical_url:\s*args\.canonicalUrl/);
    });

    it('honors robots.txt before scraping (D-03)', () => {
      const src = readRunnerIndex();
      expect(src).toMatch(/respectsRobots\(url\)/);
      expect(src).toMatch(/robots-disallow/);
    });
  });

  describe('D-31: auto-pause source after 3 consecutive failed runs', () => {
    it('runner bumps consecutive_failures and pauses at >= 3', () => {
      const src = readRunnerIndex();
      expect(src).toMatch(/bumpSourceFailure/);
      expect(src).toMatch(/consecutive_failures/);
      // Auto-pause at 3
      expect(src).toMatch(/next\s*>=\s*3/);
      // paused_at set
      expect(src).toMatch(/paused_at:\s*new Date\(\)\.toISOString\(\)/);
    });

    it('runner emits sentryCapture with rag.scraper.failed tag on auto-pause', () => {
      const src = readRunnerIndex();
      expect(src).toMatch(/sentryCapture/);
      expect(src).toMatch(/['"]rag\.scraper\.failed['"]/);
    });

    it('runner resets consecutive_failures on successful scrape', () => {
      const src = readRunnerIndex();
      expect(src).toMatch(/resetSourceFailure/);
    });
  });

  describe('D-30: cost gating short-circuits before Firecrawl call', () => {
    it('runner calls gateOrThrow BEFORE scrapeWithBackoff', () => {
      const src = readRunnerIndex();
      const gateIdx = src.indexOf('gateOrThrow(admin,');
      const scrapeIdx = src.indexOf('scrapeWithBackoff(fc, url)');
      expect(gateIdx).toBeGreaterThan(-1);
      expect(scrapeIdx).toBeGreaterThan(-1);
      expect(gateIdx).toBeLessThan(scrapeIdx);
    });

    it('CostCapExceededError catch auto-pauses the source', () => {
      const src = readRunnerIndex();
      expect(src).toMatch(/CostCapExceededError/);
      expect(src).toMatch(/cost-cap:/);
    });
  });

  describe('D-22: captureRagEvent fired with required properties', () => {
    it('runner calls captureRagEvent with rag_scrape_run + duration_ms + cost_usd', () => {
      const src = readRunnerIndex();
      expect(src).toMatch(/captureRagEvent\(/);
      expect(src).toMatch(/['"]rag_scrape_run['"]/);
      expect(src).toMatch(/duration_ms/);
      expect(src).toMatch(/cost_usd/);
    });
  });

  describe('vendor-gated startup (FIRECRAWL_API_KEY missing)', () => {
    it('runner returns 200 + ok:false reason when FIRECRAWL_API_KEY missing', () => {
      const src = readRunnerIndex();
      expect(src).toMatch(/FIRECRAWL_API_KEY missing/);
      // Must be 200 not 500 — vendor-gated send pattern.
      expect(src).toMatch(/status:\s*200,/);
    });
  });
});
