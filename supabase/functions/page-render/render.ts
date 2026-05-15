// 15-06: import the 3 embed iframe-HTML builders from the PURE embed-src
// module. The file is dependency-free TypeScript (no DOM, no Deno.*, no
// React) so Deno resolves it via this relative path with no further setup.
// The iframe-HTML factoring is MANDATORY here — no <iframe> template literal
// stays in render.ts (BLOCKER 2 fix from 15-06-PLAN.md).
import {
  buildCalendlyIframeHtml,
  buildTallyIframeHtml,
  buildYouTubeIframeHtml,
} from '../../../leanshot/src/lib/page-builder/embed-src.ts';

// 15-08: import the SHARED HTML / attribute escapers + JSON-LD generator.
// `escape-html.ts` is a pure dependency-free module — the same logic is
// MIRRORED locally as `escapeHtml(...)` below to preserve the 15-03 contract,
// and `escapeAttr` is the attribute-context-safe variant used by the SEO
// head injection (T-15-08-02). `json-ld.ts` is the auto-generator (D-16); it
// returns a `<`-escaped JSON string that cannot terminate a `<script>` tag
// (T-15-08-01).
import { escapeAttr as escapeAttrShared } from '../../../leanshot/src/lib/page-builder/escape-html.ts';
import { generateJsonLd, type SchemaType } from '../../../leanshot/src/lib/page-builder/json-ld.ts';

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

// 15-08: global `site_settings` row shape (per migration 05). The renderer
// cascades per-page SEO over these defaults (per-page → site_settings →
// safe fallback).
export interface SiteSettingsRow {
  site_name?: string;
  default_description?: string;
  favicon_url?: string;
  default_og_image?: string;
}

export interface RenderPageInput {
  slug: string;
  seo?: PageSeo;
  blocks: BlockNode[];
  // 15-08: optional site_settings row threaded through to renderSeoHead.
  // Optional so render.test.ts's existing fixtures (which don't pass it)
  // continue to type-check; the index.ts dispatcher fetches the singleton
  // row and passes it in production. `pageTitle` defaults to the slug when
  // both per-page seo.title AND page.title are empty.
  siteSettings?: SiteSettingsRow;
  // 15-08: page title (column `landing_pages.title`) — separate from
  // seo.title, used as the cascade fallback for `<title>` when seo.title
  // is blank. Optional for the same back-compat reason as siteSettings.
  title?: string;
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

/**
 * 15-08: attribute-context-safe variant of `escapeHtml`. Additionally escapes
 * `"` and `'` so a user value cannot terminate a double-quoted HTML attribute.
 * Delegates to the shared `escape-html.ts` module — the same string Logic that
 * the browser editor uses (so a payload that the editor preview thinks is safe
 * is also safe in the served HTML).
 */
export function escapeAttr(value: unknown): string {
  return escapeAttrShared(value);
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

// ─── 15-05 block renderers ─────────────────────────────────────────────────────
//
// The five branches below mirror the same shape as renderHero / renderCta /
// renderFooter above: narrow `block.content` to the per-type interface
// declared in 15-05-PLAN.md `<interfaces>`, escape every interpolated value
// via `escapeHtml`, route hrefs through `safeHref`, and assemble the section
// wrapper via `blockWrapperStyle` + `hideOnMobileClass`. The grouped block
// keeps the new cases co-located so future plans (15-06 embeds, 15-07
// lead-form) extend at the obvious seam below the group.

interface FaqItem {
  q: string;
  a: string;
}

function renderFaq(block: BlockNode): string {
  const c = block.content;
  const heading = escapeHtml(c.heading ?? '');
  const eyebrow = c.eyebrow ? escapeHtml(c.eyebrow) : '';
  const rawItems = Array.isArray(c.items) ? (c.items as unknown[]) : [];
  const itemsHtml = rawItems
    .map((entry, i) => {
      if (!entry || typeof entry !== 'object') return '';
      const item = entry as Partial<FaqItem>;
      const q = escapeHtml(item.q ?? '');
      const a = escapeHtml(item.a ?? '');
      if (!q) return '';
      const panelId = `faq-${escapeHtml(block.id)}-${i}`;
      return (
        `<div class="block-faq__item">` +
        `<button class="block-faq__trigger" type="button" aria-expanded="false" aria-controls="${panelId}">` +
        `<span class="block-faq__q">${q}</span>` +
        `<span class="block-faq__chevron" aria-hidden="true">▾</span>` +
        `</button>` +
        `<div class="block-faq__panel" role="region" id="${panelId}"><p class="block-faq__a">${a}</p></div>` +
        `</div>`
      );
    })
    .filter((s) => s !== '')
    .join('');
  const wrapStyle = blockWrapperStyle(block.style, 'default', 'left');
  const wrapClass = `block block-faq${hideOnMobileClass(block.style.hideOnMobile)}`;
  const eyebrowHtml = eyebrow ? `<p class="block-faq__eyebrow">${eyebrow}</p>` : '';
  return `<section class="${wrapClass}" style="${wrapStyle}"><div class="block-faq__inner">${eyebrowHtml}<h2 class="block-faq__heading">${heading}</h2><div class="block-faq__items">${itemsHtml}</div></div></section>`;
}

interface PricingPlan {
  name: string;
  price: string;
  cadence: string;
  features: string[];
  ctaLabel: string;
  recommended?: boolean;
}

function renderPricing(block: BlockNode): string {
  const c = block.content;
  const heading = escapeHtml(c.heading ?? '');
  const eyebrow = c.eyebrow ? escapeHtml(c.eyebrow) : '';
  const rawPlans = Array.isArray(c.plans) ? (c.plans as unknown[]) : [];
  const plansHtml = rawPlans
    .map((entry) => {
      if (!entry || typeof entry !== 'object') return '';
      const plan = entry as Partial<PricingPlan>;
      const name = escapeHtml(plan.name ?? '');
      const price = escapeHtml(plan.price ?? '');
      const cadence = escapeHtml(plan.cadence ?? '');
      const ctaLabel = escapeHtml(plan.ctaLabel ?? '');
      const recommended = plan.recommended === true;
      const features = Array.isArray(plan.features) ? (plan.features as unknown[]) : [];
      const featuresHtml = features
        .map((f) => {
          const text = escapeHtml(f ?? '');
          if (!text) return '';
          return `<li class="block-pricing__feature"><span class="block-pricing__check" aria-hidden="true" style="color:var(--color-success);">✓</span><span>${text}</span></li>`;
        })
        .filter((s) => s !== '')
        .join('');
      const planClass = recommended
        ? 'block-pricing__plan block-pricing__plan--recommended'
        : 'block-pricing__plan';
      const planStyle = recommended
        ? 'border:2px solid var(--color-primary);box-shadow:0 0 0 4px var(--color-primary-soft);'
        : 'border:1px solid var(--color-border);';
      // CTA aria-label includes the plan name so screen-reader users hear which plan they're starting.
      const ariaLabel = ctaLabel && name ? `${ctaLabel} — ${name}` : (ctaLabel || `Get started — ${name}`);
      const ctaHtml = ctaLabel
        ? `<button type="button" class="block-pricing__cta" aria-label="${ariaLabel}" style="background:var(--color-primary);color:var(--color-primary-foreground);">${ctaLabel}</button>`
        : '';
      return (
        `<div class="${planClass}" style="${planStyle}">` +
        (name ? `<p class="block-pricing__name">${name}</p>` : '') +
        `<p class="block-pricing__price" style="font-family:Geist Mono,ui-monospace,SFMono-Regular,Menlo,monospace;">` +
        `<span class="block-pricing__amount">${price}</span>` +
        `<span class="block-pricing__cadence">${cadence}</span>` +
        `</p>` +
        (featuresHtml ? `<ul class="block-pricing__features">${featuresHtml}</ul>` : '') +
        ctaHtml +
        `</div>`
      );
    })
    .filter((s) => s !== '')
    .join('');
  const wrapStyle = blockWrapperStyle(block.style, 'default', 'center');
  const wrapClass = `block block-pricing${hideOnMobileClass(block.style.hideOnMobile)}`;
  const eyebrowHtml = eyebrow ? `<p class="block-pricing__eyebrow">${eyebrow}</p>` : '';
  return `<section class="${wrapClass}" style="${wrapStyle}"><div class="block-pricing__inner">${eyebrowHtml}<h2 class="block-pricing__heading">${heading}</h2><div class="block-pricing__plans">${plansHtml}</div></div></section>`;
}

interface TestimonialQuote {
  quote: string;
  authorName: string;
  authorPhotoUrl?: string;
  authorPhotoAlt?: string;
}

function renderTestimonial(block: BlockNode): string {
  const c = block.content;
  const heading = c.heading ? escapeHtml(c.heading) : '';
  const eyebrow = c.eyebrow ? escapeHtml(c.eyebrow) : '';
  const rawQuotes = Array.isArray(c.quotes) ? (c.quotes as unknown[]) : [];
  const quotesHtml = rawQuotes
    .map((entry) => {
      if (!entry || typeof entry !== 'object') return '';
      const q = entry as Partial<TestimonialQuote>;
      const quoteText = escapeHtml(q.quote ?? '');
      const authorName = escapeHtml(q.authorName ?? '');
      if (!quoteText) return '';
      // <img> ONLY when both URL is present AND alt is non-empty (a11y gate).
      const photoUrl = typeof q.authorPhotoUrl === 'string' ? q.authorPhotoUrl.trim() : '';
      const photoAlt = typeof q.authorPhotoAlt === 'string' ? q.authorPhotoAlt.trim() : '';
      const photoHtml =
        photoUrl && photoAlt
          ? `<img class="block-testimonial__photo" src="${escapeHtml(safeHref(photoUrl))}" alt="${escapeHtml(photoAlt)}" width="48" height="48" style="border-radius:9999px;width:48px;height:48px;object-fit:cover;">`
          : '';
      return (
        `<figure class="block-testimonial__item">` +
        `<blockquote class="block-testimonial__quote" style="font-family:Fraunces,Georgia,serif;font-style:italic;font-size:22px;line-height:1.4;margin:0;">${quoteText}</blockquote>` +
        `<figcaption class="block-testimonial__author">${photoHtml}<span class="block-testimonial__author-name">${authorName}</span></figcaption>` +
        `</figure>`
      );
    })
    .filter((s) => s !== '')
    .join('');
  const wrapStyle = blockWrapperStyle(block.style, 'default', 'center');
  const wrapClass = `block block-testimonial${hideOnMobileClass(block.style.hideOnMobile)}`;
  const eyebrowHtml = eyebrow ? `<p class="block-testimonial__eyebrow">${eyebrow}</p>` : '';
  const headingHtml = heading ? `<h2 class="block-testimonial__heading">${heading}</h2>` : '';
  return `<section class="${wrapClass}" style="${wrapStyle}"><div class="block-testimonial__inner">${eyebrowHtml}${headingHtml}<div class="block-testimonial__items">${quotesHtml}</div></div></section>`;
}

interface FeatureGridItem {
  iconName: string;
  title: string;
  body: string;
}

function renderFeatureGrid(block: BlockNode): string {
  const c = block.content;
  const heading = escapeHtml(c.heading ?? '');
  const eyebrow = c.eyebrow ? escapeHtml(c.eyebrow) : '';
  const rawFeatures = Array.isArray(c.features) ? (c.features as unknown[]) : [];
  const featuresHtml = rawFeatures
    .map((entry) => {
      if (!entry || typeof entry !== 'object') return '';
      const f = entry as Partial<FeatureGridItem>;
      const title = escapeHtml(f.title ?? '');
      const body = escapeHtml(f.body ?? '');
      const iconName = escapeHtml(f.iconName ?? '');
      if (!title && !body) return '';
      // Icon: rendered as a glyph wrapper class (lucide-* class hook). The
      // published page ships zero JS, so the icon visual is a CSS-driven
      // marker tag with the lucide icon name as a data attribute — Phase 15
      // does NOT ship lucide-react into the public bundle (D-17).
      const iconHtml = iconName
        ? `<span class="block-feature-grid__icon" data-icon="${iconName}" aria-hidden="true" style="color:var(--color-primary);">●</span>`
        : '';
      return (
        `<div class="block-feature-grid__card" style="border:1px solid var(--color-border);padding:24px;border-radius:12px;">` +
        iconHtml +
        (title ? `<h3 class="block-feature-grid__title">${title}</h3>` : '') +
        (body ? `<p class="block-feature-grid__body">${body}</p>` : '') +
        `</div>`
      );
    })
    .filter((s) => s !== '')
    .join('');
  const wrapStyle = blockWrapperStyle(block.style, 'default', 'center');
  const wrapClass = `block block-feature-grid${hideOnMobileClass(block.style.hideOnMobile)}`;
  const eyebrowHtml = eyebrow ? `<p class="block-feature-grid__eyebrow">${eyebrow}</p>` : '';
  // 3-col on >=1024, 2-col on >=640, 1-col on mobile — pure CSS grid.
  return `<section class="${wrapClass}" style="${wrapStyle}"><div class="block-feature-grid__inner"><div class="block-feature-grid__header">${eyebrowHtml}<h2 class="block-feature-grid__heading">${heading}</h2></div><div class="block-feature-grid__grid" style="display:grid;gap:16px;grid-template-columns:repeat(1,minmax(0,1fr));">${featuresHtml}</div></div></section>`;
}

function renderImageText(block: BlockNode): string {
  const c = block.content;
  const heading = escapeHtml(c.heading ?? '');
  const body = escapeHtml(c.body ?? '');
  const rawImageAlt = typeof c.imageAlt === 'string' ? c.imageAlt.trim() : '';
  const rawImageUrl = typeof c.imageUrl === 'string' ? c.imageUrl.trim() : '';
  // a11y gate: omit <img> entirely when alt is blank (Threat T-15-05-02).
  const imgHtml =
    rawImageAlt && rawImageUrl
      ? `<img class="block-image-text__img" src="${escapeHtml(safeHref(rawImageUrl))}" alt="${escapeHtml(rawImageAlt)}" width="600" height="400" style="width:100%;height:auto;max-width:600px;aspect-ratio:3/2;object-fit:cover;border-radius:12px;">`
      : '';
  const textHtml =
    `<div class="block-image-text__text">` +
    (heading ? `<h2 class="block-image-text__heading">${heading}</h2>` : '') +
    (body ? `<p class="block-image-text__body">${body}</p>` : '') +
    `</div>`;
  // alignment controls image position: 'left' (default) = image before text;
  // 'right' = image after text. 'center' falls back to image-left.
  const align = block.style.alignment ?? 'left';
  const orderedHtml = align === 'right' ? `${textHtml}${imgHtml}` : `${imgHtml}${textHtml}`;
  const wrapStyle = blockWrapperStyle(block.style, 'default', 'left');
  const wrapClass = `block block-image-text${hideOnMobileClass(block.style.hideOnMobile)}`;
  return `<section class="${wrapClass}" style="${wrapStyle}"><div class="block-image-text__inner" style="display:grid;gap:32px;grid-template-columns:1fr;">${orderedHtml}</div></section>`;
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
    // 15-05: five new core landing-page block branches.
    case 'faq':
      return renderFaq(block);
    case 'pricing':
      return renderPricing(block);
    case 'testimonial':
      return renderTestimonial(block);
    case 'feature-grid':
      return renderFeatureGrid(block);
    case 'image-text':
      return renderImageText(block);
    // 15-06: three embed-provider branches. Each branch is a thin wrapper —
    // it narrows block.content to the per-type shape and CALLS the matching
    // iframe-HTML helper from embed-src.ts. NO <iframe ...> template literal
    // is assembled here; the iframe-HTML factoring is the BLOCKER 2 fix.
    case 'youtube':
      // embed-youtube
      return renderEmbedYouTube(block);
    case 'calendly':
      // embed-calendly
      return renderEmbedCalendly(block);
    case 'tally':
      // embed-tally
      return renderEmbedTally(block);
    // 15-07: native lead-form block (D-12) — emits a semantic <form> with a
    // hidden honeypot field + small inline submit script that POSTs to the
    // `lead-capture` Edge Function. Markup contract documented in
    // 15-07-PLAN.md `<interfaces>`.
    case 'lead-form':
      return renderLeadForm(block);
    default:
      return '';
  }
}

// ─── 15-06 embed renderers — thin wrappers around embed-src helpers ───────────
//
// Each renderer:
//   1. Narrows block.content to the matching <embed_content_shapes> shape
//      with defensive type coercion (BlockNode.content is Record<string,
//      unknown>; the JSONB store can hand us anything).
//   2. Calls the matching buildXIframeHtml helper from embed-src.ts. The
//      helper returns either a complete <iframe>-wrapped HTML string or ''
//      (safe non-iframe fallback when input is invalid).
//   3. Wraps the result in the renderer's existing block-section wrapper
//      (backgroundTone + spacingDensity + hide-on-mobile).
//
// NO <iframe ...> template literal lives in this file — the entire iframe
// HTML comes from embed-src.ts. The iframe `src` therefore comes ONLY from
// the validated builder output; no raw content values are string-concatenated
// into HTML here.

function renderEmbedYouTube(block: BlockNode): string {
  const c = block.content;
  const html = buildYouTubeIframeHtml({
    videoId: typeof c.videoId === 'string' ? c.videoId : '',
    startSeconds:
      typeof c.startSeconds === 'number' && Number.isFinite(c.startSeconds) ? c.startSeconds : 0,
    autoplay: c.autoplay === true,
  });
  const wrapStyle = blockWrapperStyle(block.style, 'default', 'center');
  const wrapClass = `block block-yt-wrap${hideOnMobileClass(block.style.hideOnMobile)}`;
  return `<section class="${wrapClass}" style="${wrapStyle}"><div class="block-yt-wrap__inner">${html}</div></section>`;
}

function renderEmbedCalendly(block: BlockNode): string {
  const c = block.content;
  const html = buildCalendlyIframeHtml({
    calendlyUrl: typeof c.calendlyUrl === 'string' ? c.calendlyUrl : '',
    prefillEmail: c.prefillEmail === true,
  });
  const wrapStyle = blockWrapperStyle(block.style, 'default', 'center');
  const wrapClass = `block block-cal-wrap${hideOnMobileClass(block.style.hideOnMobile)}`;
  return `<section class="${wrapClass}" style="${wrapStyle}"><div class="block-cal-wrap__inner">${html}</div></section>`;
}

function renderEmbedTally(block: BlockNode): string {
  const c = block.content;
  const html = buildTallyIframeHtml({
    tallyFormUrl: typeof c.tallyFormUrl === 'string' ? c.tallyFormUrl : '',
    hideTitle: c.hideTitle === true,
  });
  const wrapStyle = blockWrapperStyle(block.style, 'default', 'center');
  const wrapClass = `block block-tally-wrap${hideOnMobileClass(block.style.hideOnMobile)}`;
  return `<section class="${wrapClass}" style="${wrapStyle}"><div class="block-tally-wrap__inner">${html}</div></section>`;
}

// ─── 15-07 native lead-form renderer ──────────────────────────────────────────
//
// Emits a semantic <form> with:
//   - <label for> + <input type="email" name="email" required> (HTML5 native
//     validation per UI-SPEC).
//   - Optional <label> + <input name="name"> when content.collectName.
//   - HONEYPOT: <input name="website"> wrapped in an offscreen div
//     (position:absolute;left:-9999px + aria-hidden + tabindex=-1 +
//     autocomplete=off). NOT display:none — must remain in the submitted
//     FormData. Per UI-SPEC.
//   - Submit <button type="submit"> with content.buttonLabel.
//   - Inline success region (role="status", data-lead-success).
//   - Inline error region (role="alert", data-lead-error).
//   - data-lead-form marker + data-lead-capture-url pointing at the function
//     path + data-success-message attribute for the inline script.
//   - Minimal inline <script> performing the fetch POST + status toggle
//     (≤25 lines, no external deps). Inline-only — the published page ships
//     zero external JS (D-17).
//
// T-15-LF-01: every content string passes through escapeHtml before
// interpolation; successMessage is escaped as an attribute value.
// T-15-LF-03: honeypot field is in-DOM but visually offscreen.

function renderLeadForm(block: BlockNode): string {
  const c = block.content;
  const heading = escapeHtml(c.heading ?? '');
  const description = c.description ? escapeHtml(c.description) : '';
  const buttonLabel = escapeHtml(c.buttonLabel ?? 'Send me access');
  const successMessage = escapeHtml(c.successMessage ?? '');
  const collectName = c.collectName === true;

  const formIdSafe = escapeHtml(block.id);
  const emailId = `lead-${formIdSafe}-email`;
  const nameId = `lead-${formIdSafe}-name`;
  const successId = `lead-${formIdSafe}-success`;
  const errorId = `lead-${formIdSafe}-error`;
  const captureUrl = '/functions/v1/lead-capture/submit';

  const headingHtml = heading
    ? `<h2 class="block-lead-form__heading" style="font-family:Geist,system-ui,sans-serif;font-size:22px;font-weight:600;line-height:1.3;margin:0 0 8px 0;">${heading}</h2>`
    : '';
  const descriptionHtml = description
    ? `<p class="block-lead-form__description" style="margin:0 0 24px 0;font-size:16px;line-height:1.55;">${description}</p>`
    : '';
  const nameFieldHtml = collectName
    ? `<label class="block-lead-form__label" for="${nameId}" style="display:block;margin-bottom:12px;">` +
      `<span class="block-lead-form__label-text" style="display:block;font-size:14px;font-weight:500;margin-bottom:4px;">Name</span>` +
      `<input id="${nameId}" name="name" type="text" placeholder="Your name" autocomplete="name" style="width:100%;padding:8px 12px;border:1px solid var(--color-border,#d4d4d8);border-radius:8px;font-size:16px;">` +
      `</label>`
    : '';

  const innerForm =
    `<form class="block-lead-form__form" novalidate ` +
    `data-lead-form="1" ` +
    `data-lead-capture-url="${captureUrl}" ` +
    `data-success-message="${successMessage}" ` +
    `style="max-width:480px;margin:0 auto;text-align:left;">` +
    headingHtml +
    descriptionHtml +
    nameFieldHtml +
    `<label class="block-lead-form__label" for="${emailId}" style="display:block;margin-bottom:12px;">` +
    `<span class="block-lead-form__label-text" style="display:block;font-size:14px;font-weight:500;margin-bottom:4px;">Email</span>` +
    `<input id="${emailId}" name="email" type="email" required placeholder="your@email.com" autocomplete="email" style="width:100%;padding:8px 12px;border:1px solid var(--color-border,#d4d4d8);border-radius:8px;font-size:16px;">` +
    `</label>` +
    // HONEYPOT — present in DOM, visually offscreen (T-15-LF-03). NOT display:none.
    `<div aria-hidden="true" style="position:absolute;left:-9999px;width:1px;height:1px;overflow:hidden;">` +
    `<label for="lead-${formIdSafe}-website">Website</label>` +
    `<input id="lead-${formIdSafe}-website" name="website" type="text" tabindex="-1" autocomplete="off" aria-hidden="true">` +
    `</div>` +
    `<button type="submit" class="block-lead-form__submit" style="width:100%;margin-top:8px;padding:12px 24px;border-radius:9999px;border:0;background:var(--color-primary,#1e293b);color:var(--color-primary-foreground,#fafafa);font-size:16px;font-weight:500;cursor:pointer;">${buttonLabel}</button>` +
    `<div id="${successId}" data-lead-success="1" role="status" aria-live="polite" hidden style="margin-top:16px;padding:12px;border-radius:8px;background:var(--color-success-soft,#dcfce7);color:var(--color-success,#166534);"></div>` +
    `<div id="${errorId}" data-lead-error="1" role="alert" aria-live="assertive" hidden style="margin-top:16px;padding:12px;border-radius:8px;background:var(--color-danger-soft,#fee2e2);color:var(--color-danger,#991b1b);"></div>` +
    `</form>`;

  // Inline submit script — ≤25 lines, no external deps. Per-form scope via the
  // form's data-lead-form attribute. Idempotent: the script binds on first load
  // and the IIFE drops out if re-injected.
  const inlineScript =
    `<script>(function(){var f=document.querySelector('form[data-lead-form][data-lead-capture-url="${captureUrl}"]');` +
    `if(!f||f.__lcBound)return;f.__lcBound=true;` +
    `var s=f.querySelector('[data-lead-success]');var e=f.querySelector('[data-lead-error]');var btn=f.querySelector('button[type=submit]');` +
    `f.addEventListener('submit',function(ev){ev.preventDefault();if(e){e.hidden=true;e.textContent='';}` +
    `var fd=new FormData(f);var body={};fd.forEach(function(v,k){body[k]=v;});` +
    `if(btn)btn.disabled=true;` +
    `fetch(f.getAttribute('data-lead-capture-url'),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})` +
    `.then(function(r){if(r.status===429){if(e){e.textContent='Too many submissions. Please wait a few minutes and try again.';e.hidden=false;}if(btn)btn.disabled=false;return;}` +
    `if(!r.ok){if(e){e.textContent='Please enter a valid email address.';e.hidden=false;}if(btn)btn.disabled=false;return;}` +
    `if(s){s.textContent=f.getAttribute('data-success-message')||'Thanks!';s.hidden=false;}f.style.display='none';})` +
    `.catch(function(){if(e){e.textContent='Something went wrong. Please try again.';e.hidden=false;}if(btn)btn.disabled=false;});});})();</script>`;

  const wrapStyle = blockWrapperStyle(block.style, 'default', 'center');
  const wrapClass = `block block-lead-form${hideOnMobileClass(block.style.hideOnMobile)}`;
  return `<section class="${wrapClass}" style="${wrapStyle}"><div class="block-lead-form__inner" style="position:relative;">${innerForm}${inlineScript}</div></section>`;
}

// ─── renderSeoHead — SEO seam (STUB) ──────────────────────────────────────────

export interface RenderSeoHeadOpts {
  pageTitle: string;
  pageDescription: string;
  canonicalUrl: string;
  ogImage: string;
  /**
   * Optional pre-built JSON-LD string. Reserved for future plans (Phase 16+)
   * that may inject schema-org overrides. 15-08 ignores this field and
   * ALWAYS auto-generates JSON-LD from `blocks + schemaType` via D-16.
   */
  jsonLd?: string;
  /**
   * 15-08 cascade input. The per-page SEO column ("title" / "description" /
   * "ogImage") wins when set. Otherwise `siteSettings` defaults fill in.
   * When BOTH are blank, a safe minimal fallback is used (no description
   * meta emitted, no og:image emitted — the renderer never invents data).
   */
  siteSettings?: SiteSettingsRow;
  /** 15-08 — blocks tree used to auto-generate JSON-LD. */
  blocks?: BlockNode[];
  /** 15-08 — JSON-LD schema type. Defaults to 'WebPage' when blank. */
  schemaType?: string;
}

/**
 * 15-08: SEO-head injection.
 *
 * Emits the full `<head>`-inner string for a published page. Every user
 * value is routed through `escapeHtml` (text-node context) or `escapeAttr`
 * (attribute context) — see the threat-model T-15-08-02 row.
 *
 * Cascade rule: per-page SEO field → site_settings default → safe fallback.
 *
 *   <title>          = (seo.title || page.title || slug) — page.title is
 *                       passed in as opts.pageTitle by renderPage.
 *                       Suffix " — {site_name}" appended when site_name is
 *                       set.
 *   <meta name=description>
 *                     = seo.description ?? site_settings.default_description
 *   <meta name=og:image>
 *                     = seo.ogImage ?? site_settings.default_og_image
 *   <link rel=canonical>
 *                     = seo.canonical || `${PUBLIC_MARKETING_ORIGIN}/${slug}`
 *                       — the canonical URL is precomputed by renderPage and
 *                       arrives as opts.canonicalUrl already populated.
 *   <link rel=icon>
 *                     = site_settings.favicon_url (only emitted when present)
 *   <script type=application/ld+json>
 *                     = generateJsonLd({ blocks, title, description, url,
 *                       schemaType }) — auto-generated from the block tree.
 *                       The output string is `<`-escaped so it can NEVER
 *                       terminate the `<script>` tag (T-15-08-01).
 */
export function renderSeoHead(opts: RenderSeoHeadOpts): string {
  const ss = opts.siteSettings ?? {};
  const siteName = (ss.site_name ?? '').trim();
  const titleRaw = opts.pageTitle ?? '';
  const titleWithSite = siteName !== '' ? `${titleRaw} — ${siteName}` : titleRaw;
  const titleHtml = escapeHtml(titleWithSite);

  const description = opts.pageDescription && opts.pageDescription.trim() !== ''
    ? opts.pageDescription
    : (ss.default_description ?? '');
  const descriptionAttr = escapeAttr(description);

  const ogImageRaw = opts.ogImage && opts.ogImage.trim() !== ''
    ? opts.ogImage
    : (ss.default_og_image ?? '');
  const ogImageAttr = escapeAttr(ogImageRaw);

  const canonicalAttr = escapeAttr(opts.canonicalUrl ?? '');
  const ogTitleAttr = escapeAttr(titleWithSite);
  const faviconAttr = escapeAttr(ss.favicon_url ?? '');

  // JSON-LD auto-generation (D-16) — the helper returns a `<`-escaped JSON
  // string so the `<script>` tag CANNOT be terminated by a `</script>` in
  // the user-authored title or FAQ items (T-15-08-01).
  const schemaTypeRaw = (opts.schemaType ?? '').trim();
  const allowedTypes: SchemaType[] = ['WebPage', 'FAQPage', 'Product', 'Article', 'Event'];
  const schemaType: SchemaType = (allowedTypes as string[]).includes(schemaTypeRaw)
    ? (schemaTypeRaw as SchemaType)
    : 'WebPage';
  const jsonLd = generateJsonLd({
    blocks: opts.blocks ?? [],
    title: titleRaw,
    description,
    url: opts.canonicalUrl ?? '',
    schemaType,
  });

  const parts: string[] = [
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${titleHtml}</title>`,
  ];
  if (description !== '') {
    parts.push(`<meta name="description" content="${descriptionAttr}">`);
  }
  if (canonicalAttr !== '') {
    parts.push(`<link rel="canonical" href="${canonicalAttr}">`);
  }
  // OpenGraph tags — emitted on every page; og:type defaults to 'website'.
  parts.push(`<meta property="og:title" content="${ogTitleAttr}">`);
  if (description !== '') {
    parts.push(`<meta property="og:description" content="${descriptionAttr}">`);
  }
  parts.push('<meta property="og:type" content="website">');
  if (canonicalAttr !== '') {
    parts.push(`<meta property="og:url" content="${canonicalAttr}">`);
  }
  if (ogImageRaw !== '') {
    parts.push(`<meta property="og:image" content="${ogImageAttr}">`);
  }
  // Twitter card — pairs with og:* so the page gets a large preview card.
  parts.push('<meta name="twitter:card" content="summary_large_image">');
  // Favicon — only when site_settings has set it.
  if ((ss.favicon_url ?? '').trim() !== '') {
    parts.push(`<link rel="icon" href="${faviconAttr}">`);
  }
  // Performance: keep the Geist + Fraunces preloads from 15-03 (UI-SPEC
  // Performance Contract — fonts must be discoverable in the initial HTML).
  parts.push(
    '<link rel="preload" as="style" href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700&display=swap">',
  );
  parts.push(
    '<link rel="preload" as="style" href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght,SOFT@9..144,400;9..144,500&display=swap">',
  );
  // JSON-LD <script>. The body is pre-escaped — direct interpolation safe.
  parts.push(`<script type="application/ld+json">${jsonLd}</script>`);

  return parts.join('');
}

// ─── renderPage — full document ────────────────────────────────────────────────

export function renderPage(page: RenderPageInput): string {
  const seo: PageSeo = page.seo ?? {};
  // 15-08 cascade: per-page seo.title → landing_pages.title (page.title) →
  // slug as last-resort fallback. page.title is threaded through from
  // index.ts so the slug only surfaces when both are blank.
  const pageTitle = (seo.title && seo.title.trim() !== '')
    ? seo.title
    : (page.title && page.title.trim() !== '' ? page.title : page.slug);
  const canonical = (seo.canonical && seo.canonical.trim() !== '') ? seo.canonical : `/${page.slug}`;
  const head = renderSeoHead({
    pageTitle,
    pageDescription: seo.description ?? '',
    canonicalUrl: canonical,
    ogImage: seo.ogImage ?? '',
    siteSettings: page.siteSettings,
    blocks: page.blocks ?? [],
    schemaType: seo.schemaType,
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
