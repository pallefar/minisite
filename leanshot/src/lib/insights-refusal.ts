/**
 * Refusal-list helper for the insights pipeline (PK-02).
 *
 * Patient-safety floor. The rule engine in `insights.ts` must never emit
 * strings that read like dose-change advice (e.g. "increase your Ozempic
 * dose"). This module is a pure, dependency-free guard wrapped around
 * `generateInsights` and `pickFocus` so accidental future copy that looks
 * like dose-change advice is structurally filtered out.
 *
 * Background: see `.planning/phases/03-pharmacology-insights-hardening/03-CONTEXT.md`
 * decision D-05 and `03-RESEARCH.md` lines 320-389 for the regex rationale
 * (word-boundary anchors, hyphenated stems, ±5-token context guard against
 * a med-noun set). Adversarial corpus lives in `insights-refusal.test.ts`
 * (25 must-refuse + 25 must-pass; ROADMAP SC#3 / D-05's "50+" bar).
 *
 * NO imports — pure module, safe to import from anywhere in the tree.
 */

// Stem forms with the final silent `e` dropped (where applicable) so that
// suffixes like `ing` / `ed` can match without re-introducing the `e`.
// `double` becomes `doubl` + `(e|es|ed|ing)`; `escalate` becomes `escalat` +
// `(e|es|ed|ing)`; `de-escalate` becomes `de[-\s]?escalat` + suffixes; etc.
// Plain stems that don't have a silent-e (skip, stop, start, taper, ramp,
// bump, lower) keep their full form. `more` and `less` are adverbs/quantifiers
// with no suffix variants.
//
// CR-02 (Phase 3 review): added the clinical dose-change verbs called out
// by D-05 / ROADMAP SC#3 as "all dose-change phrasings" that were missing
// from the original stem set — `discontinu(e|ed|ing)`, `paus(e|ed|ing)`,
// `hold(s|ed|ing)`, `resum(e|ed|ing)`, `withhold(s|ing)`, `add(s|ed|ing)`,
// `cut(s)`, `reduc(e|ed|ing)`. The ±5-token med-noun context guard
// continues to suppress benign uses ("add more vegetables", "cut sugar",
// "hold a plank", "pause before bed") because those phrases contain no
// med-noun within proximity.
//
// This is a Rule-1 auto-fix vs. the plan's literal regex
// `(...double|halve|...|escalate|de[-\s]?escalate|...)(s|ed|ing|es|d)?` which
// couldn't match `doubling` / `escalating` / `raising` / `halving` (the silent
// final `e` is dropped before adding `ing`). The corpus deliberately includes
// those `-ing` forms (REFUSE rows 3 "doubling", 25 "Start" + "schedule again";
// PASS rows 11 "Escalate"... etc.) so the regex must accept them.
const STEM_PATTERN =
  /\b(increas|decreas|rais|lower|doubl|halv|skip|stop|start|taper|ramp|escalat|de[-\s]?escalat|bump|more|less|discontinu|paus|hold|resum|withhold|add|cut|reduc)(e|es|ed|ing|s|d)?\b/gi;

const MED_NOUNS = new Set([
  'dose',
  'doses',
  'mg',
  'mcg',
  'unit',
  'units',
  'injection',
  'injections',
  'shot',
  'shots',
  'medication',
  'medications',
  'med',
  'meds',
  'titration',
  'ozempic',
  'wegovy',
  'mounjaro',
  'zepbound',
  'rybelsus',
  'saxenda',
  'trulicity',
  'retatrutide',
  'semaglutide',
  'tirzepatide',
  'dulaglutide',
  'liraglutide',
  'compound',
  'compounded',
  'glp-1',
  'glp1',
]);

const TOKEN_RX = /[^\w-]+/;

/** Tokenize a string into lowercase words, preserving hyphenated terms. */
export function tokenize(s: string): string[] {
  return s.toLowerCase().split(TOKEN_RX).filter(Boolean);
}

/**
 * Returns true if `body` contains a dose-change-shaped phrase: one of the
 * STEM_PATTERN verbs (taper/skip/bump/de-escalate/...) within ±5 tokens of
 * a med-noun (mg/dose/injection/ozempic/...). Word-boundary anchors avoid
 * matching `bumper`, `humpback`, etc.; per-call regex avoids `lastIndex`
 * state leakage from the `g` flag.
 *
 * CR-01 (Phase 3 review): walks ALL token occurrences of a matched stem,
 * not just the first via `tokens.findIndex`. The prior implementation
 * silently allowed "Increase your protein and increase your Ozempic dose"
 * because the second "increase" was never checked for med-noun proximity.
 */
export function isDoseChangeAdvice(body: string): boolean {
  const tokens = tokenize(body);
  // Fresh regex per call to avoid g-flag lastIndex state leaking across calls.
  const rx = new RegExp(STEM_PATTERN.source, STEM_PATTERN.flags);
  let match: RegExpExecArray | null;
  while ((match = rx.exec(body)) !== null) {
    const matchedTokens = tokenize(match[0]);
    if (matchedTokens.length === 0) continue;
    // Strip stem suffix so e.g. "increasing" matches the tokenized "increasing".
    const stem = matchedTokens[0]!.replace(/(s|ed|ing|es|d)$/, '');
    // CR-01 fix: walk EVERY token starting with the stem and check proximity
    // around each occurrence. Returning true on any med-noun hit catches
    // multi-occurrence cases like "increase ... protein ... increase your
    // Ozempic dose" where only a later occurrence is near a med noun.
    for (let idx = 0; idx < tokens.length; idx++) {
      if (!tokens[idx]!.startsWith(stem)) continue;
      const lo = Math.max(0, idx - 5);
      const hi = Math.min(tokens.length, idx + 6);
      for (let i = lo; i < hi; i++) {
        if (MED_NOUNS.has(tokens[i]!)) return true;
      }
    }
  }
  return false;
}

/** Filter dose-change-shaped rows out of an insights-array. */
export function scrubInsights<T extends { body: string; title: string }>(insights: T[]): T[] {
  return insights.filter((i) => !isDoseChangeAdvice(i.body) && !isDoseChangeAdvice(i.title));
}
