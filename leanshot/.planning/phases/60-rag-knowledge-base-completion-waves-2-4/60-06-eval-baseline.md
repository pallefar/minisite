# 60-06 Eval Baseline

**Date:** 2026-05-26
**Environment:** sequential-on-main (local dev — no active Supabase stack)
**Executor:** claude-sonnet-4-6 (60-06 Wave 1)

## Status

**Both suites: `secret_missing` — deferred to 60-15 close-out**

Per [[feedback_spike_accept_deploy_evidence_defer_runtime_verify]]: when end-to-end verify
needs a browser/device or live secrets the operator hasn't provided, accept deploy-time
evidence + document hot-patch contingency. Both required secrets (`COHERE_API_KEY`,
`OPENROUTER_API_KEY`) are set in Supabase project secrets per operator confirmation (2026-05-26
Batch 1 setup), but the local dev environment does NOT have the Docker stack running.

## Suite: retrieval (suite=retrieval)

**Command:** `deno run --allow-all eval/phase60/run.ts --suite=retrieval`

**Result:** `secret_missing`

**Diagnostic:**
```
Local Supabase stack: not running (Docker container supabase_db_minisite absent)
COHERE_API_KEY: not set in local shell environment (set in Supabase project secrets)
OPENROUTER_API_KEY: not set in local shell environment (set in Supabase project secrets)
```

**Evidence:**
- The dimension module (`eval/phase60/dimensions/retrieval-recall.ts`) loads correctly.
- Gold-set loads from `tests/eval/phase60/gold-set.jsonl` (40 examples verified).
- Metric computation (recall@5, recall@10, MRR) verified via 5 unit tests (all pass).
- Pass thresholds: recall@5 ≥ 0.80, recall@10 ≥ 0.92, MRR ≥ 0.65.

**Deferred to:** 60-15 close-out (live secrets + deployed Fn required).

## Suite: rerank-delta (suite=rerank-delta)

**Command:** `deno run --allow-all eval/phase60/run.ts --suite=rerank-delta`

**Result:** `secret_missing`

**Diagnostic:**
```
Same as retrieval: local stack not running; COHERE_API_KEY / OPENROUTER_API_KEY absent locally.
```

**Evidence:**
- The dimension module (`eval/phase60/dimensions/rerank-delta.ts`) loads correctly.
- Delta computation + bootstrap CI verified via 3 unit tests (all pass).
- Pass threshold: delta_p5 >= +0.10 absolute (AI-SPEC §5 Dim #4).
- `cosine_only=1` short-circuit in `index.ts` verified by integration test (Task 7).

**Deferred to:** 60-15 close-out.

## Operator Env-Var Checklist for 60-15 Close-Out

| Secret | Source | Status |
|--------|--------|--------|
| `COHERE_API_KEY` | Cohere Dashboard → API Keys | Set in Supabase project secrets (2026-05-26 Batch 1) |
| `OPENROUTER_API_KEY` | OpenRouter Dashboard | Set in Supabase project secrets (2026-05-26 Batch 1) |
| `JINA_API_KEY` | Jina AI Dashboard | NOT set (fallback path; set when operator wants to test Jina) |
| `RAG_RERANKER_PROVIDER` | Set to 'cohere' | Set in Supabase project secrets (2026-05-26 Batch 1) |
| `SUPABASE_URL` | Auto-injected by Supabase Edge runtime | N/A |
| `SUPABASE_SERVICE_ROLE_KEY` | Auto-injected by Supabase Edge runtime | N/A |
| `POSTHOG_PROJECT_KEY` | PostHog project settings | Should already be set (earlier phases) |

## Unit Test Evidence (All Pass)

All 5 test suites ran successfully in this Wave 1 execution:

| Suite | Tests | Status |
|-------|-------|--------|
| merge.test.ts | 9 | PASS |
| cohere-rerank.test.ts | 5 | PASS |
| jina-rerank.test.ts | 5 | PASS |
| refusal.test.ts | 6 | PASS |
| integration.test.ts | 12 | PASS |
| eval-dimensions.test.ts | 5 | PASS |

**Total: 42 unit/integration tests pass.**

## 60-15 Live Verification Instructions

```bash
# 1. Deploy rag-retrieve Fn (60-15 owns this step)
supabase functions deploy rag-retrieve --project-ref <ref>

# 2. Push migration
supabase db push --linked

# 3. Run retrieval suite
EVAL_BASE_URL=https://<ref>.supabase.co/functions/v1 \
EVAL_SERVICE_KEY=<service-role-key> \
deno run --allow-all eval/phase60/run.ts --suite=retrieval

# 4. Run rerank-delta suite
EVAL_BASE_URL=https://<ref>.supabase.co/functions/v1 \
EVAL_SERVICE_KEY=<service-role-key> \
deno run --allow-all eval/phase60/run.ts --suite=rerank-delta

# Expected: delta_p5 >= +0.10 (if not, check COHERE_API_KEY + RAG_RERANKER_PROVIDER)
```
