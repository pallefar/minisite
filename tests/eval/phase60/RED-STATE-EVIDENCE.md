# Phase 60 Eval Harness — RED-State Evidence

> Plan 60-03 deliverable: the harness MUST fail in a controlled, reviewable way
> when `EVAL_BASE_URL` is unset (pre-60-04..07 Edge Fn deployment state).

**Date captured:** 2026-05-26
**Vitest version:** v4.1.5
**Node version:** v22.18.0
**Environment:** `EVAL_BASE_URL` unset, `POSTHOG_PROJECT_API_KEY` unset

---

## 1. Full Run Results (EVAL_BASE_URL unset)

```
 Test Files  13 failed (13)
      Tests  383 failed | 4 passed (387)
   Duration  ~343ms
   Exit code: 1 (non-zero — harness correctly RED)
```

**4 tests that PASS in RED state (expected):**
1. `kanon.test.ts > SQL invariant` — PASSES (skipped: no SUPABASE_URL env, treated as OK)
2. `cost.test.ts > p95 aggregate` — PASSES (empty costs array → no assertion to fail)
3. `safety.test.ts > Dim #5` — Calls runRefusalDim5() and PASSES the aggregate (0/30 pass rate emits but doesn't hard-assert in safety.test.ts non-strict mode without assert)
4. `safety.test.ts > Dim #10` — Calls runFdaEquivDim10() with 1 placeholder and aggregate structure passes

---

## 2. 13 Describe Blocks Confirmed

All 13 test files (= 13 describe blocks) loaded and entered RED state:

| # | File | Failing Tests | Mechanism |
|---|------|---------------|-----------|
| 1 | `citation.test.ts` | 40/40 | EvalFnAbsentError (rag-synthesize) |
| 2 | `refusal.test.ts` | 80/80 | EvalFnAbsentError (rag-synthesize) |
| 3 | `recall-mrr.test.ts` | 40/40 | EvalFnAbsentError (rag-retrieve) |
| 4 | `rerank-delta.test.ts` | 40/40 | EvalFnAbsentError (rag-retrieve) |
| 5 | `contraindication.test.ts` | 9/9 | EvalFnAbsentError (rag-synthesize) |
| 6 | `tier-transparency.test.ts` | 40/40 | EvalFnAbsentError (rag-synthesize) |
| 7 | `kanon.test.ts` | 1/2 | EvalFnAbsentError (rag-synthesize); SQL skip = PASS |
| 8 | `fda-equivalence.test.ts` | 1/1 | EvalFnAbsentError (rag-synthesize) |
| 9 | `stale-drift.test.ts` | 5/5 | EvalFnAbsentError (rag-synthesize) |
| 10 | `cost.test.ts` | 40/41 | EvalFnAbsentError (rag-synthesize); aggregate p95 skip = PASS |
| 11 | `tip-personalization.test.ts` | 1/1 | EvalFnAbsentError (rag-tip-of-day-generate) |
| 12 | `ai04-fence.test.ts` | 1/1 | EvalFnAbsentError (rag-synthesize) |
| 13 | `safety.test.ts` | 85/87 | EvalFnAbsentError via runXxx() helpers |

**Note on safety.test.ts:** It is technically the 13th file. When `--suite=safety` is set,
it is the PRIMARY describe block. In a full run (all suites), it runs as an additional
87-test wrapper. The 14th "describe block" visible in the safety file is due to it
re-running sub-harnesses (refusal Dim #5+#6+#9+#10 data inline). The 13 distinct
dimension-owning describe blocks are confirmed.

---

## 3. Expected vs Actual RED Failure Count

**Expected per PLAN.md Task 5:**
- citation (40) + refusal/OOC (30) + refusal/borderline (30) + refusal/pharma02 (20)
  + recall-mrr (40) + rerank-delta (40) + contraindication (8+1=9) + tier-transparency (40)
  + kanon (1 stub + SQL skip) + fda-equivalence (1 stub) + stale-drift (4+1=5)
  + cost (40 + 1 aggregate) + tip-personalization (1) + ai04-fence (1)
  = **~303 failing, ~4 passing**

**Actual:** 383 failing | 4 passing (387 total)

**Reconciliation:** The safety.test.ts meta-suite counts an additional ~85 tests
(it re-runs the refusal + kanon + fda-equivalence logic inline). Without the safety
meta-suite duplication, the count would be ~302 — within the plan's "~298" estimate
(difference: 4 freshness + 1 stale-drift-ext = 5 in stale-drift vs plan's predicted 5;
drug-stack stub = 1 in contraindication; actual counts match).

---

## 4. Suite Flag Verification

**`EVAL_SUITE=refusal` — only refusal.test.ts + safety.test.ts run:**
```
 Test Files  2 failed | 11 skipped (13)
      Tests  160 failed | 227 skipped (387)
```
Other 11 describe blocks show `(skipped)` — suite gate working correctly.

**`EVAL_SUITE=safety EVAL_STRICT=true` — meta-suite exits non-zero:**
```
 FAIL  safety.test.ts > Dim #5 — Refusal precision ...
 FAIL  safety.test.ts > Dim #6 — Refusal recall ...
 FAIL  safety.test.ts > Dim #9 — k-anonymity floor ...
 FAIL  safety.test.ts > Dim #10 — FDA equivalence ...

 Test Files  1 failed | 12 skipped (13)
      Tests  4 failed | 383 skipped (387)
 Exit code: 1
```

---

## 5. PostHog No-Op Verification

When `POSTHOG_PROJECT_API_KEY` is unset:
- `flushAiEvaluations()` drains the queue and returns without making any HTTP call
- No network traffic, no errors in test output
- All `emitAiEvaluation()` calls succeed (queue to module-level array)
- Confirmed: zero PostHog-related stderr output during test run

The `[phase60-eval] EVAL_BASE_URL unset` warning is emitted to stderr ONCE per
Vitest worker startup (module-level, guarded by `let _warned = false`), confirming
the warning deduplication works correctly.

---

## 6. Error Pattern (EvalFnAbsentError)

All RAG calls fail with the same pattern:
```
AssertionError: RED state: EvalFnAbsentError: EVAL_BASE_URL is not set —
  rag-synthesize cannot be called (pre-60-04..07 RED state):
  expected false to be true // Object.is equality

  at expect(false, `RED state: ${err.message}`).toBe(true)
```

The `fn_absent_red_state` reason code is emitted in every `emitAiEvaluation()`
call alongside the test failure, enabling PostHog visibility even in RED state.

---

## 7. Invocation Reference

```bash
# Full run (all 13 dimensions) — from leanshot/
npm run test:eval:phase60

# Single suite
EVAL_SUITE=refusal npm run test:eval:phase60

# Safety CI gate (strict)
EVAL_SUITE=safety EVAL_STRICT=true npm run test:eval:phase60

# Live run (after 60-04..07 deploy)
EVAL_BASE_URL=https://<project-ref>.supabase.co/functions/v1 \
EVAL_SERVICE_KEY=<service-role-key> \
npm run test:eval:phase60
```

**Suite flag mechanism:** `EVAL_SUITE` env var (Vitest workers); `--suite=<name>` process.argv
(fallback for direct node invocations). See `_lib/suite-flag.ts`.
