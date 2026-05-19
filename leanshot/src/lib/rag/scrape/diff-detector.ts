/**
 * Vitest-friendly mirror of supabase/functions/rag-scrape-runner/diff-detector.ts.
 *
 * Phase 50 Plan 50-04 D-19 — pure functions; this Node/Vite copy exists because
 * the Deno-runtime file imports via `npm:` specifiers that vitest cannot
 * resolve. Per [[feedback_executor_tdd_scaffolds_sibling_files]] precedent and
 * Plan 50-03 placement decision, the test-side mirror is the canonical
 * vitest-testable contract; the Deno copy under `supabase/functions/` keeps
 * the same logic byte-for-byte. CI should grep for divergence between the two
 * copies (TODO: add pre-commit guard in Plan 50-09).
 *
 * If you modify this file, ALSO modify
 * `supabase/functions/rag-scrape-runner/diff-detector.ts` to match.
 */

function normalize(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, ' ');
}

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

export function computeDiffRatio(oldText: string, newText: string): number {
  const oldTokens = tokenize(oldText);
  const newTokens = tokenize(newText);
  if (oldTokens.size === 0 && newTokens.size === 0) return 0;
  let totalOld = 0;
  let totalNew = 0;
  for (const c of oldTokens.values()) totalOld += c;
  for (const c of newTokens.values()) totalNew += c;
  if (totalOld === 0 && totalNew === 0) return 0;
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
  return diff / (2 * denom);
}

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

export function detectNewSections(oldMarkdown: string, newMarkdown: string): boolean {
  const oldH = extractHeadings(oldMarkdown);
  const newH = extractHeadings(newMarkdown);
  for (const h of newH) {
    if (!oldH.has(h)) return true;
  }
  return false;
}

export function shouldRequeue(oldText: string, newText: string): boolean {
  if (detectNewSections(oldText, newText)) return true;
  return computeDiffRatio(oldText, newText) >= 0.20;
}

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
