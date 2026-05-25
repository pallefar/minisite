/**
 * Phase 38 Plan 38-09 — ForYouCard (D-01 dashboard surface).
 *
 * Bento card surfaced on the Home tab; renders top-3 recommendations from the
 * `recommend-next-best-action` Edge Fn for the authenticated user. Falls back
 * to a popular-content placeholder on error or 3s timeout (D-02 graceful
 * degradation).
 *
 * Click tracking is server-side: clicks POST to the `track-rec-click` Edge Fn
 * which captures `recommendation.clicked` via posthog-server.ts. The browser
 * never emits AI events directly (Phase 24 D-12 — adblock-resilient capture).
 *
 * Bundle posture (memory project_phase5_bundle_regression): this module is
 * intended to be `React.lazy`-loaded from HomeTab.tsx so it doesn't widen the
 * initial route chunk. The card is small (no chart, no framer-motion-heavy
 * surface) so the delta is <2 kB gz.
 */

import { useTranslation } from 'react-i18next';
import { ArrowRight } from 'lucide-react';
import { type ReactElement, useCallback, useEffect, useRef, useState } from 'react';
import { Card, CardHeader } from '@/components/ui/Card';
import { Skeleton } from '@/components/ui/Skeleton';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import { useStore } from '@/lib/store';
import { supabase } from '@/lib/supabase';

const RECOMMEND_TIMEOUT_MS = 3000;

/**
 * Recommendation shape returned by `recommend-next-best-action` (D-03 contract).
 * Only the keys we render on the card are typed; the Edge Fn includes more.
 */
export interface ForYouRecommendation {
  recommendation_id: string;
  source_type: string;
  source_id: string;
  title?: string;
  deeplink?: string;
  score?: number;
}

/**
 * Popular-content fallback shape — small set of hard-coded KB pointers that
 * render while the Edge Fn warms / errors. These render the same row UI as
 * personalized recommendations but don't fire click tracking (no
 * recommendation_id to attach the click to).
 */
const POPULAR_FALLBACK: ForYouRecommendation[] = [
  {
    recommendation_id: 'fallback-glp1-rotation',
    source_type: 'kb_article',
    source_id: 'fallback-glp1-rotation',
    title: 'Injection-site rotation basics',
    deeplink: '/kb/injection-rotation',
  },
  {
    recommendation_id: 'fallback-glp1-curve',
    source_type: 'kb_article',
    source_id: 'fallback-glp1-curve',
    title: 'Reading your drug-level curve',
    deeplink: '/kb/drug-level-curve',
  },
  {
    recommendation_id: 'fallback-foodnoise',
    source_type: 'kb_article',
    source_id: 'fallback-foodnoise',
    title: 'Logging food-noise without obsessing',
    deeplink: '/kb/food-noise',
  },
];

interface ForYouCardProps {
  /** Override the default 6-col span (e.g. side panels). */
  span?: 3 | 4 | 5 | 6 | 7 | 8 | 12;
}

/**
 * Default export so the consumer can do `React.lazy(() => import(...))` per
 * Phase 5 bundle posture. Named export retained for direct imports in tests.
 */
export function ForYouCard({ span = 6 }: ForYouCardProps = {}): ReactElement {
  const { t } = useTranslation('patient');
  const userId = useStore((s) => s.signedIn?.user?.id ?? null);
  const reducedMotion = useReducedMotion();

  const [recs, setRecs] = useState<ForYouRecommendation[] | null>(null);
  const [fallback, setFallback] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(true);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!userId) {
      // No session yet — render the popular fallback so the card never blank-flashes.
      setRecs(POPULAR_FALLBACK);
      setFallback(true);
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    abortRef.current = controller;
    const timeoutId = window.setTimeout(() => controller.abort(), RECOMMEND_TIMEOUT_MS);

    let cancelled = false;
    (async () => {
      try {
        const { data, error } = await supabase.functions.invoke('recommend-next-best-action', {
          body: { user_id: userId, surface: 'dashboard' },
        });
        if (cancelled) return;
        if (error) throw error;
        const payload = (data ?? {}) as { recommendations?: ForYouRecommendation[] };
        const list = payload.recommendations ?? [];
        if (list.length === 0) {
          setRecs(POPULAR_FALLBACK);
          setFallback(true);
        } else {
          setRecs(list.slice(0, 3));
          setFallback(false);
        }
      } catch {
        if (cancelled) return;
        // 3s timeout, network error, or Edge Fn 5xx — D-02 popular fallback.
        setRecs(POPULAR_FALLBACK);
        setFallback(true);
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
  }, [userId]);

  const handleClick = useCallback(
    (rec: ForYouRecommendation) => {
      // Personalized recs have UUID recommendation_ids; fallback rows use
      // string sentinels prefixed with 'fallback-' — those skip server tracking.
      if (!fallback && !rec.recommendation_id.startsWith('fallback-')) {
        // Fire-and-forget; we don't block navigation on the tracker.
        void fetch(`${import.meta.env.VITE_SUPABASE_URL ?? ''}/functions/v1/track-rec-click`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            // Use the supabase-js access token if present so RLS resolves.
            Authorization: `Bearer ${
              (typeof window !== 'undefined' &&
                window.localStorage.getItem('sb-leanshot-auth')) ??
              ''
            }`,
          },
          body: JSON.stringify({
            recommendation_id: rec.recommendation_id,
            surface: 'dashboard',
          }),
        }).catch(() => {
          /* swallow — tracker failure must not break navigation */
        });
      }
      if (rec.deeplink) {
        window.location.href = rec.deeplink;
      }
    },
    [fallback],
  );

  return (
    <Card span={span} variant="elevated" data-testid="for-you-card">
      <CardHeader title={t('patient:card.for_you.title')} />
      {loading && (
        <div className="flex flex-col gap-2" aria-busy="true">
          <Skeleton className="h-12 w-full rounded-lg" />
          <Skeleton className="h-12 w-full rounded-lg" />
          <Skeleton className="h-12 w-full rounded-lg" />
        </div>
      )}
      {!loading && recs && recs.length > 0 && (
        <ul className="flex flex-col gap-2" data-testid="for-you-list">
          {recs.map((rec) => (
            <li key={rec.recommendation_id}>
              <button
                type="button"
                onClick={() => handleClick(rec)}
                className={
                  'group flex w-full items-center justify-between gap-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-elevated)] px-3 py-2.5 text-left hover:border-[var(--color-primary-soft)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]' +
                  (reducedMotion
                    ? ''
                    : ' transition-[transform,border-color] hover:-translate-y-[1px]')
                }
                aria-label={t('patient:card.for_you.open_rec', { title: rec.title ?? rec.source_id })}
              >
                <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-[var(--color-text)]">
                  {rec.title ?? rec.source_id}
                </span>
                {typeof rec.score === 'number' && !fallback && (
                  <span
                    aria-label={`Score ${(rec.score * 100).toFixed(0)} percent`}
                    className="shrink-0 rounded-full bg-[var(--color-primary-soft)] px-2 py-0.5 text-[10px] font-semibold text-[var(--color-primary)]"
                  >
                    {Math.round(rec.score * 100)}
                  </span>
                )}
                <ArrowRight
                  className="size-4 shrink-0 text-[var(--color-text-secondary)]"
                  aria-hidden
                />
              </button>
            </li>
          ))}
        </ul>
      )}
      {fallback && !loading && (
        <p className="mt-2 text-[11px] text-[var(--color-text-tertiary)]" data-testid="for-you-fallback-notice">
          {t('patient:card.for_you.fallback_notice')}
        </p>
      )}
    </Card>
  );
}

export default ForYouCard;
