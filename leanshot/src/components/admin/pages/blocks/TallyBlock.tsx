/**
 * Phase 15 Plan 15-06 / Phase 41 Plan 41-05 — TallyBlock editor preview.
 *
 * Phase 41 retrofit: iframe is now wrapped in <ConsentGatedEmbed> (D-07/D-09
 * consent gating + D-10 loading transition + D-08 placeholder fallback).
 * Sandbox flags PRESERVED per UI-SPEC §Surface B State 3:
 *   `allow-scripts allow-same-origin allow-forms`.
 *
 * Categories per D-07: functional (forms only).
 * min-height 500 per UI-SPEC §Surface B per-provider iframe heights.
 */
import { Card } from '@/components/ui/Card';
import type { BlockNode } from '@/lib/page-builder/block-schema';
import { EMBED_IFRAME_TITLES, buildTallySrc } from '@/lib/page-builder/embed-src';
import { backgroundToneClass, paddingForDensity } from './block-style-helpers';
import { ConsentGatedEmbed } from './ConsentGatedEmbed';

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

  const src = buildTallySrc({
    tallyFormUrl: typeof content.tallyFormUrl === 'string' ? content.tallyFormUrl : '',
    hideTitle: content.hideTitle === true,
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
          <ConsentGatedEmbed
            provider="tally"
            categories={['functional']}
            minHeight={500}
            sandbox="allow-scripts allow-same-origin allow-forms"
            title={EMBED_IFRAME_TITLES.tally}
            src={src}
          />
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
