/**
 * push-payload.ts — Push notification payload builder with safety grep gates.
 *
 * Phase 60 Plan 60-11 Task 2.
 *
 * Builds the push title + body for the Tip-of-the-Day notification sent via
 * the Phase 54 push-dispatch Edge Fn. Enforces three hard safety gates per
 * AI-SPEC §5 Dim #13 + §6 G1/G9 + UI-SPEC §7:
 *
 *   1. PRESCRIPTIVE_VERB_RE — rejects imperative verbs at sentence start
 *   2. EQUIVALENCE_RE       — rejects FDA-equivalence claims (PHARMA-02 Layer 3 mirror)
 *   3. DOSE_NUMBER_RE       — rejects raw dosing numbers (mg/mcg/units/IU)
 *
 * All three throw TipPayloadRejected(reason) — caller MUST catch and skip
 * both the kb_tip_of_day INSERT and the push dispatch for that day.
 * Fail-closed: no fallback to a weakened payload is permitted.
 *
 * Char limits (UI-SPEC §7 hard caps, iOS/Android constraints):
 *   PUSH_TITLE_MAX = 65  (includes "Today's tip: " prefix)
 *   PUSH_BODY_MAX  = 240 (includes " — LeanShot Research" suffix)
 *
 * PHARMA-02 context: this file is Layer 3 of the 3-layer invariant
 * ([[feedback_3_layer_must_never_invariant_pattern]] Phase 39 39-02 D-06):
 *   Layer 1: ESLint AST rule (src/)
 *   Layer 2: isPharma02GatedTopic() runtime check in index.ts
 *   Layer 3: THIS FILE — regex grep on LLM output before push dispatch
 */

// ──────────────────────────────────────────────────────────────────────────────
// Constants (exported for tests)
// ──────────────────────────────────────────────────────────────────────────────

/** Hard cap for push notification title (iOS/Android max). */
export const PUSH_TITLE_MAX = 65;

/** Hard cap for push notification body (iOS/Android max). */
export const PUSH_BODY_MAX = 240;

/** Fixed prefix added to every tip title. Length: 13 chars. */
export const TITLE_PREFIX = "Today's tip: ";

/** Fixed suffix added to every tip body. Length: 20 chars. */
export const BODY_SUFFIX = ' — LeanShot Research';

// ──────────────────────────────────────────────────────────────────────────────
// Safety regex gates (AI-SPEC §5 Dim #13 + §6 G1/G9)
// ──────────────────────────────────────────────────────────────────────────────

/** Rejects prescriptive imperative verbs at the start of a sentence. */
export const PRESCRIPTIVE_VERB_RE = /^(take|increase|decrease|stop|start) /im;

/** Rejects FDA-equivalence claims (PHARMA-02 Layer 3). */
export const EQUIVALENCE_RE = /(equivalent to (Ozempic|Wegovy|Mounjaro|Zepbound)|same as (FDA-approved|brand-name))/i;

/** Rejects raw dosing numbers in any unit. */
export const DOSE_NUMBER_RE = /\b\d+(\.\d+)?\s?(mg|mcg|units|iu)\b/i;

// ──────────────────────────────────────────────────────────────────────────────
// Error type
// ──────────────────────────────────────────────────────────────────────────────

/** Thrown when a safety gate rejects the push payload. */
export class TipPayloadRejected extends Error {
  constructor(public reason: 'prescriptive_verb_rejected' | 'equivalence_claim_rejected' | 'dose_number_in_push') {
    super(reason);
    this.name = 'TipPayloadRejected';
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Truncate `str` to `maxLen` chars. If truncated, replaces the last char with
 * the unicode ellipsis character `…` (1 char, avoids double-byte budget issues).
 */
function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen - 1) + '…';
}

// ──────────────────────────────────────────────────────────────────────────────
// Primary export
// ──────────────────────────────────────────────────────────────────────────────

export interface BuildPushPayloadArgs {
  /** Chunk headline (pre-truncated or not). */
  headline: string;
  /** First sentence from the Haiku-generated summary. */
  body_first_sentence: string;
  /** topic_tag slug used for deep-link. */
  topic: string;
  /** topic_slug used for deep-link. */
  slug: string;
}

export interface PushPayload {
  title: string;
  body: string;
  deep_link: string;
}

/**
 * Build the push notification payload for a tip-of-the-day.
 *
 * @throws {TipPayloadRejected} with reason 'prescriptive_verb_rejected' |
 *   'equivalence_claim_rejected' | 'dose_number_in_push'
 */
export function buildPushPayload(args: BuildPushPayloadArgs): PushPayload {
  const { headline, body_first_sentence, topic, slug } = args;

  // ── Safety gate 1: prescriptive verb ──────────────────────────────────────
  if (PRESCRIPTIVE_VERB_RE.test(body_first_sentence)) {
    throw new TipPayloadRejected('prescriptive_verb_rejected');
  }

  // ── Safety gate 2: equivalence claim ─────────────────────────────────────
  if (EQUIVALENCE_RE.test(body_first_sentence)) {
    throw new TipPayloadRejected('equivalence_claim_rejected');
  }

  // ── Safety gate 3: dose number ───────────────────────────────────────────
  if (DOSE_NUMBER_RE.test(body_first_sentence)) {
    throw new TipPayloadRejected('dose_number_in_push');
  }

  // ── Title construction ───────────────────────────────────────────────────
  // Max headline chars = PUSH_TITLE_MAX - TITLE_PREFIX.length = 65 - 13 = 52
  const maxHeadlineLen = PUSH_TITLE_MAX - TITLE_PREFIX.length;
  const truncatedHeadline = truncate(headline, maxHeadlineLen);
  const title = TITLE_PREFIX + truncatedHeadline;

  // ── Body construction ────────────────────────────────────────────────────
  // Max sentence chars = PUSH_BODY_MAX - BODY_SUFFIX.length = 240 - 20 = 220
  const maxSentenceLen = PUSH_BODY_MAX - BODY_SUFFIX.length;
  const truncatedSentence = truncate(body_first_sentence, maxSentenceLen);
  const body = truncatedSentence + BODY_SUFFIX;

  return {
    title,
    body,
    deep_link: `/knowledge/${topic}/${slug}`,
  };
}
