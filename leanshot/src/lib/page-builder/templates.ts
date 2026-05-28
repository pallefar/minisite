/**
 * Phase 15 Plan 09 — code-defined template catalog + scaffold helper.
 *
 * D-14 contract:
 *   • TEMPLATES is the in-code catalog of 5 starter page templates. There is
 *     no template-instance link after scaffolding — selecting a template
 *     deep-copies its blocks into the new page. Subsequent edits NEVER
 *     touch the source TEMPLATES entry, and updating a template here does
 *     NOT propagate to previously-scaffolded pages.
 *   • scaffoldFromTemplate() is the deep-copy gate: it structuredClone()s
 *     the blocks, regenerates every id (so two scaffolds from the same
 *     template never collide), and re-maps every non-null parent_id
 *     through the new-id table so the topology references the NEW ids,
 *     not the source ids.
 *
 * Constraints:
 *   - Pure, side-effect-free module (mirror src/lib/insights.ts discipline).
 *     No DOM, no store access, no runtime imports beyond block-schema.
 *   - Block-style values are token-bounded (D-05): only the BlockStyle
 *     union members from block-schema.ts are used.
 *
 * SchemaType note: 15-08 ships src/lib/page-builder/json-ld.ts which will
 * own this type. Until that file lands, we declare a local mirror with a
 * TODO comment for parallel-wave tolerance. Re-importing once 15-08 lands
 * is a single-line change.
 */
import type { BlockNode, BlockType } from './block-schema';

// TODO: re-import from json-ld.ts once 15-08 lands.
export type SchemaType = 'WebPage' | 'FAQPage' | 'Product' | 'Article' | 'Event';

export type TemplateId =
  | 'long-form-sales'
  | 'lead-magnet'
  | 'comparison'
  | 'faq'
  | 'testimonial'
  // Phase 19 — 3 affiliate co-branded landing-page variants (UI-SPEC §"/r/{code}"
  // lines 212-256). These extend the Phase 15 catalog with the same `Template`
  // shape but carry a non-`affiliate`-empty `category` so callers can filter.
  | 'coach'
  | 'story'
  | 'method';

/** Top-level grouping. Phase 15 templates default to `'page'`; Phase 19
 * adds `'affiliate'` for the 3 co-branded /r/{code} variants. */
export type TemplateCategory = 'page' | 'affiliate';

export interface Template {
  id: TemplateId;
  name: string;
  description: string;
  /** Path to a thumbnail image under /assets/page-templates/<id>.webp. */
  thumbnail: string;
  /** Default JSON-LD type for the page when scaffolded from this template. */
  seoSchemaType: SchemaType;
  /** Phase 19 — distinguishes affiliate templates from generic page templates. */
  category: TemplateCategory;
  blocks: BlockNode[];
}

// ---------------------------------------------------------------------------
// id generation
// ---------------------------------------------------------------------------

/**
 * Generate a short, sufficiently-unique block id. Block ids are scoped to a
 * single revision so global uniqueness is not required — we just need
 * collision-resistance within ~100 blocks per page. `crypto.randomUUID()`
 * is available in every supported runtime (browser + Deno + Node 19+);
 * slice(0, 8) gives us 8 hex chars (matches nanoid(8) convention used by
 * 15-03's block-schema doc string).
 */
function newBlockId(): string {
  return crypto.randomUUID().slice(0, 8);
}

// ---------------------------------------------------------------------------
// Block helpers (compact authoring sugar — keeps the catalog readable)
// ---------------------------------------------------------------------------

interface BlockSpec {
  type: BlockType;
  parentKey?: string; // authoring-only — re-mapped to a real id below
  key?: string; // authoring-only — referenced by parentKey
  content?: Record<string, unknown>;
  style?: BlockNode['style'];
}

/**
 * Build a BlockNode[] from a compact spec list. Authoring `key` values are
 * NEVER stored on the resulting BlockNodes — they exist only so that the
 * template author can wire parent_id references by name. The compiled
 * BlockNodes carry real ids generated here.
 */
function compile(specs: BlockSpec[]): BlockNode[] {
  // Pass 1: build id table keyed by authoring-key (fallback: index).
  const idByKey = new Map<string, string>();
  for (let i = 0; i < specs.length; i++) {
    const spec = specs[i]!;
    const id = newBlockId();
    idByKey.set(spec.key ?? `__idx_${i}`, id);
  }

  // Pass 2: bucket by parent for per-sibling-group sequential `order`.
  const orderByParent = new Map<string | null, number>();

  return specs.map((spec, i) => {
    const id = idByKey.get(spec.key ?? `__idx_${i}`)!;
    const parent_id = spec.parentKey === undefined ? null : (idByKey.get(spec.parentKey) ?? null);
    const order = orderByParent.get(parent_id) ?? 0;
    orderByParent.set(parent_id, order + 1);
    return {
      id,
      type: spec.type,
      parent_id,
      order,
      content: spec.content ?? {},
      style: spec.style ?? {},
    };
  });
}

// ---------------------------------------------------------------------------
// 1) Long-form sales — hero + features + testimonial + pricing + CTA + footer
// ---------------------------------------------------------------------------

const LONG_FORM_SALES: BlockNode[] = compile([
  {
    type: 'hero',
    content: {
      heading: 'Build something people can’t put down',
      subheading: 'A complete starting point — edit, ship, and refine in minutes.',
      ctaLabel: 'Get started',
    },
    style: { backgroundTone: 'brand', alignment: 'center', spacingDensity: 'spacious' },
  },
  {
    type: 'feature-grid',
    content: {
      heading: 'Everything you need to launch',
      items: [
        { title: 'Fast', body: 'Pre-built blocks, ship in a day.' },
        { title: 'Flexible', body: 'Token-bounded styling, never off-brand.' },
        { title: 'Accessible', body: 'WCAG AA out of the box.' },
      ],
    },
    style: { backgroundTone: 'default', spacingDensity: 'default' },
  },
  {
    type: 'testimonial',
    content: {
      quote: 'We shipped our launch page in an afternoon and never looked back.',
      author: 'Alex Rivera',
      role: 'Founder, North Lab',
    },
    style: { backgroundTone: 'subtle', alignment: 'center', spacingDensity: 'default' },
  },
  {
    type: 'pricing',
    content: {
      heading: 'Simple pricing',
      plans: [
        { name: 'Starter', price: '$0', features: ['1 page', 'All blocks'] },
        { name: 'Pro', price: '$29', features: ['Unlimited pages', 'Priority support'] },
      ],
    },
    style: { backgroundTone: 'default', spacingDensity: 'spacious' },
  },
  {
    type: 'cta',
    content: {
      heading: 'Ready to start?',
      body: 'Join thousands who shipped faster.',
      ctaLabel: 'Get started',
    },
    style: { backgroundTone: 'brand', alignment: 'center', spacingDensity: 'default' },
  },
  {
    type: 'footer',
    content: {
      copyright: '© LeanShot. All rights reserved.',
      links: [
        { label: 'Privacy', href: '/legal/privacy' },
        { label: 'Terms', href: '/legal/terms' },
      ],
    },
    style: { backgroundTone: 'dark', spacingDensity: 'compact' },
  },
]);

// ---------------------------------------------------------------------------
// 2) Lead-magnet opt-in — hero + lead-form + footer
//    D-12: native lead-form is the conversion surface for this template.
// ---------------------------------------------------------------------------

const LEAD_MAGNET: BlockNode[] = compile([
  {
    type: 'hero',
    content: {
      heading: 'Get the free playbook',
      subheading: 'Five exercises we use on every launch. Sent straight to your inbox.',
      ctaLabel: 'Send me access',
    },
    style: { backgroundTone: 'brand', alignment: 'center', spacingDensity: 'spacious' },
  },
  {
    type: 'lead-form',
    content: {
      heading: 'Send me the playbook',
      fields: [
        { name: 'email', label: 'Email', required: true, type: 'email' },
        { name: 'name', label: 'Your name', required: false, type: 'text' },
      ],
      submitLabel: 'Send me access',
      successMessage: 'You’re on the list. Check your inbox for next steps.',
    },
    style: { backgroundTone: 'default', alignment: 'center', spacingDensity: 'default' },
  },
  {
    type: 'footer',
    content: {
      copyright: '© LeanShot. All rights reserved.',
      links: [{ label: 'Privacy', href: '/legal/privacy' }],
    },
    style: { backgroundTone: 'dark', spacingDensity: 'compact' },
  },
]);

// ---------------------------------------------------------------------------
// 3) Comparison — hero + feature-grid (side-by-side) + cta + footer
// ---------------------------------------------------------------------------

const COMPARISON: BlockNode[] = compile([
  {
    type: 'hero',
    content: {
      heading: 'See how we compare',
      subheading: 'Built for teams that ship — not enterprise checkboxes.',
      ctaLabel: 'Get started',
    },
    style: { backgroundTone: 'brand', alignment: 'center', spacingDensity: 'default' },
  },
  {
    type: 'feature-grid',
    content: {
      heading: 'What you get',
      items: [
        { title: 'Speed', body: 'Ship in hours, not weeks.' },
        { title: 'Ownership', body: 'Your data, your domain, your brand.' },
        { title: 'Transparency', body: 'Flat pricing, no quotes.' },
      ],
    },
    style: { backgroundTone: 'subtle', spacingDensity: 'default' },
  },
  {
    type: 'image-text',
    content: {
      heading: 'Built for the way you work',
      body: 'Token-bounded styling means it always matches your brand. No accidental hex.',
      imagePath: '',
      imageAlt: 'Editor screenshot',
    },
    style: { backgroundTone: 'default', alignment: 'left', spacingDensity: 'default' },
  },
  {
    type: 'cta',
    content: {
      heading: 'Try it free',
      body: 'No credit card. Cancel anytime.',
      ctaLabel: 'Get started',
    },
    style: { backgroundTone: 'brand', alignment: 'center', spacingDensity: 'default' },
  },
  {
    type: 'footer',
    content: { copyright: '© LeanShot.', links: [] },
    style: { backgroundTone: 'dark', spacingDensity: 'compact' },
  },
]);

// ---------------------------------------------------------------------------
// 4) FAQ — hero + faq (auto-generates JSON-LD FAQPage per D-16) + cta + footer
// ---------------------------------------------------------------------------

const FAQ_TEMPLATE: BlockNode[] = compile([
  {
    type: 'hero',
    content: {
      heading: 'Frequently asked questions',
      subheading: 'Everything you need to know before you start.',
      ctaLabel: 'Get started',
    },
    style: { backgroundTone: 'brand', alignment: 'center', spacingDensity: 'default' },
  },
  {
    type: 'faq',
    content: {
      heading: 'Common questions',
      items: [
        {
          q: 'How long does it take to ship a page?',
          a: 'Most teams ship their first page in under an hour.',
        },
        {
          q: 'Can I use my own domain?',
          a: 'Yes — every page is served at your custom slug.',
        },
        {
          q: 'Is there a free tier?',
          a: 'The Starter plan is free forever for one page.',
        },
      ],
    },
    style: { backgroundTone: 'default', spacingDensity: 'spacious' },
  },
  {
    type: 'cta',
    content: {
      heading: 'Still have questions?',
      body: 'We’re here to help.',
      ctaLabel: 'Get started',
    },
    style: { backgroundTone: 'subtle', alignment: 'center', spacingDensity: 'default' },
  },
  {
    type: 'footer',
    content: { copyright: '© LeanShot.', links: [] },
    style: { backgroundTone: 'dark', spacingDensity: 'compact' },
  },
]);

// ---------------------------------------------------------------------------
// 5) Testimonial-driven — hero + 3 testimonials + cta + footer
// ---------------------------------------------------------------------------

const TESTIMONIAL_TEMPLATE: BlockNode[] = compile([
  {
    type: 'hero',
    content: {
      heading: 'Loved by builders everywhere',
      subheading: 'See what teams are saying about the platform.',
      ctaLabel: 'Get started',
    },
    style: { backgroundTone: 'brand', alignment: 'center', spacingDensity: 'spacious' },
  },
  {
    type: 'testimonial',
    content: {
      quote: 'We replaced a $5k/mo agency with this in a weekend.',
      author: 'Mira Chen',
      role: 'Head of Growth, Northwind',
    },
    style: { backgroundTone: 'default', alignment: 'center', spacingDensity: 'default' },
  },
  {
    type: 'testimonial',
    content: {
      quote: 'The token-bounded styling alone is worth it — nothing’s ever off-brand.',
      author: 'Devon Park',
      role: 'Designer, Hyperdrive',
    },
    style: { backgroundTone: 'subtle', alignment: 'center', spacingDensity: 'default' },
  },
  {
    type: 'testimonial',
    content: {
      quote: 'Shipped four landing pages in the time it used to take to write one brief.',
      author: 'Sasha Lin',
      role: 'Founder, Quiet Co.',
    },
    style: { backgroundTone: 'default', alignment: 'center', spacingDensity: 'default' },
  },
  {
    type: 'cta',
    content: {
      heading: 'Join them',
      body: 'Build something your customers will love.',
      ctaLabel: 'Get started',
    },
    style: { backgroundTone: 'brand', alignment: 'center', spacingDensity: 'default' },
  },
  {
    type: 'footer',
    content: { copyright: '© LeanShot.', links: [] },
    style: { backgroundTone: 'dark', spacingDensity: 'compact' },
  },
]);

// ---------------------------------------------------------------------------
// 6) Phase 19 affiliate templates — `coach` / `story` / `method`
// ---------------------------------------------------------------------------
// Block-tree mirrors the SQL seed in
// supabase/migrations/20270101000009_affiliate_landing_template_seeds.sql.
// {{slot}} bindings (display_name, photo_path, blurb, calendly_url,
// testimonial_quote, referral_code) are substituted by the renderer at
// render time. Phase 19 affiliates do NOT use the Phase 15 editor — the
// in-code TEMPLATES entries below exist so PartnerTemplatePicker
// (Plan 19-06b) and the scaffold helper can resolve template metadata.

const COACH_TEMPLATE: BlockNode[] = compile([
  {
    type: 'hero',
    content: {
      layout: 'split',
      heading: '{{display_name}}',
      subheading: '{{blurb}}',
      ctaLabel: 'Start your free trial',
      ctaHref: '/signup?aff={{referral_code}}',
      ctaSecondaryLabel: 'Book a 1:1 with me',
      ctaSecondaryHref: '{{calendly_url}}',
      ctaSecondaryShowIf: 'calendly_url',
      leftSlot: {
        type: 'PhotoSlot',
        binding: '{{photo_path}}',
        fallback: 'InitialsAvatar',
        size: 'lg',
      },
    },
    style: { backgroundTone: 'brand', alignment: 'left', spacingDensity: 'spacious' },
  },
  {
    type: 'feature-grid',
    content: {
      heading: 'Why I recommend LeanShot',
      cols: 2,
      items: [
        { title: 'Every shot tracked', body: 'Injections, side effects, weight — one timeline.' },
        { title: 'Built-in coach', body: 'Rule-based insights + an AI coach on tap.' },
        { title: 'Doctor-share view', body: 'One-tap snapshot for clinic visits.' },
      ],
    },
    style: { backgroundTone: 'default', spacingDensity: 'default' },
  },
  {
    type: 'cta',
    content: {
      heading: 'Track your GLP-1 journey',
      body: "Free to start. Your data stays local — sync only when you're ready.",
      ctaLabel: 'Start free trial',
      ctaHref: '/signup?aff={{referral_code}}',
    },
    style: { backgroundTone: 'brand', alignment: 'center', spacingDensity: 'default' },
  },
  {
    type: 'footer',
    content: {
      fineprint: 'Referred by {{display_name}}.',
      copyright: '© LeanShot',
      links: [
        { label: 'Privacy', href: '/legal/privacy' },
        { label: 'Terms', href: '/legal/terms' },
      ],
    },
    style: { backgroundTone: 'dark', spacingDensity: 'compact' },
  },
]);

const STORY_TEMPLATE: BlockNode[] = compile([
  {
    type: 'hero',
    content: {
      layout: 'testimonial',
      quote: '{{testimonial_quote}}',
      attribution: '{{display_name}}',
      subheading: '{{blurb}}',
      ctaLabel: 'Start your free trial',
      ctaHref: '/signup?aff={{referral_code}}',
      ctaSecondaryLabel: 'Book a 1:1 with me',
      ctaSecondaryHref: '{{calendly_url}}',
      ctaSecondaryShowIf: 'calendly_url',
      attributionSlot: {
        type: 'PhotoSlot',
        binding: '{{photo_path}}',
        fallback: 'InitialsAvatar',
        size: 'md',
      },
    },
    style: { backgroundTone: 'brand', alignment: 'center', spacingDensity: 'spacious' },
  },
  {
    type: 'feature-grid',
    content: {
      heading: "What you'll track",
      cols: 3,
      items: [
        { title: 'Injections', body: 'Every shot + site rotation, automatically.' },
        { title: 'Body + mood', body: 'Weight, symptoms, sleep, food noise.' },
        { title: 'Doctor share', body: 'A snapshot in one tap.' },
      ],
    },
    style: { backgroundTone: 'default', spacingDensity: 'default' },
  },
  {
    type: 'cta',
    content: {
      heading: 'Try LeanShot free',
      ctaLabel: 'Start your free trial',
      ctaHref: '/signup?aff={{referral_code}}',
    },
    style: { backgroundTone: 'subtle', alignment: 'center', spacingDensity: 'default' },
  },
  {
    type: 'footer',
    content: {
      fineprint: 'Referred by {{display_name}}.',
      copyright: '© LeanShot',
      links: [
        { label: 'Privacy', href: '/legal/privacy' },
        { label: 'Terms', href: '/legal/terms' },
      ],
    },
    style: { backgroundTone: 'dark', spacingDensity: 'compact' },
  },
]);

const METHOD_TEMPLATE: BlockNode[] = compile([
  {
    type: 'hero',
    content: {
      layout: 'bullets',
      heading: 'How I work with LeanShot',
      bullets: [
        'Stop guessing the curve — see your real drug level day by day',
        'Rotate injection sites without a notebook',
        'Watch your weight, mood, and symptoms in one view',
        'Send your doctor a clean snapshot in one tap',
        'Ask the AI coach anything in plain English',
      ],
      ctaLabel: 'Start your free trial',
      ctaHref: '/signup?aff={{referral_code}}',
    },
    style: { backgroundTone: 'default', alignment: 'left', spacingDensity: 'spacious' },
  },
  {
    type: 'image-text',
    content: {
      heading: 'Brought to you by {{display_name}}',
      body: '{{blurb}}',
      imageSlot: {
        type: 'PhotoSlot',
        binding: '{{photo_path}}',
        fallback: 'InitialsAvatar',
        size: 'md',
      },
      ctaSecondaryLabel: 'Book a 1:1 with me',
      ctaSecondaryHref: '{{calendly_url}}',
      ctaSecondaryShowIf: 'calendly_url',
    },
    style: { backgroundTone: 'subtle', alignment: 'left', spacingDensity: 'default' },
  },
  {
    type: 'cta',
    content: {
      heading: 'Track your GLP-1 journey',
      ctaLabel: 'Start free trial',
      ctaHref: '/signup?aff={{referral_code}}',
    },
    style: { backgroundTone: 'brand', alignment: 'center', spacingDensity: 'default' },
  },
  {
    type: 'footer',
    content: {
      fineprint: 'Referred by {{display_name}}.',
      copyright: '© LeanShot',
      links: [
        { label: 'Privacy', href: '/legal/privacy' },
        { label: 'Terms', href: '/legal/terms' },
      ],
    },
    style: { backgroundTone: 'dark', spacingDensity: 'compact' },
  },
]);

// ---------------------------------------------------------------------------
// Catalog
// ---------------------------------------------------------------------------

export const TEMPLATES: Record<TemplateId, Template> = {
  'long-form-sales': {
    id: 'long-form-sales',
    name: 'Long-form sales',
    description: 'Hero, features, social proof, pricing, and CTA — the full pitch.',
    thumbnail: '/assets/page-templates/long-form-sales.webp',
    seoSchemaType: 'WebPage',
    category: 'page',
    blocks: LONG_FORM_SALES,
  },
  'lead-magnet': {
    id: 'lead-magnet',
    name: 'Lead-magnet opt-in',
    description: 'Single-purpose page with a native lead form for capturing emails.',
    thumbnail: '/assets/page-templates/lead-magnet.webp',
    seoSchemaType: 'WebPage',
    category: 'page',
    blocks: LEAD_MAGNET,
  },
  comparison: {
    id: 'comparison',
    name: 'Comparison',
    description: 'Show why you win — features, contrasts, and a final CTA.',
    thumbnail: '/assets/page-templates/comparison.webp',
    seoSchemaType: 'WebPage',
    category: 'page',
    blocks: COMPARISON,
  },
  faq: {
    id: 'faq',
    name: 'FAQ',
    description: 'Frequently asked questions with JSON-LD FAQPage out of the box.',
    thumbnail: '/assets/page-templates/faq.webp',
    seoSchemaType: 'FAQPage',
    category: 'page',
    blocks: FAQ_TEMPLATE,
  },
  testimonial: {
    id: 'testimonial',
    name: 'Testimonial-driven',
    description: 'Three featured testimonials anchored by a strong hero and CTA.',
    thumbnail: '/assets/page-templates/testimonial.webp',
    seoSchemaType: 'WebPage',
    category: 'page',
    blocks: TESTIMONIAL_TEMPLATE,
  },
  // Phase 19 affiliate templates (UI-SPEC §"/r/{code}").
  coach: {
    id: 'coach',
    name: 'The coach',
    description:
      'Photo-forward hero + Calendly CTA. Best when your audience already knows your face.',
    thumbnail: '/assets/page-templates/affiliate-coach.webp',
    seoSchemaType: 'WebPage',
    category: 'affiliate',
    blocks: COACH_TEMPLATE,
  },
  story: {
    id: 'story',
    name: 'The story',
    description:
      'Testimonial-forward pull-quote in the hero. Best when you have a strong personal story.',
    thumbnail: '/assets/page-templates/affiliate-story.webp',
    seoSchemaType: 'WebPage',
    category: 'affiliate',
    blocks: STORY_TEMPLATE,
  },
  method: {
    id: 'method',
    name: 'The method',
    description:
      'Benefits-list hero, no above-the-fold photo. Best for analytical / educational audiences.',
    thumbnail: '/assets/page-templates/affiliate-method.webp',
    seoSchemaType: 'WebPage',
    category: 'affiliate',
    blocks: METHOD_TEMPLATE,
  },
};

// ---------------------------------------------------------------------------
// Phase 19 affiliate-template helpers
// ---------------------------------------------------------------------------

/** Slot-binding keys the affiliate-landing renderer substitutes at render time.
 * Mirrors UI-SPEC §D-18. */
export type AffiliateSlotKey =
  | 'display_name'
  | 'photo_path'
  | 'blurb'
  | 'calendly_url'
  | 'testimonial_quote'
  | 'referral_code';

export type AffiliateSlotOverrides = Partial<Record<AffiliateSlotKey, string>>;

/** Return only the 3 affiliate templates from the catalog.
 *
 * Consumed by `PartnerTemplatePicker` (Plan 19-06b) and the Phase 19
 * affiliate-templates vitest suite. The result is intentionally
 * order-stable (coach → story → method) — that's the visual order shown
 * to the affiliate. */
export function getAffiliateTemplates(): Template[] {
  return (['coach', 'story', 'method'] as const).map((id) => TEMPLATES[id]);
}

/** Recursively replace `{{slot}}` tokens in any string value of a content/
 * style object. Non-string leaves pass through. Pure — no side effects.
 *
 * Whitespace-tolerant: matches `{{ slot_name }}` or `{{slot_name}}`. */
function applyOverridesToObject<T>(value: T, overrides: AffiliateSlotOverrides): T {
  if (typeof value === 'string') {
    return value.replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (_match, key: string) => {
      const replacement = overrides[key as AffiliateSlotKey];
      return replacement === undefined ? `{{${key}}}` : replacement;
    }) as T;
  }
  if (Array.isArray(value)) {
    return value.map((v) => applyOverridesToObject(v, overrides)) as T;
  }
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = applyOverridesToObject(v, overrides);
    }
    return out as T;
  }
  return value;
}

/** Phase 19 overload: scaffold an affiliate template with slot substitutions.
 *
 * Distinct from `scaffoldFromTemplate(id)` (Phase 15) which is the deep-copy
 * scaffold gate for the page-builder editor. This variant accepts overrides
 * AND deep-copies so the catalog stays immutable. */
export function scaffoldAffiliateTemplate(args: {
  template: 'coach' | 'story' | 'method';
  overrides?: AffiliateSlotOverrides;
}): BlockNode[] {
  const source = TEMPLATES[args.template];
  const cloned = structuredClone(source.blocks);
  const remap = new Map<string, string>();
  for (const b of cloned) {
    remap.set(b.id, newBlockId());
  }
  const overrides = args.overrides ?? {};
  return cloned.map((b) => {
    const remappedParent = b.parent_id === null ? null : (remap.get(b.parent_id) ?? null);
    return {
      ...b,
      id: remap.get(b.id)!,
      parent_id: remappedParent,
      content: applyOverridesToObject(b.content, overrides),
      style: applyOverridesToObject(b.style, overrides),
    };
  });
}

// ---------------------------------------------------------------------------
// scaffoldFromTemplate — the D-14 independence gate
// ---------------------------------------------------------------------------

/**
 * Deep-copy a template's block tree, regenerate every id, and re-map every
 * non-null `parent_id` reference through the new-id table.
 *
 * Contract:
 *   • Mutating the returned tree (or any nested content/style object on it)
 *     does NOT mutate `TEMPLATES[id]`.
 *   • Two calls with the same `id` return trees with disjoint id sets.
 *   • Parent/child topology is preserved against the NEW ids — `parent_id`
 *     never points at a stale source-template id.
 *
 * Implementation notes:
 *   - Uses `structuredClone` (available in ES2022 / target runtime) for the
 *     deep copy. JSON round-tripping would also work for our JSONB-shaped
 *     content but structuredClone is the project-correct choice.
 *   - The id remap is applied in a second pass: clone first (structures and
 *     values intact, but ids still match the source), then rewrite each
 *     block's id + parent_id against the same remap table so references
 *     remain consistent.
 */
export function scaffoldFromTemplate(id: TemplateId): BlockNode[] {
  const source = TEMPLATES[id];
  const cloned = structuredClone(source.blocks);

  // Build the remap table from OLD source-template ids -> NEW ids.
  const remap = new Map<string, string>();
  for (const b of cloned) {
    remap.set(b.id, newBlockId());
  }

  // Rewrite id + parent_id against the remap table.
  return cloned.map((b) => ({
    ...b,
    id: remap.get(b.id)!,
    parent_id: b.parent_id === null ? null : (remap.get(b.parent_id) ?? null),
  }));
}
