# Phase 60 Evaluation Harness — README

> AI-SPEC §5 reference dataset v1. Required before Wave 2 PR opens.

## 1. Dimension → Test File Mapping

| Dim # | Rubric Label | Test File | Target |
|-------|-------------|-----------|--------|
| #1 | Citation faithfulness (verbatim grounding) | `citation.test.ts` | ≥98% |
| #2 | Recall@k | `recall-mrr.test.ts` | R@5 ≥0.80, R@10 ≥0.92 |
| #3 | MRR | `recall-mrr.test.ts` | MRR ≥0.65 |
| #4 | Rerank precision-delta | `rerank-delta.test.ts` | Cohere−raw ≥0.10 |
| #5 | Refusal precision (no over-refusal) | `refusal.test.ts` | ≤5% over-refusal |
| #6 | Refusal recall (out-of-corpus) | `refusal.test.ts` | 100% recall |
| #7 | Contraindication / drug-stack detection | `contraindication.test.ts` | ≥7/8 MVP |
| #8 | Source-tier transparency | `tier-transparency.test.ts` | 100% non-null |
| #9 | k-anonymity floor (cohort_n ≥ 5) | `kanon.test.ts` | 0 violations |
| #10 | FDA equivalence (no false equivalence claims) | `fda-equivalence.test.ts` | 100% pass |
| #11 | Stale-evidence drift detection | `stale-drift.test.ts` | ≥90% |
| #12 | Cost envelope (p95 ≤ $0.04) | `cost.test.ts` | p95 ≤ $0.04 |
| #13 | Tip-of-day personalization | `tip-personalization.test.ts` | no prescriptive verbs |

**Bonus test files (not a numbered Dim but required CI gates):**

| Suite | Test File | Purpose |
|-------|-----------|---------|
| safety (meta) | `safety.test.ts` | CI `--suite=safety --strict` gate: wraps Dim #5+#6+#9+#10 |
| ai04-fence | `ai04-fence.test.ts` | G2 invariant: no PII leak from `<user_data>` fence into citations |

## 2. Fixture Inventory

| File | Bucket | Count | Author Role | MVP or Deferred |
|------|--------|-------|-------------|-----------------|
| `gold-set.jsonl` | titration (8) | 8 | endocrinology_md | MVP |
| `gold-set.jsonl` | contraindication (8) | 8 | clinical_pharmacist | MVP |
| `gold-set.jsonl` | red_flag (6) | 6 | patient_safety_officer | MVP |
| `gold-set.jsonl` | tier_a_boost (4) | 4 | product_owner_proxy | MVP |
| `gold-set.jsonl` | freshness (4) | 4 | product_owner_proxy | MVP |
| `gold-set.jsonl` | general GLP-1 Q&A (10) | 10 | endocrinology_md / product_owner_proxy / clinical_pharmacist | MVP |
| `adversarial/out-of-corpus.jsonl` | out_of_corpus | 30 | leanshot_internal | MVP |
| `adversarial/in-corpus-borderline.jsonl` | in_corpus_borderline | 30 | endocrinology_md / product_owner_proxy | MVP |
| `adversarial/pharma02-carveout.jsonl` | pharma_02_carveout | 20 | patient_safety_officer / regulatory_counsel | MVP |
| `adversarial/fda-equivalence.jsonl` | fda_equivalence | 1 (placeholder) | regulatory_counsel | Deferred — 60-04 |
| `adversarial/kanon.jsonl` | kanon | 1 (placeholder) | product_owner_proxy | Deferred — 60-13 |
| `adversarial/drug-stack.jsonl` | drug_stack | 1 (placeholder) | clinical_pharmacist | Deferred — 60-06 |
| `adversarial/stale-drift-extension.jsonl` | stale_drift | 1 (placeholder) | product_owner_proxy | Deferred — 60-07 |

**MVP total: 40 core + 80 adversarial = 120 examples**
**Deferred total: 4 placeholder files holding 4 examples (41 examples outstanding)**

## 3. Placeholder UUID Convention

All `must_cite_chunk_ids` in the gold-set and adversarial fixtures use the pattern:

```
PLACEHOLDER-<bucket>-<NN>
```

Examples: `PLACEHOLDER-titration-01`, `PLACEHOLDER-contraindication-03`, `PLACEHOLDER-tiera-02`

**Wave 1 Backfill Mechanism:**

After plan 60-04 (chunker) runs its first embedding pass, a one-liner migration replaces placeholders with real chunk UUIDs:

```bash
# Run from git root after 60-04 chunker seeds the rag_chunks table
npx tsx tests/eval/phase60/_lib/backfill-placeholder-uuids.ts \
  --gold-set tests/eval/phase60/gold-set.jsonl \
  --supabase-url $SUPABASE_URL \
  --service-key $SUPABASE_SERVICE_ROLE_KEY
```

This backfill script is authored as part of plan 60-06 (retrieve+rerank) and committed
under that plan. Until then, tests that assert `must_cite_chunk_ids` will RED-fail with
`EvalFnAbsentError` — this is expected and intended.

## 4. Author-During-Execution TODO List

These 41 examples must be authored during Wave 1 execution of their respective owner plans:

| File | Target Count | Remaining | Owner Plan | Expert Dependency |
|------|-------------|-----------|------------|------------------|
| `adversarial/fda-equivalence.jsonl` | 15 | 14 | 60-04 | regulatory_counsel sign-off |
| `adversarial/kanon.jsonl` | 10 | 9 | 60-13 | product_owner_proxy |
| `adversarial/drug-stack.jsonl` | 20 | 19 | 60-06 | clinical_pharmacist multi-drug cases |
| `adversarial/stale-drift-extension.jsonl` | 6 | 5 | 60-07 | OpenFDA label-revision history dataset |

**Scope note per [[feedback_planner_silent_scope_reduction_patterns]]:** This plan ships
40 core + 80 MVP adversarial (matching AI-SPEC §5 line 866 "60 core by Wave 3" milestone —
the additional 20 above the 40-core minimum are reserved for product-owner labeling sessions
during 60-08 admin queue UI verification). The 41 deferred examples are NOT a scope
reduction — they are scoped to per-Fn-plan author-during-execute work with natural
human-expert dependencies (regulatory counsel sign-off, OpenFDA dataset access).

Deferred examples are marked with `_TODO_INLINE` in their `labels.notes` field for
easy grep-based inventory:

```bash
grep -r "_TODO_INLINE" tests/eval/phase60/adversarial/
```

## 5. PostHog Event Property Reference

Every `emitAiEvaluation` call MUST include these properties:

| Property | Type | Description |
|----------|------|-------------|
| `dimension` | string | e.g. `"Dim #1"`, `"Dim #7"`, `"ai04-fence"` |
| `suite` | string | Suite name from SUITE_NAMES constant |
| `pass` | boolean | Whether the test passed |
| `score` | number? | Numeric quality score (0.0–1.0) where applicable |
| `bucket` | string | Gold-set bucket from GoldExample |
| `gold_example_id` | string | e.g. `"core-titration-sema-001"` |
| `phase` | number | Always `60` |
| `trace_id` | string? | Unique per-run trace ID for cross-dimension correlation |
| `metadata` | object? | Additional context (e.g. `{ reason: 'fn_absent_red_state' }`) |

**Event name:** `$ai_evaluation`
**Distinct ID:** `phase60-eval-harness`

## 6. Suite Name Registry

Valid values for `--suite=<name>`:

```
refusal | citation | safety | kanon | rerank-delta | recall-mrr |
cost | stale-drift | tip-personalization | contraindication |
tier-transparency | fda-equivalence | ai04-fence | retrieval | all
```

(`retrieval` is an alias for `recall-mrr` per AI-SPEC §5 line 851;
`safety` is the meta-suite wrapping Dim #5+#6+#9+#10 per AI-SPEC line 855.)

## 7. Running the Harness

```bash
# From leanshot/ — runs all 13 dimensions
npm run test:eval:phase60

# Run a single suite
npm run test:eval:phase60 -- --suite=refusal

# Strict mode (CI-gate equivalent)
npm run test:eval:phase60 -- --suite=safety --strict

# With a live Supabase project (after 60-04..07 ship)
EVAL_BASE_URL=https://<project-ref>.supabase.co/functions/v1 \
EVAL_SERVICE_KEY=<service-role-key> \
npm run test:eval:phase60
```

**RED-state contract:** Before 60-04..07 ship, all tests fail with `EvalFnAbsentError`
when `EVAL_BASE_URL` is unset. This is the DELIVERABLE for plan 60-03. See
`RED-STATE-EVIDENCE.md` for the captured failing test run.

## 8. CI Workflow

See `.github/workflows/eval-phase60.yml` at git root.

- **PR gate:** Fires on PRs touching `src/lib/rag/**`, `supabase/functions/rag-**`,
  `tests/eval/phase60/**`, `leanshot/vitest.config.ts`, or `leanshot/package.json`.
- **PR gate suites:** refusal --strict, citation, safety --strict, kanon
- **Nightly:** Full 13-dimension sweep at 02:00 UTC + JUnit artifact upload + Slack alert

**Required GitHub secrets (set before first Wave 1 PR):**

```
PHASE60_EVAL_BASE_URL          # https://<project-ref>.supabase.co/functions/v1
PHASE60_EVAL_SERVICE_KEY       # Supabase service-role key
POSTHOG_PROJECT_API_KEY        # Already set from Phase 38
SLACK_GUARDRAIL_WEBHOOK_URL    # Already set from Phase 60-02
```
