/**
 * Unit tests for community post tombstone render (44-03 Task 1 — RED phase).
 *
 * Covers D-15 soft-delete tombstone: deleted_at set → '<em>[deleted]</em>'.
 */
import { describe, it, expect } from 'vitest';
import { renderPostBodyHtml } from '@/lib/community/dompurify-config';

describe('renderPostBodyHtml tombstone', () => {
  it('returns <em>[deleted]</em> when deleted_at is set', () => {
    const post = { body: 'Some content', deleted_at: '2026-05-23T00:00:00Z' };
    expect(renderPostBodyHtml(post)).toBe('<em>[deleted]</em>');
  });

  it('returns sanitized body when deleted_at is null', () => {
    const post = { body: '<h2>Hello</h2>', deleted_at: null };
    const result = renderPostBodyHtml(post);
    expect(result).toContain('<h2>Hello</h2>');
    expect(result).not.toContain('[deleted]');
  });

  it('sanitizes body content even when deleted_at is null (not a tombstone)', () => {
    const post = { body: '<script>bad()</script>safe', deleted_at: null };
    const result = renderPostBodyHtml(post);
    expect(result).not.toContain('<script');
    expect(result).toContain('safe');
  });

  it('ignores body content when deleted_at is set (returns tombstone regardless)', () => {
    const post = { body: 'This should not appear', deleted_at: '2026-01-01T00:00:00Z' };
    const result = renderPostBodyHtml(post);
    expect(result).toBe('<em>[deleted]</em>');
    expect(result).not.toContain('This should not appear');
  });
});
