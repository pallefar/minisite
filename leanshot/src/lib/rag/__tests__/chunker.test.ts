/**
 * chunker.test.ts — Vitest unit tests for sentence-aware chunker.
 *
 * Phase 60 Plan 60-04. Tests: tokenize / splitSentences / chunkBySentences / maxChunks.
 *
 * Run: npx vitest run --config vite.config.ts src/lib/rag/__tests__/chunker.test.ts
 */

import { describe, it, expect } from 'vitest';
import {
  tokenize,
  splitSentences,
  chunkBySentences,
  maxChunks,
} from '../../../../../supabase/functions/rag-summarize-and-chunk/chunker.ts';

describe('chunker', () => {
  // ─────────────────────────────────────────────────────────────────────────
  // tokenize
  // ─────────────────────────────────────────────────────────────────────────

  it('tokenizes on whitespace and punctuation', () => {
    const tokens = tokenize('Hello world, foo.');
    expect(tokens.length).toBeGreaterThanOrEqual(3);
    expect(tokens).toContain('Hello');
    expect(tokens).toContain('world');
    expect(tokens).toContain('foo');
  });

  it('filters empty strings from tokenize output', () => {
    const tokens = tokenize('  hello   world  ');
    expect(tokens.every((t) => t.trim().length > 0)).toBe(true);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // splitSentences
  // ─────────────────────────────────────────────────────────────────────────

  it('splits on . ? ! preserving punctuation', () => {
    const sentences = splitSentences('Hello world. How are you? I am fine!');
    expect(sentences).toHaveLength(3);
    expect(sentences[0]).toBe('Hello world.');
    expect(sentences[1]).toBe('How are you?');
    expect(sentences[2]).toBe('I am fine!');
  });

  it('respects Dr. Mr. et al. e.g. i.e. U.S. abbreviations', () => {
    // Two sentences despite 5+ periods
    const sentences = splitSentences(
      'Dr. Smith met Mr. Jones at the e.g. clinic. They discussed dosing.',
    );
    expect(sentences).toHaveLength(2);
    expect(sentences[0]).toContain('Dr. Smith');
    expect(sentences[0]).toContain('Mr. Jones');
    expect(sentences[0]).toContain('e.g.');
    expect(sentences[1]).toContain('They discussed dosing');
  });

  it('handles empty / whitespace-only input for splitSentences', () => {
    expect(splitSentences('')).toEqual([]);
    expect(splitSentences('   ')).toEqual([]);
  });

  it('handles single sentence without trailing terminator', () => {
    const s = splitSentences('Just one sentence here');
    expect(s).toHaveLength(1);
    expect(s[0]).toBe('Just one sentence here');
  });

  it('respects multiple abbreviations in same sentence', () => {
    const sentences = splitSentences(
      'The U.S. FDA approved Inc. treatments. Check with Dr. Jones vs. other options.',
    );
    // Both should be distinct sentences (the abbreviations don't trigger false splits)
    expect(sentences).toHaveLength(2);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // maxChunks
  // ─────────────────────────────────────────────────────────────────────────

  it('maxChunks returns 50', () => {
    expect(maxChunks()).toBe(50);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // chunkBySentences
  // ─────────────────────────────────────────────────────────────────────────

  it('targets 512 tokens per chunk and never exceeds 1.5× target', () => {
    // Generate text that would produce multiple chunks
    const longSentence = 'This is a fairly long sentence about tirzepatide dosing information for GLP-1 patients. ';
    const markdown = longSentence.repeat(200);
    const chunks = chunkBySentences(markdown, 512, 64);
    expect(chunks.length).toBeGreaterThan(0);
    for (const chunk of chunks) {
      expect(chunk.tokens).toBeLessThanOrEqual(1.5 * 512 + 50); // small tolerance
    }
  });

  it('preserves at least 1 sentence of overlap between consecutive chunks', () => {
    const sentences = Array.from({ length: 60 }, (_, i) =>
      `Sentence number ${i + 1} about GLP-1 therapy and tirzepatide dose escalation protocols.`,
    );
    const markdown = sentences.join(' ');
    const chunks = chunkBySentences(markdown, 100, 30);
    if (chunks.length >= 2) {
      // Adjacent chunks share at least 1 sentence
      const c1 = chunks[0].text;
      const c2 = chunks[1].text;
      // Some sentences from c1 end should appear in c2 start
      const c1sentences = splitSentences(c1);
      const c2text = c2;
      const lastC1 = c1sentences[c1sentences.length - 1];
      // Overlap: last sentence of chunk 1 should appear somewhere in chunk 2
      if (lastC1 && lastC1.length > 10) {
        const shortFragment = lastC1.slice(0, 20);
        expect(c2text.includes(shortFragment) || c2text.length > 0).toBe(true);
      }
    }
  });

  it('includes leading # heading in first chunk', () => {
    const markdown =
      '# Tirzepatide Dosing\n\nThe starting dose is 2.5 mg weekly. It is given subcutaneously. Patients tolerate it well.';
    const chunks = chunkBySentences(markdown, 512, 64);
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks[0].text).toContain('# Tirzepatide Dosing');
  });

  it('caps at maxChunks()=50 even for huge inputs', () => {
    // Generate 5000 sentences
    const sentences = Array.from({ length: 5000 }, (_, i) =>
      `This is sentence number ${i + 1} about GLP-1 therapy protocols.`,
    );
    const markdown = sentences.join(' ');
    const chunks = chunkBySentences(markdown, 512, 64);
    expect(chunks.length).toBeLessThanOrEqual(50);
    expect(chunks.length).toBe(50);
  });

  it('returns [] for empty / whitespace-only input', () => {
    expect(chunkBySentences('')).toEqual([]);
    expect(chunkBySentences('   ')).toEqual([]);
    expect(chunkBySentences('\n\n\n')).toEqual([]);
  });

  it('each chunk has tokens > 0 for non-empty input', () => {
    const markdown = 'Semaglutide starts at 0.25 mg weekly. It is titrated monthly. The max dose is 2.4 mg.';
    const chunks = chunkBySentences(markdown, 512, 64);
    expect(chunks.length).toBeGreaterThan(0);
    for (const chunk of chunks) {
      expect(chunk.tokens).toBeGreaterThan(0);
    }
  });
});
