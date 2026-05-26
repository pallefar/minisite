/**
 * Phase 61 Plan 07 Task 2 — KB shortcode parser for [protocol:<uuid>] tokens.
 *
 * Mirrors src/lib/rag/remark-citations.ts structure.
 * This is a PURE pre-parse pass, NOT a remark AST plugin.
 *
 * Pre-parse approach: split the body string into an array of segments
 * (text | protocol). Text segments go to ReactMarkdown; protocol segments
 * render as <ProtocolSummaryCard />.
 *
 * Security: regex strictly enforces RFC 4122 UUID format (8-4-4-4-12 hex).
 * Malformed tokens (e.g. [protocol:not-a-uuid]) are left as plain text.
 * XSS defense: ProtocolSummaryCard renders via React (no dangerouslySetInnerHTML).
 */

// ─── Constants ────────────────────────────────────────────────────────────────

/**
 * Matches [protocol:<uuid>] tokens where uuid is RFC 4122 format.
 * Case-insensitive. Capture group 1 is the UUID without the brackets.
 */
export const PROTOCOL_SHORTCODE_REGEX =
  /\[protocol:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\]/gi;

// ─── Types ────────────────────────────────────────────────────────────────────

export type ProtocolSegment =
  | { type: 'text'; value: string }
  | { type: 'protocol'; protocolId: string; refIndex: number };

export interface ProtocolRef {
  protocolId: string;
  /** 1-based; first occurrence wins. Duplicate UUIDs reuse the same refIndex. */
  refIndex: number;
}

export interface ProtocolParseResult {
  segments: ProtocolSegment[];
  protocols: ProtocolRef[];
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Parse [protocol:<uuid>] shortcodes from a sanitized markdown string.
 *
 * Returns an ordered list of segments (interleaved text + protocol) and a
 * de-duplicated protocols array with stable refIndex values.
 *
 * Numbering:
 *   - First-occurrence UUID → refIndex=1
 *   - Next distinct UUID → refIndex=2, etc.
 *   - Repeated UUID → same refIndex as first occurrence (deduplication)
 *
 * Edge case: input with zero shortcodes returns one text segment + empty protocols[].
 *
 * @param text — The sanitized body string (sanitize runs BEFORE this; shortcode parsing is SECOND).
 */
export function parseProtocolShortcodes(text: string): ProtocolParseResult {
  const segments: ProtocolSegment[] = [];
  const protocols: ProtocolRef[] = [];

  // Map from protocolId (lowercase) → refIndex for deduplication
  const seen = new Map<string, number>();

  let lastIndex = 0;
  PROTOCOL_SHORTCODE_REGEX.lastIndex = 0; // reset global regex state

  let match: RegExpExecArray | null;
  while ((match = PROTOCOL_SHORTCODE_REGEX.exec(text)) !== null) {
    const rawUuid = match[1]!;
    const protocolId = rawUuid.toLowerCase();
    const matchStart = match.index;

    // Text segment before this match
    if (matchStart > lastIndex) {
      segments.push({ type: 'text', value: text.slice(lastIndex, matchStart) });
    }

    // Assign refIndex: first occurrence gets next available number;
    // subsequent occurrences of the same UUID reuse the existing number.
    let refIndex: number;
    if (seen.has(protocolId)) {
      refIndex = seen.get(protocolId)!;
    } else {
      refIndex = protocols.length + 1;
      seen.set(protocolId, refIndex);
      protocols.push({ protocolId, refIndex });
    }

    segments.push({ type: 'protocol', protocolId, refIndex });

    lastIndex = matchStart + match[0].length;
  }

  // Trailing text after last match
  if (lastIndex < text.length) {
    segments.push({ type: 'text', value: text.slice(lastIndex) });
  }

  // Edge case: no matches at all — return one text segment
  if (segments.length === 0) {
    segments.push({ type: 'text', value: text });
  }

  return { segments, protocols };
}
