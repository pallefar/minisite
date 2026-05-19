/**
 * Diff-detection helpers for Phase 50 Plan 50-04 rag-scrape-runner.
 *
 * Implements D-19 (≥20% text diff OR new section markers → re-queue) +
 * D-21 (erratum detection via diff).
 *
 * Token-bag distance is used instead of full Levenshtein because:
 *   - O(n) instead of O(n²) — Firecrawl markdown can be 10k+ chars per page.
 *   - The 20% threshold is intentionally coarse; minor reformatting should
 *     not re-queue.
 *
 * @internal Edge Function / Deno runtime only. Pure functions, no Deno APIs
 *           except crypto.subtle (available in Edge Fn runtime).
 */

/**
 * Normalize text for comparison:
 *   - lowercase
 *   - collapse all whitespace to single spaces
 *   - trim
 * Idempotent.
 */
function normalize(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Tokenize normalized text into word multiset. Strips markdown-ish punctuation
 * but keeps alphanumerics + intra-word hyphens (so 'tirzepatide' / 'on-label'
 * survive).
 */
function tokenize(text: string): Map<string, number> {
  const counts = new Map<string, number>();
  const tokens = normalize(text)
    .split(/[^a-z0-9-]+/)
    .filter((t) => t.length > 0);
  for (const t of tokens) {
    counts.set(t, (counts.get(t) ?? 0) + 1);
  }
  return counts;
}

/**
 * Compute the change ratio between two strings as
 *   (sum of |freq_old - freq_new| across all tokens) / max(total_old, total_new)
 *
 * Range: [0, 1] where 0 = identical token bags, 1 = no shared tokens.
 *
 * Examples:
 *   - identical text → 0
 *   - one added paragraph in a 10-paragraph doc → ~0.1
 *   - completely rewritten → ~1.0
 *
 * D-19 threshold is 0.20.
 */
export function computeDiffRatio(oldText: string, newText: string): number {
  const oldTokens = tokenize(oldText);
  const newTokens = tokenize(newText);
  if (oldTokens.size === 0 && newTokens.size === 0) return 0;
  let totalOld = 0;
  let totalNew = 0;
  for (const c of oldTokens.values()) totalOld += c;
  for (const c of newTokens.values()) totalNew += c;
  if (totalOld === 0 && totalNew === 0) return 0;
  // Symmetric difference: sum of |freq_old - freq_new| over union of keys.
  let diff = 0;
  const allKeys = new Set<string>();
  for (const k of oldTokens.keys()) allKeys.add(k);
  for (const k of newTokens.keys()) allKeys.add(k);
  for (const k of allKeys) {
    const o = oldTokens.get(k) ?? 0;
    const n = newTokens.get(k) ?? 0;
    diff += Math.abs(o - n);
  }
  const denom = Math.max(totalOld, totalNew);
  if (denom === 0) return 0;
  return diff / (2 * denom); // /2 because symmetric difference double-counts.
}

/**
 * Extract markdown headings (`#`, `##`, `###`) into a Set of normalized heading
 * texts. Used by detectNewSections.
 */
function extractHeadings(markdown: string): Set<string> {
  const headings = new Set<string>();
  const lines = markdown.split(/\r?\n/);
  for (const line of lines) {
    const match = line.match(/^#{1,3}\s+(.+?)\s*$/);
    if (match) {
      headings.add(normalize(match[1]));
    }
  }
  return headings;
}

/**
 * Returns true if newMarkdown has any H1/H2/H3 heading not present in
 * oldMarkdown. A new section marker is a strong signal that the source has
 * meaningfully changed (e.g., a "Black-box warning" section appearing in an
 * FDA label revision) regardless of textual diff ratio.
 *
 * Per D-19, this overrides the 20% threshold — new sections always re-queue.
 */
export function detectNewSections(oldMarkdown: string, newMarkdown: string): boolean {
  const oldH = extractHeadings(oldMarkdown);
  const newH = extractHeadings(newMarkdown);
  for (const h of newH) {
    if (!oldH.has(h)) return true;
  }
  return false;
}

/**
 * Combined D-19 decision: should we re-queue this chunk for admin review?
 *
 * Returns true when:
 *   - text diff ≥ 0.20 (20% threshold per D-19), OR
 *   - any new section marker (H1/H2/H3) appears in newMarkdown.
 */
export function shouldRequeue(oldText: string, newText: string): boolean {
  if (detectNewSections(oldText, newText)) return true;
  return computeDiffRatio(oldText, newText) >= 0.20;
}

/**
 * SHA-256 content hash for dedup. Normalizes whitespace + case BEFORE hashing
 * so trivial reformatting does not produce a new hash.
 *
 * Used by rag-scrape-runner to populate `rag_chunks.content_hash`. The unique
 * index `rag_chunks_dedup_uq (topic_id, source_id, content_hash)` is the
 * single source of truth for "have we seen this exact content before".
 *
 * Returns lowercase hex string (64 chars).
 */
export async function computeContentHash(text: string): Promise<string> {
  const normalized = normalize(text);
  const encoded = new TextEncoder().encode(normalized);
  const buf = await crypto.subtle.digest('SHA-256', encoded);
  const bytes = new Uint8Array(buf);
  let hex = '';
  for (const b of bytes) {
    hex += b.toString(16).padStart(2, '0');
  }
  return hex;
}
