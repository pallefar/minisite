/**
 * Phase 60 Plan 60-13 — Public /knowledge root surface.
 *
 * UI-SPEC §10:
 *  - H1 "Knowledge Base" in Fraunces italic at text-heading (28px) — SOLE
 *    Fraunces usage per invariant 11.
 *  - Topic grid: Card variant="interactive" per topic from listTopics().
 *  - Featured chunk: Card variant="elevated" with summary excerpt.
 *  - Newsletter signup: email Input + Subscribe button.
 *  - Full FDA/DSHEA disclaimer footer (verbatim from t('rag.fda_off_label_full')).
 *
 * SEO: react-helmet-async <Helmet> sets <title>, description, canonical,
 * og:title, og:type, JSON-LD WebSite schema.
 */

import { useEffect, useState } from 'react';
import { Helmet } from 'react-helmet-async';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Skeleton } from '@/components/ui/Skeleton';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import { getFeaturedChunk, listTopics } from '@/lib/knowledge/api';
import type { RagChunkRow, TopicSummary } from '@/lib/knowledge/api';
import { getTopicDisplayName } from '@/lib/knowledge/topics';
import { KnowledgeTierBadge } from './KnowledgeTierBadge';

const CANONICAL_BASE = 'https://app.leanshot.app';

// JSON-LD WebSite schema for the root page
const websiteJsonLd = {
  '@context': 'https://schema.org',
  '@type': 'WebSite',
  name: 'LeanShot Knowledge Base',
  url: `${CANONICAL_BASE}/knowledge`,
  potentialAction: {
    '@type': 'SearchAction',
    target: {
      '@type': 'EntryPoint',
      urlTemplate: `${CANONICAL_BASE}/knowledge?q={search_term_string}`,
    },
    'query-input': 'required name=search_term_string',
  },
};

export function KnowledgeRootPage() {
  const { t } = useTranslation('rag');
  const navigate = useNavigate();
  const reducedMotion = useReducedMotion();

  const [topics, setTopics] = useState<TopicSummary[]>([]);
  const [featured, setFeatured] = useState<RagChunkRow | null>(null);
  const [loading, setLoading] = useState(true);

  // Newsletter signup state
  const [email, setEmail] = useState('');
  const [subscribeStatus, setSubscribeStatus] = useState<'idle' | 'submitting' | 'success' | 'error'>('idle');

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [topicList, featuredChunk] = await Promise.all([listTopics(), getFeaturedChunk()]);
        if (!cancelled) {
          setTopics(topicList);
          setFeatured(featuredChunk);
        }
      } catch {
        // fail-soft: render with empty state
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => { cancelled = true; };
  }, []);

  async function handleSubscribe(e: React.FormEvent) {
    e.preventDefault();
    if (!email || subscribeStatus === 'submitting') return;
    setSubscribeStatus('submitting');
    try {
      const resp = await fetch('/functions/v1/rag-newsletter-subscribe-public', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      if (resp.ok) {
        setSubscribeStatus('success');
        setEmail('');
      } else {
        setSubscribeStatus('error');
      }
    } catch {
      setSubscribeStatus('error');
    }
  }

  const description = 'Curated peptide and metabolic research, summarized with sources.';

  return (
    <>
      <Helmet>
        <title>Knowledge Base — LeanShot</title>
        <meta name="description" content={description} />
        <link rel="canonical" href={`${CANONICAL_BASE}/knowledge`} />
        <meta property="og:title" content="Knowledge Base — LeanShot" />
        <meta property="og:description" content={description} />
        <meta property="og:type" content="website" />
        <script type="application/ld+json">{JSON.stringify(websiteJsonLd)}</script>
      </Helmet>

      <main className="max-w-screen-lg mx-auto px-4 py-8 space-y-10">
        {/* ── Hero strip ───────────────────────────────────────────── */}
        <section aria-labelledby="kb-heading">
          <h1
            id="kb-heading"
            className="font-display italic text-heading font-semibold text-text-primary leading-tight"
          >
            Knowledge Base
          </h1>
          <p className="text-sm text-text-secondary mt-1">{description}</p>
        </section>

        {/* ── Topic grid ───────────────────────────────────────────── */}
        <section aria-label="Browse topics">
          {loading ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-24 rounded-xl" />
              ))}
            </div>
          ) : topics.length === 0 ? (
            <p className="text-sm text-text-secondary">No topics available yet.</p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {topics.map((topic) => (
                <button
                  key={topic.slug}
                  type="button"
                  onClick={() => navigate(`/${topic.slug}`)}
                  className={[
                    'text-left rounded-xl border border-border-subtle bg-surface-card p-4',
                    'hover:border-border focus-visible:outline-2 focus-visible:outline-accent',
                    reducedMotion ? '' : 'transition-colors duration-150',
                  ].join(' ')}
                  aria-label={`Browse ${topic.display_name} — ${topic.chunk_count} articles`}
                >
                  <div className="text-lg font-semibold text-text-primary leading-snug">
                    {topic.display_name}
                  </div>
                  <div className="text-xs text-text-secondary mt-1">
                    {topic.chunk_count} {topic.chunk_count === 1 ? 'article' : 'articles'}
                  </div>
                </button>
              ))}
            </div>
          )}
        </section>

        {/* ── Featured chunk ───────────────────────────────────────── */}
        {featured && (
          <section aria-label="Featured article">
            <div className="rounded-xl border border-border bg-surface-elevated p-6 space-y-3">
              <div className="flex items-center gap-2">
                <span className="text-xs text-text-secondary uppercase tracking-wide">
                  {getTopicDisplayName(featured.topic_tag)}
                </span>
                <KnowledgeTierBadge tier={featured.source_tier} />
              </div>
              <h2 className="text-lg font-semibold text-text-primary leading-snug line-clamp-2">
                {featured.title ?? featured.summary.split('\n')[0]}
              </h2>
              <p className="text-sm text-text-secondary line-clamp-2">
                {featured.summary}
              </p>
              <div className="flex items-center justify-between">
                <span className="text-xs text-text-tertiary">
                  {featured.source
                    ? (featured.source as { name: string }).name
                    : 'Unknown source'}
                </span>
                {featured.slug && (
                  <button
                    type="button"
                    onClick={() => navigate(`/${featured.topic_tag}/${featured.slug}`)}
                    className="text-sm font-medium text-accent hover:underline"
                  >
                    Read more →
                  </button>
                )}
              </div>
            </div>
          </section>
        )}

        {/* ── Newsletter signup ────────────────────────────────────── */}
        <section aria-labelledby="newsletter-heading" className="rounded-xl border border-border-subtle bg-surface p-6">
          <h2
            id="newsletter-heading"
            className="text-lg font-semibold text-text-primary mb-1"
          >
            Get the weekly research digest
          </h2>
          <p className="text-sm text-text-secondary mb-4">
            Curated summaries from peer-reviewed sources, delivered Sundays. Unsubscribe anytime.
          </p>

          {subscribeStatus === 'success' ? (
            <p className="text-sm text-success" role="status">
              You&apos;re subscribed. Check your inbox for a confirmation.
            </p>
          ) : (
            <form onSubmit={(e) => void handleSubscribe(e)} className="flex gap-3 items-end">
              <div className="flex-1">
                <Input
                  type="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  aria-label="Email address for research digest"
                  required
                />
              </div>
              <Button
                type="submit"
                variant="primary"
                aria-busy={subscribeStatus === 'submitting'}
                disabled={subscribeStatus === 'submitting'}
              >
                Subscribe to digest
              </Button>
            </form>
          )}
          {subscribeStatus === 'error' && (
            <p className="text-xs text-danger mt-2" role="alert">
              Something went wrong. Please try again.
            </p>
          )}
          <p className="text-xs text-text-tertiary mt-3">
            Unsubscribe anytime. Not medical advice.
          </p>
        </section>

        {/* ── FDA/DSHEA disclaimer footer ──────────────────────────── */}
        <footer className="border-t border-border-subtle pt-6">
          <p className="text-xs text-text-tertiary leading-relaxed">
            {t('fda_off_label_full')}
          </p>
        </footer>
      </main>
    </>
  );
}
