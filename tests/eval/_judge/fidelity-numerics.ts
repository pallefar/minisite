/**
 * Phase 38 Plan 38-10 — Pure-code fidelity numeric extraction.
 *
 * AI-SPEC §5 Dim 1 — Factual fidelity to logged events:
 *   PASS: every number, date, event in `narrative` is traceable to a row in
 *         `renderUserFacts()` template (string-extract numerics → set-equality
 *         vs <user_facts> numerics).
 *   FAIL: digest invents a numeric not present in the user-facts template.
 *
 * This module performs NO LLM calls — it is the deterministic pre-judge filter
 * that catches the most common fabrication mode (made-up counts / dates / kg
 * deltas). The LLM judge in `llm-judge.ts` is a secondary semantic check.
 *
 * Numeric extraction strategy (regex):
 *   - integers (1, 12, 365)
 *   - decimals (0.5, 92.1)
 *   - percentages (10%, 5.5%)
 *   - dates (YYYY-MM-DD, MM/DD)
 *   - ordinals removed (1st, 2nd) — they map back to integers via .test()
 *   - Tokens stripped to canonical form (drop trailing %, normalize signs)
 *
 * Pre-existing whitelist tokens (avoid false positives):
 *   - "GLP-1" — drug class shorthand, contains numeric but not a logged event
 *   - "1mg" type strings — Dim 2 (whitelist) catches separately
 *   - 7 / 24 / 28 — calendar literals always allowed (days/hours/cycle)
 *
 * Exports:
 *   - extractNumerics(text): Set<string>  — canonical numeric tokens
 *   - fidelityCheck(narrative, userFactsText): { fabricated: string[], score: 1|0 }
 */

/** Calendar literals + product copy allowed in narrative without being in user_facts. */
const FIDELITY_ALLOWLIST = new Set<string>([
  '1', // common ordinal
  '7', // 7 days / week
  '24', // 24 hours
  '28', // 4-week cycle
  '30', // monthly
  '0', // zero-mentions allowed
  '2', // common pair count
  '3', // common pair count
  '100', // percentage rounding (100%)
]);

/** GLP-1 drug-class tokens to scrub before numeric extraction. */
const SCRUB_TOKENS: RegExp[] = [
  /GLP-1/gi,
  /BMI/gi,
];

/**
 * Extract canonical numeric tokens from a string.
 *
 * Returns a Set so set-difference is a single op in `fidelityCheck`.
 */
export function extractNumerics(text: string): Set<string> {
  let scrubbed = text;
  for (const re of SCRUB_TOKENS) scrubbed = scrubbed.replace(re, ' ');

  const out = new Set<string>();

  // Dates: YYYY-MM-DD
  const isoDates = scrubbed.match(/\b\d{4}-\d{2}-\d{2}\b/g) ?? [];
  for (const d of isoDates) out.add(d);

  // Dates: MM/DD or M/D (short form)
  const shortDates = scrubbed.match(/\b\d{1,2}\/\d{1,2}\b/g) ?? [];
  for (const d of shortDates) out.add(d);

  // Decimals (incl. +/-)
  const decimals = scrubbed.match(/[+-]?\d+\.\d+/g) ?? [];
  for (const d of decimals) out.add(d.replace(/^\+/, ''));

  // Percentages (already covered by integer match below; track explicitly)
  const pcts = scrubbed.match(/\b\d+(?:\.\d+)?%/g) ?? [];
  for (const p of pcts) out.add(p);

  // Integers — last, so we don't double-add decimals' integer parts.
  // Strip already-counted decimals/dates first.
  let intsOnly = scrubbed;
  intsOnly = intsOnly.replace(/\b\d{4}-\d{2}-\d{2}\b/g, ' ');
  intsOnly = intsOnly.replace(/\b\d{1,2}\/\d{1,2}\b/g, ' ');
  intsOnly = intsOnly.replace(/[+-]?\d+\.\d+/g, ' ');
  intsOnly = intsOnly.replace(/\b\d+(?:\.\d+)?%/g, ' ');
  const ints = intsOnly.match(/\b\d+\b/g) ?? [];
  for (const i of ints) out.add(i);

  return out;
}

export interface FidelityResult {
  fabricated: string[];
  score: 1 | 0;
}

/**
 * Compare numerics in narrative against numerics in user_facts template.
 * Any narrative-only numeric (not in allowlist) is flagged as fabricated.
 *
 * Returns score 1 if zero fabrications, else 0.
 */
export function fidelityCheck(narrative: string, userFactsText: string): FidelityResult {
  const narrativeNumerics = extractNumerics(narrative);
  const userFactsNumerics = extractNumerics(userFactsText);

  const fabricated: string[] = [];
  for (const n of narrativeNumerics) {
    if (userFactsNumerics.has(n)) continue;
    if (FIDELITY_ALLOWLIST.has(n)) continue;
    fabricated.push(n);
  }

  return { fabricated, score: fabricated.length === 0 ? 1 : 0 };
}
