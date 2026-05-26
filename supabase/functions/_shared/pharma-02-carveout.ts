/**
 * pharma-02-carveout.ts — PHARMA-02 3-layer invariant Layer 2 runtime helper.
 *
 * Phase 60 Plan 60-04. AI-SPEC §6 G1 Layer 2 contract.
 *
 * This helper implements the RUNTIME layer of the PHARMA-02 3-layer safety invariant
 * (per [[feedback_3_layer_must_never_invariant_pattern]] Phase 39 39-02 D-06):
 *
 *   Layer 1: ESLint AST rule (blocks new src/lib/rag/* reads of carveout fields
 *            outside sibling helpers) — owned by 60-02 or scaffolding plan.
 *   Layer 2: THIS FILE — runtime helper assertNoPharma02DoseQuotes called from
 *            rag-summarize-and-chunk AFTER Anthropic returns and BEFORE persist.
 *   Layer 3: CI grep gate over response corpus — owned by 60-03 eval suite.
 *
 * PHARMA-02 category: any RAG chunk about compounded-GLP-1 dosing, off-label peptide
 * stacks, or MTC/MEN2 starter ranges MUST NOT expose dose-specific quote_blocks to
 * downstream surfaces (AI coach, tip-of-day, newsletter, /knowledge/* hub).
 *
 * Regulatory context: FDA issued 30+ warning letters in 2025-2026 to telehealth
 * companies whose patient-facing claims about compounded GLP-1s implied equivalence
 * to FDA-approved products. PHARMA-02 invariant makes this structurally impossible.
 *
 * Trip behavior: when assertNoPharma02DoseQuotes returns {ok:false, offending:[…]},
 * the Fn consumer (rag-summarize-and-chunk/index.ts) MUST:
 *   1. UPDATE rag_chunks SET status='rejected', reject_reason='safety-concern'
 *   2. Emit PostHog event 'rag_pharma02_carveout_blocked'
 *   3. Call alertGuardrailTrip('pharma_02', …) via slack-guardrail-alert.ts
 *   4. Leave summary + quote_blocks columns NULL
 *   5. NOT throw — continue to next chunk in the batch
 */

// ──────────────────────────────────────────────────────────────────────────────
// PHARMA-02 gated topic tags
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Canonical list of PHARMA-02 safety-gated topic_tag values.
 *
 * These topic tags cover compounded-GLP-1 dosing, off-label peptide stacks,
 * MTC/MEN2 starter ranges — categories where patient-facing dose quotes are
 * prohibited per FDA 2025-2026 enforcement wave.
 *
 * Maintained here as the single source of truth (Layer 2 runtime enforcement).
 * ESLint AST rule (Layer 1) and CI grep gate (Layer 3) cross-reference this list.
 */
export const PHARMA_02_GATED_TOPIC_TAGS: readonly string[] = [
  'compounded-glp1-dosing',
  'compounded-semaglutide-dosing',
  'compounded-tirzepatide-dosing',
  'compounded-liraglutide-dosing',
  'off-label-peptide-stack',
  'bpc-157-dosing',
  'tb-500-dosing',
  'igf-1-dosing',
  'hgh-dosing',
  'peptide-stack-dosing',
  'mtc-men2-starter-range',
  'glp1-compounded-equivalence',
] as const;

// ──────────────────────────────────────────────────────────────────────────────
// Helper: isPharma02GatedTopic
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Returns true if the given topic_tag is in the PHARMA-02 gated list.
 * Handles null/undefined gracefully (returns false).
 */
export function isPharma02GatedTopic(
  topic_tag: string | null | undefined,
): boolean {
  if (!topic_tag) return false;
  return (PHARMA_02_GATED_TOPIC_TAGS as readonly string[]).includes(topic_tag);
}

// ──────────────────────────────────────────────────────────────────────────────
// Helper: assertNoPharma02DoseQuotes (Layer 2 runtime invariant)
// ──────────────────────────────────────────────────────────────────────────────

export interface QuoteBlockLike {
  quote: string;
  kind: string;
  gloss?: string;
}

export type AssertPharma02Result =
  | { ok: true }
  | { ok: false; offending: Array<{ quote: string; kind: string }> };

/**
 * Layer 2 runtime helper: asserts that no dose quote_blocks exist for a
 * PHARMA-02 gated topic_tag.
 *
 * Logic:
 *   1. If topic_tag is NOT in PHARMA_02_GATED_TOPIC_TAGS → {ok: true} (not gated)
 *   2. If topic_tag IS gated AND any quote_block has kind='dose' → {ok: false, offending}
 *   3. If topic_tag IS gated AND no dose blocks → {ok: true}
 *
 * MUST be called AFTER Anthropic returns and BEFORE writing to rag_chunks.
 *
 * @param topic_tag - The chunk's topic_tag field (may be null for un-tagged chunks)
 * @param quote_blocks - The Anthropic-returned quote_blocks array
 */
export function assertNoPharma02DoseQuotes(
  topic_tag: string | null,
  quote_blocks: QuoteBlockLike[],
): AssertPharma02Result {
  // Not a gated topic — all quote kinds allowed
  if (!isPharma02GatedTopic(topic_tag)) {
    return { ok: true };
  }

  // Gated topic: check for 'dose' kind blocks
  const offending = quote_blocks
    .filter((qb) => qb.kind === 'dose')
    .map((qb) => ({ quote: qb.quote, kind: qb.kind }));

  if (offending.length > 0) {
    return { ok: false, offending };
  }

  return { ok: true };
}
