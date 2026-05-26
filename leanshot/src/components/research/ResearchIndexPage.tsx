/**
 * Phase 62 Plan 62-06 Task 2 — Public /research/ index page.
 *
 * Surface 5 from UI-SPEC: public index of published papers with RSS link.
 * Mirrors KnowledgeRootPage.tsx structure with these differences:
 *   - H1 "LeanShot Research" (not "Knowledge Base")
 *   - RSS link row (Subscribe via RSS) instead of newsletter form
 *   - Card grid of research publications (not topic tiles)
 *   - NO noindex — research papers are SEO-discoverable
 *   - JSON-LD WebSite schema for /research
 *
 * SEO: react-helmet-async <Helmet> with title, description, canonical,
 * RSS alternate link, JSON-LD WebSite schema. robots=index (NOT noindex).
 *
 * Typography ceiling: ONLY text-[11px], text-[13px], text-[18px], text-heading (28px).
 * No text-base, text-lg, text-md, text-sm, text-xl, text-2xl.
 */

import { useEffect, useState } from 'react';
import { Helmet } from 'react-helmet-async';
import { FileText } from 'lucide-react';
import { Skeleton } from '@/components/ui/Skeleton';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import { fetchPublishedResearch } from '@/lib/research/api';
import type { ResearchPublication } from '@/types/research';

const CANONICAL_BASE = 'https://app.leanshot.app';

// JSON-LD WebSite schema for the /research root page
const researchWebsiteJsonLd = {
  '@context': 'https://schema.org',
  '@type': 'WebSite',
  name: 'LeanShot Research',
  url: `${CANONICAL_BASE}/research`,
};

function formatPublishedDate(iso: string | null | undefined): string {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      timeZone: 'UTC',
    });
  } catch {
    return iso;
  }
}

export function ResearchIndexPage() {
  const reducedMotion = useReducedMotion();
  const [publications, setPublications] = useState<ResearchPublication[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const pubs = await fetchPublishedResearch();
        if (!cancelled) setPublications(pubs);
      } catch {
        // fail-soft: render empty state on fetch error (per PATTERNS.md convention)
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => { cancelled = true; };
  }, []);

  const description = 'Evidence-based findings from anonymized, aggregate LeanShot treatment data.';

  return (
    <>
      <Helmet>
        <title>LeanShot Research</title>
        <meta name="description" content={description} />
        <link rel="canonical" href={`${CANONICAL_BASE}/research`} />
        <link rel="alternate" type="application/rss+xml" href="/research/rss.xml" title="LeanShot Research RSS" />
        <meta property="og:title" content="LeanShot Research" />
        <meta property="og:description" content={description} />
        <meta property="og:type" content="website" />
        {/* NO noindex — research papers are SEO-discoverable per CONTEXT.md decision */}
        <script type="application/ld+json">{JSON.stringify(researchWebsiteJsonLd)}</script>
      </Helmet>

      <main className="max-w-screen-xl mx-auto px-4 py-8 space-y-8">
        {/* ── Hero strip ─────────────────────────────────────────── */}
        <section aria-labelledby="research-heading">
          <h1
            id="research-heading"
            className="font-display italic text-heading font-semibold text-[var(--color-text)] leading-tight"
          >
            LeanShot Research
          </h1>
          <p className="text-[13px] text-[var(--color-text-secondary)] mt-1">
            {description}
          </p>

          {/* RSS link row */}
          <div className="flex items-center gap-2 mt-3">
            <FileText className="size-4 text-[var(--color-primary)]" aria-hidden="true" />
            <a
              href="/research/rss.xml"
              className="text-[13px] text-[var(--color-primary)] underline-offset-4 hover:underline"
            >
              Subscribe via RSS
            </a>
          </div>
        </section>

        {/* ── Publication cards ───────────────────────────────────── */}
        <section aria-label="Published research papers">
          {loading ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-36 rounded-xl" />
              ))}
            </div>
          ) : publications.length === 0 ? (
            <p className="text-[13px] text-[var(--color-text-secondary)]">No research published yet.</p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {publications.map((pub: ResearchPublication) => (
                <a
                  key={pub.id}
                  href={`/research/${pub.slug}`}
                  className={[
                    'block text-left rounded-xl border border-[var(--color-border)]',
                    'bg-[var(--color-surface)] p-4',
                    'hover:bg-[var(--color-admin-table-row-hover)]',
                    'focus-visible:outline-2 focus-visible:outline-[var(--color-primary)]',
                    reducedMotion ? '' : 'transition-colors duration-150',
                  ].join(' ')}
                  aria-label={`Read paper: ${pub.title}`}
                >
                  <p className="text-[13px] font-semibold text-[var(--color-text)] leading-snug line-clamp-2">
                    {pub.title}
                  </p>
                  {pub.published_at && (
                    <p className="text-[11px] text-[var(--color-text-secondary)] mt-1">
                      {formatPublishedDate(pub.published_at)}
                    </p>
                  )}
                  {pub.abstract && (
                    <p className="text-[13px] text-[var(--color-text-secondary)] mt-2 line-clamp-2">
                      {pub.abstract}
                    </p>
                  )}
                  <span className="inline-block text-[13px] text-[var(--color-primary)] mt-3">
                    Read full paper →
                  </span>
                </a>
              ))}
            </div>
          )}
        </section>
      </main>
    </>
  );
}

export default ResearchIndexPage;
