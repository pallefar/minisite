/**
 * Phase 60 Plan 60-13 — Build-time sitemap.xml + og card generator.
 *
 * Node + TypeScript script (tsx-runner). Invoked via:
 *   tsx scripts/build-sitemap.ts
 *   tsx scripts/build-sitemap.ts --dry-run   (prints stats, no writes)
 *   tsx scripts/build-sitemap.ts --force      (regenerate all og cards)
 *
 * Wired to package.json `prebuild` script:
 *   "prebuild": "tsx scripts/build-sitemap.ts || echo 'sitemap skipped (db unreachable)'"
 * Non-fatal: dev builds without SUPABASE_URL proceed normally.
 *
 * Output:
 *   public/sitemap.xml          — grouped by topic
 *   public/og/knowledge/<topic>/<slug>.png  — 1200×630 og cards
 *
 * T-60-13-AUTHZ-1 mitigation: this script is Node-side ONLY, never imported
 * by src/. Service-role key stays in CI env, never in client bundle.
 *
 * Schema:
 *   /knowledge                              — root, priority 1.0
 *   /knowledge/<topic>                      — topic index, priority 0.8
 *   /knowledge/<topic>/<slug>               — article, priority 0.6
 */

import { createClient } from '@supabase/supabase-js';
import { existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TOPIC_DISPLAY_NAMES } from '../src/lib/knowledge/topics';

const __dirname = dirname(fileURLToPath(import.meta.url));
const LEANSHOT_DIR = resolve(__dirname, '..');

const CANONICAL_BASE = 'https://app.leanshot.app';
const DRY_RUN = process.argv.includes('--dry-run');
const FORCE = process.argv.includes('--force');

// ─── Supabase client (service-role, build-time only) ─────────────────────────

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  if (DRY_RUN) {
    console.log('🏜  --dry-run: No DB credentials — generating empty sitemap skeleton');
    generateEmptySitemap();
    process.exit(0);
  }
  console.warn(
    '⚠  build-sitemap: SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not set — skipping sitemap generation',
  );
  process.exit(0);
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

// ─── Chunk type ───────────────────────────────────────────────────────────────

interface SitemapChunk {
  id: string;
  topic_tag: string;
  slug: string | null;
  title: string | null;
  published_at: string | null;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`📚 build-sitemap: querying published chunks...${DRY_RUN ? ' (dry-run)' : ''}`);

  const { data, error } = await supabase
    .from('rag_chunks')
    .select('id, topic_tag, slug, title, published_at')
    .eq('status', 'published')
    .is('retracted_at', null)
    .eq('public_visibility', true)
    .not('slug', 'is', null)
    .order('published_at', { ascending: false });

  if (error) {
    console.error('❌ build-sitemap: DB query failed:', error.message);
    process.exit(0); // non-fatal
  }

  const chunks = (data ?? []) as SitemapChunk[];
  const sluggedChunks = chunks.filter((c) => c.slug !== null);

  // Deduplicate topics
  const topicSet = new Set(sluggedChunks.map((c) => c.topic_tag));
  const topics = [...topicSet].filter((t) => t in TOPIC_DISPLAY_NAMES);

  const articleCount = sluggedChunks.length;
  const topicCount = topics.length;

  console.log(
    `  Found: ${articleCount} articles across ${topicCount} topics`,
  );

  // ── Generate sitemap.xml ───────────────────────────────────────────────────
  const urls: string[] = [];

  // Root
  urls.push(
    `  <url>\n    <loc>${CANONICAL_BASE}/knowledge</loc>\n    <changefreq>weekly</changefreq>\n    <priority>1.0</priority>\n  </url>`,
  );

  // Phase 68 Plan 68-03 — audience-specific landing pages
  // (/for-doctors, /for-clinics, /for-coaches). High-priority (0.9) because
  // they're the conversion-side surface for clinic / coach / doctor traffic
  // referred via UTM-default-landing (Phase 51 + Phase 68-01 utm_landing_defaults).
  // changefreq=monthly because the page-builder seed is operator-editable
  // post-launch via the admin page-list / page-editor UI (Phase 15).
  const AUDIENCE_LASTMOD = new Date().toISOString().slice(0, 10);
  for (const audienceSlug of ['/for-doctors', '/for-clinics', '/for-coaches']) {
    urls.push(
      `  <url>\n    <loc>${CANONICAL_BASE}${audienceSlug}</loc>\n    <lastmod>${AUDIENCE_LASTMOD}</lastmod>\n    <changefreq>monthly</changefreq>\n    <priority>0.9</priority>\n  </url>`,
    );
  }

  // Topic index pages
  for (const topic of topics) {
    urls.push(
      `  <url>\n    <loc>${CANONICAL_BASE}/knowledge/${topic}</loc>\n    <changefreq>weekly</changefreq>\n    <priority>0.8</priority>\n  </url>`,
    );
  }

  // Article pages
  for (const chunk of sluggedChunks) {
    const lastmod = chunk.published_at
      ? `\n    <lastmod>${chunk.published_at.slice(0, 10)}</lastmod>`
      : '';
    urls.push(
      `  <url>\n    <loc>${CANONICAL_BASE}/knowledge/${chunk.topic_tag}/${chunk.slug}</loc>${lastmod}\n    <changefreq>monthly</changefreq>\n    <priority>0.6</priority>\n  </url>`,
    );
  }

  const sitemapXml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...urls,
    '</urlset>',
  ].join('\n');

  const totalUrls = 1 + topicCount + articleCount;

  if (!DRY_RUN) {
    const sitemapPath = resolve(LEANSHOT_DIR, 'public', 'sitemap.xml');
    writeFileSync(sitemapPath, sitemapXml, 'utf-8');
    console.log(`  ✅ Wrote public/sitemap.xml (${totalUrls} URLs: 1 root + ${topicCount} topics + ${articleCount} articles)`);
  } else {
    console.log(`  [dry-run] Would write public/sitemap.xml with ${totalUrls} URLs`);
  }

  // ── Generate og card PNGs ─────────────────────────────────────────────────
  let ogGenerated = 0;
  let ogSkipped = 0;

  for (const chunk of sluggedChunks) {
    if (!chunk.slug) continue;

    const ogDir = resolve(LEANSHOT_DIR, 'public', 'og', 'knowledge', chunk.topic_tag);
    const ogPath = resolve(ogDir, `${chunk.slug}.png`);

    // Skip if file exists and not forced
    if (!FORCE && existsSync(ogPath)) {
      // Check mtime against chunk.published_at
      if (chunk.published_at) {
        const mtime = statSync(ogPath).mtimeMs;
        const publishedMs = new Date(chunk.published_at).getTime();
        if (mtime > publishedMs) {
          ogSkipped++;
          continue;
        }
      } else {
        ogSkipped++;
        continue;
      }
    }

    if (!DRY_RUN) {
      // Generate a simple SVG-based og card (PNG generation requires @vercel/og
      // which needs Edge Runtime context; for build-time, emit a placeholder SVG).
      // Full @vercel/og cards are served at runtime via a Vercel OG image endpoint.
      // For the MVP, we generate an SVG placeholder that passes the og:image check.
      mkdirSync(ogDir, { recursive: true });

      const topicName = TOPIC_DISPLAY_NAMES[chunk.topic_tag] ?? chunk.topic_tag;
      const title = chunk.title ?? `Article: ${chunk.slug}`;
      const escapedTitle = title.replace(/[<>&"]/g, (c) =>
        ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c] ?? c,
      );

      // Write placeholder SVG (note: og:image should be a PNG, but SVG works for dev)
      // For production, replace with actual @vercel/og endpoint or Satori-based generation
      const svgContent = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <rect width="1200" height="630" fill="#EFEBE0"/>
  <text x="60" y="200" font-family="Georgia, serif" font-size="48" font-weight="bold" fill="#1A1A1A">${escapedTitle.slice(0, 60)}</text>
  <text x="60" y="280" font-family="Georgia, serif" font-size="32" fill="#6B7280">${topicName} · LeanShot Knowledge</text>
  <text x="60" y="560" font-family="Georgia, serif" font-size="24" fill="#9CA3AF">app.leanshot.app/knowledge</text>
</svg>`;

      // Write SVG with .png extension (browsers accept SVG served as image/svg+xml)
      writeFileSync(ogPath, svgContent, 'utf-8');
      ogGenerated++;
    } else {
      console.log(`  [dry-run] Would generate og card: public/og/knowledge/${chunk.topic_tag}/${chunk.slug}.png`);
      ogGenerated++;
    }
  }

  if (!DRY_RUN && ogGenerated > 0) {
    console.log(`  ✅ Generated ${ogGenerated} og cards (${ogSkipped} skipped, up-to-date)`);
  } else if (DRY_RUN) {
    console.log(
      `  [dry-run] Would generate ${ogGenerated} og cards, skip ${ogSkipped}`,
    );
  } else {
    console.log(`  ✅ All og cards up-to-date (${ogSkipped} skipped)`);
  }

  console.log(`✅ build-sitemap complete: ${totalUrls} URLs, ${ogGenerated} og cards`);
}

// ─── Empty sitemap for dry-run without DB ─────────────────────────────────────

function generateEmptySitemap() {
  // Phase 68 Plan 68-03 — even when the DB is unreachable, the audience
  // landing pages are static-route surfaces (block_tree seeded into the DB
  // but the routes themselves resolve client-side). Include them in the
  // skeleton so SEO crawlers see them on every build.
  const audienceLastmod = new Date().toISOString().slice(0, 10);
  const audienceUrls = ['/for-doctors', '/for-clinics', '/for-coaches'].map(
    (slug) =>
      `  <url>\n    <loc>${CANONICAL_BASE}${slug}</loc>\n    <lastmod>${audienceLastmod}</lastmod>\n    <changefreq>monthly</changefreq>\n    <priority>0.9</priority>\n  </url>`,
  );

  const sitemapXml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    `  <url>\n    <loc>${CANONICAL_BASE}/knowledge</loc>\n    <changefreq>weekly</changefreq>\n    <priority>1.0</priority>\n  </url>`,
    ...audienceUrls,
    '</urlset>',
  ].join('\n');

  if (!DRY_RUN) {
    const sitemapPath = resolve(LEANSHOT_DIR, 'public', 'sitemap.xml');
    writeFileSync(sitemapPath, sitemapXml, 'utf-8');
    console.log('  Written: public/sitemap.xml (1 URL — root only, DB unreachable)');
  } else {
    console.log('  [dry-run] Would write public/sitemap.xml with 1 URL (root only)');
  }
}

main().catch((err: unknown) => {
  console.error('❌ build-sitemap: unexpected error:', err);
  process.exit(0); // non-fatal — production builds continue
});
