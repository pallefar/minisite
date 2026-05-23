/**
 * Unit tests for community mention parsing (44-03 Task 1 — RED phase).
 *
 * Covers Pitfall 3: strip code blocks before applying regex.
 */
import { describe, it, expect } from 'vitest';
import { parseMentions } from '@/lib/community/mention-parse';

describe('parseMentions', () => {
  it('parses a simple mention', () => {
    expect(parseMentions('hi @bob')).toEqual(['bob']);
  });

  it('lowercases handles', () => {
    expect(parseMentions('hi @Bob')).toEqual(['bob']);
  });

  it('deduplicates handles', () => {
    expect(parseMentions('hi @bob and @bob')).toEqual(['bob']);
  });

  it('handles @@user (double-at) by capturing the inner @user (D-14)', () => {
    expect(parseMentions('@@evan')).toEqual(['evan']);
  });

  it('respects word boundary before period (@user.)', () => {
    expect(parseMentions('@user.')).toEqual(['user']);
  });

  it('strips inline code before applying regex (Pitfall 3)', () => {
    expect(parseMentions('see `code @ignored` text @bob')).toEqual(['bob']);
  });

  it('strips fenced code blocks before applying regex (Pitfall 3)', () => {
    expect(parseMentions('```\n@inblock\n``` @real')).toEqual(['real']);
  });

  it('rejects handles shorter than 3 chars', () => {
    expect(parseMentions('@a')).toEqual([]);
  });

  it('rejects handles longer than 30 chars', () => {
    const long = '@' + 'x'.repeat(31);
    expect(parseMentions(long)).toEqual([]);
  });

  it('returns [] for empty string', () => {
    expect(parseMentions('')).toEqual([]);
  });

  it('preserves first-occurrence order and deduplicates', () => {
    expect(parseMentions('@charlie @alice @bob @alice')).toEqual(['charlie', 'alice', 'bob']);
  });

  it('handles multiple different mentions', () => {
    expect(parseMentions('@alice and @bob should both be included')).toEqual(['alice', 'bob']);
  });
});
