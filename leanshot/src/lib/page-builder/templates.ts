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
  | 'testimonial';

export interface Template {
  id: TemplateId;
  name: string;
  description: string;
  /** Path to a thumbnail image under /assets/page-templates/<id>.webp. */
  thumbnail: string;
  /** Default JSON-LD type for the page when scaffolded from this template. */
  seoSchemaType: SchemaType;
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
    const parent_id =
      spec.parentKey === undefined ? null : (idByKey.get(spec.parentKey) ?? null);
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
// Catalog
// ---------------------------------------------------------------------------

export const TEMPLATES: Record<TemplateId, Template> = {
  'long-form-sales': {
    id: 'long-form-sales',
    name: 'Long-form sales',
    description: 'Hero, features, social proof, pricing, and CTA — the full pitch.',
    thumbnail: '/assets/page-templates/long-form-sales.webp',
    seoSchemaType: 'WebPage',
    blocks: LONG_FORM_SALES,
  },
  'lead-magnet': {
    id: 'lead-magnet',
    name: 'Lead-magnet opt-in',
    description: 'Single-purpose page with a native lead form for capturing emails.',
    thumbnail: '/assets/page-templates/lead-magnet.webp',
    seoSchemaType: 'WebPage',
    blocks: LEAD_MAGNET,
  },
  comparison: {
    id: 'comparison',
    name: 'Comparison',
    description: 'Show why you win — features, contrasts, and a final CTA.',
    thumbnail: '/assets/page-templates/comparison.webp',
    seoSchemaType: 'WebPage',
    blocks: COMPARISON,
  },
  faq: {
    id: 'faq',
    name: 'FAQ',
    description: 'Frequently asked questions with JSON-LD FAQPage out of the box.',
    thumbnail: '/assets/page-templates/faq.webp',
    seoSchemaType: 'FAQPage',
    blocks: FAQ_TEMPLATE,
  },
  testimonial: {
    id: 'testimonial',
    name: 'Testimonial-driven',
    description: 'Three featured testimonials anchored by a strong hero and CTA.',
    thumbnail: '/assets/page-templates/testimonial.webp',
    seoSchemaType: 'WebPage',
    blocks: TESTIMONIAL_TEMPLATE,
  },
};

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
