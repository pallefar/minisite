/**
 * Phase 60 Plan 60-13 Task 3 — RAG article body sanitizer.
 *
 * Wider allowlist than dompurify-config.ts (which handles verbatim quotes
 * with a strict [strong em b i br]-only list). The article body allowlist
 * includes block structure tags for rendered article content.
 *
 * T-60-13-XSS-1 mitigation: DOMPurify strips script, iframe, img-onerror,
 * javascript: hrefs, and all tags outside the allowlist below.
 *
 * UI-SPEC §8 body section allowlist:
 *   p a ul ol li code pre strong em blockquote mark h2 h3 h4
 *   NO img, NO script, NO iframe, NO inline-style.
 *
 * Proven by KnowledgeArticleDetailPage.test.tsx Tests 5 + 6.
 *
 * NOTE: dompurify-config.ts (60-10) handles verbatim_quote (citation popover) —
 * this file handles article body (public hub). Different allowlists; do NOT merge.
 */

import DOMPurify from 'dompurify';

// ─── Allowlist (article body — structure + inline formatting) ─────────────────

const RAG_ARTICLE_ALLOWED_TAGS = [
  'p',
  'a',
  'ul',
  'ol',
  'li',
  'code',
  'pre',
  'strong',
  'em',
  'blockquote',
  'mark',
  'h2',
  'h3',
  'h4',
];

// Defense-in-depth: explicitly forbid known dangerous tags
const RAG_ARTICLE_FORBID_TAGS = [
  'script',
  'img',
  'iframe',
  'style',
  'object',
  'embed',
  'base',
  'form',
  'input',
  'button',
  'h1', // Reserve H1 for the page title
];

// Only allow href on anchors (no src, no onerror, no onclick, etc.)
const RAG_ARTICLE_ALLOWED_ATTR = ['href'];

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Sanitize a RAG article body string for safe rendering via react-markdown +
 * dangerouslySetInnerHTML (or rehype plugin).
 *
 * T-60-13-XSS-1: strips script, iframe, img-onerror, javascript: hrefs, and
 * all tags outside the article body allowlist.
 *
 * After sanitization, all anchor hrefs are forced to target=_blank rel=noopener
 * by DOMPurify's afterSanitizeAttributes hook.
 */
export function sanitizeRagMarkdown(html: string): string {
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: RAG_ARTICLE_ALLOWED_TAGS,
    FORBID_TAGS: RAG_ARTICLE_FORBID_TAGS,
    ALLOWED_ATTR: RAG_ARTICLE_ALLOWED_ATTR,
    FORCE_BODY: false,
    ADD_ATTR: ['target', 'rel'],
    HOOK: 'afterSanitizeAttributes',
    afterSanitizeAttributes(node: Element) {
      // Force all links to open in new tab safely
      if (node.tagName === 'A') {
        node.setAttribute('target', '_blank');
        node.setAttribute('rel', 'noopener noreferrer');
      }
    },
  } as Parameters<typeof DOMPurify.sanitize>[1]);
}
