/**
 * Phase 60 Plan 60-10 Task 3 — RAG DOMPurify config tests.
 *
 * Validates T-60-10-XSS-1: 6 attack vectors stripped by sanitizeVerbatimQuote.
 *
 * Run: npx vitest run --config vite.config.ts src/lib/rag/__tests__/dompurify-config.test.ts
 */

import { describe, it, expect } from 'vitest';
import { sanitizeVerbatimQuote } from '../dompurify-config';

describe('sanitizeVerbatimQuote — T-60-10-XSS-1 mitigations', () => {
  // Test 1: script tag stripped
  it('Test 1: strips <script> tag (no text, no tag)', () => {
    const result = sanitizeVerbatimQuote('<script>alert(1)</script>');
    expect(result).not.toContain('<script');
    expect(result).not.toContain('alert(1)');
    // Result should be empty or only text
    expect(result.trim()).toBe('');
  });

  // Test 2: javascript: href stripped (no <a> tag allowed in RAG quotes)
  it('Test 2: strips <a href="javascript:..."> entirely (no anchors in allowlist)', () => {
    const result = sanitizeVerbatimQuote('<a href="javascript:alert(1)">x</a>');
    // <a> is forbidden entirely — no anchor in output
    expect(result).not.toContain('<a');
    expect(result).not.toContain('javascript:');
  });

  // Test 3: img tag stripped entirely
  it('Test 3: strips <img src=x onerror=alert(1)> completely', () => {
    const result = sanitizeVerbatimQuote('<img src=x onerror=alert(1)>');
    expect(result).not.toContain('<img');
    expect(result).not.toContain('onerror');
    expect(result).not.toContain('alert');
  });

  // Test 4: allowlist members preserved
  it('Test 4: preserves <strong> and <em> (allowlist members)', () => {
    const result = sanitizeVerbatimQuote('<strong>Bold</strong> <em>italic</em>');
    expect(result).toContain('<strong>Bold</strong>');
    expect(result).toContain('<em>italic</em>');
  });

  // Test 5: iframe stripped
  it('Test 5: strips <iframe> completely', () => {
    const result = sanitizeVerbatimQuote('<iframe src="evil.com"></iframe>');
    expect(result).not.toContain('<iframe');
    expect(result).not.toContain('evil.com');
  });

  // Test 6: <p> tag stripped but text preserved
  it('Test 6: strips <p> tag but preserves text content', () => {
    const result = sanitizeVerbatimQuote('<p>hello</p>');
    expect(result).not.toContain('<p>');
    expect(result).not.toContain('</p>');
    expect(result).toContain('hello');
  });

  // Bonus: data: URI href stripped
  it('Bonus: strips data: URI in any attribute context', () => {
    const result = sanitizeVerbatimQuote('<img src="data:text/html,<script>alert(1)</script>">');
    expect(result).not.toContain('<img');
    expect(result).not.toContain('data:');
  });

  // Bonus: <b> and <i> are also allowlisted
  it('Bonus: preserves <b> and <i> (both in allowlist)', () => {
    const result = sanitizeVerbatimQuote('<b>bold</b> <i>italic</i>');
    expect(result).toContain('<b>bold</b>');
    expect(result).toContain('<i>italic</i>');
  });
});
