/**
 * Phase 15 Plan 15-06 — CalendlyBlock editor preview.
 *
 * Same security posture as YouTubeBlock (see file). Calendly booking opens
 * popups so the sandbox set adds `allow-popups` + `allow-forms`. min-height
 * 600px per 15-UI-SPEC visual contract.
 */
import { useState } from 'react';
import { Card } from '@/components/ui/Card';
import { Skeleton } from '@/components/ui/Skeleton';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import type { BlockNode } from '@/lib/page-builder/block-schema';
import { EMBED_IFRAME_TITLES, buildCalendlySrc } from '@/lib/page-builder/embed-src';
import { backgroundToneClass, paddingForDensity } from './block-style-helpers';

export interface CalendlyBlockProps {
  block: BlockNode;
}

interface CalendlyContentShape {
  calendlyUrl?: unknown;
  prefillEmail?: unknown;
}

export function CalendlyBlock({ block }: CalendlyBlockProps) {
  const content = (block.content ?? {}) as CalendlyContentShape;
  const tone = block.style.backgroundTone ?? 'default';
  const density = block.style.spacingDensity ?? 'default';
  const hideOnMobile = !!block.style.hideOnMobile;
  const reduceMotion = useReducedMotion();
  const [loaded, setLoaded] = useState(false);

  const src = buildCalendlySrc({
    calendlyUrl: typeof content.calendlyUrl === 'string' ? content.calendlyUrl : '',
    prefillEmail: content.prefillEmail === true,
  });

  return (
    <section
      className={
        backgroundToneClass(tone) +
        ' w-full px-6 ' +
        (hideOnMobile ? 'hidden md:block ' : '')
      }
      style={{ paddingTop: paddingForDensity(density), paddingBottom: paddingForDensity(density) }}
    >
      <div className="max-w-3xl mx-auto">
        {src ? (
          <div
            className="block-embed block-embed-calendly relative w-full"
            style={{ minHeight: 600 }}
          >
            {!loaded && (
              <Skeleton className="absolute inset-0 w-full h-full" />
            )}
            <iframe
              src={src}
              title={EMBED_IFRAME_TITLES.calendly}
              loading="lazy"
              referrerPolicy="no-referrer"
              sandbox="allow-scripts allow-same-origin allow-popups allow-forms"
              allow="clipboard-write; payment"
              onLoad={() => setLoaded(true)}
              className={
                'w-full border-0 ' +
                (reduceMotion ? '' : 'transition-opacity duration-200 ease-out ') +
                (loaded ? 'opacity-100' : 'opacity-0')
              }
              style={{ minHeight: 600 }}
            />
          </div>
        ) : (
          <Card variant="flat" padding="md" className="text-center">
            <p className="text-[14px] text-[var(--color-text-secondary)]">
              Add a valid Calendly link (https://calendly.com/…) to preview the embed.
            </p>
          </Card>
        )}
      </div>
    </section>
  );
}
