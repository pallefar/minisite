/**
 * Phase 38 Plan 38-02 — deterministic user-facts template for the weekly digest.
 *
 * Per AI-SPEC §4b "Context Window Management" verbatim:
 *   - top 5 symptom logs by frequency
 *   - last 7 weight entries (one per day)
 *   - last 14 injections (twice-weekly cadence × 7 days)
 *
 * Per CONTEXT D-04 sanitization: NEVER emit drug names, dose values, or
 * specific weight values (numbers + units allowed in counts/deltas; raw
 * weight values redacted to "weight delta -X.X lb/kg").
 *
 * Per AI-SPEC §6 O3 + Section 4 — the rendered output is enclosed in
 * `<user_facts>...</user_facts>` and includes a `<whitelist>...</whitelist>`
 * block injected from WHITELIST_ACTION_IDS so the model sees the constraint
 * in-context (defense layer, NOT a substitute for the JSON-schema enum).
 *
 * The output is STRICTLY DETERMINISTIC given the same input — this is what
 * makes the "faithfulness" eval tractable (AI-SPEC §5 Dim 1): string-extract
 * numerics from the rendered template, set-equal against the digest narrative.
 */

import { WHITELIST_ACTION_IDS } from './digest-schema.ts';

/**
 * Caller's structured fact bundle. All arrays are pre-sorted by the caller
 * (most-recent-first for time-ordered; most-frequent-first for symptoms).
 *
 * Red-flag types track AI-SPEC §1b "Red-flag symptom triage" dimension —
 * the digest template surfaces these EXPLICITLY at the top of the user_facts
 * block so the model never misses them (Critical Failure Mode #2).
 */
export interface UserFactsForDigest {
  userId: string;
  orgId: string | null;
  /** ISO date marking the start of the 7-day window (YYYY-MM-DD). */
  weekStartIso: string;
  injections: Array<{ at: string; site?: string }>;
  weights: Array<{ date: string; value_kg: number }>;
  symptoms: Array<{ name: string; count: number }>;
  mood?: { avg: number; n: number };
  streak: { days: number; status: 'active' | 'broken' | 'milestone' };
  missedCheckIns: string[];
  redFlags: Array<{
    type:
      | 'severe_abdominal_pain'
      | 'intractable_vomiting'
      | 'ruq_pain'
      | 'bloody_stool'
      | 'dehydration_ckd';
    loggedAt: string;
  }>;
}

const MAX_SYMPTOMS = 5;
const MAX_WEIGHTS = 7;
const MAX_INJECTIONS = 14;

/**
 * Render a deterministic facts block.
 *
 * The output shape is a fenced `<user_facts>` block followed by a
 * `<whitelist>` block. SYSTEM_PROMPT_DIGEST (see `anthropic-summarize.ts`)
 * instructs the model to draw action.id values ONLY from the whitelist and
 * to support every claim with a number from user_facts.
 *
 * Per CONTEXT D-04: raw weight VALUES are redacted; only deltas are emitted.
 * Drug names are never templated (the caller's UserFactsForDigest shape
 * carries no drug-name field by design).
 */
export function renderUserFacts(f: UserFactsForDigest): string {
  const symptoms = f.symptoms.slice(0, MAX_SYMPTOMS);
  const weights = f.weights.slice(0, MAX_WEIGHTS);
  const injections = f.injections.slice(0, MAX_INJECTIONS);

  // Weight delta — last vs first within the window. Redacted to a magnitude
  // only (no absolute values), per D-04.
  let weightDeltaLine = 'weight: no entries this week';
  if (weights.length >= 2) {
    const newest = weights[0]!;
    const oldest = weights[weights.length - 1]!;
    const deltaKg = newest.value_kg - oldest.value_kg;
    const sign = deltaKg >= 0 ? '+' : '-';
    weightDeltaLine = `weight delta over ${weights.length} entries: ${sign}${Math.abs(deltaKg).toFixed(1)} kg`;
  } else if (weights.length === 1) {
    weightDeltaLine = `weight: 1 entry this week (no delta computable)`;
  }

  const injectionsLine =
    injections.length === 0
      ? 'injections: 0 this week'
      : `injections: ${injections.length} this week` +
        (injections.some((i) => i.site)
          ? ` (sites: ${[...new Set(injections.map((i) => i.site).filter(Boolean))].join(', ')})`
          : '');

  const symptomsLine =
    symptoms.length === 0
      ? 'symptoms: none logged'
      : `symptoms (top ${symptoms.length}): ` +
        symptoms.map((s) => `${s.name} ×${s.count}`).join(', ');

  const moodLine =
    f.mood && f.mood.n > 0
      ? `mood: avg ${f.mood.avg.toFixed(1)}/5 across ${f.mood.n} entries`
      : 'mood: not logged this week';

  const streakLine = `streak: ${f.streak.days} days (${f.streak.status})`;

  const missedLine =
    f.missedCheckIns.length === 0
      ? 'missed check-ins: none'
      : `missed check-ins: ${f.missedCheckIns.length} day(s) — ${f.missedCheckIns.join(', ')}`;

  // Red flags surface FIRST in the block so the model cannot miss them.
  const redFlagsLine =
    f.redFlags.length === 0
      ? 'red flags: none'
      : `RED FLAGS — ${f.redFlags.length} occurrence(s): ` +
        f.redFlags.map((rf) => `${rf.type} @ ${rf.loggedAt}`).join('; ');

  const whitelistList = WHITELIST_ACTION_IDS.map((id) => `- ${id}`).join('\n');

  return [
    '<user_facts>',
    `week_start: ${f.weekStartIso}`,
    redFlagsLine,
    injectionsLine,
    weightDeltaLine,
    symptomsLine,
    moodLine,
    streakLine,
    missedLine,
    '</user_facts>',
    '<whitelist>',
    whitelistList,
    '</whitelist>',
  ].join('\n');
}
