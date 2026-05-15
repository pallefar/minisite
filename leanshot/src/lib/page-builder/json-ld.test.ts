/**
 * Phase 15 Plan 08 — json-ld.ts behavioral tests.
 */
import { describe, expect, it } from 'vitest';
import type { BlockNode } from './block-schema';
import { generateJsonLd, SCHEMA_TYPE_OPTIONS } from './json-ld';

function faqBlock(items: Array<{ q: string; a: string }>): BlockNode {
  return {
    id: 'b1',
    type: 'faq',
    parent_id: null,
    order: 0,
    content: { items },
    style: {},
  };
}

describe('generateJsonLd', () => {
  it('builds a WebPage object with the base fields', () => {
    const out = generateJsonLd({
      blocks: [],
      title: 'T',
      description: 'D',
      url: 'https://x/p',
      schemaType: 'WebPage',
    });
    const parsed = JSON.parse(out);
    expect(parsed).toEqual({
      '@context': 'https://schema.org',
      '@type': 'WebPage',
      name: 'T',
      description: 'D',
      url: 'https://x/p',
    });
  });

  it('extracts FAQPage mainEntity from a faq block', () => {
    const out = generateJsonLd({
      blocks: [faqBlock([{ q: 'Q1', a: 'A1' }])],
      title: 'T',
      description: 'D',
      url: 'https://x/p',
      schemaType: 'FAQPage',
    });
    const parsed = JSON.parse(out);
    expect(parsed['@type']).toBe('FAQPage');
    expect(parsed.mainEntity).toEqual([
      {
        '@type': 'Question',
        name: 'Q1',
        acceptedAnswer: { '@type': 'Answer', text: 'A1' },
      },
    ]);
  });

  it('FAQPage with no faq block yields mainEntity = []', () => {
    const out = generateJsonLd({
      blocks: [],
      title: 'T',
      description: 'D',
      url: 'https://x/p',
      schemaType: 'FAQPage',
    });
    const parsed = JSON.parse(out);
    expect(parsed.mainEntity).toEqual([]);
  });

  it('survives a title containing </script> and < (T-15-08-01)', () => {
    const out = generateJsonLd({
      blocks: [],
      title: '</script><img src=x onerror=alert(1)>',
      description: 'D',
      url: 'https://x/p',
      schemaType: 'WebPage',
    });
    // Must JSON-parse cleanly.
    const parsed = JSON.parse(out);
    expect(parsed.name).toBe('</script><img src=x onerror=alert(1)>');
    // Raw string MUST NOT contain a literal `</script>` substring.
    expect(out).not.toContain('</script>');
    // Raw string MUST NOT contain any literal `<` (every `<` was unicode-escaped).
    expect(out).not.toContain('<');
    // The escape form `<` must be present where `<` was.
    expect(out).toContain('\\u003c');
  });

  it('exports SCHEMA_TYPE_OPTIONS as exactly 5 known types', () => {
    expect(Array.from(SCHEMA_TYPE_OPTIONS)).toEqual([
      'WebPage',
      'FAQPage',
      'Product',
      'Article',
      'Event',
    ]);
  });

  it('FAQPage ignores items missing q or a, and never throws on malformed blocks', () => {
    const block: BlockNode = {
      id: 'b1',
      type: 'faq',
      parent_id: null,
      order: 0,
      content: { items: [{ q: 'Q1' }, { a: 'A2' }, null, 'string', { q: 'Q3', a: 'A3' }] },
      style: {},
    };
    const out = generateJsonLd({
      blocks: [block],
      title: 'T',
      description: 'D',
      url: 'https://x',
      schemaType: 'FAQPage',
    });
    const parsed = JSON.parse(out);
    expect(parsed.mainEntity).toHaveLength(1);
    expect(parsed.mainEntity[0].name).toBe('Q3');
  });
});
