/**
 * Phase 15 Plan 15-05 — FeatureGridBlock visual contract.
 *
 * Responsive grid: 3-col on >=1024px, 2-col on >=640px, 1-col on mobile.
 * Each card uses DS Card "default" visual styling with a lucide icon resolved
 * from feature.iconName (rendered via dynamic icon lookup against
 * lucide-react). All token-bounded — no raw hex.
 */
import * as Icons from 'lucide-react';
import type { ComponentType } from 'react';
import type { BlockNode } from '@/lib/page-builder/block-schema';
import { backgroundToneClass, paddingForDensity } from './block-style-helpers';

export interface FeatureGridBlockProps {
  block: BlockNode;
}

interface FeatureGridItem {
  iconName?: string;
  title?: string;
  body?: string;
}

interface FeatureGridContent {
  eyebrow?: string;
  heading?: string;
  features?: FeatureGridItem[];
}

type LucideIcon = ComponentType<{ className?: string; 'aria-hidden'?: boolean }>;

function resolveIcon(name: string | undefined): LucideIcon | null {
  if (!name) return null;
  const reg = Icons as unknown as Record<string, unknown>;
  const candidate = reg[name];
  if (typeof candidate === 'function' || (typeof candidate === 'object' && candidate !== null)) {
    return candidate as LucideIcon;
  }
  return null;
}

export function FeatureGridBlock({ block }: FeatureGridBlockProps) {
  const content = (block.content ?? {}) as FeatureGridContent;
  const tone = block.style.backgroundTone ?? 'default';
  const align = block.style.alignment ?? 'center';
  const density = block.style.spacingDensity ?? 'default';
  const hideOnMobile = !!block.style.hideOnMobile;
  const features = Array.isArray(content.features) ? content.features : [];

  return (
    <section
      className={
        backgroundToneClass(tone) +
        ' w-full px-6 ' +
        (hideOnMobile ? 'hidden md:block ' : '') +
        (align === 'center' ? 'text-center ' : align === 'right' ? 'text-right ' : 'text-left ')
      }
      style={{ paddingTop: paddingForDensity(density), paddingBottom: paddingForDensity(density) }}
    >
      <div className="max-w-6xl mx-auto">
        {content.eyebrow && (
          <p className="text-[13px] font-semibold uppercase tracking-[0.06em] mb-2 opacity-70">
            {content.eyebrow}
          </p>
        )}
        <h2 className="text-[32px] font-semibold tracking-tight leading-[1.15]">
          {content.heading ?? 'Features'}
        </h2>
        <div className="mt-8 grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 text-left">
          {features.map((f, i) => {
            const Icon = resolveIcon(f.iconName);
            return (
              <div
                key={i}
                className="block-feature-grid__card bg-[var(--color-surface)] border border-[var(--color-border)] shadow-[var(--shadow-xs)] rounded-xl p-6 flex flex-col gap-2"
              >
                {Icon && <Icon aria-hidden className="size-6 text-[var(--color-primary)]" />}
                {f.title && <h3 className="text-[16px] font-semibold">{f.title}</h3>}
                {f.body && (
                  <p className="text-[13px] leading-[1.5] opacity-80">{f.body}</p>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
