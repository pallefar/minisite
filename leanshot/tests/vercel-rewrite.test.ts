/**
 * vercel-rewrite.test.ts
 *
 * Asserts that the vercel.json rewrite carve-out for /api/og/(.*) and
 * /share/level/(.*) is ordered BEFORE the SPA fallback /share/(.*) → /index.html.
 *
 * Research A1 (load-bearing): if the carve-out is missing or mis-ordered, social
 * bots scraping /share/level/<token> receive the empty SPA shell instead of the
 * SSR HTML with OG meta tags — the share card renders blank on Twitter/LinkedIn.
 *
 * This test is deterministic (reads the JSON on disk) and runs in every CI run
 * without a deployed environment.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const vercelJson = JSON.parse(
  readFileSync(resolve(__dirname, '../vercel.json'), 'utf-8'),
) as {
  rewrites: Array<{ source: string; destination: string }>;
};

const sources = vercelJson.rewrites.map((r) => r.source);

describe('vercel.json rewrite carve-out (Research A1 — load-bearing)', () => {
  it('includes /api/og/(.*) rewrite', () => {
    expect(sources).toContain('/api/og/(.*)');
  });

  it('includes /share/level/(.*) rewrite', () => {
    expect(sources).toContain('/share/level/(.*)');
  });

  it('/share/level/(.*) is ABOVE the SPA share fallback /share/(.*) (order matters)', () => {
    const shareLevelIdx = sources.indexOf('/share/level/(.*)');
    const shareFallbackIdx = sources.indexOf('/share/(.*)');
    expect(shareLevelIdx).toBeGreaterThanOrEqual(0);
    expect(shareFallbackIdx).toBeGreaterThan(shareLevelIdx);
  });

  it('/api/og/(.*) is ABOVE the SPA share fallback /share/(.*) (order matters)', () => {
    const ogIdx = sources.indexOf('/api/og/(.*)');
    const shareFallbackIdx = sources.indexOf('/share/(.*)');
    expect(ogIdx).toBeGreaterThanOrEqual(0);
    expect(shareFallbackIdx).toBeGreaterThan(ogIdx);
  });
});
