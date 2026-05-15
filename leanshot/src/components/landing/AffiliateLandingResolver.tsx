/**
 * Phase 19 Plan 19-08 — /r/{code}/landing resolver.
 *
 * Wired by Plan 19-09 in `App.tsx` against a path match of
 * `^/r/([a-z0-9-]+)/landing$` — Plan 19-09 captures the `code` segment and
 * passes it as a prop. This resolver fetches the affiliate row via the
 * anon-readable `affiliates_public_view` (Plan 19-01 BL-3), fires a
 * non-blocking impression ping (BL-8 / D-38), and lazy-imports the
 * matching template renderer.
 *
 * Render states:
 *   - Loading:  thin skeleton
 *   - 404 :     "This page isn't available." + link back to /
 *   - Found:    <Suspense> + lazy template chunk for template_choice
 *
 * Threat-model honors (UI-SPEC §"Template variant"):
 *   - affiliates_public_view exposes only 8 non-PII columns + filters
 *     status='approved' — non-approved affiliates render the 404 view.
 *   - Display strings are passed through React JSX children → auto-escaped.
 *   - The impression ping is fired AFTER the affiliate row resolves so we
 *     never record impressions for missing / non-approved affiliates.
 */
import { type ReactElement, Suspense, lazy, useEffect, useMemo, useState } from 'react';
import { recordImpression } from '@/lib/affiliate/impression';
import { supabase } from '@/lib/supabase';
import type { AffiliatePublicRow } from './LandingTemplateCoach';

interface ResolverState {
  status: 'loading' | 'found' | 'not_found';
  affiliate: AffiliatePublicRow | null;
}

export interface AffiliateLandingResolverProps {
  code: string;
}

const TEMPLATE_LOADERS = {
  coach: () => import('./LandingTemplateCoach'),
  story: () => import('./LandingTemplateStory'),
  method: () => import('./LandingTemplateMethod'),
} as const;

function LandingSkeleton(): ReactElement {
  return (
    <main className="max-w-[1200px] mx-auto px-4 md:px-8 py-12 md:py-16" aria-busy="true">
      <div className="animate-pulse space-y-6">
        <div className="h-[200px] w-full max-w-md rounded-card bg-[var(--color-surface-2)]" />
        <div className="h-10 w-2/3 rounded-card bg-[var(--color-surface-2)]" />
        <div className="h-6 w-1/2 rounded-card bg-[var(--color-surface-2)]" />
        <div className="h-12 w-48 rounded-card bg-[var(--color-surface-2)]" />
      </div>
    </main>
  );
}

function NotFoundView(): ReactElement {
  return (
    <main className="max-w-[1200px] mx-auto px-4 md:px-8 py-16 md:py-24 text-center">
      <h1 className="text-4xl font-semibold mb-4 text-[var(--color-text-primary)]">
        This page isn&apos;t available.
      </h1>
      <p className="text-lg text-[var(--color-text-secondary)] mb-8">
        The link you followed may be expired or no longer active.
      </p>
      <a
        href="/"
        className="inline-flex items-center justify-center px-6 py-3 rounded-card bg-[var(--color-primary)] text-white font-semibold text-lg hover:opacity-90 transition-opacity"
      >
        Go to LeanShot
      </a>
    </main>
  );
}

export function AffiliateLandingResolver({
  code,
}: AffiliateLandingResolverProps): ReactElement {
  const [state, setState] = useState<ResolverState>({ status: 'loading', affiliate: null });

  useEffect(() => {
    let cancelled = false;
    const trimmed = (code ?? '').trim().toLowerCase();
    if (!trimmed) {
      setState({ status: 'not_found', affiliate: null });
      return () => {
        cancelled = true;
      };
    }
    (async (): Promise<void> => {
      try {
        const { data } = await supabase
          .from('affiliates_public_view')
          .select('id,display_name,photo_path,blurb,calendly_url,testimonial_quote,template_choice,referral_code')
          .eq('referral_code', trimmed)
          .maybeSingle();
        if (cancelled) return;
        if (!data) {
          setState({ status: 'not_found', affiliate: null });
          return;
        }
        const affiliate = data as AffiliatePublicRow;
        setState({ status: 'found', affiliate });
        // Fire-and-forget impression ping AFTER state set so the landing
        // render is not blocked. recordImpression() is silent on failure.
        void recordImpression(affiliate.id);
      } catch {
        if (cancelled) return;
        // Treat fetch failure as not_found — never leak a stack trace to a
        // landing page; the visitor sees the same view as a missing code.
        setState({ status: 'not_found', affiliate: null });
      }
    })();
    return (): void => {
      cancelled = true;
    };
  }, [code]);

  const TemplateComponent = useMemo(() => {
    if (state.status !== 'found' || !state.affiliate) return null;
    const choice = state.affiliate.template_choice;
    const loader =
      TEMPLATE_LOADERS[choice] ?? TEMPLATE_LOADERS.coach; /* fallback to coach */
    return lazy(loader);
  }, [state.status, state.affiliate]);

  if (state.status === 'loading') return <LandingSkeleton />;
  if (state.status === 'not_found' || !state.affiliate || !TemplateComponent) {
    return <NotFoundView />;
  }
  return (
    <Suspense fallback={<LandingSkeleton />}>
      <TemplateComponent affiliate={state.affiliate} />
    </Suspense>
  );
}

export default AffiliateLandingResolver;
