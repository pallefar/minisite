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
  // Phase 39 Plan 39-09 — variant-aware page-render extensions.
  VARIANT_VARY_HEADER_VALUE,
  VARIANT_COOKIE_PREFIX,
  buildVariantCacheKey,
  variantCookieName,
  resolveVariantBlocks,
  type VariantBlockResolver,
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

Deno.test('renderBlock: unimplemented type returns empty string (default fall-through)', () => {
  // Forward-contract: assert the `default` branch returns '' so future block
  // types added to BlockType BEFORE their `case` lands stay safe. 15-05
  // swapped `'faq'` → `'calendly'`, 15-06 swapped `'calendly'` → `'lead-form'`,
  // and 15-07 implements `'lead-form'`. The 12-literal BlockType union is now
  // fully covered by 15-03/05/06/07 — we use a synthetic unknown literal here
  // to keep the contract pinned for any future BlockType expansion.
  const html = renderBlock({
    id: 'x1',
    // Cast: this type literal is not in the BlockType union — that is the
    // point. The default branch must still return ''.
    type: 'not-yet-implemented' as unknown as BlockNode['type'],
    parent_id: null,
    order: 0,
    content: {},
    style: {},
  });
  assertEquals(html, '');
});

// ─── renderBlock — lead-form (15-07) ──────────────────────────────────────────

Deno.test('renderBlock lead-form: emits semantic <form> + email field + honeypot + roles', () => {
  const html = renderBlock({
    id: 'lf1',
    type: 'lead-form',
    parent_id: null,
    order: 0,
    content: {
      heading: 'Get the free guide',
      description: 'Drop your email below.',
      buttonLabel: 'Send me access',
      successMessage: "You're on the list.",
      collectName: false,
    },
    style: {},
  });
  assertStringIncludes(html, '<form');
  assertStringIncludes(html, 'data-lead-form');
  assertStringIncludes(html, '/functions/v1/lead-capture/submit');
  assertStringIncludes(html, 'type="email"');
  assertStringIncludes(html, 'name="email"');
  assertStringIncludes(html, 'name="website"'); // honeypot
  assertStringIncludes(html, 'role="status"');
  assertStringIncludes(html, 'role="alert"');
  assertStringIncludes(html, 'Send me access');
  // Honeypot wrapper is offscreen, NOT display:none.
  assertStringIncludes(html, 'left:-9999px');
  assert(!/display:\s*none/.test(html.split('aria-hidden="true" style=')[1]?.split('>')[0] ?? ''),
    'honeypot wrapper must NOT use display:none — the field must remain in the FormData');
  // collectName=false → no name input.
  assert(!/<input[^>]*name="name"/.test(html), 'name input must be absent when collectName=false');
});

Deno.test('renderBlock lead-form: collectName=true renders the name input', () => {
  const html = renderBlock({
    id: 'lf2',
    type: 'lead-form',
    parent_id: null,
    order: 0,
    content: {
      heading: 'Get the free guide',
      buttonLabel: 'Send me access',
      successMessage: 'Done',
      collectName: true,
    },
    style: {},
  });
  assert(/<input[^>]*name="name"/.test(html), 'name input must be present when collectName=true');
});

Deno.test('renderBlock lead-form: XSS payload in content is escaped', () => {
  const html = renderBlock({
    id: 'lf3',
    type: 'lead-form',
    parent_id: null,
    order: 0,
    content: {
      heading: '<script>alert(1)</script>',
      buttonLabel: '"><img src=x>',
      successMessage: '<svg onload=alert(2)>',
      collectName: false,
    },
    style: {},
  });
  // No raw <script>alert(1)</script> in the heading. The inline submit script
  // tag itself uses literal <script> — we only assert the user-supplied
  // payload is escaped, not that the rendered HTML is <script>-free.
  assert(!html.includes('<script>alert(1)</script>'), 'heading <script> must be escaped');
  assertStringIncludes(html, '&lt;script&gt;alert(1)&lt;/script&gt;');
  assertStringIncludes(html, '&quot;&gt;&lt;img src=x&gt;');
  // successMessage is interpolated as an HTML attribute value; the &quot; and
  // &lt; escapes prevent attribute-break-out.
  assertStringIncludes(html, '&lt;svg onload=alert(2)&gt;');
});

// ─── renderSeoHead ─────────────────────────────────────────────────────────────

// 15-08 — stub minimality test replaced by the full SEO-cascade behavior
// suite below. The 15-03 stub deliberately emitted ONLY charset/viewport/
// title/font-preloads as a placeholder for this plan. The new tests prove
// the real cascade behavior + escape contracts.

Deno.test('renderSeoHead: emits full SEO cascade (title, description, og:*, canonical, JSON-LD, twitter:card)', () => {
  const head = renderSeoHead({
    pageTitle: 'Hello',
    pageDescription: 'A description',
    canonicalUrl: 'https://x/h',
    ogImage: 'https://x/og.png',
  });
  assertStringIncludes(head, '<meta charset="utf-8">');
  assertStringIncludes(head, '<title>Hello</title>');
  assertStringIncludes(head, '<meta name="description" content="A description">');
  assertStringIncludes(head, '<meta property="og:title" content="Hello">');
  assertStringIncludes(head, '<meta property="og:description" content="A description">');
  assertStringIncludes(head, '<meta property="og:type" content="website">');
  assertStringIncludes(head, '<meta property="og:url" content="https://x/h">');
  assertStringIncludes(head, '<meta property="og:image" content="https://x/og.png">');
  assertStringIncludes(head, '<meta name="twitter:card" content="summary_large_image">');
  assertStringIncludes(head, '<link rel="canonical" href="https://x/h">');
  assertStringIncludes(head, '<script type="application/ld+json">');
  // Performance preloads still present (UI-SPEC Performance Contract).
  assertStringIncludes(head, 'rel="preload"');
  assertStringIncludes(head, 'Geist');
  assertStringIncludes(head, 'Fraunces');
});

Deno.test('renderSeoHead: per-page description wins; site_settings.default_description fills when blank', () => {
  // Per-page blank → falls back to default.
  const headFallback = renderSeoHead({
    pageTitle: 'P',
    pageDescription: '',
    canonicalUrl: '/p',
    ogImage: '',
    siteSettings: { default_description: 'Global default desc' },
  });
  assertStringIncludes(headFallback, 'content="Global default desc"');
  // Per-page set → overrides default.
  const headOverride = renderSeoHead({
    pageTitle: 'P',
    pageDescription: 'Page desc',
    canonicalUrl: '/p',
    ogImage: '',
    siteSettings: { default_description: 'Global default desc' },
  });
  assertStringIncludes(headOverride, 'content="Page desc"');
  assert(
    !headOverride.includes('Global default desc'),
    'site_settings default leaked when per-page description was set',
  );
});

Deno.test('renderSeoHead: site_name suffix appended to <title> when set', () => {
  const head = renderSeoHead({
    pageTitle: 'Hello',
    pageDescription: '',
    canonicalUrl: '/h',
    ogImage: '',
    siteSettings: { site_name: 'LeanShot' },
  });
  assertStringIncludes(head, '<title>Hello — LeanShot</title>');
});

Deno.test('renderSeoHead: emits favicon link ONLY when site_settings.favicon_url is set', () => {
  const headOff = renderSeoHead({
    pageTitle: 'H',
    pageDescription: '',
    canonicalUrl: '/h',
    ogImage: '',
  });
  assert(!headOff.includes('rel="icon"'), 'favicon emitted with no site_settings');
  const headOn = renderSeoHead({
    pageTitle: 'H',
    pageDescription: '',
    canonicalUrl: '/h',
    ogImage: '',
    siteSettings: { favicon_url: '/favicon.svg' },
  });
  assertStringIncludes(headOn, '<link rel="icon" href="/favicon.svg">');
});

Deno.test('renderSeoHead: meta description carrying " and < cannot break out of the attribute (T-15-08-02)', () => {
  const head = renderSeoHead({
    pageTitle: 'P',
    pageDescription: 'bad" onerror="alert(1)" <script>x</script>',
    canonicalUrl: '/p',
    ogImage: '',
  });
  // The escaped value cannot terminate the attribute. No literal `onerror="`
  // can appear as an attribute outside our intended attributes.
  assert(!head.includes('"onerror='), 'attribute breakout in description');
  assertStringIncludes(head, '&quot;');
  assertStringIncludes(head, '&lt;script&gt;');
});

Deno.test('renderSeoHead: JSON-LD <script> cannot be terminated by a </script> in the title (T-15-08-01)', () => {
  const head = renderSeoHead({
    pageTitle: '</script><img src=x onerror=alert(1)>',
    pageDescription: '',
    canonicalUrl: '/p',
    ogImage: '',
  });
  // The <title> is HTML-escaped so the literal </script> in the title context
  // is also escaped.
  assert(!head.includes('<title></script>'), 'unescaped </script> in <title>');
  // The JSON-LD block contains escaped < (\\u003c) — never a literal </script>.
  // Pull the JSON-LD substring out and assert no literal </script>.
  const ldIdx = head.indexOf('<script type="application/ld+json">');
  assert(ldIdx >= 0, 'no JSON-LD <script> tag emitted');
  const ldEnd = head.indexOf('</script>', ldIdx);
  // Find the actual closing tag (the only legitimate </script>). The body
  // between the opening tag and that closing tag must NOT contain another
  // </script> substring.
  const innerStart = ldIdx + '<script type="application/ld+json">'.length;
  const inner = head.slice(innerStart, ldEnd);
  assert(!inner.includes('</script>'), 'JSON-LD body could terminate the <script> tag');
  // Inner is the raw JSON-LD output. It must contain the \\u003c escape.
  assertStringIncludes(inner, '\\u003c');
});

Deno.test('renderSeoHead: FAQPage schemaType extracts mainEntity from faq blocks', () => {
  const faq: BlockNode = {
    id: 'b1',
    type: 'faq',
    parent_id: null,
    order: 0,
    content: { items: [{ q: 'Q1', a: 'A1' }] },
    style: {},
  };
  const head = renderSeoHead({
    pageTitle: 'FAQs',
    pageDescription: 'F',
    canonicalUrl: '/faq',
    ogImage: '',
    blocks: [faq],
    schemaType: 'FAQPage',
  });
  // Pull the JSON-LD payload and assert its structure.
  const ldStart = head.indexOf('<script type="application/ld+json">') +
    '<script type="application/ld+json">'.length;
  const ldEnd = head.indexOf('</script>', ldStart);
  const ld = head.slice(ldStart, ldEnd);
  // JSON-LD output has \\u003c-escaped `<`s; replace before parsing.
  const parsed = JSON.parse(ld.replace(/\\u003c/g, '<'));
  assertEquals(parsed['@type'], 'FAQPage');
  assertEquals(parsed.mainEntity?.[0]?.name, 'Q1');
  assertEquals(parsed.mainEntity?.[0]?.acceptedAnswer?.text, 'A1');
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

// ─── 39-09: variant-aware page-render extensions ──────────────────────────────
//
// Plan 39-09 (Wave 5 admin slice C) — PAGEAB-01/02/04/06.
//
// The pure-function seam tested here:
//   • VARIANT_VARY_HEADER_VALUE — string constant the dispatcher emits as the
//     `Vary: ...` response header so the edge cache partitions on the
//     lt_variant_{page_id} cookie (PAGEAB-04).
//   • buildVariantCacheKey(pageId, variantId) — pure cache-key function so
//     control + variant do NOT cross-poison (PAGEAB-04).
//   • variantCookieName(pageId) — returns `lt_variant_{page_id}` so callers
//     don't string-concat ad-hoc.
//   • renderPage with `canonicalSlug` → emits <link rel="canonical"
//     href="/{control-slug}"> for variant renders (PAGEAB-02).
//   • renderPage with non-null `variantId` → still emits `<link
//     rel="canonical">` resolved from canonicalSlug (regression-test).
//   • resolveVariantBlocks(blocks, resolver) — async tree walk that calls the
//     resolver only for blocks with non-null `variant_set_id` (PAGEAB-06 /
//     D-13 / per-block A/B). On resolver throw OR null return → keeps the
//     canonical block content (graceful 401 fallback per `<interfaces>`).

Deno.test('39-09 PAGEAB-04: VARIANT_VARY_HEADER_VALUE includes "Cookie"', () => {
  // The dispatcher composes its own Vary header. This constant guarantees a
  // single source of truth so both render.ts and index.ts agree on the
  // partitioning cookie boundary.
  assertStringIncludes(VARIANT_VARY_HEADER_VALUE, 'Cookie');
});

Deno.test('39-09 PAGEAB-04: VARIANT_COOKIE_PREFIX matches the documented lt_variant_ contract', () => {
  assertEquals(VARIANT_COOKIE_PREFIX, 'lt_variant_');
});

Deno.test('39-09 PAGEAB-04: variantCookieName(pageId) returns lt_variant_{pageId}', () => {
  assertEquals(variantCookieName('abc123'), 'lt_variant_abc123');
});

Deno.test('39-09 PAGEAB-04: buildVariantCacheKey includes both page_id AND variant_id', () => {
  // Control + variant must not collide. The format `${page_id}:${variant_id}`
  // is documented in <interfaces>. Control is represented by the string
  // 'control' when no variant is active.
  assertEquals(buildVariantCacheKey('abc', 'control'), 'abc:control');
  assertEquals(buildVariantCacheKey('abc', 'variant_x'), 'abc:variant_x');
  // Distinct keys for control vs variant of the same page — the regression we
  // are guarding against.
  const ctrl = buildVariantCacheKey('p1', 'control');
  const vrnt = buildVariantCacheKey('p1', 'variant_a');
  assert(ctrl !== vrnt, `expected distinct cache keys, got both ${ctrl}`);
});

Deno.test('39-09 PAGEAB-04: buildVariantCacheKey defaults variantId to "control" when blank', () => {
  // Defensive contract: an empty / undefined variantId arrives whenever no
  // cookie is set AND variant-resolver returned no row. Treat as control.
  assertEquals(buildVariantCacheKey('abc', undefined), 'abc:control');
  assertEquals(buildVariantCacheKey('abc', ''), 'abc:control');
  assertEquals(buildVariantCacheKey('abc', null as unknown as string), 'abc:control');
});

Deno.test('39-09 PAGEAB-02: renderPage emits <link rel="canonical"> pointing at canonicalSlug for variant render', () => {
  // When canonicalSlug differs from the rendered slug (i.e. we are serving a
  // variant), the emitted canonical link MUST point at the CONTROL slug, not
  // at the variant slug. This is the SEO contract that prevents the variant
  // page from out-ranking the control page in Google's index (V13-4).
  const html = renderPage({
    slug: 'variant-launch',
    canonicalSlug: 'launch',
    seo: {},
    blocks: [heroBlock()],
  });
  assertStringIncludes(html, '<link rel="canonical" href="/launch">');
  // Sanity: the variant slug DOES appear elsewhere (e.g. inside JSON-LD url
  // fields if seo.canonical is unset) but the canonical TAG itself points at
  // the control slug.
  assert(
    !html.includes('<link rel="canonical" href="/variant-launch">'),
    'canonical link MUST point at canonicalSlug, not the variant slug',
  );
});

Deno.test('39-09 PAGEAB-02 regression: renderPage without canonicalSlug emits canonical = "/{slug}" (existing 15-08 behavior)', () => {
  // Regression-test: the existing canonical emission for non-variant pages
  // continues to work. Plan 39-09 must NOT silently break the 15-08 contract.
  const html = renderPage({
    slug: 'launch',
    seo: {},
    blocks: [heroBlock()],
  });
  assertStringIncludes(html, '<link rel="canonical" href="/launch">');
});

Deno.test('39-09 PAGEAB-02: seo.canonical (explicit override) wins over canonicalSlug', () => {
  // If a staff user has hand-set seo.canonical via the SEO panel, that value
  // wins over the auto-computed canonicalSlug. The 15-08 cascade rule stays
  // intact: per-page seo.canonical → variant canonicalSlug → safe fallback.
  const html = renderPage({
    slug: 'variant-launch',
    canonicalSlug: 'launch',
    seo: { canonical: 'https://leanshot.app/preferred-canonical' },
    blocks: [heroBlock()],
  });
  assertStringIncludes(html, '<link rel="canonical" href="https://leanshot.app/preferred-canonical">');
});

// ─── 39-09 PAGEAB-06 / D-13: resolveVariantBlocks per-block resolver ──────────

Deno.test('39-09 PAGEAB-06: resolveVariantBlocks does NOT call the resolver for blocks without variant_set_id', async () => {
  let callCount = 0;
  const resolver: VariantBlockResolver = (_block) => {
    callCount += 1;
    return Promise.resolve(null);
  };
  const blocks: BlockNode[] = [heroBlock({ id: 'h1' })];
  const out = await resolveVariantBlocks(blocks, resolver);
  assertEquals(callCount, 0, 'resolver MUST NOT fire for blocks without variant_set_id');
  // Output is the same tree, structurally
  assertEquals(out.length, 1);
  assertEquals(out[0]?.id, 'h1');
});

Deno.test('39-09 PAGEAB-06: resolveVariantBlocks calls the resolver for each block with variant_set_id', async () => {
  const calls: string[] = [];
  const resolver: VariantBlockResolver = (block) => {
    calls.push(block.id);
    return Promise.resolve(null);
  };
  const blocks: BlockNode[] = [
    heroBlock({ id: 'h1', variant_set_id: 'vs-1' }),
    heroBlock({ id: 'h2' }),
    heroBlock({ id: 'h3', variant_set_id: 'vs-2' }),
  ];
  await resolveVariantBlocks(blocks, resolver);
  assertEquals(calls, ['h1', 'h3'], 'resolver MUST fire exactly for blocks with variant_set_id');
});

Deno.test('39-09 PAGEAB-06: resolver-returned variant block REPLACES the canonical block content in the rendered HTML', async () => {
  // The per-block A/B contract: the resolver returns a BlockNode whose
  // `content` is the variant's admin-edited payload. The renderer must emit
  // THAT content, not the canonical content the editor saved.
  const blocks: BlockNode[] = [
    heroBlock({
      id: 'h1',
      variant_set_id: 'vs-1',
      content: {
        heading: 'CANONICAL_HEADING',
        subheading: '',
        ctaLabel: 'Go',
        ctaHref: '/x',
      },
    }),
  ];
  const resolver: VariantBlockResolver = (block) =>
    Promise.resolve({
      ...block,
      content: {
        heading: 'VARIANT_HEADING',
        subheading: '',
        ctaLabel: 'Go',
        ctaHref: '/x',
      },
    });
  const resolved = await resolveVariantBlocks(blocks, resolver);
  const html = renderPage({ slug: 's', seo: {}, blocks: resolved });
  assertStringIncludes(html, 'VARIANT_HEADING');
  assert(
    !html.includes('CANONICAL_HEADING'),
    'canonical block content leaked into rendered HTML when variant was resolved',
  );
});

Deno.test('39-09 PAGEAB-06 fallback: resolver throws → canonical block content is emitted (graceful 401 path)', async () => {
  // Per `<interfaces>`: if variant-resolver returns 401 (anonymous path not
  // yet supported in Plan 39-03's first cut) OR otherwise rejects, the
  // renderer falls back to the canonical block content. The visitor MUST
  // still see a page — no 500 surfaced.
  const blocks: BlockNode[] = [
    heroBlock({
      id: 'h1',
      variant_set_id: 'vs-1',
      content: {
        heading: 'FALLBACK_HEADING',
        subheading: '',
        ctaLabel: 'Go',
        ctaHref: '/x',
      },
    }),
  ];
  const resolver: VariantBlockResolver = (_block) =>
    Promise.reject(new Error('401 unauthenticated'));
  const resolved = await resolveVariantBlocks(blocks, resolver);
  const html = renderPage({ slug: 's', seo: {}, blocks: resolved });
  assertStringIncludes(html, 'FALLBACK_HEADING');
});

Deno.test('39-09 PAGEAB-06 fallback: resolver returns null → canonical block content is emitted', async () => {
  // Null return is the "no variant assigned for this user" path — the
  // resolver completed successfully but had nothing to swap. Same effect as
  // the throw path: keep the canonical block.
  const blocks: BlockNode[] = [
    heroBlock({
      id: 'h1',
      variant_set_id: 'vs-1',
      content: {
        heading: 'CANONICAL_KEEP',
        subheading: '',
        ctaLabel: 'Go',
        ctaHref: '/x',
      },
    }),
  ];
  const resolver: VariantBlockResolver = (_block) => Promise.resolve(null);
  const resolved = await resolveVariantBlocks(blocks, resolver);
  const html = renderPage({ slug: 's', seo: {}, blocks: resolved });
  assertStringIncludes(html, 'CANONICAL_KEEP');
});

Deno.test('39-09 PAGEAB-06 regression: resolveVariantBlocks preserves block order + parent_id when swapping', async () => {
  // The variant payload only replaces `content`; structure (id, type, order,
  // parent_id) must remain untouched so the existing root/child filter in
  // renderPage keeps working.
  const blocks: BlockNode[] = [
    heroBlock({ id: 'h1', order: 2, variant_set_id: 'vs-1' }),
    heroBlock({ id: 'h2', order: 0 }),
    heroBlock({ id: 'h3', order: 1 }),
  ];
  const resolver: VariantBlockResolver = (block) =>
    Promise.resolve({ ...block, content: { heading: 'V', subheading: '', ctaLabel: 'Go', ctaHref: '/x' } });
  const out = await resolveVariantBlocks(blocks, resolver);
  assertEquals(out.length, 3);
  assertEquals(out[0]?.id, 'h1');
  assertEquals(out[0]?.order, 2);
  assertEquals(out[1]?.id, 'h2');
  assertEquals(out[2]?.id, 'h3');
});
