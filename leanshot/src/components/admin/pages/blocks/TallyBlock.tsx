/**
 * Phase 15 Plan 15-06 — TallyBlock editor preview.
 *
 * Same security posture as YouTubeBlock (see file). Tally is a form — the
 * sandbox set adds `allow-forms` but NOT popups. min-height 400px per
 * 15-UI-SPEC visual contract.
 */
import { useState } from 'react';
import { Card } from '@/components/ui/Card';
import { Skeleton } from '@/components/ui/Skeleton';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import type { BlockNode } from '@/lib/page-builder/block-schema';
import { EMBED_IFRAME_TITLES, buildTallySrc } from '@/lib/page-builder/embed-src';
import { backgroundToneClass, paddingForDensity } from './block-style-helpers';

export interface TallyBlockProps {
  block: BlockNode;
}

interface TallyContentShape {
  tallyFormUrl?: unknown;
  hideTitle?: unknown;
}

export function TallyBlock({ block }: TallyBlockProps) {
  const content = (block.content ?? {}) as TallyContentShape;
  const tone = block.style.backgroundTone ?? 'default';
  const density = block.style.spacingDensity ?? 'default';
  const hideOnMobile = !!block.style.hideOnMobile;
  const reduceMotion = useReducedMotion();
  const [loaded, setLoaded] = useState(false);

  const src = buildTallySrc({
    tallyFormUrl: typeof content.tallyFormUrl === 'string' ? content.tallyFormUrl : '',
    hideTitle: content.hideTitle === true,
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
            className="block-embed block-embed-tally relative w-full"
            style={{ minHeight: 400 }}
          >
            {!loaded && (
              <Skeleton className="absolute inset-0 w-full h-full" />
            )}
            <iframe
              src={src}
              title={EMBED_IFRAME_TITLES.tally}
              loading="lazy"
              referrerPolicy="no-referrer"
              sandbox="allow-scripts allow-same-origin allow-forms"
              onLoad={() => setLoaded(true)}
              className={
                'w-full border-0 ' +
                (reduceMotion ? '' : 'transition-opacity duration-200 ease-out ') +
                (loaded ? 'opacity-100' : 'opacity-0')
              }
              style={{ minHeight: 400 }}
            />
          </div>
        ) : (
          <Card variant="flat" padding="md" className="text-center">
            <p className="text-[14px] text-[var(--color-text-secondary)]">
              Add a valid Tally form link (https://tally.so/…) to preview the embed.
            </p>
          </Card>
        )}
      </div>
    </section>
  );
}
