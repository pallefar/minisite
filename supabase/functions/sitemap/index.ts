/**
 * `sitemap` Edge Function — Phase 15 Plan 08.
 *
 * Public, no-JWT `Deno.serve` dispatcher that returns the sitemap.xml for
 * every PUBLISHED landing page in `public.landing_pages`. Crawlers (Google,
 * Bing) request `/sitemap.xml`; 15-02's `vercel.json` rewrites that path to
 * `…/functions/v1/sitemap`.
 *
 * ## Trust posture
 *   - PUBLIC: `[functions.sitemap] verify_jwt = false` in `config.toml`.
 *     Pitfall 7 — without it the gateway 401s every crawler request.
 *   - Service-role admin client (mirrors `share/index.ts`) so the function
 *     reads `landing_pages` server-side; RLS is bypassed but the
 *     `status='published'` filter (and the NOT-NULL `published_revision_id`
 *     check) is the access-control gate — T-15-08-03. A draft slug is
 *     NEVER selected, even via service-role.
 *
 * ## Threat-model mitigations enforced here
 *   T-15-08-03 hard-filter `status='published'` AND non-null
 *              published_revision_id; the Deno test seeds a draft row in
 *              the mock dataset and asserts it does NOT appear in output.
 *   T-15-08-05 (accept) — fixed `Internal error` body on failure; no
 *              Postgres error strings echoed. Mirrors `share`'s posture.
 *   T-15-08-06 (accept) — Cache-Control: public, s-maxage=3600 +
 *              stale-while-revalidate=86400 puts crawler traffic behind
 *              the CDN.
 *
 * ## Cache + content type
 *   Content-Type: application/xml; charset=utf-8
 *   Cache-Control: public, s-maxage=3600, stale-while-revalidate=86400
 */
import { createClient } from 'npm:@supabase/supabase-js@2';

// ─── Module-level admin client (lazy + test-injectable) ─────────────────────

// deno-lint-ignore no-explicit-any
let _adminInstance: any = null;

// deno-lint-ignore no-explicit-any
function getAdmin(): any {
  if (_adminInstance === null) {
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    _adminInstance = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  }
  return _adminInstance;
}

const adminInstance = new Proxy({} as Record<string | symbol, unknown>, {
  // deno-lint-ignore no-explicit-any
  get(_t: any, prop: string | symbol): unknown {
    const a = getAdmin();
    const val = a[prop];
    return typeof val === 'function' ? val.bind(a) : val;
  },
});

export function __setAdminForTest(fakeAdmin: unknown): void {
  _adminInstance = fakeAdmin;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const CACHE_CONTROL = 'public, s-maxage=3600, stale-while-revalidate=86400';

/**
 * Hardcoded SPA-served URLs that should appear in the sitemap alongside
 * DB-backed builder pages. Added 2026-05-16 after H+I audit found the
 * sitemap was emitting just one URL (/pricing) — apex + legal pages were
 * invisible to search engines.
 *
 * Lastmod for these is fixed at the launch-date floor (the sitemap
 * function has no per-route content-edit timestamp for SPA-served pages);
 * crawlers treat absent/static lastmod as "check sometimes" which is the
 * correct posture for evergreen content.
 *
 * NOTE: Auth paths (/signin, /signup, /reset-password, /verify-email) are
 * INTENTIONALLY EXCLUDED — they're 308-redirected to hash routes via
 * vercel.json and we don't want search engines indexing the auth surface.
 */
const STATIC_URLS: ReadonlyArray<{ path: string; lastmod?: string }> = [
  { path: '/' },
  { path: '/legal/privacy' },
  { path: '/legal/terms' },
  { path: '/legal/consumer-health' },
  { path: '/legal/disclaimer' },
];

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'content-type',
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Escape XML special characters in a slug so a maliciously-named slug
 * (extremely unlikely given the page-save slug regex, but defense in depth)
 * cannot break out of the `<loc>` element.
 */
function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function getSiteOrigin(): string {
  return Deno.env.get('PUBLIC_MARKETING_ORIGIN')
    ?? Deno.env.get('SITE_ORIGIN')
    ?? 'https://leanshot.app';
}

// ─── handleSitemap — exported for tests ─────────────────────────────────────

export interface PublishedSlugRow {
  slug: string;
  updated_at: string | null;
  published_revision_id: string | null;
}

export interface SitemapAdminClient {
  from(table: string): SitemapQueryBuilder;
}

export interface SitemapQueryBuilder {
  select(cols: string): SitemapQueryBuilder;
  eq(col: string, value: unknown): Promise<{ data: PublishedSlugRow[] | null; error: { message: string } | null }>;
}

export async function handleSitemap(client: SitemapAdminClient): Promise<Response> {
  // T-15-08-03: hard-filter `status='published'`. Draft rows are NEVER
  // emitted, even via service-role (which bypasses RLS).
  const { data: rows, error } = await client
    .from('landing_pages')
    .select('slug, updated_at, published_revision_id')
    .eq('status', 'published');

  if (error) {
    console.error('[sitemap] db query error', error.message);
    return new Response('Internal error', {
      status: 500,
      headers: { ...CORS_HEADERS, 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }

  const origin = getSiteOrigin();
  // Defense in depth: filter out rows with null published_revision_id (a
  // status='published' row without a revision pointer cannot render).
  const validRows = (rows ?? []).filter((r) => r.slug && r.published_revision_id);

  const dbEntries = validRows.map((r) => {
    const loc = `${origin}/${escapeXml(r.slug)}`;
    const lastmod = r.updated_at
      ? `    <lastmod>${escapeXml(new Date(r.updated_at).toISOString())}</lastmod>\n`
      : '';
    return `  <url>\n    <loc>${loc}</loc>\n${lastmod}  </url>`;
  });

  const staticEntries = STATIC_URLS.map((u) => {
    const loc = u.path === '/' ? `${origin}/` : `${origin}${u.path}`;
    const lastmod = u.lastmod
      ? `    <lastmod>${escapeXml(u.lastmod)}</lastmod>\n`
      : '';
    return `  <url>\n    <loc>${loc}</loc>\n${lastmod}  </url>`;
  });

  const urlEntries = [...staticEntries, ...dbEntries].join('\n');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemap.org/schemas/sitemap/0.9">\n${urlEntries}\n</urlset>\n`;

  return new Response(xml, {
    status: 200,
    headers: {
      ...CORS_HEADERS,
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': CACHE_CONTROL,
      'Vary': 'Accept-Encoding',
    },
  });
}

// ─── Deno.serve entry ────────────────────────────────────────────────────────

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { status: 200, headers: CORS_HEADERS });
  }
  try {
    if (req.method === 'GET' || req.method === 'HEAD') {
      return await handleSitemap(adminInstance as unknown as SitemapAdminClient);
    }
    return new Response('Method not allowed', {
      status: 405,
      headers: { ...CORS_HEADERS, 'Content-Type': 'text/plain; charset=utf-8' },
    });
  } catch (err) {
    console.error('[sitemap] unhandled', err instanceof Error ? err.message : 'unknown');
    return new Response('Internal error', {
      status: 500,
      headers: { ...CORS_HEADERS, 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }
});

// ─── Test-only exports ──────────────────────────────────────────────────────

export const __internal = {
  handleSitemap,
  __setAdminForTest,
  escapeXml,
  getSiteOrigin,
};
