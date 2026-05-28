/**
 * Phase 60 Plan 60-13 — Public /knowledge/<topic> topic index surface.
 *
 * UI-SPEC §9:
 *  - H1 = topic display name in Fraunces italic at text-heading (28px).
 *  - Search input filters article grid via fuse.js (client-side).
 *  - Filter pill row: All Tiers / Tier A / Tier B / Tier C — URL-synced.
 *  - Article grid 2-col on lg+; each chunk card: TierBadge + title + summary
 *    excerpt + footer (source · date · "Read at source ↗" ghost link).
 *  - Card body click → detail page.
 *  - Empty state: "No results for {query}".
 *  - FDA/DSHEA disclaimer footer.
 *
 * T-60-13-SQLI-1: search params ?tier and ?q are zod-validated at the API
 *   layer before PostgREST. URL reflection uses React JSX escaping (never
 *   dangerouslySetInnerHTML).
 */

import Fuse from 'fuse.js';
import { useEffect, useMemo, useState } from 'react';
import { Helmet } from 'react-helmet-async';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { Input } from '@/components/ui/Input';
import { Pill } from '@/components/ui/Pill';
import { Skeleton } from '@/components/ui/Skeleton';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import { listPublishedChunksByTopic, KnowledgeApiError } from '@/lib/knowledge/api';
import type { RagChunkRow } from '@/lib/knowledge/api';
import { getTopicDisplayName, isReservedSlug, TOPIC_DISPLAY_NAMES } from '@/lib/knowledge/topics';
import { KnowledgeNotFound } from './KnowledgeNotFound';
import { KnowledgeTierBadge } from './KnowledgeTierBadge';

const CANONICAL_BASE = 'https://app.leanshot.app';

type TierFilter = 'A' | 'B' | 'C' | 'all';

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toISOString().slice(0, 10); // YYYY-MM-DD
  } catch {
    return iso;
  }
}

export function KnowledgeTopicIndexPage() {
  const { topic = '' } = useParams<{ topic: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const { t } = useTranslation('rag');
  const reducedMotion = useReducedMotion();

  // Validate topic
  const isUnknownTopic = !(topic in TOPIC_DISPLAY_NAMES) || isReservedSlug(topic);
  const topicDisplayName = getTopicDisplayName(topic);

  // Extract + validate URL params
  const rawTier = searchParams.get('tier');
  const tier: TierFilter = rawTier === 'A' || rawTier === 'B' || rawTier === 'C' ? rawTier : 'all';
  const rawQ = searchParams.get('q') ?? '';

  const [chunks, setChunks] = useState<RagChunkRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [localQuery, setLocalQuery] = useState(rawQ);

  useEffect(() => {
    if (isUnknownTopic) return;
    let cancelled = false;
    setLoading(true);
    listPublishedChunksByTopic({ topic, tier: tier === 'all' ? undefined : tier })
      .then((data) => {
        if (!cancelled) setChunks(data);
      })
      .catch((err: unknown) => {
        if (!cancelled && !(err instanceof KnowledgeApiError)) {
          setChunks([]);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [topic, tier, isUnknownTopic]);

  // Fuse.js search over loaded chunks
  const fuse = useMemo(
    () =>
      new Fuse(chunks, {
        keys: ['summary', 'title'],
        threshold: 0.4,
        includeScore: false,
      }),
    [chunks],
  );

  const filteredChunks = useMemo(() => {
    const q = localQuery.trim();
    if (!q) return chunks;
    return fuse.search(q).map((r) => r.item);
  }, [chunks, fuse, localQuery]);

  function setTierFilter(t: TierFilter) {
    const next = new URLSearchParams(searchParams);
    if (t === 'all') {
      next.delete('tier');
    } else {
      next.set('tier', t);
    }
    setSearchParams(next);
  }

  if (isUnknownTopic) return <KnowledgeNotFound />;

  const collectionJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: `${topicDisplayName} — LeanShot Knowledge`,
    url: `${CANONICAL_BASE}/knowledge/${topic}`,
    description: `Browse ${topicDisplayName} research articles curated by LeanShot.`,
  };

  return (
    <>
      <Helmet>
        <title>{topicDisplayName} — LeanShot Knowledge</title>
        <meta
          name="description"
          content={`Browse ${topicDisplayName} research articles curated by LeanShot.`}
        />
        <link rel="canonical" href={`${CANONICAL_BASE}/knowledge/${topic}`} />
        <script type="application/ld+json">{JSON.stringify(collectionJsonLd)}</script>
      </Helmet>

      <main className="max-w-screen-lg mx-auto px-4 py-8 space-y-6">
        {/* ── Hero ─────────────────────────────────────────────────── */}
        <section aria-labelledby="topic-heading">
          <nav aria-label="Breadcrumb" className="text-xs text-text-secondary mb-3">
            <ol className="flex items-center gap-1 list-none p-0">
              <li>
                <button type="button" onClick={() => navigate('/')} className="hover:underline">
                  Knowledge
                </button>
              </li>
              <li aria-hidden="true">›</li>
              <li aria-current="page">{topicDisplayName}</li>
            </ol>
          </nav>
          <h1
            id="topic-heading"
            className="font-display italic text-heading font-semibold text-text leading-tight"
          >
            {topicDisplayName}
          </h1>
        </section>

        {/* ── Search + filter ──────────────────────────────────────── */}
        <section aria-label="Search and filter">
          <Input
            type="search"
            placeholder={`Search ${topicDisplayName}…`}
            value={localQuery}
            onChange={(e) => setLocalQuery(e.target.value)}
            aria-label={`Search ${topicDisplayName} articles`}
            className="mb-3"
          />
          <div role="group" aria-label="Filter by tier" className="flex gap-2 flex-wrap">
            {(['all', 'A', 'B', 'C'] as TierFilter[]).map((tf) => (
              <Pill key={tf} active={tier === tf} onClick={() => setTierFilter(tf)}>
                {tf === 'all' ? 'All Tiers' : `Tier ${tf}`}
              </Pill>
            ))}
          </div>
        </section>

        {/* ── Article grid ─────────────────────────────────────────── */}
        <section aria-label="Articles">
          {loading ? (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-40 rounded-xl" />
              ))}
            </div>
          ) : filteredChunks.length === 0 ? (
            <EmptyState
              title={localQuery ? `No results for “${localQuery}”` : 'No articles yet'}
              body={
                localQuery
                  ? 'Try a broader search term or browse all topics.'
                  : `No published articles in ${topicDisplayName} yet.`
              }
            />
          ) : (
            <>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {filteredChunks.map((chunk) => (
                  <ArticleCard
                    key={chunk.id}
                    chunk={chunk}
                    topic={topic}
                    reducedMotion={reducedMotion}
                    onNavigate={(slug) => navigate(`/${topic}/${slug}`)}
                  />
                ))}
              </div>
              {chunks.length === 50 && filteredChunks.length === 50 && (
                <div className="flex justify-center mt-6">
                  <Button
                    variant="secondary"
                    onClick={() => {
                      /* TODO v1.5 infinite scroll — load more */
                    }}
                  >
                    Load more
                  </Button>
                </div>
              )}
            </>
          )}
        </section>

        {/* ── FDA/DSHEA disclaimer footer ──────────────────────────── */}
        <footer className="border-t border-border pt-6">
          <p className="text-xs text-text-tertiary leading-relaxed">{t('fda_off_label_full')}</p>
        </footer>
      </main>
    </>
  );
}

// ─── Article card sub-component ──────────────────────────────────────────────

interface ArticleCardProps {
  chunk: RagChunkRow;
  topic: string;
  reducedMotion: boolean;
  onNavigate: (slug: string) => void;
}

function ArticleCard({ chunk, reducedMotion, onNavigate }: ArticleCardProps) {
  const sourceObj = chunk.source as { name: string; source_type: string } | undefined;
  const title = chunk.title ?? chunk.summary.split('\n')[0] ?? 'Untitled';
  const date = chunk.published_at ? formatDate(chunk.published_at) : '';

  return (
    <Card
      variant="interactive"
      onClick={() => chunk.slug && onNavigate(chunk.slug)}
      aria-label={`Article: ${title}`}
      className={reducedMotion ? '' : 'transition-shadow duration-150'}
    >
      <div className="p-4 space-y-2 h-full flex flex-col">
        <div className="flex items-center justify-between gap-2">
          <Pill className="text-xs">{chunk.topic_tag}</Pill>
          <KnowledgeTierBadge tier={chunk.source_tier} sourceType={sourceObj?.source_type} />
        </div>
        <h2 className="text-lg font-semibold text-text leading-snug line-clamp-2 flex-1">
          {title}
        </h2>
        <p className="text-xs text-text-secondary line-clamp-2">{chunk.summary}</p>
        <div className="flex items-center justify-between gap-2 mt-auto pt-2 border-t border-border">
          <span className="text-xs text-text-tertiary truncate">
            {sourceObj?.name ?? 'Unknown'}
            {date ? ` · As of ${date}` : ''}
          </span>
          {chunk.canonical_url && (
            <a
              href={chunk.canonical_url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-primary hover:underline shrink-0"
              onClick={(e) => e.stopPropagation()}
              aria-label={`Read at source: ${sourceObj?.name ?? 'source'}`}
            >
              Read at source ↗
            </a>
          )}
        </div>
      </div>
    </Card>
  );
}
