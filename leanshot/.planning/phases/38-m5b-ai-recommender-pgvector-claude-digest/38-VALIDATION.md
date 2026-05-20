---
phase: 38-m5b-ai-recommender-pgvector-claude-digest
type: validation-architecture
generated: 2026-05-20
nyquist_compliant: true
---

# Phase 38 Validation Architecture (Nyquist Sampling)

Per `workflow.nyquist_validation: true` in `.planning/config.json`, this document enumerates the automated-verify cadence per plan to demonstrate Nyquist-compliant feedback sampling. Each plan's `<verify><automated>` block fires fast (≤60s p95) so executors get a tight loop; no plan relies on E2E-only validation.

## Per-plan automated verify presence

| Plan | Wave | Verify shape | Feedback latency | Sampling continuity |
|------|------|--------------|------------------|---------------------|
| 38-01 | 1 | `npx supabase db reset --linked --dry-run` + RLS migration parse + per-table CHECK constraint introspection | <30s | Continuous (every commit) |
| 38-02 | 1 | `vitest run supabase/functions/_shared/*.test.ts` (Deno via `--config vitest-e2e.config.ts` mock or unit-mock) — BAA allowlist + render-user-context + structured-output schema parse | <15s | Continuous |
| 38-03 | 2 | `deno test --allow-all supabase/functions/recommend-next-best-action/index.test.ts` + `tests/rls/recommender-cross-tenant.spec.ts` (RLS live) | <45s | Continuous |
| 38-04 | 2 | `deno test --allow-all supabase/functions/embed-content-nightly/index.test.ts` (mocked OpenAI + sha256 dedup unit) | <20s | Continuous |
| 38-05 | 2 | `deno test --allow-all supabase/functions/weekly-digest/index.test.ts` + breadcrumb-order test (BAA scope BEFORE summarize) | <30s | Continuous |
| 38-06 | 2 | `deno test --allow-all supabase/functions/plan-personalize/index.test.ts` + p99 latency assertion (<50ms with mocked inputs) | <15s | Continuous |
| 38-07 | 3 | `deno test --allow-all supabase/functions/winback-scorer/index.test.ts` + `tests/e2e/winback-scorer.spec.ts` (RLS + Phase 40 SAVE handoff stub) | <40s | Continuous |
| 38-08 | 3 | `vitest run src/admin/modules/hitl-queue/*.test.tsx` + `tests/e2e/hitl-queue.spec.ts` (RLS + super-admin gate) | <60s | Continuous |
| 38-09 | 3 | `vitest run src/components/dashboard/cards/ForYouCard.test.tsx` + `deno test --allow-all supabase/functions/track-rec-click/index.test.ts` + migration parse for pg_cron schedules | <45s | Continuous |
| 38-10 | 4 | `vitest run tests/eval/phase38/*.test.ts` (10 eval dimensions; LLM-judge harness with cached judge responses for CI determinism) + 20-row refset CI gate | <90s p95 (full suite); <30s with cached judge | Continuous + nightly full-refset reproof |

## Nyquist sampling continuity

- **Every plan has at least one `<verify><automated>` block** that executes in <60s p95. No plan is gated solely on E2E browser flows or human-UAT.
- **No `vitest watchAll` patterns** in any plan — explicit `vitest run` invocations only.
- **RLS surfaces** (38-03, 38-07, 38-08) include cross-tenant impersonation proofs that run live against Supabase (auto-skip when `SUPABASE_SERVICE_ROLE_KEY` absent per project convention) — feedback loop is ~3-5s wall-clock per test.
- **Anthropic/OpenAI calls** in tests use mocked clients (vitest `vi.mock()` for Vercel AI Gateway endpoints) — no live LLM calls in unit tests; integration tests gate on `PLAYWRIGHT_RUN_*` env vars for opt-in.

## Wave 0 completeness check

Phase 38 has no separate Wave 0 spike — Phase 38 itself depends on Phase 25 (HIPAA + BAA + Anthropic credential split) and Phase 24 (admin shell + posthog-server) which are already shipped. The 42-01 web-push spike (Phase 42 Wave 0) is unrelated.

## CI integration

Plan 38-10 task 3 wires the eval refset + LLM-judge harness into the CI workflow via `npm run test:eval:phase38`. Gates added:
- 10/10 eval dimensions PASS on 20-row refset (per AI-SPEC §5)
- LLM-judge cached responses checked into `tests/eval/phase38/__judge_cache__/` for CI determinism
- Refset regression: nightly cron re-runs against live LLM (not cached) to catch model-drift

## Memory references applied

- [[deferred-tests-fixme-skip-pattern]] — no permanent test skips; all `.test.ts` files run on every commit
- [[planner-iter1-anti-patterns]] — VALIDATION flag flip-timing: every status enum value's first writer is in the SAME plan as the CHECK constraint widening (verified during plan-checker iter-1)
- [[defer-then-batch-fix-pattern]] — any test marked `.fixme` here is pointer to `.planning/deferred-tests.md` with a v1.4 close-out condition

## Verdict

Nyquist sampling continuity: **PASSING**. No plan introduces a feedback-loop slower than the next plan's iteration window. Wave 4 (Plan 38-10) is the slowest at ~90s but is the LAST plan — its feedback budget doesn't gate downstream work.
