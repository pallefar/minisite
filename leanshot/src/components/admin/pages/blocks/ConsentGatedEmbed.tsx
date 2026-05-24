/**
 * Phase 41 Plan 41-05 — ConsentGatedEmbed HOC.
 *
 * Owns the State 1/2/3 state machine per UI-SPEC §Surface B:
 *   - State 1 (placeholder): EmbedPlaceholderCard, NO iframe in DOM.
 *   - State 2 (loading):     Card wrapper aria-busy=true + Skeleton + iframe opacity-0.
 *   - State 3 (loaded):      Same Card, no Skeleton, iframe opacity-100.
 *
 * Mount-race defense (T-41-05-02): useEffect reads CookieConsent.acceptedCategory
 * SYNCHRONOUSLY for every required category at mount, before subscribing to the
 * consent-change event.
 *
 * Revoke handling (T-41-05-01): On consent revoke, the iframe element is
 * UNMOUNTED (conditional render returns to State 1) — never kept in the DOM
 * with src='' (anti-pattern: providers continue setting cookies on stale src).
 */
import { useCallback, useEffect, useState, type JSX } from 'react';
import * as CookieConsent from 'vanilla-cookieconsent';

import { Card } from '@/components/ui/Card';
import { Skeleton } from '@/components/ui/Skeleton';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import { subscribeToConsentChange } from '@/lib/consent/consent-event';

import { EmbedPlaceholderCard, type ConsentCategory, type EmbedProvider } from './EmbedPlaceholderCard';

export interface ConsentGatedEmbedProps {
  provider: EmbedProvider;
  categories: ReadonlyArray<ConsentCategory>;
  minHeight?: number;
  aspectRatio?: string;
  sandbox: string;
  title: string;
  src: string;
  /** Optional iframe allow= attribute (e.g. 'encrypted-media; picture-in-picture'). */
  allow?: string;
  /** Test hook — set on the wrapper Card for E2E/integration tests. */
  ['data-testid']?: string;
}

type Phase = 'placeholder' | 'loading' | 'loaded';

function readAllAccepted(categories: ReadonlyArray<ConsentCategory>): boolean {
  // Functional is implicitly granted per consent-event.ts contract — but
  // we still call acceptedCategory for symmetry. The vanilla-cookieconsent
  // adapter returns true for 'functional' when granted.
  return categories.every((c) => {
    try {
      return CookieConsent.acceptedCategory(c);
    } catch {
      return false;
    }
  });
}

export function ConsentGatedEmbed({
  provider,
  categories,
  minHeight,
  aspectRatio,
  sandbox,
  title,
  src,
  allow,
  'data-testid': testId,
}: ConsentGatedEmbedProps): JSX.Element {
  const reduceMotion = useReducedMotion();

  // Synchronous initial read defends T-41-05-02 (HOC mounts AFTER consent
  // already granted — no event will fire to flip us).
  const [phase, setPhase] = useState<Phase>(() =>
    readAllAccepted(categories) ? 'loading' : 'placeholder',
  );

  // Subscribe to consent-change. On grant → loading; on revoke → placeholder.
  useEffect(() => {
    const cleanup = subscribeToConsentChange(() => {
      const allOk = readAllAccepted(categories);
      setPhase((prev) => {
        if (allOk) {
          // Re-mount the iframe (loading) if currently in placeholder.
          // Stay in 'loaded' if iframe has already finished loading.
          return prev === 'placeholder' ? 'loading' : prev;
        }
        // Revoke — drop to placeholder so iframe element unmounts.
        return 'placeholder';
      });
    });
    // Re-read on mount as well in case events fired between hydrate and effect.
    if (readAllAccepted(categories)) {
      setPhase((prev) => (prev === 'placeholder' ? 'loading' : prev));
    }
    return cleanup;
  }, [categories]);

  const handleLoad = useCallback(() => {
    setPhase((prev) => (prev === 'loading' ? 'loaded' : prev));
  }, []);

  if (phase === 'placeholder') {
    return <EmbedPlaceholderCard provider={provider} categories={categories} />;
  }

  const wrapperStyle: React.CSSProperties = {};
  if (minHeight !== undefined) wrapperStyle.minHeight = minHeight;
  if (aspectRatio !== undefined) wrapperStyle.aspectRatio = aspectRatio;

  const iframeClassName =
    'absolute inset-0 w-full h-full border-0 ' +
    (reduceMotion ? '' : 'transition-opacity duration-200 ease-out ') +
    (phase === 'loaded' ? 'opacity-100' : 'opacity-0');

  return (
    <Card
      variant="default"
      padding="none"
      data-testid={testId}
      data-provider={provider}
      aria-busy={phase === 'loading'}
      className="relative overflow-hidden"
      style={wrapperStyle}
    >
      {phase === 'loading' && (
        <Skeleton className="absolute inset-0 w-full h-full" />
      )}
      <iframe
        src={src}
        title={title}
        loading="lazy"
        referrerPolicy="no-referrer"
        sandbox={sandbox}
        {...(allow ? { allow } : {})}
        onLoad={handleLoad}
        className={iframeClassName}
      />
    </Card>
  );
}
