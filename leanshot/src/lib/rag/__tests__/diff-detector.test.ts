/**
 * Phase 50 Plan 50-04 — diff-detector unit tests (D-19).
 *
 * Pure-function tests against the vitest-side mirror at
 * `src/lib/rag/scrape/diff-detector.ts` (which keeps logic in lockstep with
 * `supabase/functions/rag-scrape-runner/diff-detector.ts`).
 */

import { describe, expect, it } from 'vitest';
import {
  computeContentHash,
  computeDiffRatio,
  detectNewSections,
  shouldRequeue,
} from '../scrape/diff-detector';

describe('Phase 50 Plan 50-04 — diff-detector', () => {
  describe('computeDiffRatio', () => {
    it('returns 0 for identical text', () => {
      expect(computeDiffRatio('foo bar baz', 'foo bar baz')).toBe(0);
    });

    it('returns 0 for whitespace-only differences', () => {
      expect(computeDiffRatio('  foo bar  ', 'foo bar')).toBe(0);
      expect(computeDiffRatio('foo\nbar', 'foo bar')).toBe(0);
    });

    it('returns ~1 for completely different text', () => {
      const a = 'alpha beta gamma delta epsilon';
      const b = 'one two three four five';
      expect(computeDiffRatio(a, b)).toBeCloseTo(1, 1);
    });

    it('returns moderate ratio for partial overlap', () => {
      const a = 'tirzepatide reduces hba1c by 2 percent at 15 mg dose';
      const b = 'tirzepatide reduces hba1c by 3 percent at 10 mg dose';
      const ratio = computeDiffRatio(a, b);
      expect(ratio).toBeGreaterThan(0);
      expect(ratio).toBeLessThan(0.5);
    });
  });

  describe('detectNewSections', () => {
    it('detects new H1 heading', () => {
      const old = '# Introduction\n\nText.\n\n## Dosing\n\nText.';
      const next = '# Introduction\n\nText.\n\n## Dosing\n\nText.\n\n## Black-box Warning\n\nText.';
      expect(detectNewSections(old, next)).toBe(true);
    });

    it('detects new H2 heading even when H1 unchanged', () => {
      const old = '# Doc\n\n## A\n\n## B';
      const next = '# Doc\n\n## A\n\n## B\n\n## C';
      expect(detectNewSections(old, next)).toBe(true);
    });

    it('returns false when no new headings appear', () => {
      const old = '# Doc\n\n## A\n\nLong text.\n\n## B';
      const next = '# Doc\n\n## A\n\nDifferent long text.\n\n## B';
      expect(detectNewSections(old, next)).toBe(false);
    });

    it('ignores H4+ headings (only H1/H2/H3 considered)', () => {
      const old = '# Doc\n\n## A';
      const next = '# Doc\n\n## A\n\n#### Trivial';
      expect(detectNewSections(old, next)).toBe(false);
    });
  });

  describe('shouldRequeue (D-19 combined gate)', () => {
    it('returns true when new section markers appear (regardless of diff)', () => {
      const old = '# Doc\n\n## A\n\nSame text everywhere.';
      // Same body text but added a new H2 — D-19 says re-queue.
      const next = '# Doc\n\n## A\n\nSame text everywhere.\n\n## New Section\n\nShort.';
      expect(shouldRequeue(old, next)).toBe(true);
    });

    it('returns true at >=20% diff with no new sections', () => {
      // Construct text where ~30% of tokens are replaced with distinct ones.
      const old = 'one two three four five six seven eight nine ten';
      const next = 'one two alpha beta gamma six seven eight nine ten';
      expect(shouldRequeue(old, next)).toBe(true);
    });

    it('returns false at <20% diff and no new sections', () => {
      // Change one token in 20-token text (~5% diff).
      const old = 'a b c d e f g h i j k l m n o p q r s t';
      const next = 'a b c d e f g h i j k l m n o p q r s TYPOFIX';
      expect(shouldRequeue(old, next)).toBe(false);
    });

    it('returns false for identical text', () => {
      expect(shouldRequeue('foo bar baz', 'foo bar baz')).toBe(false);
    });
  });

  describe('computeContentHash', () => {
    it('produces a 64-char lowercase hex string', async () => {
      const h = await computeContentHash('hello world');
      expect(h).toMatch(/^[0-9a-f]{64}$/);
    });

    it('is deterministic for identical input', async () => {
      const a = await computeContentHash('tirzepatide 15 mg weekly');
      const b = await computeContentHash('tirzepatide 15 mg weekly');
      expect(a).toBe(b);
    });

    it('is whitespace-normalized: same hash for "  foo bar" and "foo bar"', async () => {
      const a = await computeContentHash('  foo bar');
      const b = await computeContentHash('foo bar');
      expect(a).toBe(b);
    });

    it('is case-normalized: same hash for "Foo Bar" and "foo bar"', async () => {
      const a = await computeContentHash('Foo Bar');
      const b = await computeContentHash('foo bar');
      expect(a).toBe(b);
    });

    it('produces different hashes for meaningfully different text', async () => {
      const a = await computeContentHash('tirzepatide reduces hba1c by 2 percent');
      const b = await computeContentHash('semaglutide reduces hba1c by 1.5 percent');
      expect(a).not.toBe(b);
    });
  });
});
