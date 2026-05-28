/**
 * Phase 60 Plan 60-10 Task 3 — remark-citations (UUID citation parser) tests.
 *
 * Run: npx vitest run --config vite.config.ts src/lib/rag/__tests__/remark-citations.test.ts
 */

import { describe, it, expect } from 'vitest';
import { parseCitations } from '../remark-citations';

const UUID_A = 'a1b2c3d4-e5f6-7890-abcd-ef0123456789';
const UUID_B = 'b2c3d4e5-f6a7-8901-bcde-f01234567890';
const UUID_C = 'c3d4e5f6-a7b8-9012-cdef-012345678901';

describe('parseCitations', () => {
  // Test 7: single UUID parses correctly with text segments
  it('Test 7: parses single UUID citation with surrounding text', () => {
    const text = `Tirzepatide is dosed weekly [${UUID_A}] starting at 2.5mg.`;
    const result = parseCitations(text);

    expect(result.citations).toHaveLength(1);
    expect(result.citations[0]).toEqual({ chunkId: UUID_A, refIndex: 1 });

    expect(result.segments).toHaveLength(3);
    expect(result.segments[0]).toEqual({ type: 'text', text: 'Tirzepatide is dosed weekly ' });
    expect(result.segments[1]).toEqual({ type: 'citation', chunkId: UUID_A, refIndex: 1 });
    expect(result.segments[2]).toEqual({ type: 'text', text: ' starting at 2.5mg.' });
  });

  // Test 8: multiple distinct UUIDs → numeric refIndex in order of appearance
  it('Test 8: assigns ascending refIndex for distinct UUIDs in order of first appearance', () => {
    const text = `First [${UUID_A}] then [${UUID_B}] then [${UUID_C}].`;
    const result = parseCitations(text);

    expect(result.citations).toHaveLength(3);
    expect(result.citations[0].refIndex).toBe(1);
    expect(result.citations[1].refIndex).toBe(2);
    expect(result.citations[2].refIndex).toBe(3);

    expect(result.citations[0].chunkId).toBe(UUID_A);
    expect(result.citations[1].chunkId).toBe(UUID_B);
    expect(result.citations[2].chunkId).toBe(UUID_C);
  });

  // Test 9: repeated UUID reuses same refIndex
  it('Test 9: repeated UUID gets same refIndex as first occurrence', () => {
    const text = `See [${UUID_A}] and also [${UUID_A}] again.`;
    const result = parseCitations(text);

    // Only 1 unique citation
    expect(result.citations).toHaveLength(1);
    expect(result.citations[0].refIndex).toBe(1);

    // But 3 citation segments (two markers for UUID_A)
    const citationSegments = result.segments.filter((s) => s.type === 'citation');
    expect(citationSegments).toHaveLength(2);
    expect(citationSegments[0]).toMatchObject({ type: 'citation', chunkId: UUID_A, refIndex: 1 });
    expect(citationSegments[1]).toMatchObject({ type: 'citation', chunkId: UUID_A, refIndex: 1 });
  });

  // Test 10: non-UUID [text] tokens are NOT parsed as citations
  it('Test 10: [1] literal and [citation needed] are left as plain text', () => {
    const result1 = parseCitations('See [1] for details.');
    expect(result1.citations).toHaveLength(0);
    expect(result1.segments).toHaveLength(1);
    expect(result1.segments[0]).toEqual({ type: 'text', text: 'See [1] for details.' });

    const result2 = parseCitations('This [citation needed] is not parsed.');
    expect(result2.citations).toHaveLength(0);
    expect(result2.segments).toHaveLength(1);
    expect(result2.segments[0]).toEqual({
      type: 'text',
      text: 'This [citation needed] is not parsed.',
    });
  });

  // Test 11: parseCitations is pure — no React imports
  it('Test 11: parseCitations returns a plain object (no React dependency)', () => {
    const result = parseCitations(`Hello [${UUID_A}].`);
    // Plain data structures — no React nodes
    expect(result).toBeTypeOf('object');
    expect(Array.isArray(result.segments)).toBe(true);
    expect(Array.isArray(result.citations)).toBe(true);
    // Each segment is a plain object
    for (const seg of result.segments) {
      expect(typeof seg).toBe('object');
      expect(seg).not.toBeInstanceOf(Function);
    }
  });

  // Test 12: zero citations → single text segment + empty citations array
  it('Test 12: input with no citations returns one text segment and empty citations', () => {
    const input = 'This message has no citations at all.';
    const result = parseCitations(input);

    expect(result.citations).toHaveLength(0);
    expect(result.segments).toHaveLength(1);
    expect(result.segments[0]).toEqual({ type: 'text', text: input });
  });

  // Edge: empty string
  it('Edge: empty string returns one empty text segment', () => {
    const result = parseCitations('');
    expect(result.citations).toHaveLength(0);
    expect(result.segments).toHaveLength(1);
    expect(result.segments[0]).toEqual({ type: 'text', text: '' });
  });

  // Edge: UUID at start of string
  it('Edge: UUID at start (no preceding text)', () => {
    const text = `[${UUID_A}] starts the message.`;
    const result = parseCitations(text);

    expect(result.segments[0]).toMatchObject({ type: 'citation', chunkId: UUID_A, refIndex: 1 });
    expect(result.segments[1]).toMatchObject({ type: 'text', text: ' starts the message.' });
  });

  // Edge: UUID at end of string
  it('Edge: UUID at end (no trailing text)', () => {
    const text = `Ends with a citation [${UUID_A}]`;
    const result = parseCitations(text);

    expect(result.segments[result.segments.length - 1]).toMatchObject({
      type: 'citation',
      chunkId: UUID_A,
      refIndex: 1,
    });
  });
});
