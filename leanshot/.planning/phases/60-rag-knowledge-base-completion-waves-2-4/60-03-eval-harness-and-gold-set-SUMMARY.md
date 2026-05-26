---
phase: 60-rag-knowledge-base-completion-waves-2-4
plan: 03
subsystem: testing
tags: [vitest, eval-harness, rag, gold-set, jsonl, posthog, github-actions, zod]

requires:
  - phase: 60-02-shared-edge-helpers
    provides: rag-retrieve HTTP client helper (referenced by _lib/rag-client.ts patterns)

provides:
  - "120-example labeled JSONL fixture dataset (40 core + 80 MVP adversarial) for AI-SPEC §5 dimensions"
  - "13 RED-state Vitest test files covering all AI-SPEC §5 dimensions (#1-#13 + safety meta-suite + AI04-fence)"
  - "phase60-eval Vitest project block in vitest.config.ts (sibling to phase38-eval)"
  - "test:eval:phase60 npm script with EVAL_SUITE/EVAL_STRICT env var suite-flag protocol"
  - ".github/workflows/eval-phase60.yml PR-gate + nightly CI workflow"
  - "Shared _lib/ helpers: load-fixtures (Zod), suite-flag (env var), rag-client (EvalFnAbsentError), posthog-emit"

affects:
  - 60-04-summarizer-chunker-fn
  - 60-05-embed-pipeline-fn
  - 60-06-retrieval-and-rerank-fn
  - 60-07-federated-adapters-fn
  - 60-11-tip-of-day-card-and-fn
  - 60-13-public-knowledge-hub
  - 60-15-deploy-fns-push-schema-cron

tech-stack:
  added:
    - "zod ^4.0.0 (devDependency — explicit; was transitive before)"
  patterns:
    - "EVAL_SUITE env var (not CLI --suite flag) for Vitest worker-compatible suite selection"
    - "EvalFnAbsentError class for RED-state contract: 404 or missing EVAL_BASE_URL"
    - "loadFixture() with zod schema validation + line-precise error messages"
    - "emitAiEvaluation() + flushAiEvaluations() pattern: synchronous queue + async batch flush"
    - "describe.skipIf(!shouldRunSuite(SUITE)) per-file suite gate"
    - "Exported runXxx() harness helpers for safety.test.ts meta-suite composition"
    - "PLACEHOLDER-<bucket>-<NN> UUID convention: backfilled by 60-06 after chunker seeds DB"

key-files:
  created:
    - tests/eval/phase60/gold-set.jsonl
    - tests/eval/phase60/adversarial/out-of-corpus.jsonl
    - tests/eval/phase60/adversarial/in-corpus-borderline.jsonl
    - tests/eval/phase60/adversarial/pharma02-carveout.jsonl
    - tests/eval/phase60/adversarial/fda-equivalence.jsonl
    - tests/eval/phase60/adversarial/kanon.jsonl
    - tests/eval/phase60/adversarial/drug-stack.jsonl
    - tests/eval/phase60/adversarial/stale-drift-extension.jsonl
    - tests/eval/phase60/README.md
    - tests/eval/phase60/_lib/load-fixtures.ts
    - tests/eval/phase60/_lib/suite-flag.ts
    - tests/eval/phase60/_lib/rag-client.ts
    - tests/eval/phase60/_lib/posthog-emit.ts
    - tests/eval/phase60/citation.test.ts
    - tests/eval/phase60/refusal.test.ts
    - tests/eval/phase60/recall-mrr.test.ts
    - tests/eval/phase60/rerank-delta.test.ts
    - tests/eval/phase60/contraindication.test.ts
    - tests/eval/phase60/tier-transparency.test.ts
    - tests/eval/phase60/kanon.test.ts
    - tests/eval/phase60/fda-equivalence.test.ts
    - tests/eval/phase60/stale-drift.test.ts
    - tests/eval/phase60/cost.test.ts
    - tests/eval/phase60/tip-personalization.test.ts
    - tests/eval/phase60/ai04-fence.test.ts
    - tests/eval/phase60/safety.test.ts
    - tests/eval/phase60/RED-STATE-EVIDENCE.md
    - .github/workflows/eval-phase60.yml
  modified:
    - leanshot/vitest.config.ts
    - leanshot/package.json

key-decisions:
  - "Use EVAL_SUITE env var (not --suite CLI flag) for suite selection — Vitest 4.x workers don't inherit CLI args before --"
  - "Zod v4 (transitive) pinned explicitly as devDependency for load-fixtures.ts schema validation"
  - "safety.test.ts is a meta-suite that imports runXxx() helpers (not re-importing .test.ts files) to avoid double-execution"
  - "PLACEHOLDER-<bucket>-<NN> UUIDs in gold-set; Wave 1 (60-06) backfills with real chunk_ids after first chunker run"
  - "41 deferred adversarial examples (fda-equivalence/kanon/drug-stack/stale-drift-extension) are NOT scope reduction — owner plans (60-04/06/07/13) fill inline during execution with regulatory/clinical expert review"

requirements-completed:
  - RAG-04
  - RAG-05

duration: 90min
completed: 2026-05-26
---

# Phase 60 Plan 03: Eval Harness and Gold-Set Summary

**120-example labeled GLP-1 JSONL gold-set + 13 RED-state Vitest test scaffolds for all AI-SPEC §5 dimensions + phase60-eval Vitest project + PR-gate CI workflow, all failing via EvalFnAbsentError before RAG Edge Fns ship**

## Performance

- **Duration:** ~90 min
- **Started:** 2026-05-26T05:37:40Z
- **Completed:** 2026-05-26T07:55:00Z
- **Tasks:** 6/6
- **Files modified:** 34 files created/modified

## Accomplishments

- 40 core gold-set examples across 8 AI-SPEC §5 buckets (titration, contraindication, red_flag, tier_a_boost, freshness, general GLP-1 Q&A) with realistic patient queries and PLACEHOLDER UUID citations
- 80 MVP adversarial examples: 30 out-of-corpus peptide/off-label probes, 30 in-corpus borderline synonym/vernacular probes, 20 PHARMA-02 compounded dosing carveout probes
- 13 RED-state test files: all 387 tests collect, 383 fail via EvalFnAbsentError when EVAL_BASE_URL unset
- `phase60-eval` Vitest project wired as sibling to `phase38-eval` — both coexist in vitest.config.ts, neither breaks the other
- PR-gate CI workflow fires on RAG source file touches with 4 CI-gating suites (refusal/citation/safety/kanon)

## Task Commits

1. **Task 1: Gold-set + adversarial JSONL fixtures** — `f823b5f4` (feat)
2. **Task 2: _lib helpers (load-fixtures, suite-flag, rag-client, posthog-emit)** — `fd6e5d85` (feat)
3. **Task 3: 13 RED-state dimension test scaffolds** — `c1cbb065` (feat)
4. **Task 4: Vitest project config + npm script** — `3a20f7f1` (chore)
5. **Task 5: RED-state evidence + suite-flag env-var fix** — `3edae586` (docs)
6. **Task 6: eval-phase60 CI workflow** — `d74492ae` (feat)

## Files Created/Modified

- `tests/eval/phase60/gold-set.jsonl` — 40 core labeled examples across 8 AI-SPEC §5 buckets
- `tests/eval/phase60/adversarial/` — 4 MVP adversarial files (30+30+20 authored; 4 stubs with 1 placeholder each)
- `tests/eval/phase60/_lib/load-fixtures.ts` — GoldExampleSchema (zod) + loadFixture() with line-precise errors
- `tests/eval/phase60/_lib/suite-flag.ts` — EVAL_SUITE/EVAL_STRICT env var parser + shouldRunSuite()
- `tests/eval/phase60/_lib/rag-client.ts` — EvalFnAbsentError + CitedAnswerSchema + callRagRetrieve/Synthesize/TipOfDay
- `tests/eval/phase60/_lib/posthog-emit.ts` — $ai_evaluation batch emitter via Node fetch; no-op when key unset
- `tests/eval/phase60/*.test.ts` — 13 RED-state dimension test files
- `tests/eval/phase60/RED-STATE-EVIDENCE.md` — Captured evidence of correct RED state
- `tests/eval/phase60/README.md` — Dim→file mapping, fixture inventory, placeholder convention, author TODO list
- `.github/workflows/eval-phase60.yml` — PR gate + nightly 02:00 UTC cron
- `leanshot/vitest.config.ts` — Added phase60-eval project block
- `leanshot/package.json` — Added test:eval:phase60 script + zod devDependency

## Decisions Made

1. **EVAL_SUITE env var over --suite CLI flag** — Vitest 4.x forks test workers; `--suite` in process.argv is not reliably available inside worker processes. `EVAL_SUITE=refusal npm run test:eval:phase60` is the reliable invocation.

2. **Zod v4 explicit devDependency** — zod 4.4.3 was already in node_modules (transitive from other deps). Added as explicit devDependency so `import { z } from 'zod'` is auditable.

3. **safety.test.ts meta-suite via exported runners** — Each dimension test file exports a `runDimXxx(): Promise<{pass, total, failures}>` helper. safety.test.ts imports and composes these, avoiding double-execution of describe blocks.

4. **41 deferred adversarial examples are not scope reduction** — fda-equivalence (14), kanon (9), drug-stack (19), stale-drift-extension (5) require regulatory counsel sign-off and clinical pharmacist input. Each deferred file has a 1-example placeholder and `_TODO_INLINE` marker. Owner plans fill during execution.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] suite-flag.ts uses EVAL_SUITE env var instead of --suite CLI arg**
- **Found during:** Task 5 (RED-state evidence capture)
- **Issue:** `--suite=refusal` passed after npm script raises `CACError: Unknown option --suite` in Vitest 4.x. The `--` separator approach does not forward args to the test worker's `process.argv`.
- **Fix:** Updated `suite-flag.ts` to check `process.env['EVAL_SUITE']` first (reliable in Vitest workers), falling back to `process.argv` for direct node invocations. CI workflow updated to use env vars. RED-STATE-EVIDENCE.md documents the `EVAL_SUITE=refusal` invocation pattern.
- **Files modified:** tests/eval/phase60/_lib/suite-flag.ts, tests/eval/phase60/RED-STATE-EVIDENCE.md
- **Verification:** `EVAL_SUITE=refusal npm run test:eval:phase60` runs 2 files / skips 11; `EVAL_SUITE=safety EVAL_STRICT=true` runs 1 file / skips 12 with exit code 1
- **Committed in:** 3edae586 (Task 5 commit)

---

**Total deviations:** 1 auto-fixed (Rule 1 - Bug: CLI arg not forwarded to Vitest worker)
**Impact on plan:** Suite filtering works correctly via env vars. The PLAN.md spec "pass `--suite` via CLI" is honored by documenting the env-var equivalent invocation in README.md and RED-STATE-EVIDENCE.md.

## Issues Encountered

None — besides the suite-flag CLI forwarding issue above, execution followed the plan exactly.

## Known Stubs

| Stub | File | Reason |
|------|------|--------|
| `must_cite_chunk_ids: ["PLACEHOLDER-<bucket>-<NN>"]` | `gold-set.jsonl` all 40 examples | RAG chunker (60-04) has not run yet; real chunk_ids unknown. Wave 1 backfills via backfill-placeholder-uuids.ts script (owned by 60-06). |
| 1 example placeholder in `fda-equivalence.jsonl` | adversarial/ | 14 remaining require regulatory_counsel sign-off (60-04 owner) |
| 1 example placeholder in `kanon.jsonl` | adversarial/ | 9 remaining authored during 60-13 |
| 1 example placeholder in `drug-stack.jsonl` | adversarial/ | 19 remaining authored during 60-06 |
| 1 example placeholder in `stale-drift-extension.jsonl` | adversarial/ | 5 remaining authored during 60-07 |

These stubs are intentional and documented as author-during-execution work in README.md. They do NOT prevent the plan's goal (RED-state harness with telemetry) from being achieved.

## Threat Flags

| Flag | File | Description |
|------|------|-------------|
| threat_flag: information_disclosure | tests/eval/phase60/gold-set.jsonl | Fixtures are in public repo. README.md authoring policy + Layer 2 grep-gate (60-06) ensure no PII. All 120 examples use synthetic/regulatory-public queries only. |

## Next Phase Readiness

- **60-04 chunker**: Can use `EVAL_SUITE=recall-mrr npm run test:eval:phase60` as its verify step to confirm chunk retrieval
- **60-05 embed**: No eval harness dependency (embedding is internal pipeline step)
- **60-06 retrieve+rerank**: Key consumer — citation, recall-mrr, rerank-delta, tier-transparency, cost, contraindication suites gate this plan's verify
- **60-07 federated**: stale-drift and fda-equivalence suites gate this plan's verify
- **Operator pre-dispatch**: Set `PHASE60_EVAL_BASE_URL`, `PHASE60_EVAL_SERVICE_KEY` as GH secrets before first Wave 1 PR

---
*Phase: 60-rag-knowledge-base-completion-waves-2-4*
*Completed: 2026-05-26*
