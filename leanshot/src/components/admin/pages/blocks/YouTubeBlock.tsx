/**
 * Phase 15 Plan 15-06 / Phase 41 Plan 41-05 — YouTubeBlock editor preview.
 *
 * Phase 41 retrofit: iframe is now wrapped in <ConsentGatedEmbed> (D-07/D-09
 * consent gating + D-10 loading transition + D-08 placeholder fallback).
 * Sandbox flags PRESERVED per UI-SPEC §Surface B State 3:
 *   `allow-scripts allow-same-origin allow-presentation`.
 *
 * Categories per D-07: analytics + marketing.
 * Aspect ratio 16/9 per UI-SPEC §Surface B per-provider iframe heights.
 */
import { Card } from '@/components/ui/Card';
import type { BlockNode } from '@/lib/page-builder/block-schema';
import { EMBED_IFRAME_TITLES, buildYouTubeSrc } from '@/lib/page-builder/embed-src';
import { backgroundToneClass, paddingForDensity } from './block-style-helpers';
import { ConsentGatedEmbed } from './ConsentGatedEmbed';

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

  const src = buildYouTubeSrc({
    videoId: typeof content.videoId === 'string' ? content.videoId : '',
    startSeconds: typeof content.startSeconds === 'number' ? content.startSeconds : 0,
    autoplay: content.autoplay === true,
  });

  return (
    <section
      className={
        backgroundToneClass(tone) + ' w-full px-6 ' + (hideOnMobile ? 'hidden md:block ' : '')
      }
      style={{ paddingTop: paddingForDensity(density), paddingBottom: paddingForDensity(density) }}
    >
      <div className="max-w-3xl mx-auto">
        {src ? (
          <div className="mx-auto" style={{ maxWidth: 960 }}>
            <ConsentGatedEmbed
              provider="youtube"
              categories={['analytics', 'marketing']}
              aspectRatio="16 / 9"
              sandbox="allow-scripts allow-same-origin allow-presentation"
              allow="encrypted-media; picture-in-picture"
              title={EMBED_IFRAME_TITLES.youtube}
              src={src}
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
