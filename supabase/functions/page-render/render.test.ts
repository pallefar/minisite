/**
 * Phase 15 Plan 03 — Deno tests for the page-render HTML builder.
 *
 * Covers:
 *  - escapeHtml XSS boundary (every entity, non-string inputs).
 *  - renderBlock branches: hero / cta / footer.
 *    - content fields escaped (no raw <script>).
 *    - style.backgroundTone → token, spacingDensity 'spacious' → inline 96px,
 *      style.hideOnMobile=true → wrapper marker.
 *    - href validation (http(s)/#/relative only).
 *  - Unimplemented type returns '' (15-05/06/07 add their case names).
 *  - renderSeoHead stub minimality (no description/og/canonical/JSON-LD).
 *  - renderSeoHead escapes pageTitle.
 *  - renderPage emits a complete document, calls renderSeoHead inside <head>,
 *    only roots (parent_id === null) at top level.
 *  - renderNotFound emits the exact 15-UI-SPEC 404 copy.
 *
 * File suffix `.test.ts` per memory `reference_deno_test_discovery.md`.
 *
 * Run:
 *   cd supabase/functions/page-render && deno test --allow-all render.test.ts
 */
import { assert, assertEquals, assertStringIncludes } from 'https://deno.land/std@0.224.0/assert/mod.ts';

import {
  escapeHtml,
  renderBlock,
  renderNotFound,
  renderPage,
  renderSeoHead,
  type BlockNode,
} from './render.ts';

// ─── escapeHtml ────────────────────────────────────────────────────────────────

Deno.test('escapeHtml: entity-encodes & < > " \'', () => {
  const out = escapeHtml('<script>alert("xss")</script>');
  assert(!out.includes('<script>'), `raw <script> survived: ${out}`);
  assertStringIncludes(out, '&lt;script&gt;');
  assertStringIncludes(out, '&quot;');
  // The literal ampersand from `&lt;` is the encoded `<`; we also need the
  // original `&` substring to not appear bare elsewhere.
  assert(!/[^&]<|^</.test(out), `raw < survived: ${out}`);
});

Deno.test('escapeHtml: handles non-string inputs without throwing', () => {
  assertEquals(escapeHtml(42), '42');
  assertEquals(escapeHtml(0), '0');
  assertEquals(escapeHtml(true), 'true');
  assertEquals(escapeHtml(null), '');
  assertEquals(escapeHtml(undefined), '');
  assertEquals(escapeHtml(''), '');
});

Deno.test('escapeHtml: ampersand is encoded first (no double-encode of &lt;)', () => {
  // The classic double-encode bug: replacing & last turns `&lt;` into `&amp;lt;`.
  const out = escapeHtml('Foo & <Bar>');
  assertEquals(out, 'Foo &amp; &lt;Bar&gt;');
});

// ─── renderBlock — hero ────────────────────────────────────────────────────────

function heroBlock(overrides: Partial<BlockNode> = {}): BlockNode {
  return {
    id: 'h1',
    type: 'hero',
    parent_id: null,
    order: 0,
    content: {
      heading: 'Welcome',
      subheading: 'Hello world',
      ctaLabel: 'Get started',
      ctaHref: '/signup',
    },
    style: {},
    ...overrides,
  };
}

Deno.test('renderBlock hero: wraps in <section> and emits the heading', () => {
  const html = renderBlock(heroBlock());
  assertStringIncludes(html, '<section');
  assertStringIncludes(html, 'Welcome');
});

Deno.test('renderBlock hero: escapeHtml-d content (XSS payload defused)', () => {
  const html = renderBlock(
    heroBlock({
      content: {
        heading: '<img src=x onerror=alert(1)>',
        subheading: 'safe',
        ctaLabel: 'Go',
        ctaHref: '/x',
      },
    }),
  );
  // The raw payload must NOT appear in the rendered HTML as a live tag.
  // Note: the LITERAL substring `onerror=` survives inside the escaped
  // text `&lt;img src=x onerror=alert(1)&gt;` — that's text, not an
  // attribute. What we must prove is that no live `<img>` tag and no
  // attribute-context `onerror` was emitted. So we assert the structural
  // absence of `<img` (no live tag) and check the payload is wrapped in
  // entity-encoded delimiters.
  assert(!html.includes('<img'), `live <img tag survived: ${html}`);
  assertStringIncludes(html, '&lt;img src=x onerror=alert(1)&gt;');
});

Deno.test('renderBlock hero: backgroundTone=brand emits the hero-bg token', () => {
  const html = renderBlock(heroBlock({ style: { backgroundTone: 'brand' } }));
  assertStringIncludes(html, 'var(--color-hero-bg)');
});

Deno.test('renderBlock hero: spacingDensity=spacious emits inline 96px padding', () => {
  const html = renderBlock(heroBlock({ style: { spacingDensity: 'spacious' } }));
  assertStringIncludes(html, 'padding-top:96px');
  assertStringIncludes(html, 'padding-bottom:96px');
});

Deno.test('renderBlock hero: hideOnMobile=true emits hide-on-mobile marker', () => {
  const html = renderBlock(heroBlock({ style: { hideOnMobile: true } }));
  assertStringIncludes(html, 'hide-on-mobile');
});

Deno.test('renderBlock hero: javascript:-href is dropped (only http(s)/#/relative allowed)', () => {
  const html = renderBlock(
    heroBlock({
      content: {
        heading: 'Hi',
        subheading: '',
        ctaLabel: 'click',
        ctaHref: 'javascript:alert(1)',
      },
    }),
  );
  assert(!html.includes('javascript:'), `javascript: href leaked: ${html}`);
});

// ─── renderBlock — cta ─────────────────────────────────────────────────────────

Deno.test('renderBlock cta: interpolates heading + body + ctaLabel, all escaped', () => {
  const html = renderBlock({
    id: 'c1',
    type: 'cta',
    parent_id: null,
    order: 1,
    content: {
      heading: 'Ready?',
      body: 'Sign up <today>',
      ctaLabel: 'Go now',
      ctaHref: 'https://example.com',
    },
    style: {},
  });
  assertStringIncludes(html, 'Ready?');
  assertStringIncludes(html, '&lt;today&gt;');
  assertStringIncludes(html, 'Go now');
  assertStringIncludes(html, 'https://example.com');
});

Deno.test('renderBlock cta: malicious ctaHref is dropped', () => {
  const html = renderBlock({
    id: 'c2',
    type: 'cta',
    parent_id: null,
    order: 0,
    content: { heading: 'h', body: 'b', ctaLabel: 'l', ctaHref: 'data:text/html,xx' },
    style: {},
  });
  assert(!html.includes('data:text/html'), `data: url leaked: ${html}`);
});

// ─── renderBlock — footer ──────────────────────────────────────────────────────

Deno.test('renderBlock footer: emits <footer>, escapes logoText / navLinks / copyright', () => {
  const html = renderBlock({
    id: 'f1',
    type: 'footer',
    parent_id: null,
    order: 99,
    content: {
      logoText: 'LeanShot<sup>™</sup>',
      navLinks: [
        { label: 'About', href: '/about' },
        { label: 'Contact <us>', href: '/contact' },
      ],
      copyright: '© 2026 LeanShot',
    },
    style: {},
  });
  assertStringIncludes(html, '<footer');
  // logoText escaping
  assert(!html.includes('LeanShot<sup>'), 'raw HTML in logoText survived');
  assertStringIncludes(html, '&lt;sup&gt;');
  // navLinks label escaping
  assertStringIncludes(html, 'Contact &lt;us&gt;');
  // each href present
  assertStringIncludes(html, '/about');
  assertStringIncludes(html, '/contact');
  // copyright
  assertStringIncludes(html, '© 2026 LeanShot');
});

// ─── renderBlock — unimplemented type ─────────────────────────────────────────

Deno.test('renderBlock: unimplemented type returns empty string (extension point for 15-07)', () => {
  const html = renderBlock({
    id: 'x1',
    type: 'lead-form', // 15-07 adds this case; 15-06 already implemented calendly/youtube/tally
    parent_id: null,
    order: 0,
    content: {},
    style: {},
  });
  assertEquals(html, '');
});

// ─── renderSeoHead ─────────────────────────────────────────────────────────────

Deno.test('renderSeoHead: stub emits ONLY charset, viewport, title, font preloads', () => {
  const head = renderSeoHead({
    pageTitle: 'Hello',
    pageDescription: 'should be ignored by stub',
    canonicalUrl: 'https://x/h',
    ogImage: 'should be ignored by stub',
  });
  assertStringIncludes(head, '<meta charset="utf-8">');
  assertStringIncludes(head, 'name="viewport"');
  assertStringIncludes(head, '<title>Hello</title>');
  // Font preloads (UI-SPEC Performance Contract)
  assertStringIncludes(head, 'rel="preload"');
  assertStringIncludes(head, 'Geist');
  assertStringIncludes(head, 'Fraunces');
  // Stub MUST NOT emit any of the SEO-cascade fields — those are 15-08's job
  assert(!head.includes('name="description"'), 'stub emitted description meta');
  assert(!head.toLowerCase().includes('og:'), 'stub emitted og: tags');
  assert(!head.includes('rel="canonical"'), 'stub emitted canonical link');
  assert(!head.includes('application/ld+json'), 'stub emitted JSON-LD script');
});

Deno.test('renderSeoHead: pageTitle is escapeHtml-d', () => {
  const head = renderSeoHead({
    pageTitle: '<script>alert(1)</script>',
    pageDescription: '',
    canonicalUrl: '/x',
    ogImage: '',
  });
  assert(!head.includes('<script>alert'), `script payload survived in title: ${head}`);
  assertStringIncludes(head, '&lt;script&gt;');
});

// ─── renderPage ────────────────────────────────────────────────────────────────

Deno.test('renderPage: emits a complete HTML document with one <head> and one <body>', () => {
  const html = renderPage({
    slug: 'demo',
    seo: { title: 'Demo Page' },
    blocks: [heroBlock()],
  });
  // Doctype is case-insensitive in HTML
  assert(/^<!doctype html/i.test(html.trim()), `missing doctype: ${html.slice(0, 50)}`);
  // Exactly one head, one body
  const headOpens = (html.match(/<head[\s>]/gi) ?? []).length;
  const bodyOpens = (html.match(/<body[\s>]/gi) ?? []).length;
  assertEquals(headOpens, 1, 'expected exactly one <head>');
  assertEquals(bodyOpens, 1, 'expected exactly one <body>');
  // Title from renderSeoHead is interpolated inside head
  assertStringIncludes(html, '<title>Demo Page</title>');
  // The hero block content lands in the body
  assertStringIncludes(html, 'Welcome');
});

Deno.test('renderPage: child blocks (parent_id !== null) NOT rendered at root level', () => {
  const root = heroBlock({ id: 'root1', content: { heading: 'ROOT', subheading: '', ctaLabel: '', ctaHref: '/' } });
  const child: BlockNode = {
    id: 'child1',
    type: 'hero',
    parent_id: 'root1', // child of root1
    order: 0,
    content: { heading: 'CHILD-HEADING', subheading: '', ctaLabel: '', ctaHref: '/' },
    style: {},
  };
  const html = renderPage({ slug: 's', seo: {}, blocks: [root, child] });
  assertStringIncludes(html, 'ROOT');
  // CHILD-HEADING must not appear at the document body root — this plan's
  // renderPage only walks parent_id === null roots at the top level. Nested
  // child rendering is the responsibility of plans that introduce a
  // container block (15-05's image-text columns, 15-05's feature-grid items).
  assert(!html.includes('CHILD-HEADING'), 'child block leaked into root render');
});

Deno.test('renderPage: roots are sorted by `order` ascending', () => {
  const a: BlockNode = { ...heroBlock({ id: 'A', content: { heading: 'AAA', subheading: '', ctaLabel: '', ctaHref: '/' } }), order: 2 };
  const b: BlockNode = { ...heroBlock({ id: 'B', content: { heading: 'BBB', subheading: '', ctaLabel: '', ctaHref: '/' } }), order: 0 };
  const c: BlockNode = { ...heroBlock({ id: 'C', content: { heading: 'CCC', subheading: '', ctaLabel: '', ctaHref: '/' } }), order: 1 };
  const html = renderPage({ slug: 's', seo: {}, blocks: [a, b, c] });
  const bIdx = html.indexOf('BBB');
  const cIdx = html.indexOf('CCC');
  const aIdx = html.indexOf('AAA');
  assert(bIdx !== -1 && cIdx !== -1 && aIdx !== -1, 'all three headings present');
  assert(bIdx < cIdx && cIdx < aIdx, `expected B<C<A order, got B=${bIdx} C=${cIdx} A=${aIdx}`);
});

// ─── renderNotFound ────────────────────────────────────────────────────────────

Deno.test('renderNotFound: complete HTML doc with the exact 15-UI-SPEC 404 copy', () => {
  const html = renderNotFound();
  assert(/^<!doctype html/i.test(html.trim()), 'missing doctype');
  assertStringIncludes(html, 'Page not found. It may have been moved or removed.');
});

// ─── 15-05: renderBlock — faq ──────────────────────────────────────────────────

function faqBlock(overrides: Partial<BlockNode> = {}): BlockNode {
  return {
    id: 'fa1',
    type: 'faq',
    parent_id: null,
    order: 0,
    content: {
      heading: 'Frequently asked questions',
      items: [
        { q: 'First question?', a: 'First answer.' },
        { q: 'Second question?', a: 'Second answer.' },
      ],
    },
    style: {},
    ...overrides,
  };
}

Deno.test('renderBlock faq: emits a button per item with aria-expanded=false and aria-controls', () => {
  const html = renderBlock(faqBlock());
  const buttonMatches = html.match(/<button[^>]*aria-expanded="false"[^>]*aria-controls="[^"]+"/g) ?? [];
  assertEquals(buttonMatches.length, 2, `expected 2 accordion triggers, got ${buttonMatches.length}: ${html}`);
});

Deno.test('renderBlock faq: emits a panel per item with role="region" and id matching aria-controls', () => {
  const html = renderBlock(faqBlock());
  // Extract aria-controls values
  const controls = [...html.matchAll(/aria-controls="([^"]+)"/g)].map((m) => m[1]);
  assertEquals(controls.length, 2, 'expected 2 aria-controls');
  for (const id of controls) {
    assertStringIncludes(html, `role="region"`);
    assertStringIncludes(html, `id="${id}"`);
  }
});

Deno.test('renderBlock faq: XSS payload in q is escaped (no live <script>)', () => {
  const html = renderBlock(
    faqBlock({
      content: {
        heading: 'FAQ',
        items: [{ q: '<script>alert(1)</script>', a: 'safe' }],
      },
    }),
  );
  assert(!html.includes('<script>'), `live <script> survived: ${html}`);
  assertStringIncludes(html, '&lt;script&gt;');
});

Deno.test('renderBlock faq: hideOnMobile=true emits hide-on-mobile marker', () => {
  const html = renderBlock(faqBlock({ style: { hideOnMobile: true } }));
  assertStringIncludes(html, 'hide-on-mobile');
});

Deno.test('renderBlock faq: backgroundTone=subtle emits the surface-elevated token', () => {
  const html = renderBlock(faqBlock({ style: { backgroundTone: 'subtle' } }));
  assertStringIncludes(html, 'var(--color-surface-elevated)');
});

// ─── 15-05: renderBlock — pricing ──────────────────────────────────────────────

function pricingBlock(overrides: Partial<BlockNode> = {}): BlockNode {
  return {
    id: 'pr1',
    type: 'pricing',
    parent_id: null,
    order: 0,
    content: {
      heading: 'Pricing',
      plans: [
        {
          name: 'Plus monthly',
          price: '$12.99',
          cadence: '/month',
          features: ['Feature 1', 'Feature 2'],
          ctaLabel: 'Get started',
        },
        {
          name: 'Annual',
          price: '$132.49',
          cadence: '/year',
          features: ['All Plus features', 'Two months free'],
          ctaLabel: 'Get started',
          recommended: true,
        },
      ],
    },
    style: {},
    ...overrides,
  };
}

Deno.test('renderBlock pricing: wraps price in a Geist Mono token class', () => {
  const html = renderBlock(pricingBlock());
  // The price should appear inside an element carrying the Geist Mono token class.
  assertStringIncludes(html, 'block-pricing__price');
  // Token-bounded font-family for the price
  assertStringIncludes(html, 'font-family:Geist Mono');
  assertStringIncludes(html, '$12.99');
});

Deno.test('renderBlock pricing: CTA renders as a button-primary styled element with a non-empty aria-label', () => {
  const html = renderBlock(pricingBlock());
  // Button primary token class (from --color-primary)
  assertStringIncludes(html, 'block-pricing__cta');
  // aria-label present + non-empty
  const arias = [...html.matchAll(/aria-label="([^"]*)"/g)].map((m) => m[1]);
  assert(arias.some((a) => a.length > 0), `expected non-empty aria-label, got: ${JSON.stringify(arias)}`);
  // No Stripe call — render.ts is pure HTML; assert no <script>
  assert(!html.includes('<script'), '<script> leaked into pricing render');
});

Deno.test('renderBlock pricing: recommended:true applies the selected-card teal-ring token class', () => {
  const html = renderBlock(pricingBlock());
  // Recommended plan emits a selected-card marker class.
  assertStringIncludes(html, 'block-pricing__plan--recommended');
});

Deno.test('renderBlock pricing: feature text and plan names are escapeHtml-d', () => {
  const html = renderBlock(
    pricingBlock({
      content: {
        heading: 'Pricing',
        plans: [
          {
            name: '<b>Plus</b>',
            price: '$x',
            cadence: '/mo',
            features: ['<script>xss</script>'],
            ctaLabel: 'Go',
          },
        ],
      },
    }),
  );
  assert(!html.includes('<b>Plus</b>'), 'raw <b> survived');
  assert(!html.includes('<script>xss</script>'), 'raw script in feature survived');
  assertStringIncludes(html, '&lt;b&gt;Plus&lt;/b&gt;');
  assertStringIncludes(html, '&lt;script&gt;xss&lt;/script&gt;');
});

// ─── 15-05: renderBlock — testimonial ──────────────────────────────────────────

function testimonialBlock(overrides: Partial<BlockNode> = {}): BlockNode {
  return {
    id: 't1',
    type: 'testimonial',
    parent_id: null,
    order: 0,
    content: {
      heading: 'What people say',
      quotes: [
        {
          quote: 'This changed everything for me.',
          authorName: 'Alex Doe',
        },
      ],
    },
    style: {},
    ...overrides,
  };
}

Deno.test('renderBlock testimonial: escapes quote and renders authorName', () => {
  const html = renderBlock(
    testimonialBlock({
      content: {
        quotes: [
          { quote: '<i>great</i>', authorName: 'Alex' },
        ],
      },
    }),
  );
  assert(!html.includes('<i>great</i>'), 'raw <i> survived in quote');
  assertStringIncludes(html, '&lt;i&gt;great&lt;/i&gt;');
  assertStringIncludes(html, 'Alex');
});

Deno.test('renderBlock testimonial: emits <img> with alt when authorPhotoUrl present', () => {
  const html = renderBlock(
    testimonialBlock({
      content: {
        quotes: [
          {
            quote: 'q',
            authorName: 'Alex',
            authorPhotoUrl: '/photo.jpg',
            authorPhotoAlt: 'Alex photo',
          },
        ],
      },
    }),
  );
  assertStringIncludes(html, '<img');
  assertStringIncludes(html, 'src="/photo.jpg"');
  assertStringIncludes(html, 'alt="Alex photo"');
});

Deno.test('renderBlock testimonial: omits <img> when no authorPhotoUrl', () => {
  const html = renderBlock(testimonialBlock());
  assert(!html.includes('<img'), `unexpected <img>: ${html}`);
});

Deno.test('renderBlock testimonial: uses Fraunces italic on the quote', () => {
  const html = renderBlock(testimonialBlock());
  assertStringIncludes(html, 'block-testimonial__quote');
  assertStringIncludes(html, 'font-family:Fraunces');
  assertStringIncludes(html, 'font-style:italic');
});

// ─── 15-05: renderBlock — feature-grid ─────────────────────────────────────────

function featureGridBlock(overrides: Partial<BlockNode> = {}): BlockNode {
  return {
    id: 'fg1',
    type: 'feature-grid',
    parent_id: null,
    order: 0,
    content: {
      heading: 'Features',
      features: [
        { iconName: 'Zap', title: 'Fast', body: 'Lightning quick.' },
        { iconName: 'Heart', title: 'Loved', body: 'Patients love it.' },
        { iconName: 'Shield', title: 'Safe', body: 'Privacy first.' },
      ],
    },
    style: {},
    ...overrides,
  };
}

Deno.test('renderBlock feature-grid: renders one card per feature with title and body, escaped', () => {
  const html = renderBlock(
    featureGridBlock({
      content: {
        heading: 'F',
        features: [
          { iconName: 'Zap', title: '<x>', body: '<y>' },
        ],
      },
    }),
  );
  assertStringIncludes(html, 'block-feature-grid__card');
  assert(!html.includes('<x>'), 'raw <x> survived');
  assert(!html.includes('<y>'), 'raw <y> survived');
  assertStringIncludes(html, '&lt;x&gt;');
  assertStringIncludes(html, '&lt;y&gt;');
});

Deno.test('renderBlock feature-grid: emits one card element per feature', () => {
  const html = renderBlock(featureGridBlock());
  const cards = html.match(/block-feature-grid__card/g) ?? [];
  assertEquals(cards.length, 3, `expected 3 cards, got ${cards.length}`);
});

// ─── 15-05: renderBlock — image-text ───────────────────────────────────────────

function imageTextBlock(overrides: Partial<BlockNode> = {}): BlockNode {
  return {
    id: 'it1',
    type: 'image-text',
    parent_id: null,
    order: 0,
    content: {
      heading: 'About us',
      body: 'We make great software.',
      imageUrl: '/image.jpg',
      imageAlt: 'Team photo',
    },
    style: {},
    ...overrides,
  };
}

Deno.test('renderBlock image-text: alignment=right places image after text', () => {
  const html = renderBlock(imageTextBlock({ style: { alignment: 'right' } }));
  const imgIdx = html.indexOf('<img');
  const headingIdx = html.indexOf('About us');
  assert(imgIdx !== -1 && headingIdx !== -1, 'expected both image and heading');
  assert(headingIdx < imgIdx, `expected heading before image for right alignment; heading=${headingIdx} img=${imgIdx}`);
});

Deno.test('renderBlock image-text: alignment=left places image before text', () => {
  const html = renderBlock(imageTextBlock({ style: { alignment: 'left' } }));
  const imgIdx = html.indexOf('<img');
  const headingIdx = html.indexOf('About us');
  assert(imgIdx !== -1 && headingIdx !== -1, 'expected both image and heading');
  assert(imgIdx < headingIdx, `expected image before heading for left alignment; img=${imgIdx} heading=${headingIdx}`);
});

Deno.test('renderBlock image-text: omits <img> when imageAlt is blank', () => {
  const html = renderBlock(
    imageTextBlock({
      content: {
        heading: 'h',
        body: 'b',
        imageUrl: '/x.jpg',
        imageAlt: '',
      },
    }),
  );
  assert(!html.includes('<img'), `unexpected <img> when imageAlt blank: ${html}`);
  // Heading still rendered
  assertStringIncludes(html, 'h');
});

Deno.test('renderBlock image-text: body and heading escaped', () => {
  const html = renderBlock(
    imageTextBlock({
      content: {
        heading: '<h>',
        body: '<b>',
        imageUrl: '/x.jpg',
        imageAlt: 'alt',
      },
    }),
  );
  assert(!html.includes('<h>'), 'raw <h> survived');
  assert(!html.includes('<b>'), 'raw <b> survived');
  assertStringIncludes(html, '&lt;h&gt;');
  assertStringIncludes(html, '&lt;b&gt;');
});

// ─── 15-05: cross-block style invariants ───────────────────────────────────────

Deno.test('renderBlock 15-05 branches: hideOnMobile applied to all 5 new types', () => {
  const types = ['faq', 'pricing', 'testimonial', 'feature-grid', 'image-text'] as const;
  const factories: Record<string, () => BlockNode> = {
    faq: () => faqBlock({ style: { hideOnMobile: true } }),
    pricing: () => pricingBlock({ style: { hideOnMobile: true } }),
    testimonial: () => testimonialBlock({ style: { hideOnMobile: true } }),
    'feature-grid': () => featureGridBlock({ style: { hideOnMobile: true } }),
    'image-text': () => imageTextBlock({ style: { hideOnMobile: true } }),
  };
  for (const t of types) {
    const html = renderBlock(factories[t]());
    assert(html.includes('hide-on-mobile'), `${t} did not emit hide-on-mobile`);
  }
});

Deno.test('renderBlock 15-05 branches: backgroundTone=brand emits hero-bg token across all 5 new types', () => {
  const types = ['faq', 'pricing', 'testimonial', 'feature-grid', 'image-text'] as const;
  const factories: Record<string, () => BlockNode> = {
    faq: () => faqBlock({ style: { backgroundTone: 'brand' } }),
    pricing: () => pricingBlock({ style: { backgroundTone: 'brand' } }),
    testimonial: () => testimonialBlock({ style: { backgroundTone: 'brand' } }),
    'feature-grid': () => featureGridBlock({ style: { backgroundTone: 'brand' } }),
    'image-text': () => imageTextBlock({ style: { backgroundTone: 'brand' } }),
  };
  for (const t of types) {
    const html = renderBlock(factories[t]());
    assert(html.includes('var(--color-hero-bg)'), `${t} did not emit hero-bg token`);
  }
});
