/**
 * Phase 62 Plan 62-06 Task 2 — Public /research/<slug> scholarly article page.
 *
 * Surface 4 from UI-SPEC: single research paper with ScholarlyArticle JSON-LD,
 * DpMethodsFooter (mandatory), and ReactMarkdown body.
 *
 * Mirrors KnowledgeArticleDetailPage.tsx with these differences:
 *   - JSON-LD type: ScholarlyArticle (NOT MedicalWebPage — research papers are scholarly)
 *   - NO noindex — research papers are SEO-discoverable (inverts Phase 60-13 decision)
 *   - DpMethodsFooter replaces FDA/DSHEA disclaimer footer
 *   - Fetches from research_publications (not rag_chunks/kb_chunks)
 *   - No SourcesPanel or related articles sidebar (single-column 680px)
 *
 * T-62-06-01 mitigation (XSS): sanitizeRagMarkdown via DOMPurify before rendering.
 * T-62-06-02 mitigation: fetchResearchBySlug filters status='published'.
 * T-62-06-04 mitigation: DpMethodsFooter is unconditionally rendered (not behind flag).
 *
 * Typography ceiling: ONLY text-[11px], text-[13px], text-[18px], text-heading.
 * No text-base, text-lg, text-md, text-sm, text-xl, text-2xl.
 */

import { useEffect, useState } from 'react';
import { Helmet } from 'react-helmet-async';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Skeleton } from '@/components/ui/Skeleton';
import { sanitizeRagMarkdown } from '@/lib/rag/sanitize';
import { fetchResearchBySlug, fetchResearchMarkdown } from '@/lib/research/api';
import type { ResearchPublication } from '@/types/research';
import { DpMethodsFooter } from './DpMethodsFooter';
import { ResearchNotFound } from './ResearchNotFound';

const CANONICAL_BASE = 'https://app.leanshot.app';

function formatDate(iso: string | null | undefined): string {
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

function formatDateIso(iso: string | null | undefined): string {
  if (!iso) return '';
  try {
    return new Date(iso).toISOString().slice(0, 10);
  } catch {
    return iso ?? '';
  }
}

/**
 * Build the ScholarlyArticle JSON-LD schema.
 * T-62-06-01: Uses schema.org/ScholarlyArticle (not MedicalWebPage — per CONTEXT.md decision).
 */
function buildScholarlyArticleJsonLd(pub: ResearchPublication, canonicalUrl: string): object {
  return {
    '@context': 'https://schema.org',
    '@type': 'ScholarlyArticle',
    headline: pub.title,
    description: (pub.abstract ?? '').slice(0, 160),
    datePublished: pub.published_at ?? undefined,
    dateModified: pub.updated_at ?? undefined,
    author: {
      '@type': 'Organization',
      name: 'LeanShot Research',
    },
    publisher: {
      '@type': 'Organization',
      name: 'LeanShot',
      logo: {
        '@type': 'ImageObject',
        url: `${CANONICAL_BASE}/og-image.png`,
      },
    },
    mainEntityOfPage: canonicalUrl,
  };
}

interface ResearchArticlePageProps {
  slug: string;
}

export function ResearchArticlePage({ slug }: ResearchArticlePageProps) {
  // undefined=loading, null=not-found, object=loaded
  const [publication, setPublication] = useState<ResearchPublication | null | undefined>(undefined);
  const [markdownBody, setMarkdownBody] = useState<string>('');

  useEffect(() => {
    if (!slug) {
      setPublication(null);
      return;
    }

    let cancelled = false;
    setPublication(undefined);
    setMarkdownBody('');

    void Promise.all([fetchResearchBySlug(slug), fetchResearchMarkdown(slug)]).then(
      ([pub, md]) => {
        if (cancelled) return;
        setPublication(pub);
        setMarkdownBody(md);
      },
    ).catch(() => {
      if (!cancelled) setPublication(null);
    });

    return () => { cancelled = true; };
  }, [slug]);

  // Loading state
  if (publication === undefined) {
    return (
      <div className="max-w-screen-md mx-auto px-4 py-8 space-y-4">
        <Skeleton className="h-4 w-2/3" />
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-5/6" />
        <Skeleton className="h-4 w-4/5" />
        <Skeleton className="h-4 w-full" />
      </div>
    );
  }

  // Not found
  if (publication === null) return <ResearchNotFound />;

  const title = publication.title;
  const description = (publication.abstract ?? title).slice(0, 160);
  const canonicalUrl = `${CANONICAL_BASE}/research/${slug}`;
  const ogImageUrl = `${CANONICAL_BASE}/og/research/${slug}.png`;
  const scholarlyArticleJsonLd = buildScholarlyArticleJsonLd(publication, canonicalUrl);

  // T-62-06-01: Sanitize markdown body via DOMPurify before rendering
  const sanitizedBody = sanitizeRagMarkdown(markdownBody);

  return (
    <>
      <Helmet>
        <title>{title} — LeanShot Research</title>
        <meta name="description" content={description} />
        <link rel="canonical" href={canonicalUrl} />
        <meta property="og:title" content={title} />
        <meta property="og:description" content={description} />
        <meta property="og:type" content="article" />
        <meta property="og:image" content={ogImageUrl} />
        {/* NO noindex — research papers are SEO-discoverable per CONTEXT.md */}
        <script type="application/ld+json">{JSON.stringify(scholarlyArticleJsonLd)}</script>
      </Helmet>

      <main className="max-w-screen-md mx-auto px-4 py-8">
        {/* ── Breadcrumb ─────────────────────────────────────────── */}
        <nav aria-label="Breadcrumb" className="mb-6">
          <ol className="flex items-center gap-2 text-[13px] text-[var(--color-text-secondary)]">
            <li>
              <a href="/research" className="text-[var(--color-primary)] hover:underline underline-offset-4">
                Research
              </a>
            </li>
            <li aria-hidden="true">›</li>
            <li className="line-clamp-1">{title}</li>
          </ol>
        </nav>

        {/* ── Header ─────────────────────────────────────────────── */}
        <header className="space-y-3 mb-8">
          <h1 className="font-display italic text-heading font-semibold text-[var(--color-text)] leading-tight">
            {title}
          </h1>

          {/* Sub-header row: date + author + citation */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            {publication.published_at && (
              <span className="text-[11px] text-[var(--color-text-secondary)]">
                {formatDate(publication.published_at)}
              </span>
            )}
            <span aria-hidden="true" className="text-[11px] text-[var(--color-text-tertiary)]">·</span>
            <span className="text-[11px] text-[var(--color-text-secondary)]">
              LeanShot Research
            </span>
            <span aria-hidden="true" className="text-[11px] text-[var(--color-text-tertiary)]">·</span>
            <span className="text-[11px] font-mono text-[var(--color-text-tertiary)]" title="DOI-style citation">
              leanshot/research/{publication.slug}/{formatDateIso(publication.published_at)}
            </span>
          </div>
        </header>

        {/* ── Article body ───────────────────────────────────────── */}
        <article
          className="prose prose-sm max-w-none text-[var(--color-text)] [&_a]:text-[var(--color-primary)] [&_a:hover]:underline [&_blockquote]:border-l-2 [&_blockquote]:border-[var(--color-border)] [&_blockquote]:pl-4 [&_blockquote]:text-[var(--color-text-secondary)] [&_code]:text-[11px] [&_pre]:overflow-x-auto"
          aria-label="Research article body"
        >
          {sanitizedBody ? (
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {sanitizedBody}
            </ReactMarkdown>
          ) : (
            <p className="text-[13px] text-[var(--color-text-secondary)]">
              Full paper content loading…
            </p>
          )}
        </article>

        {/* ── DP Methods Footer (MANDATORY — T-62-06-04) ─────────── */}
        <DpMethodsFooter
          epsilon={publication.epsilon ?? 0.5}
          cohortSize={publication.cohort_size ?? 0}
          suppressedBuckets={publication.suppressed_buckets ?? 0}
        />
      </main>
    </>
  );
}

export default ResearchArticlePage;
