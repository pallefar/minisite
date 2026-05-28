/**
 * Phase 38 Plan 38-09 — RelatedArticlesFooter (RECOMMEND-08 kb_footer surface).
 *
 * Rendered at the bottom of KB article pages. Calls
 * `recommend-next-best-action` with `surface: 'kb_footer'` plus
 * `exclude_content_id: currentKbId` so the recommender doesn't recommend the
 * article the user is already reading.
 *
 * Vendor-gated pattern (memory reference_vendor_gated_send_health_check):
 * KB pages do NOT yet exist in this project. This component is included now
 * so that when the KB ships (a future phase), wiring is one import away;
 * until then it renders nothing if the recommender returns an empty list.
 *
 * Click tracking is server-side via `track-rec-click` (same path as ForYouCard).
 * Phase 24 D-12 — no client-side AI event capture.
 */

import { type ReactElement, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Card, CardHeader } from '@/components/ui/Card';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import { useStore } from '@/lib/store';
import { supabase } from '@/lib/supabase';

const RECOMMEND_TIMEOUT_MS = 3000;

interface RelatedArticle {
  recommendation_id: string;
  source_type: string;
  source_id: string;
  title?: string;
  deeplink?: string;
}

interface RelatedArticlesFooterProps {
  /** id of the KB article being viewed; excluded from recommendations. */
  currentKbId: string;
}

export function RelatedArticlesFooter({
  currentKbId,
}: RelatedArticlesFooterProps): ReactElement | null {
  const { t } = useTranslation('kb');
  const userId = useStore((s) => s.signedIn?.user?.id ?? null);
  const reducedMotion = useReducedMotion();
  const [recs, setRecs] = useState<RelatedArticle[] | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  useEffect(() => {
    if (!userId) {
      setRecs([]);
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), RECOMMEND_TIMEOUT_MS);
    let cancelled = false;

    (async () => {
      try {
        const { data, error } = await supabase.functions.invoke('recommend-next-best-action', {
          body: {
            user_id: userId,
            surface: 'kb_footer',
            exclude_content_id: currentKbId,
          },
        });
        if (cancelled) return;
        if (error) throw error;
        const payload = (data ?? {}) as { recommendations?: RelatedArticle[] };
        setRecs((payload.recommendations ?? []).slice(0, 3));
      } catch {
        if (cancelled) return;
        // Quiet failure — KB footer is decorative; the article body still renders.
        setRecs([]);
      } finally {
        if (!cancelled) setLoading(false);
        window.clearTimeout(timeoutId);
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
      window.clearTimeout(timeoutId);
    };
  }, [userId, currentKbId]);

  // Loading: render nothing — the article body is the priority surface.
  if (loading) return null;
  // Empty: same — never push noise onto KB pages when the recommender is silent.
  if (!recs || recs.length === 0) return null;

  const handleClick = (rec: RelatedArticle) => {
    if (!rec.recommendation_id.startsWith('fallback-')) {
      void fetch(`${import.meta.env.VITE_SUPABASE_URL ?? ''}/functions/v1/track-rec-click`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${
            (typeof window !== 'undefined' && window.localStorage.getItem('sb-leanshot-auth')) ?? ''
          }`,
        },
        body: JSON.stringify({
          recommendation_id: rec.recommendation_id,
          surface: 'kb_footer',
        }),
      }).catch(() => {
        /* swallow */
      });
    }
    if (rec.deeplink) {
      window.location.href = rec.deeplink;
    }
  };

  return (
    <Card span={12} variant="footer" data-testid="related-articles-footer">
      <CardHeader title={t('kb:related_articles.title')} />
      <ul className="grid grid-cols-1 gap-2 md:grid-cols-3">
        {recs.map((rec) => (
          <li key={rec.recommendation_id}>
            <button
              type="button"
              onClick={() => handleClick(rec)}
              className={
                'block w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2.5 text-left text-[13px] font-medium text-[var(--color-text)] hover:border-[var(--color-primary-soft)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]' +
                (reducedMotion
                  ? ''
                  : ' transition-[transform,border-color] hover:-translate-y-[1px]')
              }
              aria-label={`Open related article: ${rec.title ?? rec.source_id}`}
            >
              {rec.title ?? rec.source_id}
            </button>
          </li>
        ))}
      </ul>
    </Card>
  );
}

export default RelatedArticlesFooter;
