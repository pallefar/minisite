/**
 * Phase 44 Plan 03 — Community Feed Foundation: Mention parser.
 *
 * Extracts @handles from raw markdown text with code-block stripping
 * to prevent false positives from code examples (Pitfall 3).
 *
 * Algorithm:
 *   1. Strip fenced code blocks (`\`\`\`...`\`\`\``) — handles multi-line code
 *   2. Strip inline code (`` `...` ``) — handles single-line code spans
 *   3. Apply /@([a-z0-9_]{3,30})\b/gi — extract @handle with length bounds
 *   4. Lowercase each captured handle
 *   5. Deduplicate via Set, preserving first-occurrence order
 *
 * D-14 regex: `/@([a-z0-9_]{3,30})\b/gi`
 *   - 3-char minimum: avoids noise from short abbreviations
 *   - 30-char maximum: matches DB CHECK constraint on profiles.handle
 *   - @@user: the second @ is outside the capture group, so `@user` is correctly captured
 *   - @user.: \b before '.' is a word boundary — stops at the period
 *
 * T-44-06 mitigation: client-side parse is informational only.
 *   The community_post_mentions PRIMARY KEY (post_id, user_id) is the authoritative
 *   idempotency gate. notification_category_config.daily_cap=20 (Plan 44-02).
 */

const FENCED_CODE_RE = /```[\s\S]*?```/g;
const INLINE_CODE_RE = /`[^`\n]*`/g;
const MENTION_RE = /@([a-z0-9_]{3,30})\b/gi;

/**
 * Parse @mentions from raw markdown text.
 *
 * @param rawMarkdown — raw user-typed markdown (NOT sanitized HTML)
 * @returns deduplicated lowercase handles in first-occurrence order
 *
 * @example
 * parseMentions('hello @Bob and @bob `code @evan`') // ['bob']
 * parseMentions('```\n@inblock\n``` @real')          // ['real']
 * parseMentions('@a')                                // [] (too short)
 */
export function parseMentions(rawMarkdown: string): string[] {
  // Step 1: strip fenced code blocks (gracefully handle missing closing fence — strip nothing)
  // The regex is non-greedy and requires a closing ```, so an unclosed fence is left as-is.
  let stripped = rawMarkdown.replace(FENCED_CODE_RE, '');

  // Step 2: strip inline code spans
  stripped = stripped.replace(INLINE_CODE_RE, '');

  // Step 3-4: extract and lowercase handles
  const seen = new Set<string>();
  const result: string[] = [];

  let match: RegExpExecArray | null;
  // Reset lastIndex since we're reusing the regex with `g` flag
  MENTION_RE.lastIndex = 0;
  while ((match = MENTION_RE.exec(stripped)) !== null) {
    const handle = match[1].toLowerCase();
    if (!seen.has(handle)) {
      seen.add(handle);
      result.push(handle);
    }
  }

  return result;
}
