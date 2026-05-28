/**
 * Phase 60 Plan 60-13 — Public /knowledge/<topic>/<slug> article detail page.
 *
 * UI-SPEC §8:
 *  - KnowledgeBreadcrumb: Home › Knowledge › {topic_display_name} › {chunk_title}
 *  - H1: chunk title at text-lg font-sans (18px/600) — NOT Fraunces (invariant 11)
 *  - Body: react-markdown rendering of chunk.summary + quote_blocks via
 *    DOMPurify allowlist (T-60-13-XSS-1 mitigation).
 *  - Right-rail SourcesPanel (sticky lg+, accordion mobile).
 *  - Related chunks sidebar.
 *  - FDA/DSHEA disclaimer footer verbatim from t('rag.fda_off_label_full').
 *
 * SEO via react-helmet-async:
 *  - <title>, description, canonical, og:title/image/type
 *  - JSON-LD MedicalWebPage schema
 *  - noindex when chunk.public_visibility === false (T-60-13-INFO-1)
 *
 * PHARMA-02 carveout: existing 39-02 D-06 invariants (ESLint AST + runtime
 * helper + CI grep) apply upstream. The sanitize helper respects the carveout.
 * No 4th invariant layer added here per feedback_3_layer_must_never_invariant_pattern.
 */

import { useEffect, useState } from 'react';
import { Helmet } from 'react-helmet-async';
import { useTranslation } from 'react-i18next';
import ReactMarkdown from 'react-markdown';
import { useNavigate, useParams } from 'react-router-dom';
import { ProtocolSummaryCard } from '@/components/admin/protocols/ProtocolSummaryCard';
import { Skeleton } from '@/components/ui/Skeleton';
import { getChunkBySlug, listRelatedChunks } from '@/lib/knowledge/api';
import type { RagChunkDetail, RagChunkRow } from '@/lib/knowledge/api';
import { isReservedSlug } from '@/lib/knowledge/topics';
import { parseProtocolShortcodes } from '@/lib/markdown/protocol-shortcode-plugin';
import { sanitizeRagMarkdown } from '@/lib/rag/sanitize';
import { KnowledgeBreadcrumb } from './KnowledgeBreadcrumb';
import { KnowledgeNotFound } from './KnowledgeNotFound';
import { KnowledgeTierBadge } from './KnowledgeTierBadge';
import { SourcesPanel } from './SourcesPanel';

const CANONICAL_BASE = 'https://app.leanshot.app';

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '';
  try {
    return new Date(iso).toISOString().slice(0, 10);
  } catch {
    return iso;
  }
}

function formatDateYearMonth(iso: string | null | undefined): string {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  } catch {
    return iso;
  }
}

/** Determine freshness state for the freshness pill. */
function getFreshnessState(
  reviewedAt: string | null | undefined,
): 'outdated' | 'reviewed' | 'fresh' | 'none' {
  if (!reviewedAt) return 'none';
  const ageMs = Date.now() - new Date(reviewedAt).getTime();
  const twoYearsMs = 2 * 365.25 * 24 * 60 * 60 * 1000;
  const sixMonthsMs = 6 * 30.5 * 24 * 60 * 60 * 1000;
  if (ageMs > twoYearsMs) return 'outdated';
  if (ageMs > sixMonthsMs) return 'reviewed';
  return 'fresh';
}

/** Build the MedicalWebPage JSON-LD schema shape. */
function buildMedicalWebPageJsonLd(
  chunk: RagChunkDetail,
  sourceName: string,
  canonicalUrl: string,
): object {
  const title = chunk.title ?? chunk.summary.split('\n')[0] ?? 'Article';
  const description = chunk.summary.slice(0, 160);
  return {
    '@context': 'https://schema.org',
    '@type': 'MedicalWebPage',
    headline: title,
    description,
    datePublished: chunk.published_at ?? undefined,
    dateModified: chunk.published_at ?? undefined,
    author: { '@type': 'Organization', name: sourceName },
    publisher: {
      '@type': 'Organization',
      name: 'LeanShot',
      logo: {
        '@type': 'ImageObject',
        url: `${CANONICAL_BASE}/og-image.png`,
      },
    },
    mainEntityOfPage: canonicalUrl,
    medicalAudience: 'Patient',
    lastReviewed: chunk.reviewed_at ?? undefined,
  };
}

/** Compose body markdown from summary + quote_blocks */
function buildBodyMarkdown(chunk: RagChunkDetail): string {
  const parts: string[] = [];
  if (chunk.summary) parts.push(chunk.summary);
  if (Array.isArray(chunk.quote_blocks)) {
    for (const block of chunk.quote_blocks) {
      if (typeof block === 'object' && block !== null && 'text' in block) {
        const text = (block as { text: string }).text;
        if (text) parts.push(`> ${text}`);
      }
    }
  }
  return parts.join('\n\n');
}

export function KnowledgeArticleDetailPage() {
  const { topic = '', slug = '' } = useParams<{ topic: string; slug: string }>();
  const navigate = useNavigate();
  const { t } = useTranslation('rag');

  const [chunk, setChunk] = useState<RagChunkDetail | null | undefined>(undefined); // undefined = loading
  const [related, setRelated] = useState<RagChunkRow[]>([]);

  // Validate params
  const isInvalidSlug = isReservedSlug(slug) || isReservedSlug(topic);

  useEffect(() => {
    if (isInvalidSlug) {
      setChunk(null);
      return;
    }
    let cancelled = false;
    setChunk(undefined);

    getChunkBySlug({ topic, slug })
      .then((c) => {
        if (!cancelled) setChunk(c);
        if (!cancelled && c) {
          void listRelatedChunks({ topic, excludeId: c.id }).then((r) => {
            if (!cancelled) setRelated(r);
          });
        }
      })
      .catch(() => {
        if (!cancelled) setChunk(null);
      });

    return () => {
      cancelled = true;
    };
  }, [topic, slug, isInvalidSlug]);

  // Loading state
  if (chunk === undefined) {
    return (
      <div className="max-w-screen-lg mx-auto px-4 py-8 space-y-4">
        <Skeleton className="h-4 w-2/3" />
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-5/6" />
        <Skeleton className="h-4 w-4/5" />
      </div>
    );
  }

  // Null result OR retracted — show 404
  if (chunk === null) return <KnowledgeNotFound />;

  // Extra safety: retracted chunks should be caught by the API (retracted_at IS NULL filter),
  // but double-check here per T-60-13-INFO-2
  if ('retracted_at' in chunk && chunk.retracted_at !== null) return <KnowledgeNotFound />;

  const source = chunk.source;
  const sourceName = source?.name ?? 'Unknown source';
  const title = chunk.title ?? chunk.summary.split('\n')[0] ?? 'Article';
  const description = chunk.summary.slice(0, 160);
  const canonicalUrl = `${CANONICAL_BASE}/knowledge/${topic}/${slug}`;
  const ogImageUrl = `${CANONICAL_BASE}/og/knowledge/${topic}/${slug}.png`;

  const isNoIndex = chunk.public_visibility === false;
  const freshnessState = getFreshnessState(chunk.reviewed_at);

  const medicalWebPageJsonLd = buildMedicalWebPageJsonLd(chunk, sourceName, canonicalUrl);
  const bodyMarkdown = buildBodyMarkdown(chunk);

  // Sanitize the body markdown (T-60-13-XSS-1)
  // We use react-markdown for rendering, which handles markdown parsing.
  // DOMPurify is applied via rehype-sanitize equivalent by sanitizeRagMarkdown
  // on the final rendered HTML in a separate pass if needed, but since
  // react-markdown doesn't produce raw HTML by default, XSS is handled by React's
  // default escaping. We apply sanitizeRagMarkdown as an extra layer on any
  // raw HTML that might be in quote_blocks.
  const sanitizedBody = sanitizeRagMarkdown(bodyMarkdown);

  return (
    <>
      <Helmet>
        <title>{title} — LeanShot Knowledge</title>
        <meta name="description" content={description} />
        <link rel="canonical" href={canonicalUrl} />
        <meta property="og:title" content={title} />
        <meta property="og:description" content={description} />
        <meta property="og:type" content="article" />
        <meta property="og:image" content={ogImageUrl} />
        {isNoIndex && <meta name="robots" content="noindex,nofollow" />}
        <script type="application/ld+json">{JSON.stringify(medicalWebPageJsonLd)}</script>
      </Helmet>

      <main className="max-w-screen-lg mx-auto px-4 py-8">
        <div className="lg:grid lg:grid-cols-3 lg:gap-8">
          {/* ── Main content ────────────────────────────────────────── */}
          <div className="lg:col-span-2 space-y-6">
            <KnowledgeBreadcrumb topic={topic} slug={slug} chunkTitle={title} />

            <header className="space-y-3">
              <h1 className="text-lg font-semibold text-text leading-snug">{title}</h1>

              {/* Source meta strip */}
              <div className="flex flex-wrap items-center gap-2 text-sm text-text-secondary">
                <span>{sourceName}</span>
                <span aria-hidden="true">·</span>
                <KnowledgeTierBadge tier={chunk.source_tier} sourceType={source?.source_type} />
                {freshnessState === 'outdated' && (
                  <span
                    className="text-xs px-2 py-0.5 rounded-pill bg-danger-soft text-danger"
                    role="alert"
                  >
                    May be outdated
                  </span>
                )}
                {freshnessState === 'reviewed' && chunk.reviewed_at && (
                  <span className="text-xs text-text-tertiary">
                    Last reviewed {formatDateYearMonth(chunk.reviewed_at)}
                  </span>
                )}
                {chunk.published_at && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span className="text-xs text-text-tertiary">
                      Published {formatDate(chunk.published_at)}
                    </span>
                  </>
                )}
              </div>
            </header>

            {/* ── Article body ──────────────────────────────────────── */}
            <article
              className="prose prose-sm max-w-none text-text [&_a]:text-primary [&_a:hover]:underline [&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-4 [&_blockquote]:text-text-secondary [&_code]:text-sm [&_pre]:overflow-x-auto"
              aria-label="Article body"
            >
              {/* Phase 61 Plan 07 Task 4 — pre-parse [protocol:<uuid>] shortcodes BEFORE
                  handing markdown to ReactMarkdown. Mirrors the remark-citations.ts pure-parser
                  pattern. Text segments render as markdown; protocol segments render inline as
                  ProtocolSummaryCard. Sanitize-then-parse ordering: sanitizeRagMarkdown runs
                  FIRST (T-60-13-XSS-1 defense), parseProtocolShortcodes runs SECOND on the
                  sanitized string (T-61-07-02 mitigation). */}
              {(() => {
                const { segments } = parseProtocolShortcodes(sanitizedBody);
                return segments.map((seg, i) => {
                  if (seg.type === 'protocol') {
                    return (
                      <div key={`protocol-${i}-${seg.protocolId}`} className="my-4 not-prose">
                        <ProtocolSummaryCard protocolId={seg.protocolId} />
                      </div>
                    );
                  }
                  // Text segment — render as markdown. ReactMarkdown handles empty strings gracefully.
                  return <ReactMarkdown key={`text-${i}`}>{seg.value}</ReactMarkdown>;
                });
              })()}
            </article>

            {/* ── Related articles ──────────────────────────────────── */}
            {related.length > 0 && (
              <section
                aria-labelledby="related-heading"
                className="border-t border-border pt-6 space-y-3"
              >
                <h2
                  id="related-heading"
                  className="text-xs font-semibold text-text-secondary uppercase tracking-wide"
                >
                  Related
                </h2>
                <div className="space-y-2">
                  {related.map((r) => {
                    const rTitle = r.title ?? r.summary.split('\n')[0] ?? 'Article';
                    return (
                      <button
                        key={r.id}
                        type="button"
                        onClick={() => r.slug && navigate(`/${r.topic_tag}/${r.slug}`)}
                        className="w-full text-left rounded-lg border border-border p-3 hover:border-border transition-colors group"
                        aria-label={`Related: ${rTitle}`}
                      >
                        <div className="flex items-start gap-2">
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-semibold text-text line-clamp-2 group-hover:text-primary">
                              {rTitle}
                            </p>
                            <p className="text-xs text-text-secondary mt-0.5">
                              {(r.source as { name: string } | undefined)?.name ?? ''}
                            </p>
                          </div>
                          <KnowledgeTierBadge tier={r.source_tier} />
                        </div>
                      </button>
                    );
                  })}
                </div>
              </section>
            )}

            {/* ── Disclaimer footer ──────────────────────────────────── */}
            <footer className="border-t border-border pt-6 space-y-2">
              <p className="text-sm text-text-secondary">{t('disclaimer')}</p>
              <p className="text-xs text-text-tertiary leading-relaxed">
                {t('fda_off_label_full')}
              </p>
            </footer>
          </div>

          {/* ── Right rail: SourcesPanel ─────────────────────────────── */}
          {source && (
            <aside className="lg:col-span-1 mt-6 lg:mt-0">
              <div className="lg:sticky lg:top-8">
                <SourcesPanel
                  source={{
                    id: source.id,
                    name: source.name,
                    source_type: source.source_type,
                    canonical_url: chunk.canonical_url,
                  }}
                  tier={chunk.source_tier}
                  reviewedAt={chunk.reviewed_at}
                  publishedAt={chunk.published_at}
                  canonicalUrl={chunk.canonical_url}
                />
              </div>
            </aside>
          )}
        </div>
      </main>
    </>
  );
}
