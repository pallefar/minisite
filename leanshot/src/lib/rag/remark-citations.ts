/**
 * Phase 60 Plan 60-10 Task 3 — Citation parser for AI coach messages.
 *
 * Parses inline [<uuid>] tokens from assistant message text (emitted by
 * 60-06 rag-retrieve synthesis Fn per AI-SPEC §4).
 *
 * Named "remark-citations" for Phase 50-08 ancestry, but implemented as a
 * pure parser (no remark AST) since AIChatPanel renders plain text, not markdown.
 *
 * Pure function — no React imports, no side effects, no network calls.
 * Can be imported in both React components and test environments.
 *
 * UUID regex: matches AI-SPEC §4 z.string().uuid() format (RFC 4122).
 * Format: [xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx] (case-insensitive).
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export interface TextSegment {
  type: 'text';
  text: string;
}

export interface CitationSegment {
  type: 'citation';
  chunkId: string;
  refIndex: number;
}

export type Segment = TextSegment | CitationSegment;

export interface CitationRef {
  chunkId: string;
  refIndex: number;
}

export interface ParseResult {
  segments: Segment[];
  citations: CitationRef[];
}

// ─── Constants ────────────────────────────────────────────────────────────────

/**
 * Matches RFC 4122 UUID wrapped in square brackets: [xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx]
 * Case-insensitive. Capture group 1 is the raw UUID without brackets.
 */
const UUID_CITATION_REGEX = /\[([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\]/gi;

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Parse inline citation tokens from an assistant message string.
 *
 * Returns an ordered list of segments (interleaved text + citation markers) and
 * a de-duplicated citations array with stable numeric refIndex values.
 *
 * Numbering:
 *   - First-occurrence UUID → refIndex=1
 *   - Next distinct UUID → refIndex=2, etc.
 *   - Repeated UUID → same refIndex as first occurrence (deduplication)
 *
 * Non-UUID [text] tokens are left as plain text (not parsed as citations).
 *
 * Edge case: input with zero citations returns one text segment + empty citations[].
 */
export function parseCitations(text: string): ParseResult {
  const segments: Segment[] = [];
  const citations: CitationRef[] = [];

  // Map from chunkId (lowercase) → refIndex for deduplication
  const seen = new Map<string, number>();

  let lastIndex = 0;
  UUID_CITATION_REGEX.lastIndex = 0; // reset global regex state

  let match: RegExpExecArray | null;
  while ((match = UUID_CITATION_REGEX.exec(text)) !== null) {
    const fullMatch = match[0]; // e.g. "[a1b2c3d4-...]"
    const rawUuid = match[1]; // the UUID without brackets
    const chunkId = rawUuid.toLowerCase(); // normalize to lowercase
    const matchStart = match.index;

    // Text segment before this match
    if (matchStart > lastIndex) {
      segments.push({ type: 'text', text: text.slice(lastIndex, matchStart) });
    }

    // Assign refIndex: first occurrence gets next available number;
    // subsequent occurrences of the same UUID reuse the existing number.
    let refIndex: number;
    if (seen.has(chunkId)) {
      refIndex = seen.get(chunkId)!;
    } else {
      refIndex = seen.size + 1;
      seen.set(chunkId, refIndex);
      citations.push({ chunkId, refIndex });
    }

    segments.push({ type: 'citation', chunkId, refIndex });

    lastIndex = matchStart + fullMatch.length;
  }

  // Trailing text after last match
  if (lastIndex < text.length) {
    segments.push({ type: 'text', text: text.slice(lastIndex) });
  }

  // Edge case: no matches at all
  if (segments.length === 0) {
    segments.push({ type: 'text', text });
  }

  return { segments, citations };
}
