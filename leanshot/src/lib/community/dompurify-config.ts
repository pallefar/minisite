/**
 * Phase 44 Plan 03 — Community Feed Foundation: DOMPurify config.
 *
 * FORKED from src/helpdesk/KBArticleView.tsx line 66.
 * Helpdesk uses `USE_PROFILES: { html: true }` (permissive for staff).
 * Community uses an EXPLICIT ALLOWLIST + FORBID_TAGS (T-44-05 XSS defense).
 *
 * Key differences from helpdesk:
 *   - Explicit ALLOWED_TAGS instead of USE_PROFILES (no lazy profile shortcut)
 *   - FORBID_TAGS includes 'img' (D-10: images via attachment uploader ONLY)
 *   - afterSanitizeAttributes hook: force target=_blank + rel=noopener noreferrer
 *     on anchors AND strip non-http(s) hrefs (defense-in-depth vs javascript:, data:)
 *
 * T-44-05 threat mitigation:
 *   - <script>, <img>, <iframe>, <style>, <object>, <embed>, <base>, <form> all stripped
 *   - javascript: and data: hrefs stripped
 *   - All anchors get target=_blank rel='noopener noreferrer' (forced, not from input)
 */
import DOMPurify from 'dompurify';

import type { CommunityPost } from '@/lib/community/community-types';

// ─── Allowlist (D-10 markdown subset: no inline images) ───────────────────────

const COMMUNITY_ALLOWED_TAGS = [
  'h2', 'h3', 'h4', 'p', 'strong', 'em', 'b', 'i',
  'ul', 'ol', 'li', 'a', 'code', 'pre', 'blockquote', 'br',
];

// ─── DOMPurify hook ───────────────────────────────────────────────────────────

// Force target=_blank + rel=noopener noreferrer on all anchors AND strip non-http(s) hrefs.
// Registered once at module load (idempotent — multiple module evals re-register but
// DOMPurify deduplicates hooks by reference... use a flag to guard against double-register).
let _hookRegistered = false;
if (!_hookRegistered) {
  _hookRegistered = true;
  DOMPurify.addHook('afterSanitizeAttributes', (node) => {
    if ('tagName' in node && (node as Element).tagName === 'A') {
      (node as Element).setAttribute('target', '_blank');
      (node as Element).setAttribute('rel', 'noopener noreferrer');
      const href = (node as Element).getAttribute('href') ?? '';
      if (!href.startsWith('http://') && !href.startsWith('https://')) {
        (node as Element).removeAttribute('href');
      }
    }
  });
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Sanitize community post/comment body markdown (after react-markdown HTML render).
 *
 * Use this at the render trust boundary — ALL community post and comment bodies
 * MUST pass through this function before being set as innerHTML or passed to
 * ReactMarkdown's rehype-raw pipeline.
 *
 * T-44-05 invariants proven by community-dompurify-config.test.ts.
 */
export function sanitizeCommunityMarkdown(raw: string): string {
  // ALLOWED_ATTR permits 'href' so anchors keep their URL through initial sanitization.
  // The afterSanitizeAttributes hook then enforces: only http:// and https:// hrefs
  // survive, all others are removed (T-44-05 javascript:/data:/vbscript: defense).
  // target and rel are set by the hook, not by the author.
  return DOMPurify.sanitize(raw, {
    ALLOWED_TAGS: COMMUNITY_ALLOWED_TAGS,
    ALLOWED_ATTR: ['href'],
    FORBID_TAGS: ['img', 'script', 'iframe', 'style', 'object', 'embed', 'base', 'form'],
    FORCE_BODY: false,
  });
}

/**
 * Render post body HTML with soft-delete tombstone support (D-15).
 *
 * Returns `<em>[deleted]</em>` literal when post.deleted_at is set (regardless of
 * body content). Otherwise runs the body through sanitizeCommunityMarkdown.
 *
 * Used by CommunityPost.tsx before passing output to ReactMarkdown / dangerouslySetInnerHTML.
 */
export function renderPostBodyHtml(post: { body: string; deleted_at: string | null }): string {
  if (post.deleted_at !== null) {
    return '<em>[deleted]</em>';
  }
  return sanitizeCommunityMarkdown(post.body);
}

// Re-export CommunityPost for convenience (downstream components can import from here)
export type { CommunityPost };
