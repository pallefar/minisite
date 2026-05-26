/**
 * Phase 60 Plan 60-10 Task 3 — RAG-specific DOMPurify config.
 *
 * FORKED from src/lib/community/dompurify-config.ts — but STRICTER.
 *
 * The community config allows: h2 h3 h4 p strong em b i ul ol li a code pre blockquote br
 * This RAG verbatim_quote config allows ONLY: strong em b i br
 *
 * Rationale: verbatim_quote is scraped source text displayed as a block-quote.
 * It MUST NOT contain links, images, headings, or any interactive content.
 * The DOMPurify output is passed to dangerouslySetInnerHTML in CitationPopover
 * (T-60-10-XSS-1 mitigation per PLAN threat model).
 *
 * Key differences from community config:
 *   - ALLOWED_TAGS: only [strong, em, b, i, br] — no anchors, no lists, no headings
 *   - ALLOWED_ATTR: [] — no attributes allowed on ANY tag
 *   - No afterSanitizeAttributes hook needed (no anchors to force target/rel on)
 *   - FORBID_TAGS explicitly lists known dangerous tags for defense-in-depth
 */

import DOMPurify from 'dompurify';

// ─── Allowlist (quote text only — no structure, no links) ─────────────────────

const RAG_VERBATIM_ALLOWED_TAGS = ['strong', 'em', 'b', 'i', 'br'];

// Defense-in-depth: explicitly forbid known dangerous tags
// (DOMPurify strips anything NOT in ALLOWED_TAGS anyway, but FORBID_TAGS
// makes the intent visible for code review + audit purposes).
const RAG_VERBATIM_FORBID_TAGS = [
  'a', 'img', 'iframe', 'script', 'style', 'object', 'embed', 'base', 'form',
  'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'code', 'pre', 'blockquote',
];

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Sanitize a verbatim_quote string from a RAG chunk for safe dangerouslySetInnerHTML.
 *
 * T-60-10-XSS-1: strips script, iframe, img-onerror, javascript: hrefs, and all
 * tags outside the [strong em b i br] allowlist.
 *
 * Proven by dompurify-config.test.ts (6 attack vectors, Task 3).
 */
export function sanitizeVerbatimQuote(html: string): string {
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: RAG_VERBATIM_ALLOWED_TAGS,
    FORBID_TAGS: RAG_VERBATIM_FORBID_TAGS,
    ALLOWED_ATTR: [],
    FORCE_BODY: false,
  });
}
