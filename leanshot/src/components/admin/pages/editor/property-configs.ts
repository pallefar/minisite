/**
 * Phase 15 Plan 15-05 — Property-editor field configs (FLAT keyed by block type).
 *
 * Each entry declares the CONTENT field set for one block type — the property
 * panel auto-renders these as token-bounded form controls. Style fields
 * (backgroundTone / alignment / spacingDensity / hideOnMobile) are handled
 * uniformly by PropertyPanel and are NOT duplicated here.
 *
 * Forward-compatibility (15-06/07/08): the registry is a flat `Record<BlockType,
 * BlockPropertyConfig>` — additive merges. Each future plan adds keys without
 * restructuring the file.
 *
 * Token-bounded (D-05): field `kind` must be one of `text` / `textarea` /
 * `text-list` / `kv-list` / `image-url+alt`. `color` / `hex` / `typography` are
 * explicitly forbidden (asserted by FAQBlock.test.tsx).
 */
import type { BlockType } from '@/lib/page-builder/block-schema';

/**
 * Allowed field kinds. NO color / hex / typography kinds — those would
 * break D-05's token-bounded styling guarantee.
 */
export type FieldKind =
  | 'text'
  | 'textarea'
  | 'text-list'
  | 'pricing-plans'
  | 'testimonial-quotes'
  | 'feature-items'
  | 'faq-items'
  | 'image-url+alt'
  // 15-06: embed-provider field kinds — token-bounded, no color/hex/typography.
  | 'number'
  | 'boolean';

export interface ContentFieldConfig {
  /** Path into `block.content` — for nested fields use `parent.child`. */
  key: string;
  /** UI-visible label */
  label: string;
  kind: FieldKind;
  /** Optional helper text under the field */
  hint?: string;
  /** Optional placeholder for text/textarea */
  placeholder?: string;
}

export interface BlockPropertyConfig {
  /** Per-block content fields (style fields are universal — handled by panel) */
  contentFields: ContentFieldConfig[];
}

/**
 * Flat registry keyed by `BlockType`. Each per-block-type entry is one
 * object literal — future plans add keys here without touching siblings.
 */
export const PROPERTY_CONFIGS: Partial<Record<BlockType, BlockPropertyConfig>> = {
  faq: {
    contentFields: [
      { key: 'eyebrow', label: 'Eyebrow', kind: 'text', placeholder: 'FAQ' },
      { key: 'heading', label: 'Heading', kind: 'text' },
      { key: 'items', label: 'Questions & answers', kind: 'faq-items' },
    ],
  },
  pricing: {
    // 15-10: each plan entry MAY carry an enum-bounded `checkoutPlan` field
    // (`'plus_monthly'` | `'plus_yearly'`) — render.ts emits the Checkout
    // button as an <a href> upgrade deep-link when set, and as an inert
    // <span> otherwise. The editor field is part of the same JSON object
    // shape (pricing-plans kind); the hint documents the bounded enum so
    // staff users pick from the two known plans, never a raw price ID
    // (T-15-10-01 / D-05 token-bounded — no free-form Stripe price input).
    contentFields: [
      { key: 'eyebrow', label: 'Eyebrow', kind: 'text', placeholder: 'Pricing' },
      { key: 'heading', label: 'Heading', kind: 'text' },
      {
        key: 'plans',
        label: 'Plans',
        kind: 'pricing-plans',
        hint:
          'JSON array of plan objects: { name, price, cadence, features[], ctaLabel, recommended?, checkoutPlan? }. ' +
          'checkoutPlan MUST be one of "plus_monthly" or "plus_yearly" (the only two enum-bound Stripe plans) — ' +
          'any other value renders an inert button with no checkout link.',
      },
    ],
  },
  testimonial: {
    contentFields: [
      { key: 'eyebrow', label: 'Eyebrow', kind: 'text' },
      { key: 'heading', label: 'Heading', kind: 'text' },
      { key: 'quotes', label: 'Quotes', kind: 'testimonial-quotes' },
    ],
  },
  'feature-grid': {
    contentFields: [
      { key: 'eyebrow', label: 'Eyebrow', kind: 'text' },
      { key: 'heading', label: 'Heading', kind: 'text' },
      { key: 'features', label: 'Features', kind: 'feature-items' },
    ],
  },
  'image-text': {
    contentFields: [
      { key: 'heading', label: 'Heading', kind: 'text' },
      { key: 'body', label: 'Body', kind: 'textarea' },
      {
        key: 'imageUrl',
        label: 'Image',
        kind: 'image-url+alt',
        hint: 'Both URL and alt are required for the image to render.',
      },
    ],
  },
  // ─── 15-06 embed blocks — three tailored per-provider field sets (D-02). ───
  youtube: {
    contentFields: [
      {
        key: 'videoId',
        label: 'YouTube video ID',
        kind: 'text',
        placeholder: 'dQw4w9WgXcQ',
        hint: '11-character ID from the YouTube URL (the v= parameter).',
      },
      {
        key: 'startSeconds',
        label: 'Start time (seconds)',
        kind: 'number',
        hint: '0 = play from the beginning.',
      },
      { key: 'autoplay', label: 'Autoplay', kind: 'boolean' },
    ],
  },
  calendly: {
    contentFields: [
      {
        key: 'calendlyUrl',
        label: 'Calendly link',
        kind: 'text',
        placeholder: 'https://calendly.com/your-handle/intro',
        hint: 'Must start with https://calendly.com/',
      },
      { key: 'prefillEmail', label: 'Prefill visitor email', kind: 'boolean' },
    ],
  },
  tally: {
    contentFields: [
      {
        key: 'tallyFormUrl',
        label: 'Tally form link',
        kind: 'text',
        placeholder: 'https://tally.so/r/your-form-id',
        hint: 'Must start with https://tally.so/',
      },
      { key: 'hideTitle', label: 'Hide form title', kind: 'boolean' },
    ],
  },
  // ─── 15-07 native lead-form (D-12) — token-bounded, NO color/hex/typography. ───
  'lead-form': {
    contentFields: [
      {
        key: 'heading',
        label: 'Heading',
        kind: 'text',
        placeholder: 'Get the free guide',
      },
      {
        key: 'description',
        label: 'Description',
        kind: 'textarea',
        hint: 'Optional supporting copy below the heading.',
      },
      {
        key: 'buttonLabel',
        label: 'Submit button label',
        kind: 'text',
        placeholder: 'Send me access',
      },
      {
        key: 'successMessage',
        label: 'Success message',
        kind: 'textarea',
        hint: 'Shown in-place after a successful submission.',
      },
      { key: 'collectName', label: 'Collect name field', kind: 'boolean' },
    ],
  },
};
