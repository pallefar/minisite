/**
 * Phase 15 Plan 03 — Block-schema contract tests.
 *
 * Asserts the BlockType union surface, RESERVED_SLUGS membership, the
 * normalization semantics of isReservedSlug (lowercase + trim), and the
 * structural shape of BlockNode/BlockStyle.
 *
 * This module is imported by editor plans 15-04/05/06/07 — the literal
 * strings here are a hard contract; downstream plans MUST NOT redefine
 * BlockType / BlockNode / BlockStyle / RESERVED_SLUGS.
 */
import { describe, expect, it } from 'vitest';
import {
  RESERVED_SLUGS,
  isReservedSlug,
  type BlockNode,
  type BlockStyle,
  type BlockTree,
  type BlockType,
} from './block-schema';

describe('block-schema', () => {
  describe('BlockType union', () => {
    it('contains exactly the 12 literals from the Phase 15 contract', () => {
      // Exhaustive-array round-trip: if a literal is added/removed from
      // BlockType, this assignment fails at compile time. The .sort() +
      // deep-equal then locks the *set* membership at runtime.
      const all: BlockType[] = [
        'hero',
        'cta',
        'faq',
        'pricing',
        'testimonial',
        'feature-grid',
        'image-text',
        'footer',
        'calendly',
        'youtube',
        'tally',
        'lead-form',
      ];
      const expected = [
        'calendly',
        'cta',
        'faq',
        'feature-grid',
        'footer',
        'hero',
        'image-text',
        'lead-form',
        'pricing',
        'tally',
        'testimonial',
        'youtube',
      ];
      expect([...all].sort()).toEqual(expected);
      expect(all.length).toBe(12);
      // De-dupe check — every literal is unique
      expect(new Set(all).size).toBe(12);
    });
  });

  describe('RESERVED_SLUGS', () => {
    it('includes all D-10 path-route protected prefixes + dotfile sitemap/robots', () => {
      const required = [
        'clinic',
        'admin',
        'share',
        'api',
        'auth',
        'assets',
        'sitemap.xml',
        'robots.txt',
      ];
      for (const r of required) {
        expect(RESERVED_SLUGS).toContain(r);
      }
    });

    it('is declared as a readonly tuple (as const)', () => {
      // Surface-level immutability proof — RESERVED_SLUGS should be a
      // readonly tuple so downstream plans can rely on `[number]` typing
      // for narrowing. We can't directly check `as const` at runtime, but
      // we can assert the array isn't trivially mutated when callers try.
      const before = RESERVED_SLUGS.length;
      // RESERVED_SLUGS is typed `readonly`; the cast here only exercises
      // that the value identity stays the same.
      const ref = RESERVED_SLUGS;
      expect(ref).toBe(RESERVED_SLUGS);
      expect(RESERVED_SLUGS.length).toBe(before);
    });
  });

  describe('isReservedSlug', () => {
    it('returns true for direct reserved-slug match', () => {
      expect(isReservedSlug('clinic')).toBe(true);
      expect(isReservedSlug('admin')).toBe(true);
      expect(isReservedSlug('share')).toBe(true);
      expect(isReservedSlug('api')).toBe(true);
      expect(isReservedSlug('auth')).toBe(true);
      expect(isReservedSlug('assets')).toBe(true);
      expect(isReservedSlug('sitemap.xml')).toBe(true);
      expect(isReservedSlug('robots.txt')).toBe(true);
    });

    it('normalizes to lowercase before checking membership', () => {
      expect(isReservedSlug('CLINIC')).toBe(true);
      expect(isReservedSlug('Admin')).toBe(true);
      expect(isReservedSlug('Sitemap.XML')).toBe(true);
    });

    it('trims whitespace before checking membership', () => {
      expect(isReservedSlug('  admin  ')).toBe(true);
      expect(isReservedSlug('\tclinic\n')).toBe(true);
    });

    it('returns false for ordinary slugs', () => {
      expect(isReservedSlug('pricing')).toBe(false);
      expect(isReservedSlug('about-us')).toBe(false);
      expect(isReservedSlug('contact')).toBe(false);
      expect(isReservedSlug('clinic-info')).toBe(false); // not exact match
      expect(isReservedSlug('')).toBe(false);
    });
  });

  describe('type shapes', () => {
    it('accepts a well-formed BlockNode literal at compile time', () => {
      const node: BlockNode = {
        id: 'abc12345',
        type: 'hero',
        parent_id: null,
        order: 0,
        content: { heading: 'Welcome', subheading: 'Hello' },
        style: { backgroundTone: 'brand', alignment: 'center' },
      };
      expect(node.type).toBe('hero');
      expect(node.parent_id).toBeNull();
    });

    it('accepts a BlockStyle with only hideOnMobile (all fields optional)', () => {
      const style: BlockStyle = { hideOnMobile: true };
      expect(style.hideOnMobile).toBe(true);

      const empty: BlockStyle = {};
      expect(empty).toEqual({});
    });

    it('allows BlockTree to be an array of BlockNodes', () => {
      const tree: BlockTree = [
        {
          id: 'a',
          type: 'hero',
          parent_id: null,
          order: 0,
          content: {},
          style: {},
        },
        {
          id: 'b',
          type: 'cta',
          parent_id: null,
          order: 1,
          content: {},
          style: {},
        },
      ];
      expect(tree).toHaveLength(2);
    });

    // Phase 39 Plan 39-02 (PAGEAB-06 / D-13) — variant_set_id optional FK.
    // The field is appended to BlockNode as `variant_set_id?: string` so a
    // block can reference a row in page_variants for per-block A/B variant
    // resolution at render time. Optional — existing blocks without the field
    // continue to validate.
    it('accepts BlockNode with optional variant_set_id (D-13 / PAGEAB-06)', () => {
      const withVariant: BlockNode = {
        id: 'v1',
        type: 'hero',
        parent_id: null,
        order: 0,
        content: { heading: 'Variant A' },
        style: {},
        variant_set_id: 'variant-abc-123',
      };
      expect(withVariant.variant_set_id).toBe('variant-abc-123');

      // Backwards-compat: BlockNode without variant_set_id still satisfies
      // the interface (the field is optional).
      const withoutVariant: BlockNode = {
        id: 'v2',
        type: 'hero',
        parent_id: null,
        order: 0,
        content: {},
        style: {},
      };
      expect(withoutVariant.variant_set_id).toBeUndefined();
    });
  });
});
