/**
 * research-renderer.ts — markdown-it wrapper for research publication rendering.
 *
 * Phase 62 Plan 03. Task 2.
 * Mirrors src/lib/markdown/protocol-shortcode-plugin.ts structure.
 *
 * Pure function — no React, no side effects, no Deno.* imports.
 * Used by:
 *   - research-publish Edge Fn (server-side markdown render, injected via HandlerDeps.markdownRenderer)
 *   - Admin editor preview (client-side, for live preview of markdown_content in PublicationEditorPage)
 *
 * Security: html: false prevents raw HTML injection (T-62-03-01 mitigation — Layer 1).
 * Client-side DOMPurify sanitization is a second layer (Plan 62-06 PublicResearchArticlePage).
 *
 * NOT for rendering untrusted user content without additional sanitization.
 */

import MarkdownIt from 'markdown-it';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface RenderResult {
  /** Rendered HTML string. Raw HTML injection blocked (html: false). */
  html: string;
  /** Approximate word count (strips markdown syntax before counting). */
  wordCount: number;
  /** Extracted heading outline for TOC generation. */
  headings: Array<{ level: number; text: string; anchor: string }>;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Normalize heading text to an anchor-friendly slug.
 * Lowercase, spaces to hyphens, strip non-alphanumeric (except hyphens).
 */
function toAnchor(text: string): string {
  return text
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * Strip markdown syntax tokens to get raw prose words.
 * Removes heading markers, bold/italic markers, code fences, inline code,
 * links keeping text, images, blockquote markers, list bullets.
 */
function stripMarkdownSyntax(markdown: string): string {
  return (
    markdown
      // Remove fenced code blocks
      .replace(/```[\s\S]*?```/g, '')
      // Remove inline code
      .replace(/`[^`]+`/g, '')
      // Remove images ![alt](url)
      .replace(/!\[.*?\]\(.*?\)/g, '')
      // Remove links — keep the text
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      // Remove heading markers
      .replace(/^#{1,6}\s+/gm, '')
      // Remove blockquote markers
      .replace(/^>\s*/gm, '')
      // Remove horizontal rules
      .replace(/^[-*_]{3,}\s*$/gm, '')
      // Remove bold/italic markers
      .replace(/\*{1,3}([^*]+)\*{1,3}/g, '$1')
      .replace(/_{1,3}([^_]+)_{1,3}/g, '$1')
      // Remove list bullets
      .replace(/^[\s]*[-+*]\s+/gm, '')
      .replace(/^[\s]*\d+\.\s+/gm, '')
      // Collapse whitespace
      .replace(/\s+/g, ' ')
      .trim()
  );
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Render markdown to HTML using markdown-it.
 *
 * Returns:
 *   - html: rendered HTML with raw HTML injection blocked (html: false)
 *   - wordCount: approximate prose word count
 *   - headings: extracted heading outline [{level, text, anchor}]
 *
 * The rendered HTML is safe for use in admin preview (html: false blocks XSS).
 * For public rendering, also run through DOMPurify on the browser side.
 */
export function renderResearchMarkdown(markdown: string): RenderResult {
  const md = new MarkdownIt({
    typographer: true,
    linkify: true,
    html: false, // T-62-03-01: block raw HTML injection
  });

  const html = md.render(markdown);

  // ── Extract headings ─────────────────────────────────────────────────────────
  const headings: RenderResult['headings'] = [];
  const headingRegex = /^(#{1,6})\s+(.+)$/gm;
  let match: RegExpExecArray | null;
  while ((match = headingRegex.exec(markdown)) !== null) {
    const level = match[1]!.length;
    const rawText = match[2]!.trim();
    // Strip inline markdown from heading text (bold, italic, code)
    const text = rawText
      .replace(/\*{1,3}([^*]+)\*{1,3}/g, '$1')
      .replace(/_{1,3}([^_]+)_{1,3}/g, '$1')
      .replace(/`([^`]+)`/g, '$1');
    headings.push({ level, text, anchor: toAnchor(text) });
  }

  // ── Word count ───────────────────────────────────────────────────────────────
  const stripped = stripMarkdownSyntax(markdown);
  const wordCount = stripped.length === 0 ? 0 : stripped.split(/\s+/).length;

  return { html, wordCount, headings };
}

export default renderResearchMarkdown;
