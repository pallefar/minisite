/**
 * Phase 38 Plan 38-10 — Reference dataset loader for the eval harness.
 *
 * Reads `tests/eval/phase38-refset.json` once and re-exports a typed array
 * for each dimension test to iterate. Per AI-SPEC §5, the refset is the
 * single source of truth — adding rows here automatically extends every
 * dimension test (no per-test maintenance).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import type { UserFactsForDigest } from '../_judge/llm-judge.ts';

export interface RefsetRow {
  id: string;
  scenario: string;
  user_facts: UserFactsForDigest;
  expected_dim1_fidelity: boolean;
  expected_dim2_whitelist: boolean;
  expected_dim3_redflag:
    | { escalation_first: boolean; prescriber_phrase: boolean }
    | null;
  expected_dim4_zero_cross_org?: boolean;
  expected_dim6_precision_at_3_min: number;
  expected_tags: string[];
  expected_required_top3_tag?: string;
  expected_excluded_content_ids: string[];
  expected_baa_scope: 'consumer' | 'clinical';
  expected_clinical_key_used?: boolean;
  expected_tone_min: number;
  expected_phase: 'active' | 'maintenance' | 'tapering';
  expected_forbidden_copy_tokens?: string[];
  expected_zero_free_text_clinical?: boolean;
  expected_sparse_no_fabrication?: boolean;
  expected_schema_outcome?: 'retry_then_fallback';
  _user_free_text_probe?: string;
  _cross_tenant_pair?: string;
  _schema_probe?: string;
}

const here = dirname(fileURLToPath(import.meta.url));
const refsetPath = resolve(here, '..', 'phase38-refset.json');

let cached: RefsetRow[] | null = null;

export function loadRefset(): RefsetRow[] {
  if (cached) return cached;
  const raw = readFileSync(refsetPath, 'utf-8');
  cached = JSON.parse(raw) as RefsetRow[];
  return cached;
}

export const STAGING_BASE_URL = process.env.STAGING_BASE_URL ?? '';
export const SHOULD_RUN_EVAL = Boolean(STAGING_BASE_URL);

/**
 * Stable run identifier for grouping eval.judge.score events into a single
 * `phase38-eval-runs` dashboard row. Falls back to a timestamp when CI
 * doesn't provide a run id.
 */
export const RUN_ID =
  process.env.GITHUB_RUN_ID ??
  process.env.CI_RUN_ID ??
  `local-${Date.now().toString(36)}`;
