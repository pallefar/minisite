/**
 * Phase 62 Plan 62-06 Task 3 — Build-time sitemap extension for /research/*.
 *
 * Node ESM script. Appends /research/* URLs to public/sitemap.xml.
 * Runs at build time via vite.config.ts buildStart hook OR directly:
 *   node scripts/build-research-sitemap.mjs
 *
 * Reads from Supabase (anon key):
 *   VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY
 *
 * If env vars are missing: appends only /research (no slug URLs).
 *
 * T-62-06-05: Only fetches status='published' publications.
 *
 * Output: appends /research + /research/<slug> URLs to public/sitemap.xml.
 * If sitemap.xml doesn't exist, creates a minimal one.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const LEANSHOT_DIR = resolve(__dirname, '..');

const CANONICAL_BASE = 'https://app.leanshot.app';

// ─── Supabase fetch ───────────────────────────────────────────────────────────

const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL;
const ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY;

async function fetchPublications() {
  if (!SUPABASE_URL || !ANON_KEY) {
    console.warn(
      '[build-research-sitemap] VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY not set — appending /research only.',
    );
    return [];
  }

  const url = new URL(`${SUPABASE_URL}/rest/v1/research_publications`);
  url.searchParams.set('select', 'slug,published_at');
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
      console.warn(`[build-research-sitemap] Supabase returned ${res.status} — appending /research only.`);
      return [];
    }

    return await res.json();
  } catch (err) {
    console.warn(`[build-research-sitemap] Network error: ${err.message} — appending /research only.`);
    return [];
  }
}

// ─── Sitemap manipulation ─────────────────────────────────────────────────────

function formatLastmod(iso) {
  if (!iso) return '';
  try {
    return new Date(iso).toISOString().slice(0, 10);
  } catch {
    return '';
  }
}

/**
 * Reads existing sitemap.xml or generates a minimal skeleton.
 */
function readOrCreateSitemap(sitemapPath) {
  if (existsSync(sitemapPath)) {
    return readFileSync(sitemapPath, 'utf-8');
  }
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
</urlset>`;
}

/**
 * Appends /research and /research/<slug> URL entries to sitemap XML.
 * Inserts before closing </urlset> tag.
 */
function appendResearchUrls(sitemapXml, publications) {
  const researchUrls = [
    // Root /research index
    `  <url><loc>${CANONICAL_BASE}/research</loc></url>`,
    // Per-publication URLs (T-62-06-05: only published ones)
    ...publications.map((pub) => {
      const lastmod = formatLastmod(pub.published_at);
      const lastmodTag = lastmod ? `<lastmod>${lastmod}</lastmod>` : '';
      return `  <url><loc>${CANONICAL_BASE}/research/${pub.slug}</loc>${lastmodTag}</url>`;
    }),
  ];

  // Remove any existing /research entries to avoid duplicates on re-run
  const filteredXml = sitemapXml.replace(
    /\s*<url><loc>https:\/\/app\.leanshot\.app\/research[^<]*<\/loc>[^<]*<\/url>/g,
    '',
  );

  // Insert before closing </urlset>
  const closeTag = '</urlset>';
  const insertPos = filteredXml.lastIndexOf(closeTag);
  if (insertPos === -1) {
    // Malformed sitemap — append at end
    return filteredXml + '\n' + researchUrls.join('\n') + '\n';
  }

  return (
    filteredXml.slice(0, insertPos) +
    researchUrls.join('\n') + '\n' +
    filteredXml.slice(insertPos)
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const sitemapPath = resolve(LEANSHOT_DIR, 'public', 'sitemap.xml');

  // Fetch published publications (T-62-06-05: only published)
  const publications = await fetchPublications();
  console.log(`[build-research-sitemap] Found ${publications.length} published publication(s).`);

  // Read or create sitemap
  const existingSitemap = readOrCreateSitemap(sitemapPath);

  // Append research URLs
  const updatedSitemap = appendResearchUrls(existingSitemap, publications);

  // Write back
  writeFileSync(sitemapPath, updatedSitemap, 'utf-8');
  console.log(`[build-research-sitemap] Updated ${sitemapPath} with ${publications.length + 1} /research/* URLs.`);
}

main().catch((err) => {
  console.error('[build-research-sitemap] Fatal error:', err);
  process.exit(1);
});
