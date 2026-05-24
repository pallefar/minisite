/**
 * Phase 15 Plan 15-06 — Embed editor block component tests + PropertyPanel routing.
 *
 * Covers (per 15-06-PLAN.md `<behavior>` for Task 2):
 *   • Each embed block renders a sandboxed <iframe> with a non-empty `title`
 *     attribute (== EMBED_IFRAME_TITLES[provider]) when input is valid.
 *   • Invalid input renders NO iframe (safe non-iframe fallback) — never
 *     emits an iframe with an unvalidated src.
 *   • Each block renders a DS Skeleton present in the initial render (before
 *     the iframe `load` event fires).
 *   • PROPERTY_CONFIGS exposes a tailored content-field set for each of
 *     `calendly`, `youtube`, `tally`.
 */
import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { BlockNode } from '@/lib/page-builder/block-schema';

// Phase 41-05 retrofit: blocks now gate iframe behind ConsentGatedEmbed.
// Grant all categories so iframe still renders on mount (preserves Phase 15 assertions).
vi.mock('vanilla-cookieconsent', () => ({
  acceptedCategory: () => true,
  show: vi.fn(),
}));
import { EMBED_IFRAME_TITLES } from '@/lib/page-builder/embed-src';
import { PROPERTY_CONFIGS } from '../editor/property-configs';
import { CalendlyBlock } from './CalendlyBlock';
import { TallyBlock } from './TallyBlock';
import { YouTubeBlock } from './YouTubeBlock';

function block<T extends 'youtube' | 'calendly' | 'tally'>(
  type: T,
  content: Record<string, unknown>,
): BlockNode {
  return {
    id: 'e1',
    type,
    parent_id: null,
    order: 0,
    content,
    style: {},
  };
}

describe('YouTubeBlock', () => {
  it('renders an <iframe> with non-empty title and youtube-nocookie src for a valid videoId', () => {
    const { container } = render(
      <YouTubeBlock
        block={block('youtube', { videoId: 'dQw4w9WgXcQ', startSeconds: 0, autoplay: false })}
      />,
    );
    const iframe = container.querySelector('iframe');
    expect(iframe).not.toBeNull();
    expect(iframe!.getAttribute('title')).toBe(EMBED_IFRAME_TITLES.youtube);
    expect(iframe!.getAttribute('title')!.length).toBeGreaterThan(0);
    expect(iframe!.getAttribute('src')!).toMatch(
      /^https:\/\/www\.youtube-nocookie\.com\/embed\/dQw4w9WgXcQ/,
    );
    expect(iframe!.getAttribute('sandbox')).toBeTruthy();
  });

  it('renders NO iframe for a hostile videoId (../evil)', () => {
    const { container } = render(
      <YouTubeBlock
        block={block('youtube', { videoId: '../evil', startSeconds: 0, autoplay: false })}
      />,
    );
    expect(container.querySelector('iframe')).toBeNull();
  });

  it('renders a Skeleton element on initial mount (before iframe load fires)', () => {
    const { container } = render(
      <YouTubeBlock
        block={block('youtube', { videoId: 'dQw4w9WgXcQ', startSeconds: 0, autoplay: false })}
      />,
    );
    expect(container.querySelector('.skeleton-shimmer')).not.toBeNull();
  });
});

describe('CalendlyBlock', () => {
  it('renders an <iframe> with non-empty title and sandbox for a valid calendly URL', () => {
    const { container } = render(
      <CalendlyBlock
        block={block('calendly', {
          calendlyUrl: 'https://calendly.com/leanshot/intro',
          prefillEmail: false,
        })}
      />,
    );
    const iframe = container.querySelector('iframe');
    expect(iframe).not.toBeNull();
    expect(iframe!.getAttribute('title')).toBe(EMBED_IFRAME_TITLES.calendly);
    expect(iframe!.getAttribute('title')!.length).toBeGreaterThan(0);
    expect(iframe!.getAttribute('sandbox')).toBeTruthy();
  });

  it('renders NO iframe for a non-calendly.com host', () => {
    const { container } = render(
      <CalendlyBlock
        block={block('calendly', {
          calendlyUrl: 'https://evil.com/x',
          prefillEmail: false,
        })}
      />,
    );
    expect(container.querySelector('iframe')).toBeNull();
  });

  it('renders a Skeleton element on initial mount', () => {
    const { container } = render(
      <CalendlyBlock
        block={block('calendly', {
          calendlyUrl: 'https://calendly.com/leanshot/intro',
          prefillEmail: false,
        })}
      />,
    );
    expect(container.querySelector('.skeleton-shimmer')).not.toBeNull();
  });
});

describe('TallyBlock', () => {
  it('renders an <iframe> with non-empty title for a valid tally URL', () => {
    const { container } = render(
      <TallyBlock
        block={block('tally', {
          tallyFormUrl: 'https://tally.so/r/wAbC12',
          hideTitle: true,
        })}
      />,
    );
    const iframe = container.querySelector('iframe');
    expect(iframe).not.toBeNull();
    expect(iframe!.getAttribute('title')).toBe(EMBED_IFRAME_TITLES.tally);
    expect(iframe!.getAttribute('title')!.length).toBeGreaterThan(0);
  });

  it('renders NO iframe for a non-tally.so host', () => {
    const { container } = render(
      <TallyBlock
        block={block('tally', {
          tallyFormUrl: 'https://tally.so.evil.com/r/wAbC12',
          hideTitle: false,
        })}
      />,
    );
    expect(container.querySelector('iframe')).toBeNull();
  });

  it('renders a Skeleton element on initial mount', () => {
    const { container } = render(
      <TallyBlock
        block={block('tally', {
          tallyFormUrl: 'https://tally.so/r/wAbC12',
          hideTitle: false,
        })}
      />,
    );
    expect(container.querySelector('.skeleton-shimmer')).not.toBeNull();
  });
});

describe('PROPERTY_CONFIGS — tailored embed entries', () => {
  it('youtube exposes videoId, startSeconds, autoplay — and NOT calendlyUrl / tallyFormUrl', () => {
    const config = PROPERTY_CONFIGS.youtube;
    expect(config).toBeDefined();
    const keys = config!.contentFields.map((f) => f.key);
    expect(keys).toContain('videoId');
    expect(keys).toContain('startSeconds');
    expect(keys).toContain('autoplay');
    expect(keys).not.toContain('calendlyUrl');
    expect(keys).not.toContain('tallyFormUrl');
  });

  it('calendly exposes calendlyUrl and prefillEmail', () => {
    const config = PROPERTY_CONFIGS.calendly;
    expect(config).toBeDefined();
    const keys = config!.contentFields.map((f) => f.key);
    expect(keys).toContain('calendlyUrl');
    expect(keys).toContain('prefillEmail');
    expect(keys).not.toContain('videoId');
    expect(keys).not.toContain('tallyFormUrl');
  });

  it('tally exposes tallyFormUrl and hideTitle', () => {
    const config = PROPERTY_CONFIGS.tally;
    expect(config).toBeDefined();
    const keys = config!.contentFields.map((f) => f.key);
    expect(keys).toContain('tallyFormUrl');
    expect(keys).toContain('hideTitle');
    expect(keys).not.toContain('videoId');
    expect(keys).not.toContain('calendlyUrl');
  });
});

describe('PROPERTY_CONFIGS — token-bounded only (no hex / color / typography)', () => {
  it.each(['calendly', 'youtube', 'tally'] as const)(
    '%s config kinds are within the allowed set',
    (type) => {
      const config = PROPERTY_CONFIGS[type];
      expect(config).toBeDefined();
      for (const f of config!.contentFields) {
        expect(f.kind).not.toBe('color');
        expect(f.kind).not.toBe('hex');
        expect(f.kind).not.toBe('typography');
      }
    },
  );
});
