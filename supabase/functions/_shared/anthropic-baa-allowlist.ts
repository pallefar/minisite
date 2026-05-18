/**
 * Anthropic BAA-covered model allowlist — Phase 25 Plan 25-04 (HIPAA-04 SC #1).
 *
 * ENGINEERING-CURATED LIST, NOT VENDOR-PUBLISHED.
 * Per RESEARCH correction #3 (25-RESEARCH.md line 120): Anthropic does NOT
 * publish a per-model HIPAA BAA allowlist. BAA scope is account-tier-scoped
 * (HIPAA-ready Enterprise) + admin-toggle gated. Excluded products
 * (Workbench, Console, Cowork, Code-except-CLI, web_search) are excluded by
 * PRODUCT, not by model ID.
 *
 * This file lists model IDs that engineering has decided are safe to call
 * from clinical context. Reviewed monthly; subprocessor-diff cron in Plan
 * 25-08 watches trust.anthropic.com/updates for vendor changes.
 *
 * Last reviewed: 2026-05-17
 * Maintainer: see PROJECT.md Vendor Accounts table
 * Reference: [[reference_hipaa_baa_vendor_matrix]]
 */

export const BAA_COVERED_MODELS = [
  'claude-sonnet-4-5',
  'claude-opus-4-6',
  'claude-haiku-4-5-20251001',
] as const;

export const DENYLIST_SUFFIXES = ['-beta', '-preview'] as const;

export type BaaCoveredModel = (typeof BAA_COVERED_MODELS)[number];

function sanitizeModelId(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  // Strip non-printable ASCII (outside 0x20–0x7E range) and cap length at 100.
  return raw.replace(/[^\x20-\x7E]/g, '').slice(0, 100);
}

function rejectionResponse(
  modelId: string,
  reason: 'allowlist-miss' | 'denylist-suffix' | 'empty',
): Response {
  return new Response(JSON.stringify({ error: 'model-not-baa-covered', modelId, reason }), {
    status: 403,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store' },
  });
}

/**
 * Assert that a model ID is BAA-covered and may be used in clinical context.
 *
 * Throws a `Response(403)` if:
 *   - modelId is not a string (or is empty after sanitization) → reason: 'empty'
 *   - modelId ends with a denylist suffix (case-insensitive) → reason: 'denylist-suffix'
 *   - modelId is not in BAA_COVERED_MODELS → reason: 'allowlist-miss'
 *
 * The thrown Response carries sanitized modelId (max 100 printable ASCII chars).
 * Callers MUST catch the thrown Response and return it (or handle it) — do NOT
 * let it propagate to Deno's unhandled-rejection handler.
 *
 * @throws {Response} 403 JSON response when model is not BAA-covered
 */
export function assertBaaCoveredModel(modelId: unknown): void {
  const m = sanitizeModelId(modelId);
  if (!m) throw rejectionResponse(m, 'empty');
  const lower = m.toLowerCase();
  for (const suffix of DENYLIST_SUFFIXES) {
    if (lower.endsWith(suffix)) throw rejectionResponse(m, 'denylist-suffix');
  }
  if (!(BAA_COVERED_MODELS as readonly string[]).includes(m)) {
    throw rejectionResponse(m, 'allowlist-miss');
  }
}
