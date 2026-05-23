/**
 * Unit tests for community dompurify config (44-03 Task 1 — RED phase).
 *
 * Covers T-44-05 XSS defense invariants:
 *   - <script> stripped
 *   - <img> stripped (D-10)
 *   - javascript: href stripped
 *   - <iframe> stripped
 *   - <h2> preserved
 *   - target=_blank + rel='noopener noreferrer' forced on anchors
 */
import { describe, it, expect } from 'vitest';
import { sanitizeCommunityMarkdown } from '@/lib/community/dompurify-config';

describe('sanitizeCommunityMarkdown', () => {
  it('strips <script> tags', () => {
    const result = sanitizeCommunityMarkdown('<script>alert(1)</script>hello');
    expect(result).not.toContain('<script');
    expect(result).toContain('hello');
  });

  it('strips <img> tags (D-10 — images via attachment uploader only)', () => {
    const result = sanitizeCommunityMarkdown('<img src="x" onerror="alert(1)">hello');
    expect(result).not.toContain('<img');
    expect(result).toContain('hello');
  });

  it('strips javascript: href values (T-44-05)', () => {
    const result = sanitizeCommunityMarkdown('<a href="javascript:alert(1)">x</a>');
    expect(result).not.toContain('javascript:');
  });

  it('preserves https:// hrefs with target=_blank and rel=noopener noreferrer', () => {
    const result = sanitizeCommunityMarkdown('<a href="https://example.com">x</a>');
    expect(result).toContain('href="https://example.com"');
    expect(result).toContain('target="_blank"');
    expect(result).toContain('rel="noopener noreferrer"');
  });

  it('strips <iframe> tags', () => {
    const result = sanitizeCommunityMarkdown('<iframe src="evil"></iframe>foo');
    expect(result).not.toContain('<iframe');
    expect(result).toContain('foo');
  });

  it('preserves <h2> headings (allowed tag)', () => {
    const result = sanitizeCommunityMarkdown('<h2>Title</h2>');
    expect(result).toContain('<h2>Title</h2>');
  });

  it('does NOT use USE_PROFILES (explicit allowlist only)', () => {
    // <style> is not in allowlist; should be stripped
    const result = sanitizeCommunityMarkdown('<style>body{color:red}</style>hello');
    expect(result).not.toContain('<style');
    expect(result).toContain('hello');
  });
});
