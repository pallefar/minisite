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
  | 'image-url+alt';

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
    contentFields: [
      { key: 'eyebrow', label: 'Eyebrow', kind: 'text', placeholder: 'Pricing' },
      { key: 'heading', label: 'Heading', kind: 'text' },
      { key: 'plans', label: 'Plans', kind: 'pricing-plans' },
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
};
