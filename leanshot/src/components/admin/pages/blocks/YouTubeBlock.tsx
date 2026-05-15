/**
 * Phase 15 Plan 15-06 — YouTubeBlock editor preview.
 *
 * Renders the in-editor preview of an embed-youtube block. Uses the SAME
 * `buildYouTubeSrc` helper that the public renderer's iframe-HTML builder
 * uses — the editor preview and the published page resolve to byte-identical
 * iframe `src` strings.
 *
 * Security posture (Threat T-15-06-01 / T-15-06-02 / T-15-06-03):
 *   • iframe `src` ONLY from `buildYouTubeSrc` (allow-list videoId match) —
 *     null result renders NO iframe (safe non-iframe fallback).
 *   • `sandbox="allow-scripts allow-same-origin allow-presentation"` — no
 *     popups, no top-navigation, no modals.
 *   • `referrerpolicy="no-referrer"` blocks parent-URL disclosure.
 *   • `title` is REQUIRED — non-empty per UI-SPEC + Lighthouse ≥95.
 *   • Skeleton overlay shown until iframe `onLoad` fires; respects
 *     `useReducedMotion()` for the opacity transition.
 */
import { useState } from 'react';
import { Card } from '@/components/ui/Card';
import { Skeleton } from '@/components/ui/Skeleton';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import type { BlockNode } from '@/lib/page-builder/block-schema';
import { EMBED_IFRAME_TITLES, buildYouTubeSrc } from '@/lib/page-builder/embed-src';
import { backgroundToneClass, paddingForDensity } from './block-style-helpers';

export interface YouTubeBlockProps {
  block: BlockNode;
}

interface YouTubeContentShape {
  videoId?: unknown;
  startSeconds?: unknown;
  autoplay?: unknown;
}

export function YouTubeBlock({ block }: YouTubeBlockProps) {
  const content = (block.content ?? {}) as YouTubeContentShape;
  const tone = block.style.backgroundTone ?? 'default';
  const density = block.style.spacingDensity ?? 'default';
  const hideOnMobile = !!block.style.hideOnMobile;
  const reduceMotion = useReducedMotion();
  const [loaded, setLoaded] = useState(false);

  const src = buildYouTubeSrc({
    videoId: typeof content.videoId === 'string' ? content.videoId : '',
    startSeconds: typeof content.startSeconds === 'number' ? content.startSeconds : 0,
    autoplay: content.autoplay === true,
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
            className="block-embed block-embed-youtube relative w-full mx-auto"
            style={{ aspectRatio: '16 / 9', maxWidth: 960 }}
          >
            {!loaded && (
              <Skeleton className="absolute inset-0 w-full h-full" />
            )}
            <iframe
              src={src}
              title={EMBED_IFRAME_TITLES.youtube}
              loading="lazy"
              referrerPolicy="no-referrer"
              sandbox="allow-scripts allow-same-origin allow-presentation"
              allow="encrypted-media; picture-in-picture"
              onLoad={() => setLoaded(true)}
              className={
                'absolute inset-0 w-full h-full border-0 ' +
                (reduceMotion ? '' : 'transition-opacity duration-200 ease-out ') +
                (loaded ? 'opacity-100' : 'opacity-0')
              }
            />
          </div>
        ) : (
          <Card variant="flat" padding="md" className="text-center">
            <p className="text-[14px] text-[var(--color-text-secondary)]">
              Add a valid YouTube video ID to preview the embed.
            </p>
          </Card>
        )}
      </div>
    </section>
  );
}
