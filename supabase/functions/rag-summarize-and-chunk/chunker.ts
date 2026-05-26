/**
 * chunker.ts — Sentence-aware semantic chunker for rag-summarize-and-chunk.
 *
 * Phase 60 Plan 60-04. Reuse of 50-05 Task 3 pattern.
 *
 * Key contracts:
 *   - tokenize: lightweight whitespace+punctuation tokenizer (length only; not OpenAI-exact)
 *   - splitSentences: splits on . ? ! with abbreviation guard
 *   - chunkBySentences: greedy 512-token chunks with 64-token overlap + heading prefix
 *   - maxChunks: hard cap of 50 chunks per source
 *
 * Abbreviation list guards against false splits on Dr. Mr. Mrs. Ms. et al.
 * e.g. i.e. U.S. Inc. Ltd. vs. etc.
 *
 * No external imports — pure functions only.
 */

// ──────────────────────────────────────────────────────────────────────────────
// Abbreviation guard
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Set of abbreviations whose trailing period should NOT trigger a sentence split.
 * Comparison is case-insensitive in splitSentences via lowercasing.
 */
const ABBREVIATIONS: ReadonlySet<string> = new Set([
  'dr.',
  'mr.',
  'mrs.',
  'ms.',
  'prof.',
  'jr.',
  'sr.',
  'et al.',
  'e.g.',
  'i.e.',
  'u.s.',
  'inc.',
  'ltd.',
  'vs.',
  'etc.',
  'no.',
  'vol.',
  'p.',
  'pp.',
]);

// ──────────────────────────────────────────────────────────────────────────────
// tokenize
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Lightweight tokenizer: split on whitespace + punctuation, filter empty strings.
 * Used for cost estimation only (not OpenAI-exact); result.length ~ token count.
 */
export function tokenize(text: string): string[] {
  return text.split(/(\s+|[,.;:!?\(\)\[\]"'])/).filter((t) => t.trim().length > 0);
}

// ──────────────────────────────────────────────────────────────────────────────
// splitSentences
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Split markdown text into sentences.
 *
 * Rules:
 *   1. Split on . ? ! followed by whitespace or end-of-string.
 *   2. Abbreviation guard: if the preceding word (lowercased, with period) is in
 *      ABBREVIATIONS, do NOT split there.
 *   3. Preserve the terminating punctuation in the returned sentence.
 *   4. Trim whitespace from each sentence; filter empty strings.
 */
export function splitSentences(markdown: string): string[] {
  if (!markdown || markdown.trim() === '') return [];

  // Split on sentence-terminating punctuation followed by whitespace or EOL
  // We need to handle abbreviations, so we tokenize by potential splits first.
  const sentences: string[] = [];
  let current = '';

  // Walk character by character to detect split points
  // Use a simpler approach: regex split with lookbehind + abbreviation filtering
  // Split candidates: . ! ? followed by whitespace
  const parts = markdown.split(/(?<=[.!?])(?=\s|$)/);

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i].trimStart();
    if (!part) continue;

    // Check if this part ends with an abbreviation period (possibly causing false split)
    // The prev part's trimmed ending should NOT be an abbreviation
    if (current) {
      // Merge if current ends with an abbreviation token
      if (_endsWithAbbreviation(current)) {
        current = current + ' ' + part;
        continue;
      }
      // Push the completed sentence
      const trimmed = current.trim();
      if (trimmed) sentences.push(trimmed);
      current = part;
    } else {
      current = part;
    }
  }

  // Push the last accumulated sentence
  if (current && current.trim()) {
    sentences.push(current.trim());
  }

  return sentences.filter((s) => s.length > 0);
}

/**
 * Check whether a (partial) sentence ends with an abbreviation token.
 * The trailing period belongs to the abbreviation, not a sentence terminator.
 */
function _endsWithAbbreviation(text: string): boolean {
  const trimmed = text.trim();
  // Get the last "word" including its trailing period
  const match = trimmed.match(/(\S+\.)\s*$/);
  if (!match) return false;

  const lastToken = match[1].toLowerCase();

  // Check exact match in abbreviation set
  if (ABBREVIATIONS.has(lastToken)) return true;

  // Also check multi-word abbreviations like "et al."
  const twoWordMatch = trimmed.match(/(\S+\s+\S+\.)\s*$/);
  if (twoWordMatch && ABBREVIATIONS.has(twoWordMatch[1].toLowerCase())) return true;

  return false;
}

// ──────────────────────────────────────────────────────────────────────────────
// maxChunks
// ──────────────────────────────────────────────────────────────────────────────

/** Maximum number of chunks per source. Hard cap prevents cost explosion. */
export function maxChunks(): number {
  return 50;
}

// ──────────────────────────────────────────────────────────────────────────────
// chunkBySentences
// ──────────────────────────────────────────────────────────────────────────────

export interface Chunk {
  text: string;
  tokens: number;
}

/**
 * Greedy sentence-aware chunker.
 *
 * Algorithm:
 *   1. Extract leading heading (if present) to prepend to first chunk.
 *   2. Split remaining text into sentences.
 *   3. Accumulate sentences until adding the next would push tokens past 1.5×targetTokens.
 *   4. On chunk boundary: start next chunk with last 1-2 sentences of previous
 *      chunk (up to overlapTokens) for context continuity.
 *   5. Cap at maxChunks() — remaining sentences are dropped.
 *
 * @param markdown - Raw scraped markdown text
 * @param targetTokens - Target tokens per chunk (default 512)
 * @param overlapTokens - Overlap tokens between adjacent chunks (default 64)
 */
export function chunkBySentences(
  markdown: string,
  targetTokens = 512,
  overlapTokens = 64,
): Chunk[] {
  if (!markdown || markdown.trim() === '') return [];

  const maxT = 1.5 * targetTokens;
  const cap = maxChunks();
  const result: Chunk[] = [];

  // Extract leading heading
  let leadingHeading = '';
  let body = markdown;
  const headingMatch = markdown.match(/^(#{1,6} [^\n]+)\n/);
  if (headingMatch) {
    leadingHeading = headingMatch[1];
    body = markdown.slice(headingMatch[0].length);
  }

  const sentences = splitSentences(body);
  if (sentences.length === 0) {
    // Only heading? Return it as one chunk.
    if (leadingHeading) {
      return [{ text: leadingHeading, tokens: tokenize(leadingHeading).length }];
    }
    return [];
  }

  let chunkSentences: string[] = leadingHeading ? [leadingHeading] : [];
  let chunkTokens = tokenize(chunkSentences.join(' ')).length;

  for (let i = 0; i < sentences.length; i++) {
    if (result.length >= cap) break;

    const sentence = sentences[i];
    const sentenceTokens = tokenize(sentence).length;
    const newTokens = chunkTokens + sentenceTokens + (chunkSentences.length > 0 ? 1 : 0);

    if (chunkSentences.length > 0 && newTokens > maxT) {
      // Close current chunk
      const text = chunkSentences.join(' ');
      result.push({ text, tokens: tokenize(text).length });

      if (result.length >= cap) break;

      // Start next chunk with overlap from tail of previous chunk
      const overlapSentences: string[] = [];
      let overlapAccum = 0;
      for (let j = chunkSentences.length - 1; j >= 0 && overlapAccum < overlapTokens; j--) {
        const s = chunkSentences[j];
        // Skip the leading heading for overlap (don't re-include it)
        if (s === leadingHeading) break;
        overlapAccum += tokenize(s).length;
        overlapSentences.unshift(s);
        if (overlapSentences.length >= 2) break;
      }

      chunkSentences = [...overlapSentences, sentence];
      chunkTokens = tokenize(chunkSentences.join(' ')).length;
    } else {
      chunkSentences.push(sentence);
      chunkTokens = newTokens;
    }
  }

  // Flush the last accumulated chunk
  if (chunkSentences.length > 0 && result.length < cap) {
    const text = chunkSentences.join(' ');
    result.push({ text, tokens: tokenize(text).length });
  }

  return result;
}
