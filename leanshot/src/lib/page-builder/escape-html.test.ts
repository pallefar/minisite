/**
 * Phase 15 Plan 08 — escape-html.ts behavioral tests.
 */
import { describe, expect, it } from 'vitest';
import { escapeAttr, escapeHtml } from './escape-html';

describe('escapeHtml', () => {
  it('escapes < and > in a <script> payload', () => {
    const out = escapeHtml('<script>alert(1)</script>');
    expect(out).not.toContain('<');
    expect(out).not.toContain('>');
    expect(out).toContain('&lt;');
    expect(out).toContain('&gt;');
  });

  it('returns empty string for empty input', () => {
    expect(escapeHtml('')).toBe('');
  });

  it('returns plain text unchanged', () => {
    expect(escapeHtml('plain text')).toBe('plain text');
  });

  it('returns empty string for null and undefined', () => {
    expect(escapeHtml(null)).toBe('');
    expect(escapeHtml(undefined)).toBe('');
  });

  it('escapes & first so already-mentioned entities are not double-encoded', () => {
    // Input '&' becomes '&amp;'; input '<' becomes '&lt;'.
    // Double-encode would produce '&amp;lt;' for a plain '<' (wrong).
    expect(escapeHtml('<')).toBe('&lt;');
    expect(escapeHtml('&')).toBe('&amp;');
    expect(escapeHtml('A & B < C')).toBe('A &amp; B &lt; C');
  });
});

describe('escapeAttr', () => {
  it('escapes " &  < > and \' for attribute context', () => {
    const out = escapeAttr('a "quoted" & <tag>');
    expect(out).not.toContain('"');
    expect(out).not.toContain('<');
    expect(out).not.toContain('>');
    expect(out).toContain('&quot;');
    expect(out).toContain('&amp;');
    expect(out).toContain('&lt;');
    expect(out).toContain('&gt;');
  });

  it('cannot terminate a double-quoted attribute early', () => {
    const userValue = 'evil" onerror="alert(1)';
    const interpolated = `content="${escapeAttr(userValue)}"`;
    // The first unescaped `"` after `content=` is the one we inserted, and
    // the next `"` is the closing one. There must be exactly 2 quote chars
    // in the attribute string — proving the user value cannot break out.
    const quoteCount = (interpolated.match(/"/g) ?? []).length;
    expect(quoteCount).toBe(2);
  });

  it("escapes ' to &#39;", () => {
    expect(escapeAttr("it's a test")).toBe('it&#39;s a test');
  });

  it('returns empty string for nullish input', () => {
    expect(escapeAttr(null)).toBe('');
    expect(escapeAttr(undefined)).toBe('');
    expect(escapeAttr('')).toBe('');
  });
});
