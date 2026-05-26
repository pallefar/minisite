/**
 * prompt.ts — Haiku system + user prompt builders for tip-of-the-day synthesis.
 *
 * Phase 60 Plan 60-11 Task 3.
 *
 * Builds the system and user prompts consumed by the OpenRouter Haiku API call
 * in index.ts. The model ID is intentionally NOT referenced here — prompt
 * builders are model-agnostic; the caller (index.ts) pins the model constant.
 *
 * AI-04 compliance (Phase 4 D-02):
 *   When user_drug or active_themes are present, they are wrapped in
 *   <user_data>...</user_data> fences in the user prompt to prevent
 *   user context from being interpreted as instructions. Mirrors the
 *   existing ai-chat/index.ts pattern exactly.
 *
 * AI-SPEC §5 Dim #13 non-prescriptive contract:
 *   System prompt explicitly prohibits imperative verbs, dose numbers, and
 *   equivalence claims — the same categories guarded by push-payload.ts
 *   grep gates (defense-in-depth at both the LLM output and payload stages).
 *
 * Token budget (AI-SPEC §4): system prompt ≤ ~1,200 tokens. The chunk excerpt
 * is the dominant variable; callers should ensure source_text_excerpt stays
 * under ~800 chars (≈200 tokens) for the system prompt to stay within budget.
 */

import type { RagRetrievedChunk } from '../_shared/rag-retrieve.ts';

// ──────────────────────────────────────────────────────────────────────────────
// System prompt builder
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Build the system prompt for the Haiku tip-of-the-day synthesis call.
 *
 * Embeds the chunk excerpt and its metadata. The chunk_id tag is used by
 * the evaluator to trace the tip back to its source; it MUST appear exactly
 * once (AI-SPEC §4 citation-faithfulness contract).
 */
export function buildTipSystemPrompt(chunk: RagRetrievedChunk): string {
  return `You are LeanShot's evidence-grounded tip-of-the-day writer.

Write ONE sentence that summarizes the most useful insight from the chunk below for a GLP-1 patient.
Format: 1 sentence, max 30 words, ending with a period.

RULES:
- informational, NOT prescriptive (NEVER use verbs: take, increase, decrease, stop, start in imperative mood)
- NEVER mention specific dose numbers (mg, mcg, units, IU)
- NEVER claim a compounded drug is equivalent to Ozempic/Wegovy/Mounjaro/Zepbound or "the same as" any FDA-approved drug
- The sentence must be a verbatim substring of the chunk text OR a faithful paraphrase that contains NO claim absent from the chunk
- End with a period
- Do NOT include a citation marker; the chunk_id is implicit

<chunk id="${chunk.chunk_id}" tier="${chunk.tier}" date="${chunk.evidence_date}">
${chunk.source_text_excerpt}
</chunk>`;
}

// ──────────────────────────────────────────────────────────────────────────────
// User prompt builder
// ──────────────────────────────────────────────────────────────────────────────

export interface BuildTipUserPromptArgs {
  /** User's active drug (e.g. 'tirzepatide', 'semaglutide'). null = unset. */
  user_drug: string | null;
  /** User's active interest themes (e.g. ['muscle-loss', 'weight-plateau']). */
  active_themes: string[];
  /** Optional query override. Default: "Write today's tip." */
  query?: string;
}

/**
 * Build the user prompt for the Haiku tip-of-the-day synthesis call.
 *
 * When user_drug or active_themes are present, wraps them in <user_data>
 * fences per AI-04 structural separation invariant (Phase 4 D-02). This
 * prevents the user's health context from being interpreted as instructions.
 *
 * When no user context is provided, returns a bare query string with no fence.
 */
export function buildTipUserPrompt(args: BuildTipUserPromptArgs): string {
  const { user_drug, active_themes, query = "Write today's tip." } = args;

  const hasUserContext = user_drug !== null || active_themes.length > 0;

  if (!hasUserContext) {
    return query;
  }

  const contextLines: string[] = [];
  if (user_drug) {
    contextLines.push(`drug: ${user_drug}`);
  }
  if (active_themes.length > 0) {
    contextLines.push(`themes: ${active_themes.join(', ')}`);
  }

  // AI-04 fence: user health data is structurally separated from instructions
  return `<user_data>\n${contextLines.join('\n')}\n</user_data>\n\n${query}`;
}
