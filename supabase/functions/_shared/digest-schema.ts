/**
 * Phase 38 Plan 38-02 — Zod schemas + WHITELIST_ACTION_IDS + digestJsonSchema
 * + CLINICAL_KEYWORD_BLOCKLIST for the AI Recommender + Weekly Digest.
 *
 * Per CONTEXT D-15 (verbatim): the v1 whitelist contains 9 base action IDs.
 * D-15 lists `read_kb:<slug>` / `try_recipe:<slug>` / `watch_tutorial:<slug>` —
 * the colon-suffix slug travels in a sibling `deeplink` field; the action_id
 * enum stays simple per AI-SPEC §4b Zod pattern. The CONTEXT decision is the
 * authoritative source; AI-SPEC §4b's 7-entry subset is reconciled by adding
 * the two CONTEXT-only entries (try_recipe, watch_tutorial) here.
 *
 * Per AI-SPEC §6 O1/O2 — two-layer enforcement defense:
 *   - Layer 1 (compile-time + runtime): Zod enum on action.id
 *   - Layer 2 (post-Zod regex): CLINICAL_KEYWORD_BLOCKLIST scans the reason
 *     string for clinical-action keywords (mg, mcg, dose, titrate, etc.)
 *
 * The digestJsonSchema constant is passed to the Anthropic Messages API
 * `output_config.format.json_schema` — its `properties.actions.items.properties.id.enum`
 * MUST stay in lockstep with WHITELIST_ACTION_IDS (single source of truth).
 *
 * Phase 25 HIPAA-01 dependency: the WHITELIST is the contract that prevents
 * non-whitelisted action drift (e.g., "increase your dose to 2 mg") — this is
 * a load-bearing FDA SaMD-line mitigation per AI-SPEC §1b regulatory section.
 */

import { z } from 'https://esm.sh/zod@3.23.8';

/**
 * RECOMMEND-07 / CONTEXT D-15 whitelist of permitted action IDs.
 *
 * 9 base IDs — slug-bearing variants (read_kb:<slug>, try_recipe:<slug>,
 * watch_tutorial:<slug>) carry the slug in a sibling `deeplink` field, NOT in
 * the action_id enum. Keeping the enum simple makes runtime validation O(1).
 *
 * Order is informational; consumers MUST NOT rely on positional indices.
 */
export const WHITELIST_ACTION_IDS = [
  'read_kb',
  'log_weight',
  'log_injection',
  'log_meal',
  'view_curve',
  'share_with_doctor',
  'complete_onboarding_step',
  'try_recipe',
  'watch_tutorial',
] as const;

export type WhitelistActionId = (typeof WHITELIST_ACTION_IDS)[number];

/**
 * Per-action item — id must be whitelist member, reason ≤120 chars.
 * AI-SPEC §4b verbatim: `z.object({ id: z.enum(WHITELIST_ACTION_IDS), reason: z.string().max(120) })`.
 */
export const DigestActionSchema = z.object({
  id: z.enum(WHITELIST_ACTION_IDS),
  reason: z.string().max(120),
});

/**
 * Digest output envelope. AI-SPEC §4b verbatim:
 *   - narrative: 40-600 chars (40-char min boundary covers AI-SPEC §5 Dim 10 row 19)
 *   - actions: 1-3 items (min: 1 covers the "no empty actions" rule)
 */
export const DigestOutputSchema = z.object({
  narrative: z.string().min(40).max(600),
  actions: z.array(DigestActionSchema).min(1).max(3),
});

export type DigestOutput = z.infer<typeof DigestOutputSchema>;
export type DigestAction = z.infer<typeof DigestActionSchema>;

/**
 * JSON-Schema shape forwarded to the Anthropic Messages API via
 * `output_config.format.schema`. Must remain in lockstep with the Zod schemas
 * above — the `enum` array is imported (not re-typed) so a single edit to
 * WHITELIST_ACTION_IDS propagates here automatically.
 *
 * `additionalProperties: false` at BOTH the top level AND the per-item level
 * is required — Anthropic's schema validator allows extras unless explicitly
 * forbidden, which would let a fabricated free-text "advice" field slip past
 * the model-boundary check.
 */
export const digestJsonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    narrative: { type: 'string', minLength: 40, maxLength: 600 },
    actions: {
      type: 'array',
      minItems: 1,
      maxItems: 3,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: { type: 'string', enum: [...WHITELIST_ACTION_IDS] },
          reason: { type: 'string', maxLength: 120 },
        },
        required: ['id', 'reason'],
      },
    },
  },
  required: ['narrative', 'actions'],
} as const;

/**
 * Clinical-keyword blocklist per AI-SPEC §6 O2 verbatim:
 *   /\b(mg|mcg|dose|titrate|skip injection|increase|decrease|split dose|prescribe|diagnos)\b/i
 *
 * Applied AFTER Zod parse to scan the `reason` field for clinical-action
 * keywords that an LLM might smuggle past the enum check (the enum constrains
 * `id`, not `reason`). The `b` word boundary anchors avoid matching common
 * benign substrings like "diagnostic" (anchored) — though `diagnos` is
 * intentionally lax to catch diagnose/diagnosis/diagnosed variants.
 *
 * NOTE: phrase patterns like "skip injection" and "split dose" use a literal
 * space which `\b` straddles correctly in JS regex.
 */
export const CLINICAL_KEYWORD_BLOCKLIST =
  /\b(mg|mcg|dose|titrate|skip injection|increase|decrease|split dose|prescribe|diagnos)\b/i;

/**
 * Throws if the `reason` string contains a clinical-action keyword from
 * CLINICAL_KEYWORD_BLOCKLIST. Called by `generateDigestWithRetry` after the
 * Zod parse succeeds — schema enforcement at the gateway is best-effort, this
 * is the application-boundary belt-and-suspenders per AI-SPEC §6 O2.
 *
 * @throws {Error} when a clinical keyword is found; caller should treat the
 *   failure identically to a ZodError (retry, then fall back / skip user).
 */
export function validateNoClinicalKeywords(reason: string): void {
  if (CLINICAL_KEYWORD_BLOCKLIST.test(reason)) {
    throw new Error(
      `clinical-keyword blocklist match in reason="${reason.slice(0, 120)}"`,
    );
  }
}
