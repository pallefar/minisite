/**
 * Phase 15 Plan 09 — templates.ts contract tests (TDD RED).
 *
 * Asserts:
 *   1. TEMPLATES has exactly 5 entries with the expected ids.
 *   2. Every template's blocks array is non-empty and uses only valid BlockTypes.
 *   3. Every template has unique block ids; sibling `order` values are
 *      sequential integers per parent group; root blocks have parent_id=null.
 *   4. Every BlockStyle uses ONLY token-bounded values (D-05) — no arbitrary
 *      backgroundTone/alignment/spacingDensity.
 *   5. scaffoldFromTemplate() returns a DEEP copy — mutating a nested
 *      content/style object on the result does NOT mutate TEMPLATES (D-14
 *      independence invariant).
 *   6. scaffoldFromTemplate regenerates every block id — no id in the
 *      scaffolded tree collides with the source template.
 *   7. scaffoldFromTemplate preserves parent/child topology — parent_id
 *      references are re-mapped through the new id table, not stale.
 */
import { describe, expect, it } from 'vitest';
import type { BlockNode, BlockType } from './block-schema';
import { TEMPLATES, scaffoldFromTemplate, type TemplateId } from './templates';

const VALID_BLOCK_TYPES: ReadonlySet<BlockType> = new Set<BlockType>([
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
]);

const VALID_BG_TONES = new Set(['default', 'subtle', 'brand', 'dark']);
const VALID_ALIGNMENTS = new Set(['left', 'center', 'right']);
const VALID_DENSITIES = new Set(['compact', 'default', 'spacious']);

const EXPECTED_IDS: TemplateId[] = [
  'long-form-sales',
  'lead-magnet',
  'comparison',
  'faq',
  'testimonial',
];

describe('TEMPLATES — code-defined catalog', () => {
  it('contains the 5 Phase 15 page templates (catalog may include Phase 19 affiliate extensions)', () => {
    // Phase 19 (Plan 19-08) extends the catalog with 3 affiliate templates
    // (`coach`, `story`, `method`). Assert the 5 Phase 15 page-template ids
    // are present without forcing the catalog to stay exactly-5.
    const ids = new Set(Object.keys(TEMPLATES));
    for (const expected of EXPECTED_IDS) {
      expect(ids.has(expected)).toBe(true);
    }
  });

  it('every template has a non-empty blocks array using only valid BlockTypes', () => {
    for (const id of EXPECTED_IDS) {
      const tpl = TEMPLATES[id];
      expect(tpl.blocks.length).toBeGreaterThan(0);
      for (const block of tpl.blocks) {
        expect(VALID_BLOCK_TYPES.has(block.type)).toBe(true);
      }
    }
  });

  it('every block has a unique id within its template', () => {
    for (const id of EXPECTED_IDS) {
      const ids = TEMPLATES[id].blocks.map((b) => b.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it('every sibling group has sequential integer `order` values starting at 0', () => {
    for (const id of EXPECTED_IDS) {
      const blocks = TEMPLATES[id].blocks;
      // Bucket by parent_id
      const byParent = new Map<string | null, BlockNode[]>();
      for (const b of blocks) {
        const key = b.parent_id;
        if (!byParent.has(key)) byParent.set(key, []);
        byParent.get(key)!.push(b);
      }
      for (const siblings of byParent.values()) {
        siblings.sort((a, b) => a.order - b.order);
        siblings.forEach((sib, idx) => {
          expect(Number.isInteger(sib.order)).toBe(true);
          expect(sib.order).toBe(idx);
        });
      }
    }
  });

  it('at least one root block per template (parent_id=null)', () => {
    for (const id of EXPECTED_IDS) {
      const roots = TEMPLATES[id].blocks.filter((b) => b.parent_id === null);
      expect(roots.length).toBeGreaterThan(0);
    }
  });

  it('every BlockStyle uses ONLY token-bounded values (D-05)', () => {
    for (const id of EXPECTED_IDS) {
      for (const b of TEMPLATES[id].blocks) {
        if (b.style.backgroundTone !== undefined) {
          expect(VALID_BG_TONES.has(b.style.backgroundTone)).toBe(true);
        }
        if (b.style.alignment !== undefined) {
          expect(VALID_ALIGNMENTS.has(b.style.alignment)).toBe(true);
        }
        if (b.style.spacingDensity !== undefined) {
          expect(VALID_DENSITIES.has(b.style.spacingDensity)).toBe(true);
        }
      }
    }
  });
});

describe('scaffoldFromTemplate — D-14 independence invariant', () => {
  it('returns a deep copy — mutating a nested content object does NOT mutate TEMPLATES', () => {
    const before = JSON.stringify(TEMPLATES.faq);
    const scaffolded = scaffoldFromTemplate('faq');
    // Mutate first block's content nested object (or assign new key)
    (scaffolded[0]!.content as Record<string, unknown>).heading = 'MUTATED';
    // Mutate first block's style object
    scaffolded[0]!.style.backgroundTone = 'dark';
    // Source TEMPLATES.faq must be byte-identical to before
    const after = JSON.stringify(TEMPLATES.faq);
    expect(after).toBe(before);
  });

  it('regenerates every block id — no scaffold id collides with the source template', () => {
    const sourceIds = new Set(TEMPLATES['long-form-sales'].blocks.map((b) => b.id));
    const scaffolded = scaffoldFromTemplate('long-form-sales');
    for (const b of scaffolded) {
      expect(sourceIds.has(b.id)).toBe(false);
    }
  });

  it('two scaffolds from the same template do not share any id', () => {
    const a = scaffoldFromTemplate('comparison');
    const b = scaffoldFromTemplate('comparison');
    const aIds = new Set(a.map((x) => x.id));
    for (const block of b) {
      expect(aIds.has(block.id)).toBe(false);
    }
  });

  it('preserves parent/child topology — parent_id points at the NEW id of the scaffolded parent', () => {
    // 'testimonial' may or may not have nesting; build a synthetic check on
    // every template that has at least one non-null parent_id reference.
    for (const id of EXPECTED_IDS) {
      const source = TEMPLATES[id];
      const sourceHasNesting = source.blocks.some((b) => b.parent_id !== null);
      if (!sourceHasNesting) continue;
      const scaffolded = scaffoldFromTemplate(id);
      const scaffoldedIds = new Set(scaffolded.map((b) => b.id));
      for (const b of scaffolded) {
        if (b.parent_id === null) continue;
        // parent_id must reference some block IN the scaffolded tree
        expect(scaffoldedIds.has(b.parent_id)).toBe(true);
        // and must NOT collide with any source-template id
        const sourceIds = new Set(source.blocks.map((s) => s.id));
        expect(sourceIds.has(b.parent_id)).toBe(false);
      }
    }
  });

  it('scaffolded tree has the same block count and same types in the same order as source', () => {
    for (const id of EXPECTED_IDS) {
      const source = TEMPLATES[id].blocks;
      const scaffolded = scaffoldFromTemplate(id);
      expect(scaffolded.length).toBe(source.length);
      for (let i = 0; i < source.length; i++) {
        expect(scaffolded[i]!.type).toBe(source[i]!.type);
      }
    }
  });
});
