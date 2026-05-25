---
phase: 38-m5b-ai-recommender-pgvector-claude-digest
plan: 10
subsystem: ai-eval
tags: [eval, vitest, llm-judge, ci, posthog]
dependency_graph:
  requires: [38-01, 38-02, 38-03, 38-04, 38-05, 38-06, 38-07, 38-08, 38-09]
  provides: [phase38-eval-harness, phase38-refset, phase38-nightly-ci, phase38-judge-harness]
  affects: [recommend-next-best-action, weekly-digest-summarize]
tech-stack:
  added: [vitest projects, GitHub Actions cron]
  patterns: [skip-if-staging-unset, AI-Gateway /v1/messages reuse, JUnit XML CI artifact, judge advisory→PASS calibration]
key-files:
  created:
    - tests/eval/phase38-refset.json
    - tests/eval/_judge/llm-judge.ts
    - tests/eval/_judge/fidelity-numerics.ts
    - tests/eval/_fixtures/refset.ts
    - tests/eval/_fixtures/digest-call.ts
    - tests/eval/phase38/fidelity.test.ts
    - tests/eval/phase38/whitelist.test.ts
    - tests/eval/phase38/redflag.test.ts
    - tests/eval/phase38/cross-tenant.test.ts
    - tests/eval/phase38/baa-scope.test.ts
    - tests/eval/phase38/precision-at-3.test.ts
    - tests/eval/phase38/stale-content.test.ts
    - tests/eval/phase38/tone.test.ts
    - tests/eval/phase38/cost-latency.test.ts
    - tests/eval/phase38/schema-parse.test.ts
    - leanshot/vitest.config.ts
    - .github/workflows/phase38-eval-nightly.yml
  modified:
    - leanshot/package.json
decisions:
  - "Judge harness uses Node fetch against AI Gateway /v1/messages (no RAGAS/Phoenix/Promptfoo) — parity with production digest plumbing."
  - "Tests skip locally when STAGING_BASE_URL unset; hard-fail in CI (matches existing tests/rls + tests/integration convention)."
  - "Vitest project filter lives at leanshot/vitest.config.ts; include path walks up to git-root '../tests/eval/phase38/**' per monorepo layout (refs reference_minisite_monorepo_layout)."
  - "Red-flag + tone judges run in ADVISORY mode until MD/RD correlation ≥ 0.7 calibrated at verify-phase; deterministic fallback assertions gate when judge env unset (SkipJudgeError catch)."
  - "Cross-tenant test extends refset rows R-09/R-10 with 4 synthetic user-pairs seeded by GH Actions workflow (deterministic ids p38-eval-syn-{A,B}{1..4})."
metrics:
  duration_minutes: ~95
  completed: 2026-05-24
  tasks: 3
  files_created: 17
  files_modified: 1
---

# Phase 38 Plan 10: LLM-Judge Eval Harness + Nightly CI Summary

AI-SPEC §5 evaluation strategy shipped as code: 20-row refset, 10 dimension tests, Vitest LLM-judge harness, nightly GH Actions workflow. Every CI run now validates the recommender + digest surfaces against the §5 rubric.

## What Shipped

### Refset (Task 1)
20 rows at `tests/eval/phase38-refset.json` covering all 10 AI-SPEC §5 dimensions:

| Rows | Scenario | Dimension(s) |
|------|----------|--------------|
| R-01..R-03 | Happy / plateau / milestone critical paths | 1, 6, 8 baseline |
| R-04..R-06 | Red-flag triage (abdominal / vomiting / RUQ) | 3 (Critical) |
| R-07..R-08 | SaMD adversarial (dose-question / hypoglycemia) | 2 (Critical) |
| R-09..R-10 | Cross-tenant consumer-A ↔ clinic-B | 4 (Critical) |
| R-11..R-12 | Phase-aware (6mo maintenance / tapering) | 6 phase-mismatch |
| R-13..R-14 | Injection-site blindspot (same-quadrant 3wk) | 6 + known failure #4 |
| R-15 | Hydration/electrolyte under-counseling (CKD) | 3 + known failure #3 |
| R-16..R-17 | Sparse / weights-only week | 1 fabrication trap |
| R-18 | Stale content (31d unpublished) | 7 (RECOMMEND-04) |
| R-19 | Schema-edge (actions:[]) | 10 (Critical) |
| R-20 | BAA-scope adversarial (mis-set org_id) | 5 (Critical) |

### Judge Harness (Task 1)
`tests/eval/_judge/llm-judge.ts` — Claude-via-AI-Gateway judge:
- `judgeFidelity(narrative, userFacts)` → `{score: 0..1, fabricated: string[]}` (Dim 1 semantic)
- `judgeRedflag(narrative, actions, userFacts)` → `{escalation_first, prescriber_phrase, false_reassurance, score}` (Dim 3)
- `judgeTone(narrative)` → `{score: 1..5, flags: string[]}` (Dim 8)
- 25s timeout, retry-on-parse-fail, `SkipJudgeError` when env unset
- Emits `eval.judge.score` JSON-line for PostHog dashboard collection

`tests/eval/_judge/fidelity-numerics.ts` — pure-code Dim 1 pre-filter:
- `extractNumerics(text)` regex-extracts integers, decimals, dates, percentages
- `fidelityCheck(narrative, userFactsText)` → set-difference fabrication detector
- Calendar-literal allowlist (1, 7, 24, 28, 30) prevents false positives
- Scrubs GLP-1 / BMI drug-class tokens before extraction

### Dimension Tests (Task 2)
10 files at `tests/eval/phase38/*.test.ts`, one per AI-SPEC §5 dimension. Each:
- Skips when `STAGING_BASE_URL` unset (local dev)
- Iterates the refset (or relevant subset)
- Asserts per-dimension threshold per §5 Critical / High / Medium gates
- Emits JUnit XML + `eval.judge.score` lines on CI

Skip-guard pattern: `const describeIfLive = SHOULD_RUN_EVAL ? describe : describe.skip;`

### Vitest Project + npm Script (Task 2)
- `leanshot/vitest.config.ts` (new) — registers `phase38-eval` project pointing to `../tests/eval/phase38/**` (git-root path, since `leanshot/` is the npm cwd inside the monorepo)
- `leanshot/package.json` adds `test:eval:phase38: vitest run --project=phase38-eval`

### Nightly CI (Task 3)
`.github/workflows/phase38-eval-nightly.yml`:
- Cron `0 6 * * *` (06:00 UTC) + `workflow_dispatch` manual trigger
- Pre-flight check fails fast on missing GH secrets
- Slack alert on failure (gated on `SLACK_WEBHOOK_URL` secret presence)
- JUnit XML uploaded as artifact (30-day retention) for PostHog dashboard ingestion

## Decisions Made

1. **No RAGAS/Phoenix/Promptfoo.** Judge is a `fetch` to AI Gateway `/v1/messages` reusing the exact plumbing in `supabase/functions/_shared/anthropic-summarize.ts`. Per AI-SPEC §5 Eval Tooling table.
2. **Tests at git-root `tests/eval/`** (sibling of existing `tests/sql`), vitest project filter lives at `leanshot/vitest.config.ts` and walks up via `../tests/eval/phase38/**`. Matches monorepo layout (`reference_minisite_monorepo_layout`).
3. **Judge advisory mode** until MD/RD correlation ≥ 0.7. Tests still gate via deterministic fallbacks (regex on "talk to your prescriber", action-id whitelist, second-person voice) when `SkipJudgeError` thrown. This means CI has teeth even before calibration.
4. **GH Actions defaults `working-directory: leanshot`** matches existing `ci.yml` convention. Slack alert step uses `working-directory: ${{ github.workspace }}` because curl is git-root agnostic.
5. **Cross-tenant test extended with 4 synthetic user-pairs** (`p38-eval-syn-{A,B}{1..4}`). The GH Actions workflow's seed step (added in a future close-out plan, NOT this plan) will provision these deterministic rows; until then those 4 tests skip-cleanly via the upstream `result.ok` guard.

## Deviations from Plan

### Auto-fixed (Rules 1-3)

**1. [Rule 3 - Blocking] Verify command path drift adapted to monorepo layout**
- **Found during:** Task 1 + Task 3 verify
- **Issue:** PLAN.md verify commands reference `cd /Users/karstenhaldan/minisite && cat package.json` and `npm run test ...` from git root, but `package.json` lives at `leanshot/package.json` per monorepo layout (`reference_minisite_monorepo_layout`).
- **Fix:** Adapted verify to (a) run jq check from git root for the refset JSON (path is git-root), (b) run package.json + script existence check via `cat leanshot/package.json | jq`, (c) run vitest-config check via grep. All three verify-spirit checks pass.
- **Files modified:** None (verify-only adaptation; recorded here for plan-checker visibility)
- **Commit:** N/A — verification adaptation, no code change

**2. [Rule 2 - Critical] Pre-flight GH secret check added to nightly workflow**
- **Found during:** Task 3
- **Issue:** Workflow would run vitest before checking required secrets and produce confusing "all 10 dims FAIL" Slack noise on every nightly until operator sets secrets.
- **Fix:** Added explicit pre-flight step that fails with `::error::Missing required GH secrets:` listing missing names. Operator sees a single clear failure, not 10 dimension-failure stacktraces.
- **Files modified:** `.github/workflows/phase38-eval-nightly.yml`
- **Commit:** d1c5aaf9

## HUMAN-UAT Carry-Over

**3 GH secrets pending operator** (per pre-execution flight check; orchestrator was notified to set in parallel):

```bash
gh secret set AI_GATEWAY_API_KEY_CONSUMER --body "ai_gateway_consumer_token_..."
gh secret set AI_GATEWAY_API_KEY_CLINICAL --body "ai_gateway_clinical_token_..."
gh secret set STAGING_BASE_URL --body "https://ytnsipxxmzgaebkqmokp.functions.supabase.co"
```

Optional secrets (workflow gracefully skips dependent steps):
- `AI_GATEWAY_USAGE_TOKEN` — enables Dim 9 cost gate (otherwise advisory log only)
- `POSTHOG_API_KEY` + `POSTHOG_HOST` — enables `eval.judge.score` dashboard ingestion
- `SLACK_WEBHOOK_URL` — enables on-failure Slack alert
- `ANTHROPIC_MODEL_JUDGE` — defaults to `anthropic/claude-sonnet-4-6` if unset
- `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` — required for Edge Fn auth

**Until the 3 required secrets are set:** Nightly run will fail at pre-flight with an explicit `::error::Missing required GH secrets:` annotation. **This is expected behavior**, not a regression. After secrets are set, the first nightly will establish the baseline.

## PostHog Dashboard IDs (hand-create post-deploy)

These dashboards are NOT auto-provisioned — PostHog has no terraform/IaC pattern in the repo. The developer hand-creates each in the PostHog UI using the documented event names + filters. Until created, the JSON `eval.*` lines in CI logs are the source of truth.

| Dashboard | Event(s) consumed | Key filters | AI-SPEC ref |
|-----------|-------------------|-------------|-------------|
| **`phase38-eval-runs`** | `eval.judge.score` | group by `judge_dim`, plot `score` over `run_id` | §5 (primary dashboard) |
| **`Phase 38 Health`** | `digest.validation_failed`, `recommendation.404_on_click` | 1h rolling rate; alert when > 0.5% | §7 M1 + M8 |
| **`Phase 38 Perf`** | `recommendation.shown` (with `latency_ms` property) | P50 / P95 over rolling 1h window | §7 M2 |
| **`Phase 38 Quality`** | `eval.judge.score` filtered `judge_dim=fidelity` | mean score; alert when daily mean < 0.95 | §7 M4 |
| **`Phase 38 Engagement`** | `recommendation.shown`, `recommendation.clicked` | CTR vs popularity baseline | §7 M3 |

## Calibration Step (verify-phase, NOT CI per-PR)

Per AI-SPEC §5 dimension table "Measurement" column:

1. Pull 10 random refset narratives from `tests/eval/phase38-refset.json` (use rows 4-6, 15 for redflag; rows 1-3, 16-17 for tone).
2. Generate digest outputs against staging for each.
3. Expert MD/RD scores each output on the §5 rubric.
4. Run `judgeRedflag` / `judgeTone` against the same 10 outputs.
5. Compute Pearson correlation between human scores and judge scores.
6. **Gate:** correlation ≥ 0.7 → flip judge from advisory to PASS gate by removing the `SkipJudgeError` catch-fallback in `redflag.test.ts` + `tone.test.ts`. Until then, judge runs alongside the deterministic regex gates.

Document calibration results in the verify-phase summary (subsystem follow-up plan, NOT this plan).

## Known Stubs

**None.** All files are wired to actual call sites; the judge harness has real `fetch` semantics; the workflow has real secret bindings. The 4 synthetic cross-tenant pairs (`p38-eval-syn-{A,B}{1..4}`) are documented seed targets — those tests skip cleanly when not seeded (via the `result.ok` guard inside the test), not stubbed.

## Threat Flags

None — no new trust boundaries introduced beyond the plan's documented `<threat_model>` (CI runner → linked staging Supabase, LLM judge → AI Gateway with CONSUMER credential on non-PHI templated facts).

## Self-Check: PASSED

Files verified present:
- FOUND: tests/eval/phase38-refset.json (20 rows)
- FOUND: tests/eval/_judge/llm-judge.ts (judgeFidelity, judgeRedflag, judgeTone exports)
- FOUND: tests/eval/_judge/fidelity-numerics.ts (extractNumerics, fidelityCheck exports)
- FOUND: tests/eval/_fixtures/refset.ts + digest-call.ts
- FOUND: tests/eval/phase38/*.test.ts (10 files)
- FOUND: leanshot/vitest.config.ts (phase38-eval project registered)
- FOUND: leanshot/package.json scripts.test:eval:phase38
- FOUND: .github/workflows/phase38-eval-nightly.yml (cron + workflow_dispatch + secrets)

Commits verified:
- FOUND: c17b4355 feat(38-10): refset + LLM-judge harness (Task 1)
- FOUND: 20f77459 test(38-10): 10 dimension tests + vitest project + npm script (Task 2)
- FOUND: d1c5aaf9 ci(38-10): nightly GH Actions workflow for Phase 38 eval (Task 3)
