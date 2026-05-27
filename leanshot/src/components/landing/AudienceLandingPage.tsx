/**
 * Phase 68 Plan 68-03 — Audience landing page renderer.
 *
 * Fetches a `landing_pages` row by URL slug + renders its `block_tree`
 * from the most-recent published `landing_page_revisions` row. Used for
 * the 3 audience-specific marketing pages:
 *   - /for-doctors  → audienceType: MedicalAudience (Physicians)
 *   - /for-clinics  → audienceType: BusinessAudience (clinic)
 *   - /for-coaches  → audienceType: BusinessAudience (coach)
 *
 * Schema reference (Phase 15 + Phase 68-01):
 *   - `landing_pages (id, slug, title, status, published_revision_id,
 *      seo_title, seo_description, seo_schema_type)`
 *   - `landing_page_revisions (id, page_id, block_tree jsonb)` — note column
 *     is `page_id` (NOT `landing_page_id`) per the Phase 15 schema.
 *   - Block tree in 68-01 seed uses a SIMPLIFIED shape (not the Phase 15
 *     page-builder BlockNode tree). Three block types:
 *       hero          { type, headline, subhead, cta: {label, href} }
 *       feature-grid  { type, features: [{ icon, title, body }] }
 *       cta           { type, label, href }
 *     We render those three shapes natively here; the Phase 15
 *     page-builder BlockNode renderer is for the admin editor + its own
 *     richer schema (different content keys).
 *
 * JSON-LD: emitted via `react-helmet-async` <Helmet> with per-audience
 * `audienceType` / `serviceType` derived from pathname. The Phase 15
 * `generateJsonLd` helper is for the page-builder editor (auto-FAQPage
 * extraction); audience landing pages need explicit Service JSON-LD with
 * a `serviceAudience` differentiator, so we build the payload inline here.
 *
 * Calendly placeholder substitution: 68-01 seeded clinic CTAs with the
 * literal string `${CALENDLY_BOOK_DEMO_URL_PLACEHOLDER}`. We resolve from
 * `VITE_CALENDLY_BOOK_DEMO_URL` at render time; when empty (Phase 70 not
 * yet shipped), the CTA renders as a disabled "Coming soon" button per
 * D-09 in CONTEXT.md — and per
 * [[feedback_placeholder_string_runtime_guard_pattern]] we MUST NEVER
 * render a literal `${...}` string as the visible href/label.
 *
 * Tailwind v4 @theme tokens only (text-text, text-text-secondary,
 * bg-surface, border-border, bg-primary, text-primary, font-display).
 * Typography ceiling: 4 sizes (text-display/text-4xl/text-lg/text-sm) +
 * 2 weights (font-semibold/font-normal) per UI-checker constraints.
 */
import { type ReactElement, useEffect, useState } from 'react';
import { Helmet } from 'react-helmet-async';
import { supabase } from '@/lib/supabase';

// ---------------------------------------------------------------------------
// Block-tree types (simplified shape used by the 68-01 seed, NOT the Phase 15
// page-builder BlockNode tree).
// ---------------------------------------------------------------------------

interface HeroBlock {
  type: 'hero';
  headline?: string;
  subhead?: string;
  cta?: { label?: string; href?: string };
}

interface FeatureGridBlock {
  type: 'feature-grid';
  features?: Array<{ icon?: string; title?: string; body?: string }>;
}

interface CtaBlock {
  type: 'cta';
  label?: string;
  href?: string;
}

type SeedBlock = HeroBlock | FeatureGridBlock | CtaBlock | { type: string };

// ---------------------------------------------------------------------------
// Audience metadata
// ---------------------------------------------------------------------------

interface AudienceMeta {
  /** schema.org `audienceType` value (string per schema.org docs). */
  audienceType: string;
  /** Friendly label used in fallback rendering. */
  audienceLabel: string;
  /** schema.org `serviceType` value. */
  serviceType: string;
}

function audienceForSlug(slug: string): AudienceMeta {
  // Slugs in the seed are stored with a leading slash (per 68-01 migration).
  // Tolerate both '/for-doctors' and 'for-doctors' for resilience.
  const normalized = slug.replace(/^\//, '');
  switch (normalized) {
    case 'for-doctors':
      return {
        audienceType: 'MedicalAudience',
        audienceLabel: 'Physicians',
        serviceType: 'PatientDataReadShare',
      };
    case 'for-clinics':
      return {
        audienceType: 'BusinessAudience',
        audienceLabel: 'GLP-1 Clinics',
        serviceType: 'MultiPatientMonitoring',
      };
    case 'for-coaches':
      return {
        audienceType: 'BusinessAudience',
        audienceLabel: 'Wellness Coaches',
        serviceType: 'CohortCoachingTool',
      };
    default:
      return {
        audienceType: 'GeneralAudience',
        audienceLabel: 'Visitors',
        serviceType: 'WebPage',
      };
  }
}

// ---------------------------------------------------------------------------
// Data fetch shape
// ---------------------------------------------------------------------------

export interface LandingPageData {
  slug: string;
  title: string;
  seoTitle: string | null;
  seoDescription: string | null;
  seoSchemaType: string | null;
  blocks: SeedBlock[];
}

// Internal — used by tests + the component itself to share resolution logic.
interface FetchResult {
  status: 'loading' | 'found' | 'not_found';
  page: LandingPageData | null;
}

// ---------------------------------------------------------------------------
// Calendly placeholder guard
// ---------------------------------------------------------------------------

const CALENDLY_PLACEHOLDER = '${CALENDLY_BOOK_DEMO_URL_PLACEHOLDER}';

/**
 * Resolve a CTA href, substituting the Calendly placeholder when the env is
 * available. Returns `null` when the href is the unresolved placeholder so
 * the renderer can render a disabled "Coming soon" button rather than a
 * literal `${...}` string ([[feedback_placeholder_string_runtime_guard_pattern]]).
 */
function resolveCtaHref(href: string | undefined): string | null {
  if (!href) return null;
  if (href !== CALENDLY_PLACEHOLDER) return href;
  const envUrl = import.meta.env.VITE_CALENDLY_BOOK_DEMO_URL as string | undefined;
  if (envUrl && envUrl.trim().length > 0) return envUrl.trim();
  return null;
}

// ---------------------------------------------------------------------------
// Block renderer (inline — the 68-01 seed shape is simpler than the Phase 15
// page-builder BlockNode and has no existing renderer). Each block returns a
// section. Unknown block types render nothing (silent skip).
// ---------------------------------------------------------------------------

function HeroBlockView({ block }: { block: HeroBlock }): ReactElement {
  const href = resolveCtaHref(block.cta?.href);
  const label = block.cta?.label ?? 'Get started';
  return (
    <section
      aria-labelledby="audience-landing-hero"
      className="bg-primary text-text-on-hero py-16 md:py-24 px-4"
    >
      <div className="max-w-screen-lg mx-auto text-center space-y-6">
        <h1
          id="audience-landing-hero"
          className="font-display text-4xl md:text-display font-semibold leading-tight"
        >
          {block.headline ?? ''}
        </h1>
        {block.subhead ? (
          <p className="text-lg text-text-on-hero-muted max-w-2xl mx-auto">
            {block.subhead}
          </p>
        ) : null}
        {block.cta ? (
          href ? (
            <a
              href={href}
              className="inline-flex items-center justify-center px-6 py-3 rounded-md bg-surface text-primary font-semibold text-lg hover:opacity-90 transition-opacity"
            >
              {label}
            </a>
          ) : (
            <button
              type="button"
              disabled
              aria-disabled="true"
              className="inline-flex items-center justify-center px-6 py-3 rounded-md bg-surface text-text-tertiary font-semibold text-lg cursor-not-allowed opacity-70"
            >
              Coming soon
            </button>
          )
        ) : null}
      </div>
    </section>
  );
}

function FeatureGridBlockView({ block }: { block: FeatureGridBlock }): ReactElement {
  const features = block.features ?? [];
  return (
    <section className="bg-surface py-16 px-4">
      <div className="max-w-screen-lg mx-auto">
        <ul className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {features.map((f, i) => (
            <li
              key={i}
              className="rounded-xl border border-border bg-surface-elevated p-6 space-y-2"
            >
              <h2 className="text-lg font-semibold text-text leading-snug">
                {f.title ?? ''}
              </h2>
              <p className="text-sm text-text-secondary">{f.body ?? ''}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function CtaBlockView({ block }: { block: CtaBlock }): ReactElement {
  const href = resolveCtaHref(block.href);
  const label = block.label ?? 'Get started';
  return (
    <section className="bg-surface-elevated py-12 px-4 border-t border-border">
      <div className="max-w-screen-lg mx-auto text-center">
        {href ? (
          <a
            href={href}
            className="inline-flex items-center justify-center px-6 py-3 rounded-md bg-primary text-text-on-hero font-semibold text-lg hover:opacity-90 transition-opacity"
          >
            {label}
          </a>
        ) : (
          <button
            type="button"
            disabled
            aria-disabled="true"
            className="inline-flex items-center justify-center px-6 py-3 rounded-md bg-surface text-text-tertiary font-semibold text-lg cursor-not-allowed opacity-70"
          >
            Coming soon
          </button>
        )}
      </div>
    </section>
  );
}

function renderBlock(block: SeedBlock, idx: number): ReactElement | null {
  switch (block.type) {
    case 'hero':
      return <HeroBlockView key={idx} block={block as HeroBlock} />;
    case 'feature-grid':
      return <FeatureGridBlockView key={idx} block={block as FeatureGridBlock} />;
    case 'cta':
      return <CtaBlockView key={idx} block={block as CtaBlock} />;
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// JSON-LD payload builder
// ---------------------------------------------------------------------------

function buildJsonLd(opts: {
  page: LandingPageData;
  audience: AudienceMeta;
  canonicalUrl: string;
}): string {
  const { page, audience, canonicalUrl } = opts;
  const payload: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': page.seoSchemaType ?? 'Service',
    name: page.seoTitle ?? page.title,
    description: page.seoDescription ?? '',
    url: canonicalUrl,
    serviceType: audience.serviceType,
    audience: {
      '@type': audience.audienceType,
      audienceType: audience.audienceLabel,
    },
    provider: {
      '@type': 'Organization',
      name: 'LeanShot',
      url: 'https://leanshot.app',
    },
  };
  // T-15-08-01 mirror — escape literal `<` so the serialized JSON cannot
  // contain `</script>` even if a future seo_title contains it.
  return JSON.stringify(payload).replace(/</g, '\\u003c');
}

// ---------------------------------------------------------------------------
// Public fetch helper (extracted so the test suite can stub
// `supabase.from(...)` and assert on the returned shape).
// ---------------------------------------------------------------------------

export async function fetchLandingPageBySlug(slug: string): Promise<LandingPageData | null> {
  // The 68-01 seed stores slugs WITH a leading slash. Try the slug as-is
  // first; if no row found, try the slash-normalized variant (defensive).
  const tryFetch = async (s: string): Promise<LandingPageData | null> => {
    const { data: pageRow, error: pageErr } = await supabase
      .from('landing_pages')
      .select(
        'id, slug, title, status, published_revision_id, seo_title, seo_description, seo_schema_type',
      )
      .eq('slug', s)
      .eq('status', 'published')
      .maybeSingle();
    if (pageErr || !pageRow) return null;

    const publishedRevId = (pageRow.published_revision_id as string | null) ?? null;
    let blocks: SeedBlock[] = [];
    if (publishedRevId) {
      const { data: revRow } = await supabase
        .from('landing_page_revisions')
        .select('id, block_tree')
        .eq('id', publishedRevId)
        .maybeSingle();
      if (revRow && Array.isArray(revRow.block_tree)) {
        blocks = revRow.block_tree as SeedBlock[];
      }
    } else {
      // Fallback: latest revision for the page (drift-safe for partial-run
      // 68-01 inserts where the published_revision_id link wasn't set).
      const { data: revRow } = await supabase
        .from('landing_page_revisions')
        .select('id, block_tree, created_at')
        .eq('page_id', pageRow.id as string)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (revRow && Array.isArray(revRow.block_tree)) {
        blocks = revRow.block_tree as SeedBlock[];
      }
    }
    return {
      slug: pageRow.slug as string,
      title: (pageRow.title as string) ?? '',
      seoTitle: (pageRow.seo_title as string | null) ?? null,
      seoDescription: (pageRow.seo_description as string | null) ?? null,
      seoSchemaType: (pageRow.seo_schema_type as string | null) ?? null,
      blocks,
    };
  };

  const withSlash = slug.startsWith('/') ? slug : `/${slug}`;
  const withoutSlash = slug.replace(/^\//, '');
  return (await tryFetch(withSlash)) ?? (await tryFetch(withoutSlash));
}

// ---------------------------------------------------------------------------
// 404 view
// ---------------------------------------------------------------------------

function NotFoundView(): ReactElement {
  return (
    <main className="max-w-screen-lg mx-auto px-4 py-16 md:py-24 text-center">
      <h1 className="font-display text-4xl font-semibold text-text mb-4">
        This page isn&apos;t available.
      </h1>
      <p className="text-lg text-text-secondary mb-8">
        The audience page you&apos;re looking for has moved or never existed.
      </p>
      <a
        href="/"
        className="inline-flex items-center justify-center px-6 py-3 rounded-md bg-primary text-text-on-hero font-semibold text-lg hover:opacity-90 transition-opacity"
      >
        Go to LeanShot
      </a>
    </main>
  );
}

// ---------------------------------------------------------------------------
// Loading view
// ---------------------------------------------------------------------------

function LoadingView(): ReactElement {
  return (
    <main className="max-w-screen-lg mx-auto px-4 py-16" aria-busy="true">
      <div className="animate-pulse space-y-6">
        <div className="h-12 w-2/3 rounded-md bg-surface-elevated" />
        <div className="h-6 w-1/2 rounded-md bg-surface-elevated" />
        <div className="h-32 w-full rounded-md bg-surface-elevated" />
      </div>
    </main>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export interface AudienceLandingPageProps {
  /** Optional override for tests — when omitted, reads `window.location.pathname`. */
  slugOverride?: string;
}

export function AudienceLandingPage({
  slugOverride,
}: AudienceLandingPageProps = {}): ReactElement {
  const slug =
    slugOverride ??
    (typeof window !== 'undefined' ? window.location.pathname : '/');

  const [state, setState] = useState<FetchResult>({ status: 'loading', page: null });

  useEffect(() => {
    let cancelled = false;
    (async (): Promise<void> => {
      const page = await fetchLandingPageBySlug(slug);
      if (cancelled) return;
      if (!page) {
        setState({ status: 'not_found', page: null });
        return;
      }
      setState({ status: 'found', page });
    })().catch((err: unknown) => {
      if (cancelled) return;
      // Soft-fail: log and render 404 rather than crashing the route.
      // eslint-disable-next-line no-console
      console.error('[audience-landing] fetch failed', err);
      setState({ status: 'not_found', page: null });
    });
    return () => {
      cancelled = true;
    };
  }, [slug]);

  if (state.status === 'loading') return <LoadingView />;
  if (state.status === 'not_found' || state.page === null) return <NotFoundView />;

  const page = state.page;
  const audience = audienceForSlug(page.slug);
  const canonicalUrl = `https://leanshot.app${page.slug.startsWith('/') ? page.slug : '/' + page.slug}`;
  const jsonLd = buildJsonLd({ page, audience, canonicalUrl });
  const docTitle = page.seoTitle ?? page.title;
  const docDescription = page.seoDescription ?? '';

  return (
    <>
      <Helmet>
        <title>{docTitle}</title>
        <meta name="description" content={docDescription} />
        <link rel="canonical" href={canonicalUrl} />
        <meta property="og:title" content={docTitle} />
        <meta property="og:description" content={docDescription} />
        <meta property="og:type" content="website" />
        <script type="application/ld+json">{jsonLd}</script>
      </Helmet>
      <main>
        {page.blocks.map((block, i) => renderBlock(block, i))}
      </main>
    </>
  );
}
