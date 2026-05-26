/**
 * Phase 62 Plan 62-06 Task 3 — Build-time RSS feed generator for /research/*.
 *
 * Node ESM script (no tsx required — re-implements buildRssXml inline).
 * Runs at build time via vite.config.ts buildStart hook OR directly:
 *   node scripts/build-research-rss.mjs
 *
 * Reads from Supabase (anon key):
 *   VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY
 *
 * If env vars are missing (CI without DB access):
 *   - Writes a minimal valid RSS with zero items
 *   - Warns to stderr (does NOT fail the build)
 *
 * Output:
 *   leanshot/public/research/rss.xml       — RSS 2.0 feed
 *   leanshot/public/research-content/*.md  — Static markdown copies for fetchResearchMarkdown()
 *
 * Security: T-62-06-05 — only fetches status='published' publications.
 * Build output: public/research/rss.xml is static; no runtime exposure.
 */

import { existsSync, mkdirSync, writeFileSync, readdirSync, copyFileSync } from 'node:fs';
import { resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const LEANSHOT_DIR = resolve(__dirname, '..');
const REPO_ROOT = resolve(LEANSHOT_DIR, '..');

const CANONICAL_BASE = 'https://app.leanshot.app';
const SELF_LINK = `${CANONICAL_BASE}/research/rss.xml`;

// ─── Inline RSS builder (avoids tsx dependency for node scripts) ──────────────

/**
 * Escapes XML reserved characters in text content.
 */
function escapeXml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Converts Date to RFC 822 format.
 * Example: "Sun, 31 May 2026 12:00:00 GMT"
 */
function toRfc822(date) {
  return new Date(date).toUTCString();
}

/**
 * Builds a complete RSS 2.0 XML string.
 */
function buildRssXml({ channelTitle, channelLink, channelDescription, items, selfLink }) {
  const itemsXml = items.map((item) => {
    return `    <item>
      <title>${escapeXml(item.title)}</title>
      <link>${escapeXml(item.link)}</link>
      <description>${escapeXml(item.description ?? '')}</description>
      <pubDate>${escapeXml(item.pubDate)}</pubDate>
      <guid isPermaLink="true">${escapeXml(item.guid)}</guid>
    </item>`;
  }).join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${escapeXml(channelTitle)}</title>
    <link>${escapeXml(channelLink)}</link>
    <description>${escapeXml(channelDescription)}</description>
    <atom:link href="${escapeXml(selfLink)}" rel="self" type="application/rss+xml" />
${itemsXml}
  </channel>
</rss>`;
}

// ─── Supabase fetch (minimal, no SDK dependency) ──────────────────────────────

const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL;
const ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY;

/**
 * Fetches published research publications from Supabase.
 * Returns empty array if env vars missing or request fails.
 */
async function fetchPublications() {
  if (!SUPABASE_URL || !ANON_KEY) {
    console.warn(
      '[build-research-rss] VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY not set — generating empty RSS feed.',
    );
    return [];
  }

  const url = new URL(`${SUPABASE_URL}/rest/v1/research_publications`);
  url.searchParams.set('select', 'id,slug,title,abstract,published_at');
  url.searchParams.set('status', 'eq.published');
  url.searchParams.set('order', 'published_at.desc');

  try {
    const res = await fetch(url.toString(), {
      headers: {
        apikey: ANON_KEY,
        Authorization: `Bearer ${ANON_KEY}`,
        Accept: 'application/json',
      },
    });

    if (!res.ok) {
      console.warn(`[build-research-rss] Supabase returned ${res.status} — generating empty RSS feed.`);
      return [];
    }

    return await res.json();
  } catch (err) {
    console.warn(`[build-research-rss] Network error fetching publications: ${err.message} — generating empty RSS feed.`);
    return [];
  }
}

// ─── Copy markdown content files ──────────────────────────────────────────────

/**
 * Copies content/research/*.md files from git root to public/research-content/.
 * This allows fetchResearchMarkdown() to GET /research-content/<slug>.md at runtime.
 */
function copyResearchMarkdownFiles() {
  const sourceDir = resolve(REPO_ROOT, 'content', 'research');
  const destDir = resolve(LEANSHOT_DIR, 'public', 'research-content');

  if (!existsSync(sourceDir)) {
    console.warn(`[build-research-rss] No content/research/ directory found at ${sourceDir} — skipping markdown copy.`);
    return;
  }

  mkdirSync(destDir, { recursive: true });

  const files = readdirSync(sourceDir).filter((f) => f.endsWith('.md'));
  let copied = 0;
  for (const file of files) {
    const src = resolve(sourceDir, file);
    const dest = resolve(destDir, file);
    copyFileSync(src, dest);
    copied++;
  }

  console.log(`[build-research-rss] Copied ${copied} markdown file(s) to public/research-content/`);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  // Ensure output directory exists
  const outputDir = resolve(LEANSHOT_DIR, 'public', 'research');
  mkdirSync(outputDir, { recursive: true });

  // 1. Copy content/research/*.md → public/research-content/
  copyResearchMarkdownFiles();

  // 2. Fetch published publications
  const publications = await fetchPublications();
  console.log(`[build-research-rss] Found ${publications.length} published publication(s).`);

  // 3. Build RSS items
  const items = publications.map((pub) => ({
    title: pub.title ?? 'Untitled',
    link: `${CANONICAL_BASE}/research/${pub.slug}`,
    description: pub.abstract ?? pub.title ?? '',
    pubDate: pub.published_at ? toRfc822(new Date(pub.published_at)) : toRfc822(new Date()),
    guid: `${CANONICAL_BASE}/research/${pub.slug}`,
  }));

  // 4. Build RSS XML
  const xml = buildRssXml({
    channelTitle: 'LeanShot Research',
    channelLink: `${CANONICAL_BASE}/research`,
    channelDescription: 'Evidence-based findings from anonymized, aggregate LeanShot treatment data.',
    items,
    selfLink: SELF_LINK,
  });

  // 5. Write to public/research/rss.xml
  const outputPath = resolve(outputDir, 'rss.xml');
  writeFileSync(outputPath, xml, 'utf-8');
  console.log(`[build-research-rss] Wrote ${outputPath} (${xml.length} bytes, ${items.length} items).`);

  // Print first 10 lines for verification
  const lines = xml.split('\n').slice(0, 10);
  console.log('[build-research-rss] RSS preview:\n' + lines.join('\n'));
}

main().catch((err) => {
  console.error('[build-research-rss] Fatal error:', err);
  process.exit(1);
});
