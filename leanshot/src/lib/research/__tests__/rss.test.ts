/**
 * Phase 62 Plan 62-06 Task 1 — Unit tests for RSS feed builder (rss.ts).
 *
 * Tests:
 *   1. buildRssXml emits valid XML for empty items list
 *   2. buildRssXml escapes ampersands and angle brackets in title/description
 *   3. toRfc822(new Date('2026-05-31T12:00:00Z')) produces RFC 822 format
 *   4. buildRssXml includes atom:link rel=self
 *   5. buildRssXml uses guid isPermaLink=true with the item link
 */

import { describe, expect, it } from 'vitest';
import { buildRssXml, toRfc822 } from '../rss';

const CHANNEL_OPTS = {
  channelTitle: 'LeanShot Research',
  channelLink: 'https://app.leanshot.app/research',
  channelDescription: 'Evidence-based findings from anonymized, aggregate LeanShot treatment data.',
  selfLink: 'https://app.leanshot.app/research/rss.xml',
};

describe('buildRssXml', () => {
  it('emits valid XML for empty items list', () => {
    const xml = buildRssXml({ ...CHANNEL_OPTS, items: [] });

    // Must start with XML declaration
    expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    // Must have rss 2.0 root
    expect(xml).toContain('<rss version="2.0"');
    // Must have channel wrapper
    expect(xml).toContain('<channel>');
    expect(xml).toContain('</channel>');
    // Must include the channel title
    expect(xml).toContain('<title>LeanShot Research</title>');
    // Must close rss tag
    expect(xml).toContain('</rss>');
  });

  it('escapes ampersands and angle brackets in title/description', () => {
    const xml = buildRssXml({
      ...CHANNEL_OPTS,
      items: [
        {
          title: 'GLP-1 & Tirzepatide: <Best> Practices',
          link: 'https://app.leanshot.app/research/glp1-test',
          description: 'A < B and C > D & E = "test"',
          pubDate: 'Sun, 31 May 2026 12:00:00 GMT',
          guid: 'https://app.leanshot.app/research/glp1-test',
        },
      ],
    });

    // Ampersand must be escaped
    expect(xml).toContain('GLP-1 &amp; Tirzepatide');
    // Less-than must be escaped
    expect(xml).toContain('&lt;Best&gt;');
    // Description special chars
    expect(xml).toContain('A &lt; B and C &gt; D &amp; E = &quot;test&quot;');
    // Must NOT contain raw ampersand in item content
    const itemStart = xml.indexOf('<item>');
    const itemEnd = xml.indexOf('</item>');
    const itemContent = xml.slice(itemStart, itemEnd + 7);
    expect(itemContent).not.toMatch(/[^&]&[^;a-z]/);
  });

  it('toRfc822 formats date correctly for 2026-05-31T12:00:00Z', () => {
    const date = new Date('2026-05-31T12:00:00Z');
    const result = toRfc822(date);
    // RFC 822 format includes the date components
    expect(result).toContain('31 May 2026');
    expect(result).toContain('12:00:00');
    expect(result).toContain('GMT');
    // Should be in standard toUTCString format
    expect(result).toMatch(/^\w+,\s+\d+\s+\w+\s+\d{4}\s+\d{2}:\d{2}:\d{2}\s+GMT$/);
  });

  it('includes atom:link rel=self', () => {
    const xml = buildRssXml({ ...CHANNEL_OPTS, items: [] });

    expect(xml).toContain('<atom:link');
    expect(xml).toContain('rel="self"');
    expect(xml).toContain('type="application/rss+xml"');
    expect(xml).toContain('https://app.leanshot.app/research/rss.xml');
  });

  it('uses guid isPermaLink=true with the item link', () => {
    const itemLink = 'https://app.leanshot.app/research/tirzepatide-titration';
    const xml = buildRssXml({
      ...CHANNEL_OPTS,
      items: [
        {
          title: 'Tirzepatide Titration Adherence',
          link: itemLink,
          description: 'Abstract text here.',
          pubDate: 'Sun, 31 May 2026 12:00:00 GMT',
          guid: itemLink,
        },
      ],
    });

    expect(xml).toContain('<guid isPermaLink="true">');
    expect(xml).toContain(itemLink);
  });
});
