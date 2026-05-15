/**
 * Phase 15 Plan 15-04 — FooterBlock visual contract.
 *
 * Default tone `dark` (per UI-SPEC). 13px copyright caption + optional
 * nav-link list. No CSS hex — uses CSS custom-property classes routed
 * through `block-style-helpers.ts`.
 */
import type { BlockNode } from '@/lib/page-builder/block-schema';
import { backgroundToneClass, paddingForDensity } from './block-style-helpers';

export interface FooterBlockProps {
  block: BlockNode;
}

interface FooterContent {
  copyright?: string;
  navLinks?: Array<{ label?: string; href?: string }>;
}

export function FooterBlock({ block }: FooterBlockProps) {
  const content = (block.content ?? {}) as FooterContent;
  const tone = block.style.backgroundTone ?? 'dark';
  const density = block.style.spacingDensity ?? 'default';
  const hideOnMobile = !!block.style.hideOnMobile;

  const links = Array.isArray(content.navLinks) ? content.navLinks : [];

  return (
    <footer
      className={
        backgroundToneClass(tone) +
        ' w-full px-6 ' +
        (hideOnMobile ? 'hidden md:block ' : '')
      }
      style={{ paddingTop: paddingForDensity(density), paddingBottom: paddingForDensity(density) }}
    >
      <div className="max-w-5xl mx-auto flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <p className="text-[13px] opacity-70">{content.copyright ?? '© LeanShot'}</p>
        {links.length > 0 && (
          <nav aria-label="Footer">
            <ul className="flex flex-wrap gap-4">
              {links.map((l, i) => (
                <li key={i}>
                  <a className="text-[13px] underline" href={safeHref(l?.href)}>
                    {l?.label ?? 'Link'}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        )}
      </div>
    </footer>
  );
}

function safeHref(href: unknown): string {
  if (typeof href !== 'string') return '#';
  if (href.startsWith('http://') || href.startsWith('https://')) return href;
  if (href.startsWith('#') || href.startsWith('/')) return href;
  return '#';
}
