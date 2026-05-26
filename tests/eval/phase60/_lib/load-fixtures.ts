/**
 * Phase 60 eval harness — fixture loader.
 *
 * Reads JSONL files from `tests/eval/phase60/<relativePath>`, parses each
 * line as JSON, and validates against the GoldExampleSchema zod schema.
 *
 * Import path convention: callers in `tests/eval/phase60/*.test.ts` use
 * `from './_lib/load-fixtures'` (relative to the test files).
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

export const GoldExampleSchema = z.object({
  id: z.string(),
  bucket: z.enum([
    'titration',
    'contraindication',
    'red_flag',
    'tier_a_boost',
    'freshness',
    'general',
    'out_of_corpus',
    'in_corpus_borderline',
    'pharma_02_carveout',
    'fda_equivalence',
    'kanon',
    'drug_stack',
    'stale_drift',
  ]),
  topic_tag: z.enum([
    'titration_semaglutide',
    'titration_tirzepatide',
    'side_effects',
    'contraindication',
    'red_flag',
    'lifestyle_adherence',
    'pricing_access',
    'compounded',
    'off_label',
    'unknown',
  ]),
  query: z.string().min(10),
  user_context: z
    .object({
      meds: z.array(z.string()).optional(),
      conditions: z.array(z.string()).optional(),
    })
    .optional(),
  expected_refusal: z
    .object({
      reason: z.enum(['out_of_corpus', 'pharma_02_carveout']),
      explanation: z.string(),
    })
    .optional(),
  expected_answer: z
    .object({
      must_cite_chunk_ids: z.array(z.string()).optional(),
      must_surface_first_sentence: z.array(z.string()).optional(),
      must_not_contain_regex: z.array(z.string()).optional(),
      must_be_prescriptive_free: z.boolean().optional(),
      expected_source_tier: z.enum(['A', 'B', 'C', 'D', 'E', 'F']).optional(),
    })
    .optional(),
  labels: z.object({
    author: z.enum([
      'endocrinology_md',
      'clinical_pharmacist',
      'patient_safety_officer',
      'regulatory_counsel',
      'product_owner_proxy',
      'leanshot_internal',
    ]),
    labeled_at: z.string(),
    notes: z.string().optional(),
  }),
});

export type GoldExample = z.infer<typeof GoldExampleSchema>;

// ---------------------------------------------------------------------------
// Phase 60 root (tests/eval/phase60/ at git root)
// ---------------------------------------------------------------------------

// __dirname equivalent for ESM
const _thisDir = dirname(fileURLToPath(import.meta.url));
// _thisDir = <git-root>/tests/eval/phase60/_lib
// phase60Root = <git-root>/tests/eval/phase60
const PHASE60_ROOT = join(_thisDir, '..');

/**
 * Load a JSONL fixture file relative to `tests/eval/phase60/`.
 *
 * @param relativePath - e.g. `'gold-set.jsonl'` or
 *   `'adversarial/out-of-corpus.jsonl'`
 * @returns Validated array of GoldExample objects.
 * @throws Error with line number and path on parse or schema failure.
 */
export function loadFixture(relativePath: string): GoldExample[] {
  const absPath = join(PHASE60_ROOT, relativePath);
  let raw: string;
  try {
    raw = readFileSync(absPath, 'utf8');
  } catch (err: unknown) {
    throw new Error(
      `[load-fixtures] Cannot read fixture file "${absPath}": ${(err as Error).message}`,
    );
  }

  const lines = raw.split('\n');
  const results: GoldExample[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    // Skip empty lines and comment lines (starting with //)
    if (line === '' || line.startsWith('//')) continue;

    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch (err: unknown) {
      throw new Error(
        `[load-fixtures] JSON parse error at "${absPath}" line ${i + 1}: ${(err as Error).message}\n  Content: ${line.slice(0, 120)}`,
      );
    }

    const result = GoldExampleSchema.safeParse(parsed);
    if (!result.success) {
      const issues = result.error.issues
        .map((issue) => `  ${issue.path.join('.')}: ${issue.message}`)
        .join('\n');
      throw new Error(
        `[load-fixtures] Schema validation failed at "${absPath}" line ${i + 1} (id=${(parsed as Record<string, unknown>)?.id ?? 'unknown'}):\n${issues}`,
      );
    }

    results.push(result.data);
  }

  return results;
}
