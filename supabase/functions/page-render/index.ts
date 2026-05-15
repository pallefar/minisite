/**
 * `page-render` Edge Function — Phase 15 Plan 03.
 *
 * Public, no-JWT Deno.serve dispatcher that turns a published landing-page
 * revision's JSONB block tree into static HTML.
 *
 * ## Trust posture
 *   - PUBLIC: `[functions.page-render] verify_jwt = false` in `config.toml`.
 *     Pitfall 7 — without it the gateway 401s every anonymous visitor.
 *   - Service-role admin client (mirrors `share/index.ts` lines 46-51) so
 *     the function reads `landing_pages` server-side; RLS is bypassed but
 *     the `status='published'` filter is the access-control gate (T-15-03-01,
 *     T-15-03-07).
 *
 * ## Routing
 *   The slug arrives via:
 *     1. `?slug=…` query param — 15-02's `vercel.json` rewrites
 *        `/{slug}` → `…/page-render?slug=$1`. This is the production path.
 *     2. The last non-empty path segment — fallback for direct Supabase
 *        function URLs (e.g. `/functions/v1/page-render/demo` during local
 *        dev). When the dispatcher receives only `/functions/v1/page-render`
 *        we fall through to a no-slug 404 (`renderNotFound()`).
 *
 * ## Threat-model mitigations enforced here
 *   T-15-03-01 hard-filter `status='published'` AND non-null published_revision_id
 *   T-15-03-02 (in render.ts) — every content field is escapeHtml'd
 *   T-15-03-04 generic 500 body — never echo DB error strings
 *   T-15-03-05 public Cache-Control + Vary: Accept-Encoding; no credentials
 *   T-15-03-06 verify_jwt=false set explicitly in config.toml
 */
import { createClient } from 'npm:@supabase/supabase-js@2';

import { BASE_RESPONSE_HEADERS, buildCorsHeaders } from './cors.ts';
import {
  renderNotFound,
  renderPage,
  type BlockNode,
  type PageSeo,
  type SiteSettingsRow,
} from './render.ts';

// ─── Module-level admin client ──────────────────────────────────────────────
// Service-role bypasses RLS; we restore access control via the hard
// `status='published'` filter in handleRender. This function NEVER writes —
// no INSERT/UPDATE/DELETE on any table.
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// ─── Constants ───────────────────────────────────────────────────────────────
/** Public CDN cache: 60s edge cache + 24h stale-while-revalidate. */
const CACHE_CONTROL = 'public, s-maxage=60, stale-while-revalidate=86400';

// ─── Header builders ─────────────────────────────────────────────────────────

function htmlHeaders(corsHeaders: Record<string, string>): Record<string, string> {
  return {
    ...BASE_RESPONSE_HEADERS,
    ...corsHeaders,
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': CACHE_CONTROL,
    'Vary': 'Accept-Encoding',
  };
}

// ─── Types for the admin-client SELECT shape ─────────────────────────────────

/**
 * The minimal columns we read from `landing_pages` plus the joined
 * published-revision blocks. The query asks for:
 *   landing_pages(slug, status, seo, published_revision_id,
 *                 landing_page_revisions!published_revision_id(blocks))
 */
interface PublishedPageRow {
  slug: string;
  status: string;
  // 15-08: per-page SEO is now stored as discrete columns (seo_title, …) on
  // landing_pages, not a single `seo` jsonb. The handler reads both shapes —
  // discrete columns when present, falling back to a `seo` jsonb when the
  // mock test fixtures hand one in (back-compat for existing index.test.ts).
  seo?: PageSeo | null;
  title?: string | null;
  seo_title?: string | null;
  seo_description?: string | null;
  seo_og_image?: string | null;
  seo_canonical?: string | null;
  seo_schema_type?: string | null;
  published_revision_id: string | null;
  landing_page_revisions: { blocks: BlockNode[] } | null;
}

// 15-08: minimal site_settings query shape. The function queries
// site_settings via SELECT ... LIMIT 1 (singleton).
interface SiteSettingsQuery {
  limit(n: number): Promise<{ data: SiteSettingsRow[] | null; error: { message: string } | null }>;
}

// ─── Admin abstraction (for testability) ─────────────────────────────────────

/**
 * Minimal admin client surface used by handleRender. The real `admin` from
 * @supabase/supabase-js implements far more; this interface lets the Deno
 * test inject a hand-rolled mock without standing up Postgres.
 */
export interface PageRenderAdminClient {
  from(table: string): PageRenderQueryBuilder;
}

export interface PageRenderQueryBuilder {
  select(cols: string): PageRenderQueryBuilder;
  eq(col: string, value: unknown): PageRenderQueryBuilder;
  maybeSingle(): Promise<{ data: PublishedPageRow | null; error: { message: string } | null }>;
  // 15-08: site_settings query path (`from('site_settings').select(...).limit(1)`).
  limit?(n: number): Promise<{ data: SiteSettingsRow[] | null; error: { message: string } | null }>;
}

// ─── Slug extraction ─────────────────────────────────────────────────────────

/**
 * Returns the slug for this request, or `null` if there isn't one.
 *
 * Order:
 *  1. `?slug=…` query param — the production path per 15-02 vercel.json.
 *  2. Last non-empty path segment after `/page-render` — fallback for
 *     direct function-URL invocations.
 */
function extractSlug(url: URL): string | null {
  const qs = url.searchParams.get('slug');
  if (qs && qs.trim() !== '') return qs.trim();

  const segments = url.pathname.split('/').filter((s) => s !== '');
  // Find `page-render` in the path; if there's a following segment, use it.
  const idx = segments.indexOf('page-render');
  if (idx !== -1 && idx + 1 < segments.length) {
    const candidate = segments[idx + 1]?.trim() ?? '';
    if (candidate !== '') return candidate;
  }
  return null;
}

// ─── handleRender — exported for tests ──────────────────────────────────────

/**
 * The render flow. Exported so the Deno test invokes it with a mock admin
 * client. The real Deno.serve dispatcher below wires this with the
 * module-level service-role `admin`.
 */
export async function handleRender(
  req: Request,
  client: PageRenderAdminClient,
  corsHeaders: Record<string, string>,
): Promise<Response> {
  const url = new URL(req.url);
  const slug = extractSlug(url);
  const headers = htmlHeaders(corsHeaders);

  if (slug === null) {
    return new Response(renderNotFound(), { status: 404, headers });
  }

  // Hard-filter to published rows. Pitfall: depending on schema, "published"
  // may be modeled as `status='published'`. We filter on BOTH that AND on
  // having a non-null published_revision_id (defense in depth — T-15-03-01).
  //
  // 15-08: extended SELECT to also pull the per-page discrete SEO columns
  // (seo_title, seo_description, seo_og_image, seo_canonical,
  // seo_schema_type, title). The legacy `seo` jsonb column is also pulled
  // for back-compat with Deno test mocks that have not yet been updated.
  const { data: row, error: queryError } = await client
    .from('landing_pages')
    .select(
      'slug, status, title, seo_title, seo_description, seo_og_image, seo_canonical, seo_schema_type, published_revision_id, landing_page_revisions!published_revision_id(blocks)',
    )
    .eq('slug', slug)
    .eq('status', 'published')
    .maybeSingle();

  if (queryError) {
    // T-15-03-04: never echo DB error strings — generic 500 only.
    console.error('[page-render] db query error', queryError.message);
    return new Response('Internal error', {
      status: 500,
      headers: {
        ...BASE_RESPONSE_HEADERS,
        ...corsHeaders,
        'Content-Type': 'text/plain; charset=utf-8',
      },
    });
  }

  if (!row || !row.published_revision_id || !row.landing_page_revisions) {
    return new Response(renderNotFound(), { status: 404, headers });
  }

  const blocks = Array.isArray(row.landing_page_revisions.blocks)
    ? row.landing_page_revisions.blocks
    : [];

  // 15-08: build the per-page seo input from discrete columns when present;
  // fall back to the legacy `seo` jsonb (test fixtures still use it).
  const seoInput: PageSeo = row.seo ?? {};
  if (typeof row.seo_title === 'string') seoInput.title = row.seo_title;
  if (typeof row.seo_description === 'string') seoInput.description = row.seo_description;
  if (typeof row.seo_og_image === 'string') seoInput.ogImage = row.seo_og_image;
  if (typeof row.seo_canonical === 'string') seoInput.canonical = row.seo_canonical;
  if (typeof row.seo_schema_type === 'string') seoInput.schemaType = row.seo_schema_type;

  // 15-08: fetch the singleton site_settings row. Best-effort — when the
  // table is unreachable (or the test fixture doesn't expose it) we render
  // with an empty defaults object and the SEO cascade falls through to
  // per-page values and safe fallbacks.
  let siteSettings: SiteSettingsRow | undefined;
  try {
    const ssBuilder = client.from('site_settings').select('site_name, default_description, favicon_url, default_og_image') as unknown as SiteSettingsQuery;
    const ssRes = await ssBuilder.limit(1);
    if (!ssRes.error && Array.isArray(ssRes.data) && ssRes.data.length > 0) {
      siteSettings = ssRes.data[0];
    }
  } catch (err) {
    // Non-fatal — site_settings is purely cosmetic at the rendering layer.
    console.warn(
      '[page-render] site_settings read failed',
      err instanceof Error ? err.message : 'unknown',
    );
  }

  const html = renderPage({
    slug: row.slug,
    title: row.title ?? undefined,
    seo: seoInput,
    blocks,
    siteSettings,
  });

  return new Response(html, { status: 200, headers });
}

// ─── Deno.serve entry ────────────────────────────────────────────────────────

Deno.serve(async (req: Request): Promise<Response> => {
  const cors = buildCorsHeaders(req);

  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      status: 200,
      headers: { ...BASE_RESPONSE_HEADERS, ...cors },
    });
  }

  try {
    if (req.method === 'GET' || req.method === 'HEAD') {
      return await handleRender(req, admin as unknown as PageRenderAdminClient, cors);
    }
    return new Response('Method not allowed', {
      status: 405,
      headers: { ...BASE_RESPONSE_HEADERS, ...cors, 'Content-Type': 'text/plain; charset=utf-8' },
    });
  } catch (err) {
    // T-15-03-04: never echo handler error details — generic 500 body only.
    console.error('[page-render] handler error', err instanceof Error ? err.message : 'unknown');
    return new Response('Internal error', {
      status: 500,
      headers: { ...BASE_RESPONSE_HEADERS, ...cors, 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }
});
