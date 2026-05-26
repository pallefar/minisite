/**
 * Phase 62 Plan 62-06 Task 1 — Pure RSS 2.0 feed builder.
 *
 * Pure function — no React, no side effects, no imports except types.
 * Used by:
 *   - scripts/build-research-rss.mjs (build-time script)
 *
 * RSS 2.0 spec: https://www.rssboard.org/rss-specification
 * RFC 822 date format: https://www.ietf.org/rfc/rfc0822.txt
 */

export interface RssItem {
  title: string;
  link: string;
  description: string;
  pubDate: string; // RFC 822 format
  guid: string;
}

/**
 * Converts a Date to RFC 822 format.
 * JS Date.toUTCString() already produces RFC 822-compliant output.
 * Example: "Sun, 31 May 2026 12:00:00 GMT"
 */
export function toRfc822(date: Date): string {
  return date.toUTCString();
}

/**
 * Escapes XML reserved characters in text content.
 * Prevents malformed XML in title/description/guid fields.
 */
function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Builds a complete RSS 2.0 XML string from the given options.
 *
 * Includes:
 *   - XML declaration
 *   - RSS 2.0 with Atom namespace for self-link
 *   - <channel> with title, link, description, atom:link self-reference
 *   - <item> for each RssItem with guid isPermaLink="true"
 *
 * All text fields have XML reserved chars escaped.
 */
export function buildRssXml(opts: {
  channelTitle: string;
  channelLink: string;
  channelDescription: string;
  items: RssItem[];
  selfLink: string;
}): string {
  const { channelTitle, channelLink, channelDescription, items, selfLink } = opts;

  const itemsXml = items
    .map((item) => {
      return `    <item>
      <title>${escapeXml(item.title)}</title>
      <link>${escapeXml(item.link)}</link>
      <description>${escapeXml(item.description)}</description>
      <pubDate>${escapeXml(item.pubDate)}</pubDate>
      <guid isPermaLink="true">${escapeXml(item.guid)}</guid>
    </item>`;
    })
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${escapeXml(channelTitle)}</title>
    <link>${escapeXml(channelLink)}</link>
    <description>${escapeXml(channelDescription)}</description>
    <atom:link href="${escapeXml(selfLink)}" rel="self" type="application/rss+xml" />
${itemsXml}
  </channel>
</rss>`;
}
