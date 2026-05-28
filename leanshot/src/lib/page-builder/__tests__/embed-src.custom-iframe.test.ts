/**
 * Phase 41 Plan 41-02 — Custom-iframe URL validator + iframe-HTML builder.
 *
 * 8 assertions covering:
 *   T1: D-15 exact-hostname match (positive); subdomain expansion REJECTED.
 *   T2: D-15 look-alike rejection (calendly.com.evil.com).
 *   T3: HTTPS required.
 *   T4: Non-string / empty / unparseable input → null.
 *   T5: D-16 FIXED sandbox attribute on the rendered iframe HTML.
 *   T6: Validation failure → empty-string HTML.
 *   T7: iframeTitle < 3 chars → fallback 'Embedded content'.
 *   T8: BlockType union compile-time check ('custom_iframe' is assignable).
 */
import { describe, expect, it } from 'vitest';
import type { BlockType } from '@/lib/page-builder/block-schema';
import { validateCustomIframeUrl, buildCustomIframeIframeHtml } from '@/lib/page-builder/embed-src';

describe('Phase 41 — validateCustomIframeUrl', () => {
  it('T1: returns the URL on exact-host match; rejects subdomain expansion', () => {
    expect(validateCustomIframeUrl('https://meet.example.org/foo', ['meet.example.org'])).toBe(
      'https://meet.example.org/foo',
    );

    // D-15 — exact match only; allowlist 'meet.example.org' MUST NOT
    // permit 'sub.meet.example.org'.
    expect(
      validateCustomIframeUrl('https://sub.meet.example.org', ['meet.example.org']),
    ).toBeNull();
  });

  it('T2: rejects look-alike hostnames (calendly.com.evil.com)', () => {
    expect(validateCustomIframeUrl('https://calendly.com.evil.com', ['calendly.com'])).toBeNull();
  });

  it('T3: requires HTTPS', () => {
    expect(validateCustomIframeUrl('http://meet.example.org', ['meet.example.org'])).toBeNull();
  });

  it('T4: returns null for empty / non-string / unparseable input', () => {
    expect(validateCustomIframeUrl('', ['anything.test'])).toBeNull();
    expect(validateCustomIframeUrl(null, ['anything.test'])).toBeNull();
    expect(validateCustomIframeUrl(undefined, ['anything.test'])).toBeNull();
    expect(validateCustomIframeUrl(42 as unknown, ['anything.test'])).toBeNull();
    expect(validateCustomIframeUrl('not-a-url', ['anything.test'])).toBeNull();
  });
});

describe('Phase 41 — buildCustomIframeIframeHtml', () => {
  it('T5: emits the FIXED D-16 sandbox + lazy + title + referrerpolicy attributes', () => {
    const html = buildCustomIframeIframeHtml(
      { embedUrl: 'https://meet.example.org', iframeTitle: 'My form' },
      ['meet.example.org'],
    );
    expect(html).toContain('sandbox="allow-scripts allow-same-origin"');
    expect(html).toContain('loading="lazy"');
    expect(html).toContain('title="My form"');
    expect(html).toContain('referrerpolicy="no-referrer"');
    // D-16: no admin override path — the sandbox literal MUST NOT include
    // 'allow-popups', 'allow-forms', 'allow-presentation', etc.
    expect(html).not.toContain('allow-popups');
    expect(html).not.toContain('allow-forms');
  });

  it('T6: returns empty string when validation fails (hostname not allowlisted)', () => {
    expect(
      buildCustomIframeIframeHtml(
        { embedUrl: 'https://bad.example.com', iframeTitle: 'whatever' },
        ['good.example.com'],
      ),
    ).toBe('');
  });

  it("T7: iframeTitle shorter than 3 chars falls back to 'Embedded content'", () => {
    const html = buildCustomIframeIframeHtml(
      { embedUrl: 'https://meet.example.org', iframeTitle: 'ab' },
      ['meet.example.org'],
    );
    expect(html).toContain('title="Embedded content"');
    expect(html).not.toContain('title="ab"');
  });
});

describe('Phase 41 — BlockType union extension', () => {
  it("T8: 'custom_iframe' is assignable to BlockType", () => {
    const t: BlockType = 'custom_iframe';
    expect(t).toBe('custom_iframe');
  });
});
