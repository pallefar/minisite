/**
 * Phase 15 Plan 03 — Recursive HTML renderer for published landing pages.
 *
 * Pure, dependency-free Deno TypeScript module — concatenates strings, no
 * React, no JSX, no DOM. Consumed by `index.ts` (the Deno.serve dispatcher).
 *
 * Exports:
 *   • `escapeHtml(value)`  — the XSS boundary. Every user-authored content
 *     field passes through this before interpolation.
 *   • `renderBlock(block)` — switch on `block.type`. THIS plan ships
 *     hero / cta / footer. 15-05 ADDS faq, pricing, testimonial,
 *     feature-grid, image-text. 15-06 ADDS calendly, youtube, tally.
 *     15-07 ADDS lead-form. Unknown / not-yet-implemented types render to
 *     '' so later plans extend without restructuring.
 *   • `renderSeoHead(opts)` — SEO seam. THIS plan ships the minimal STUB
 *     body (charset + viewport + title + font preloads). 15-08 REPLACES
 *     the body with the full SEO cascade (description, og:*, canonical,
 *     favicon, JSON-LD) using `opts.siteSettings` for defaults.
 *   • `renderPage(page)`   — emits the complete `<!doctype html>` document.
 *   • `renderNotFound()`   — minimal 404 doc with the exact 15-UI-SPEC copy.
 *
 * LOCAL TYPE MIRROR: BlockType / BlockNode / BlockStyle are mirrored
 * BYTE-IDENTICAL with `leanshot/src/lib/page-builder/block-schema.ts`.
 * Deno cannot resolve `leanshot/src` (different runtime, different module
 * graph). The `<interfaces>` block in 15-03-PLAN.md is the single source
 * both copies follow. If you change one, change the other — tested at the
 * editor boundary by 15-04's editor save path.
 */

// ─── Local type mirror (canonical source: leanshot/src/lib/page-builder/block-schema.ts) ───

export type BlockType =
  | 'hero'
  | 'cta'
  | 'faq'
  | 'pricing'
  | 'testimonial'
  | 'feature-grid'
  | 'image-text'
  | 'footer'
  | 'calendly'
  | 'youtube'
  | 'tally'
  | 'lead-form';

export interface BlockStyle {
  backgroundTone?: 'default' | 'subtle' | 'brand' | 'dark';
  alignment?: 'left' | 'center' | 'right';
  spacingDensity?: 'compact' | 'default' | 'spacious';
  hideOnMobile?: boolean;
}

export interface BlockNode {
  id: string;
  type: BlockType;
  parent_id: string | null;
  order: number;
  content: Record<string, unknown>;
  style: BlockStyle;
}

// Per-page seo column shape — only the keys the renderer cares about.
export interface PageSeo {
  title?: string;
  description?: string;
  ogImage?: string;
  canonical?: string;
  schemaType?: string;
}

export interface RenderPageInput {
  slug: string;
  seo?: PageSeo;
  blocks: BlockNode[];
}

// ─── escapeHtml — the XSS boundary ─────────────────────────────────────────────

/**
 * Coerce `value` to string and entity-encode `& < > " '`.
 *
 * Order matters: `&` MUST be replaced first, otherwise subsequent
 * substitutions of `<`/`>`/`"`/`'` would have their leading `&` re-encoded
 * to `&amp;` (double-encoding bug).
 *
 * Non-string inputs:
 *   - numbers and booleans → `String(value)` (`"42"`, `"true"`).
 *   - `null` and `undefined` → `''` (empty string — never emits the literal
 *     `null` / `undefined` into HTML output).
 */
export function escapeHtml(value: unknown): string {
  if (value === null || value === undefined) return '';
  let s: string;
  if (typeof value === 'string') {
    s = value;
  } else {
    s = String(value);
  }
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ─── href validation ───────────────────────────────────────────────────────────

/**
 * Returns the href if it's safe to interpolate into an `<a href="…">`, else
 * `'#'`. "Safe" = http(s):// absolute URL, OR starts with `#` (fragment),
 * OR starts with `/` (relative path). Anything else — `javascript:`,
 * `data:`, `vbscript:`, bare schemes — is dropped.
 *
 * Note: callers MUST still `escapeHtml` the returned value before
 * interpolation (a relative URL like `/foo?x=<bar>` would otherwise break
 * out of the attribute on `"`).
 */
function safeHref(raw: unknown): string {
  if (typeof raw !== 'string') return '#';
  const trimmed = raw.trim();
  if (trimmed === '') return '#';
  if (trimmed.startsWith('#') || trimmed.startsWith('/')) return trimmed;
  // Match http:// or https:// (case-insensitive). Reject everything else.
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return '#';
}

// ─── style helpers ─────────────────────────────────────────────────────────────

function backgroundToneStyles(tone: BlockStyle['backgroundTone'], fallback: 'default' | 'brand' | 'dark'): string {
  const effective = tone ?? fallback;
  switch (effective) {
    case 'default':
      return 'background:var(--color-bg);';
    case 'subtle':
      return 'background:var(--color-surface-elevated);';
    case 'brand':
      return 'background:var(--color-hero-bg);color:var(--color-text-on-hero);';
    case 'dark':
      return 'background:var(--color-teal-950);color:var(--color-text-on-hero);';
    default:
      return 'background:var(--color-bg);';
  }
}

function spacingDensityPadding(density: BlockStyle['spacingDensity']): string {
  switch (density ?? 'default') {
    case 'compact':
      return 'padding-top:48px;padding-bottom:48px;';
    case 'spacious':
      return 'padding-top:96px;padding-bottom:96px;';
    case 'default':
    default:
      return 'padding-top:64px;padding-bottom:64px;';
  }
}

function alignmentStyle(alignment: BlockStyle['alignment'], fallback: 'left' | 'center' | 'right'): string {
  const effective = alignment ?? fallback;
  return `text-align:${effective};`;
}

function hideOnMobileClass(hide?: boolean): string {
  return hide ? ' hide-on-mobile' : '';
}

/** Assemble the wrapper style string for a block. */
function blockWrapperStyle(
  style: BlockStyle,
  backgroundFallback: 'default' | 'brand' | 'dark',
  alignmentFallback: 'left' | 'center' | 'right',
): string {
  return [
    backgroundToneStyles(style.backgroundTone, backgroundFallback),
    spacingDensityPadding(style.spacingDensity),
    alignmentStyle(style.alignment, alignmentFallback),
  ].join('');
}

// ─── per-block renderers ───────────────────────────────────────────────────────

function renderHero(block: BlockNode): string {
  const c = block.content;
  const heading = escapeHtml(c.heading ?? '');
  const subheading = escapeHtml(c.subheading ?? '');
  const ctaLabel = escapeHtml(c.ctaLabel ?? '');
  const ctaHref = escapeHtml(safeHref(c.ctaHref));
  const secondaryLabel = c.secondaryCtaLabel ? escapeHtml(c.secondaryCtaLabel) : '';
  const secondaryHref = c.secondaryCtaHref ? escapeHtml(safeHref(c.secondaryCtaHref)) : '';
  const wrapStyle = blockWrapperStyle(block.style, 'brand', 'center');
  const wrapClass = `block block-hero${hideOnMobileClass(block.style.hideOnMobile)}`;
  const primaryCta = ctaLabel
    ? `<a class="block-hero__cta block-hero__cta--primary" href="${ctaHref}">${ctaLabel}</a>`
    : '';
  const secondaryCta = secondaryLabel
    ? `<a class="block-hero__cta block-hero__cta--secondary" href="${secondaryHref}">${secondaryLabel}</a>`
    : '';
  const subheadingHtml = subheading ? `<p class="block-hero__sub">${subheading}</p>` : '';
  return `<section class="${wrapClass}" style="${wrapStyle}"><div class="block-hero__inner"><h1 class="block-hero__heading">${heading}</h1>${subheadingHtml}<div class="block-hero__ctas">${primaryCta}${secondaryCta}</div></div></section>`;
}

function renderCta(block: BlockNode): string {
  const c = block.content;
  const heading = escapeHtml(c.heading ?? '');
  const body = escapeHtml(c.body ?? '');
  const ctaLabel = escapeHtml(c.ctaLabel ?? '');
  const ctaHref = escapeHtml(safeHref(c.ctaHref));
  const secondaryLabel = c.secondaryCtaLabel ? escapeHtml(c.secondaryCtaLabel) : '';
  const secondaryHref = c.secondaryCtaHref ? escapeHtml(safeHref(c.secondaryCtaHref)) : '';
  const wrapStyle = blockWrapperStyle(block.style, 'default', 'center');
  const wrapClass = `block block-cta${hideOnMobileClass(block.style.hideOnMobile)}`;
  const primaryCta = ctaLabel
    ? `<a class="block-cta__cta block-cta__cta--primary" href="${ctaHref}">${ctaLabel}</a>`
    : '';
  const secondaryCta = secondaryLabel
    ? `<a class="block-cta__cta block-cta__cta--secondary" href="${secondaryHref}">${secondaryLabel}</a>`
    : '';
  const bodyHtml = body ? `<p class="block-cta__body">${body}</p>` : '';
  return `<section class="${wrapClass}" style="${wrapStyle}"><div class="block-cta__inner"><h2 class="block-cta__heading">${heading}</h2>${bodyHtml}<div class="block-cta__ctas">${primaryCta}${secondaryCta}</div></div></section>`;
}

interface FooterNavLink {
  label: string;
  href: string;
}

function renderFooter(block: BlockNode): string {
  const c = block.content;
  const logoText = escapeHtml(c.logoText ?? '');
  const copyright = escapeHtml(c.copyright ?? '');
  const rawLinks = Array.isArray(c.navLinks) ? (c.navLinks as unknown[]) : [];
  const linksHtml = rawLinks
    .map((entry) => {
      if (!entry || typeof entry !== 'object') return '';
      const link = entry as Partial<FooterNavLink>;
      const label = escapeHtml(link.label ?? '');
      const href = escapeHtml(safeHref(link.href));
      if (!label) return '';
      return `<a class="block-footer__nav-link" href="${href}">${label}</a>`;
    })
    .filter((s) => s !== '')
    .join('');
  const wrapStyle = blockWrapperStyle(block.style, 'dark', 'center');
  const wrapClass = `block block-footer${hideOnMobileClass(block.style.hideOnMobile)}`;
  const navHtml = linksHtml ? `<nav class="block-footer__nav" aria-label="Footer">${linksHtml}</nav>` : '';
  const logoHtml = logoText ? `<div class="block-footer__logo">${logoText}</div>` : '';
  const copyHtml = copyright ? `<p class="block-footer__copyright">${copyright}</p>` : '';
  return `<footer class="${wrapClass}" style="${wrapStyle}"><div class="block-footer__inner">${logoHtml}${navHtml}${copyHtml}</div></footer>`;
}

// ─── renderBlock — switch on type ─────────────────────────────────────────────

export function renderBlock(block: BlockNode): string {
  switch (block.type) {
    case 'hero':
      return renderHero(block);
    case 'cta':
      return renderCta(block);
    case 'footer':
      return renderFooter(block);
    // Plans 15-05/06/07 ADD their case names here:
    //   15-05: faq, pricing, testimonial, feature-grid, image-text
    //   15-06: calendly, youtube, tally
    //   15-07: lead-form
    default:
      return '';
  }
}

// ─── renderSeoHead — SEO seam (STUB) ──────────────────────────────────────────

export interface RenderSeoHeadOpts {
  pageTitle: string;
  pageDescription: string;
  canonicalUrl: string;
  ogImage: string;
  jsonLd?: string;
  siteSettings?: {
    site_name?: string;
    default_description?: string;
    favicon_url?: string;
    default_og_image?: string;
  };
}

/**
 * SEO-head SEAM. THIS plan ships the minimal STUB body below — 15-08
 * REPLACES the body (NOT the signature, NOT the function name) with the
 * full SEO cascade (description, og:*, canonical, favicon, JSON-LD), using
 * `opts.siteSettings` for site-wide defaults that per-page overrides
 * cascade over.
 *
 * The seam contract — the function name `renderSeoHead`, the `opts` shape,
 * and the `<head>`-INNER return string (no opening/closing `<head>` tag) —
 * is fixed. Do NOT rename to anything else (e.g. a short `render-head`).
 */
export function renderSeoHead(opts: RenderSeoHeadOpts): string {
  // SEO seam — 15-08 replaces this body with the full SEO cascade
  // (description, og:*, canonical, favicon, JSON-LD, site_settings defaults).
  const title = escapeHtml(opts.pageTitle);
  return [
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${title}</title>`,
    // UI-SPEC Performance Contract — Geist + Fraunces preloaded
    '<link rel="preload" as="style" href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700&display=swap">',
    '<link rel="preload" as="style" href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght,SOFT@9..144,400;9..144,500&display=swap">',
  ].join('');
}

// ─── renderPage — full document ────────────────────────────────────────────────

export function renderPage(page: RenderPageInput): string {
  const seo: PageSeo = page.seo ?? {};
  const pageTitle = (seo.title && seo.title.trim() !== '') ? seo.title : page.slug;
  const canonical = (seo.canonical && seo.canonical.trim() !== '') ? seo.canonical : `/${page.slug}`;
  const head = renderSeoHead({
    pageTitle,
    pageDescription: seo.description ?? '',
    canonicalUrl: canonical,
    ogImage: seo.ogImage ?? '',
  });
  const roots = (page.blocks ?? [])
    .filter((b) => b.parent_id === null)
    .slice()
    .sort((a, b) => a.order - b.order);
  const bodyHtml = roots.map(renderBlock).join('');
  // Minimal hide-on-mobile rule + reset, inlined to avoid an external stylesheet.
  const inlineStyle =
    '<style>html,body{margin:0;padding:0;font-family:Geist,system-ui,-apple-system,Segoe UI,sans-serif;color:var(--color-text,#1b2724);background:var(--color-bg,#f2ede0);}@media (max-width:767px){.hide-on-mobile{display:none !important;}}</style>';
  return `<!doctype html><html lang="en"><head>${head}${inlineStyle}</head><body>${bodyHtml}</body></html>`;
}

// ─── renderNotFound ────────────────────────────────────────────────────────────

export function renderNotFound(): string {
  // EXACT copy from 15-UI-SPEC.md Copywriting Contract — published-pages 404 row.
  const body = 'Page not found. It may have been moved or removed.';
  const head = renderSeoHead({
    pageTitle: 'Page not found',
    pageDescription: '',
    canonicalUrl: '',
    ogImage: '',
  });
  const inlineStyle =
    '<style>html,body{margin:0;padding:0;font-family:Geist,system-ui,-apple-system,sans-serif;color:var(--color-text,#1b2724);background:var(--color-bg,#f2ede0);}.notfound{min-height:60vh;display:flex;align-items:center;justify-content:center;padding:48px 16px;text-align:center;font-size:16px;}</style>';
  return `<!doctype html><html lang="en"><head>${head}${inlineStyle}</head><body><main class="notfound" role="main">${body}</main></body></html>`;
}
