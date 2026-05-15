/**
 * Phase 15 Plan 15-06 — embed-src.ts tests (validate-and-build helpers).
 *
 * The XSS/clickjacking-critical seam: every iframe `src` and the full
 * iframe-HTML strings used by both the editor preview blocks AND the public
 * Deno renderer are built here from allow-listed inputs ONLY.
 *
 * Task 1 covers the 3 src builders + `EMBED_IFRAME_TITLES`.
 * Task 3 extends this file with iframe-HTML builder cases.
 */
import { describe, expect, it } from 'vitest';
import {
  EMBED_IFRAME_TITLES,
  buildCalendlySrc,
  buildTallySrc,
  buildYouTubeSrc,
} from './embed-src';

describe('buildYouTubeSrc', () => {
  it('builds a youtube-nocookie embed src for a valid videoId with no autoplay or start', () => {
    const src = buildYouTubeSrc({ videoId: 'dQw4w9WgXcQ', startSeconds: 0, autoplay: false });
    expect(src).not.toBeNull();
    expect(src!).toMatch(/^https:\/\/www\.youtube-nocookie\.com\/embed\/dQw4w9WgXcQ/);
    expect(src!).not.toMatch(/autoplay=1/);
    expect(src!).not.toMatch(/start=/);
  });

  it('emits start=90 and autoplay=1 when requested', () => {
    const src = buildYouTubeSrc({ videoId: 'dQw4w9WgXcQ', startSeconds: 90, autoplay: true });
    expect(src).not.toBeNull();
    expect(src!).toContain('start=90');
    expect(src!).toContain('autoplay=1');
  });

  it('always appends rel=0', () => {
    const src = buildYouTubeSrc({ videoId: 'dQw4w9WgXcQ', startSeconds: 0, autoplay: false });
    expect(src).not.toBeNull();
    expect(src!).toContain('rel=0');
  });

  it.each([
    'abc"><script>',
    '../evil',
    'a b',
    'a/b',
    'abc!',
    '',
  ])('returns null for hostile videoId %j', (videoId) => {
    expect(buildYouTubeSrc({ videoId, startSeconds: 0, autoplay: false })).toBeNull();
  });

  it('returns null for a videoId longer than 20 chars', () => {
    expect(
      buildYouTubeSrc({
        videoId: 'a'.repeat(21),
        startSeconds: 0,
        autoplay: false,
      }),
    ).toBeNull();
  });

  it('clamps negative startSeconds to 0 (no start param emitted)', () => {
    const src = buildYouTubeSrc({ videoId: 'dQw4w9WgXcQ', startSeconds: -30, autoplay: false });
    expect(src).not.toBeNull();
    expect(src!).not.toContain('start=');
  });

  it('floors non-integer startSeconds', () => {
    const src = buildYouTubeSrc({ videoId: 'dQw4w9WgXcQ', startSeconds: 12.9, autoplay: false });
    expect(src).not.toBeNull();
    expect(src!).toContain('start=12');
  });

  it('treats non-finite startSeconds as 0', () => {
    const src = buildYouTubeSrc({
      videoId: 'dQw4w9WgXcQ',
      startSeconds: Number.NaN,
      autoplay: false,
    });
    expect(src).not.toBeNull();
    expect(src!).not.toContain('start=');
  });
});

describe('buildCalendlySrc', () => {
  it('returns a calendly.com src for a valid https calendly url', () => {
    const src = buildCalendlySrc({
      calendlyUrl: 'https://calendly.com/leanshot/intro',
      prefillEmail: false,
    });
    expect(src).not.toBeNull();
    const parsed = new URL(src!);
    expect(parsed.origin).toBe('https://calendly.com');
    expect(parsed.pathname).toBe('/leanshot/intro');
  });

  it.each([
    ['look-alike subdomain prefix', 'https://calendly.com.evil.com/x'],
    ['path-only match attempt', 'https://evil.com/calendly.com'],
    ['http (non-https) scheme', 'http://calendly.com/x'],
    ['javascript: scheme', 'javascript:alert(1)'],
    ['data: scheme', 'data:text/html,<script>alert(1)</script>'],
    ['bare scheme garbage', 'not-a-url'],
    ['empty string', ''],
    ['subdomain of calendly.com', 'https://app.calendly.com/x'],
  ])('returns null for invalid input — %s', (_label, url) => {
    expect(buildCalendlySrc({ calendlyUrl: url, prefillEmail: false })).toBeNull();
  });

  it('does not interpolate user strings beyond the origin-validated URL', () => {
    const src = buildCalendlySrc({
      calendlyUrl: 'https://calendly.com/leanshot/intro?x=<script>',
      prefillEmail: true,
    });
    expect(src).not.toBeNull();
    // URL re-serialization should encode any `<` `>` so the raw chars don't survive.
    expect(src!).not.toContain('<script>');
    expect(new URL(src!).origin).toBe('https://calendly.com');
  });
});

describe('buildTallySrc', () => {
  it('returns a tally.so src with hideTitle=1 when requested', () => {
    const src = buildTallySrc({ tallyFormUrl: 'https://tally.so/r/wAbC12', hideTitle: true });
    expect(src).not.toBeNull();
    const parsed = new URL(src!);
    expect(parsed.origin).toBe('https://tally.so');
    expect(parsed.pathname).toBe('/r/wAbC12');
    expect(src!).toContain('hideTitle=1');
  });

  it('omits hideTitle=1 when hideTitle is false', () => {
    const src = buildTallySrc({ tallyFormUrl: 'https://tally.so/r/wAbC12', hideTitle: false });
    expect(src).not.toBeNull();
    expect(src!).not.toContain('hideTitle=1');
  });

  it.each([
    'https://tally.so.evil.com/r/wAbC12',
    'http://tally.so/r/wAbC12',
    'javascript:alert(1)',
    'https://evil.com/r/wAbC12',
    '',
  ])('returns null for invalid input %j', (url) => {
    expect(buildTallySrc({ tallyFormUrl: url, hideTitle: false })).toBeNull();
  });
});

describe('EMBED_IFRAME_TITLES', () => {
  it('exports a non-empty title for each of calendly / youtube / tally', () => {
    expect(typeof EMBED_IFRAME_TITLES.calendly).toBe('string');
    expect(EMBED_IFRAME_TITLES.calendly.length).toBeGreaterThan(0);
    expect(typeof EMBED_IFRAME_TITLES.youtube).toBe('string');
    expect(EMBED_IFRAME_TITLES.youtube.length).toBeGreaterThan(0);
    expect(typeof EMBED_IFRAME_TITLES.tally).toBe('string');
    expect(EMBED_IFRAME_TITLES.tally.length).toBeGreaterThan(0);
  });
});
