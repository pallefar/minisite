---
phase: 38-m5b-ai-recommender-pgvector-claude-digest
plan: 06
subsystem: plan-personalize
tags: [edge-function, rule-based, conversion, retention, p99-budget, no-llm]
requirements: [RECOMMEND-09]
dependency_graph:
  requires:
    - public.profiles (any phase; pre-existing)
    - public.subscriptions (Phase 14)
  provides:
    - supabase.functions.plan-personalize (POST → {offer_hint, confidence, rationale})
    - public.plan_personalize_facts(uuid) SECDEF RPC
    - public.paywall_events (minimal shell — Phase 39 owns full schema)
    - public.activation_events (minimal shell — future Phase 34 owns)
    - public.plan_history (minimal shell — future Stripe-extensions phase owns)
  affects:
    - Phase 39 PAYWALL (consumer)
    - Phase 40 SAVE (consumer)
tech-stack:
  added: []
  patterns:
    - Deno.serve Edge Fn with admin-Proxy test seam
    - service-role bearer bypass for backend-to-backend callers
    - Single-roundtrip SECDEF facts RPC + 5-rule deterministic cascade
    - Defensive rationale sanitizer (clinical-keyword strip + 200-char cap)
    - vitest perf gate with describe.skipIf for local-dev compatibility
key-files:
  created:
    - supabase/functions/plan-personalize/index.ts
    - supabase/functions/plan-personalize/index.test.ts
    - supabase/migrations/20270705000013_phase38_plan_personalize_facts_fn.sql
    - leanshot/tests/perf/plan-personalize.spec.ts
  modified:
    - leanshot/vite.config.ts (added tests/perf/**/*.spec.ts to include)
decisions:
  - 'D-16 confirmed: plan-personalize ships as a separate Edge Fn from recommender; only Phase 39 and Phase 40 are callers.'
  - 'D-17 confirmed: ZERO LLM calls; rule cascade is hand-coded and deterministic.'
  - 'RPC ownership pulled into THIS plan (Rule 2): Edge Fn cannot run in prod without plan_personalize_facts(uuid); the plan declared the Fn but not the migration, so the migration ships with the implementation.'
  - 'Optional source tables (paywall_events / activation_events / plan_history) are created as minimal shells so the rule cascade degrades to R5 (extended_trial fallback) instead of throwing when Phase 39/34 schemas have not yet shipped.'
  - 'service_role bearer is accepted as auth bypass for backend-to-backend Phase 39/40 callers (verified via dedicated test).'
metrics:
  duration_min: 9
  completed: 2026-05-20T10:40:56Z
  tasks_total: 2
  tasks_completed: 2
  files_created: 4
  files_modified: 1
  commits: 3
  tests_added: 16   # 15 Deno + 1 vitest smoke
  tests_passing: 16
---

# Phase 38 Plan 38-06: plan-personalize Edge Function Summary

Rule-based offer-hint Edge Function powering RECOMMEND-09 — deterministic 5-rule cascade producing `{offer_hint, confidence, rationale}` for Phase 39 PAYWALL and Phase 40 SAVE callers with a hot-conversion-path P99 < 50ms budget and ZERO LLM calls (D-17).

## What Shipped

**`supabase/functions/plan-personalize/index.ts`** (357 lines)
- `Deno.serve` entrypoint with CORS preflight, `OPTIONS/POST` method gate.
- Bearer-token auth: user JWT verified via `admin.getUser`, OR service-role bearer accepted as bypass for Phase 39/40 backend callers.
- Body validation: requires `user_id` (string ≥8 chars) and `context ∈ {paywall, save_offer}`; invalid `context` returns 400 `invalid_context` BEFORE any DB roundtrip.
- Single SQL roundtrip via `admin.rpc('plan_personalize_facts', { p_user_id })`.
- Rule cascade (first-match-wins, all confidences deterministic):
  - **R1** `pause_offer` (0.9) — `context=save_offer ∧ is_active ∧ plan_tier='paid_monthly'`
  - **R2** `discount_eligible` (0.8) — `paywall_dismissals ≥ 3`
  - **R3** `annual_nudge` (0.7) — `plan_tier='paid_monthly' ∧ dismissals=0 ∧ tenure>60 days`
  - **R4** `extended_trial` (0.6) — `(activation_score<0.3 ∨ null) ∧ plan_tier∈{trial,free,null}`
  - **R5** `extended_trial` (0.3) — fallback
- Defensive sanitizer strips clinical-action keywords (`dose, mg, ml, titrate, inject, medication, prescribe`) and caps rationale at 200 chars.
- Structured log breadcrumb `plan.personalize.rule_matched` with `rule_id + offer_hint + confidence + context` (no PII).

**`supabase/functions/plan-personalize/index.test.ts`** (508 lines, 15 Deno tests)
- 10 behavior tests covering all 5 rules + 400 invalid context + 404 unknown user + ZERO-LLM fetch assert + numeric confidence + sanitized rationale (T1–T10).
- 4 standard gates: OPTIONS CORS, non-POST 405, missing Authorization 401, invalid JWT 401.
- 1 auth test: service_role bearer accepted without calling `admin.getUser`.

**`supabase/migrations/20270705000013_phase38_plan_personalize_facts_fn.sql`**
- Creates `public.plan_personalize_facts(p_user_id uuid)` SECDEF stable function returning a single row of `(signup_at, plan_tier, is_active, activated_at, activation_score, paywall_dismissals, trial_end)`.
- Maps `subscriptions.ux_tier + status + plan_id` → `plan_tier ∈ {paid_monthly, paid_annual, trial, free}`.
- Creates optional source tables as minimal shells (paywall_events, activation_events, plan_history) so the LEFT JOINs always resolve; Phase 39/34 owners can ALTER TABLE to enrich.
- `grant execute … to authenticated, service_role`.

**`leanshot/tests/perf/plan-personalize.spec.ts`** (158 lines)
- Vitest harness with `describe.skipIf(!ENABLED)` — runs only when `STAGING_BASE_URL` + `PLAN_PERSONALIZE_TOKEN` env vars present.
- Pre-warms 5 calls (cold-start excluded per D-17), measures 100 calls, asserts `p99 < 50ms`.
- On failure: emits per-user and per-hint p99 breakdowns + EXPLAIN ANALYZE hint.
- Smoke wiring test always runs (numeric budget exports valid) so the file is not dead in coverage.

**`leanshot/vite.config.ts`**
- Extended vitest `include` with `tests/perf/**/*.spec.ts` so the perf gate is discoverable by `npm run test`.

## Verify Run

| Command | Result |
| ---- | ---- |
| `deno test supabase/functions/plan-personalize/index.test.ts --allow-env --allow-net` | **15/15 passed** (7ms) |
| `npx vitest run tests/perf/plan-personalize.spec.ts` (local — no staging creds) | **1 passed / 1 skipped** (skipIf blocks staging gate as designed) |
| `STAGING_BASE_URL=... npx vitest run tests/perf/plan-personalize.spec.ts` | **1 passed / 1 skipped** (needs `PLAN_PERSONALIZE_TOKEN` to enable budget gate — operator runs post-deploy) |

## Commits

| Phase | Hash | Message |
| ---- | ---- | ---- |
| RED | `d0a5e0a` | `test(38-06): add failing RED tests for plan-personalize Edge Fn` |
| GREEN | `d4b7702` | `feat(38-06): plan-personalize Edge Fn + facts RPC (rule-based, no LLM)` |
| Task 2 | `0eb0299` | `perf(38-06): plan-personalize P99 budget gate (<50ms over 100 calls)` |

## Deviations from Plan

### Auto-fixed / Auto-added

**1. [Rule 2 - Missing critical functionality] Added `plan_personalize_facts` RPC migration**
- **Found during:** Task 1 implementation.
- **Issue:** Plan's `<files_modified>` declared only the Edge Fn + tests + perf spec. Plan task action describes the SQL inline ("Single SQL query (denormalized into one query…)") but does not own a migration file. Without the RPC, the Edge Fn would 500 in prod on first deploy.
- **Fix:** Added `supabase/migrations/20270705000013_phase38_plan_personalize_facts_fn.sql` creating the SECDEF function plus minimal shells for `paywall_events`, `activation_events`, `plan_history` so LEFT JOINs always resolve (graceful degradation to R5 — D-17 fallback rule).
- **Files added:** `supabase/migrations/20270705000013_phase38_plan_personalize_facts_fn.sql`
- **Commit:** `d4b7702` (shipped alongside the Fn implementation).

**2. [Path correction] Perf spec under `leanshot/tests/perf/` instead of `tests/perf/`**
- **Found during:** Task 2 setup.
- **Issue:** Plan declared `tests/perf/plan-personalize.spec.ts` (git-root relative). The plan's verify command is `cd /Users/karstenhaldan/minisite && npm run test -- tests/perf/...` — but `package.json` with the `test` script lives in `leanshot/`, and vitest's `include` is `leanshot/`-relative.
- **Fix:** Placed at `leanshot/tests/perf/plan-personalize.spec.ts` and added `tests/perf/**/*.spec.ts` to `leanshot/vite.config.ts` vitest `include`. Functionally identical for the operator (`npm run test -- tests/perf/plan-personalize.spec.ts` resolves correctly).
- **Files modified:** `leanshot/vite.config.ts`
- **Commit:** `0eb0299`.

### Path-drift Recovery (executor incident — caught early, no work lost)

The initial `mkdir -p` + `Write` calls for the test file used the absolute path `/Users/karstenhaldan/minisite/supabase/functions/plan-personalize/`, which resolves to the **main repo**, not the worktree (`/Users/karstenhaldan/minisite/.claude/worktrees/agent-…`). Detected via `git status` showing the file untracked in the main repo and absent in the worktree. Recovered by moving the file to `${worktree}/supabase/functions/plan-personalize/` and removing the main-repo stray directory. All subsequent operations used worktree-relative paths and were correctly committed on the per-agent branch `worktree-agent-a7364b6dc79afaff2`. (Memory references: `feedback_worktree_executor_pwd_drift_leaks_to_main`.)

### Pre-existing Out-of-Scope Findings (NOT FIXED)

- `npm ci` fails with `@sentry/capacitor` sibling-check (pre-existing repo issue). Worked around with `--ignore-scripts` to install dependencies.
- Running `npm run test` (without test scoping) shows 88 pre-existing failures across `src/components/admin/*` and other suites. These predate this plan and are out of scope per SCOPE BOUNDARY. The plan's scoped verify command (`vitest run tests/perf/plan-personalize.spec.ts`) passes cleanly.

## Threat Flags

No new threat surface beyond the plan's `<threat_model>` block. T-38-28 / T-38-29 / T-38-30 mitigations are all implemented:
- T-38-28 (info disclosure): rationale sanitizer + 200-char cap implemented & tested (T10).
- T-38-29 (DoS): single SQL roundtrip via SECDEF RPC; perf gate harness ready for staging.
- T-38-30 (tampering): client passes `context` only; offer_hint computed server-side from DB facts.

## Known Stubs

None. All shipped files are wired to a real consumer path (Phase 39/40 will call the Edge Fn; Edge Fn calls the RPC; RPC reads `profiles` + `subscriptions` + the three minimal shells which Phase 39/34 will later enrich).

## Deployment Notes

- **Migration push order:** `20270705000013_phase38_plan_personalize_facts_fn.sql` is the next-in-sequence migration after Plan 38-01's batch (ends at `_000012`). No timestamp collision.
- **Deploy:** `supabase functions deploy plan-personalize --import-map supabase/functions/import_map.json` (per [reference_supabase_functions_deploy_import_map_flag]). The Fn does not actually use any custom aliases yet, but the flag is documented in the plan's `<verification>` block and harmless.
- **Perf gate activation:** Operator/CI needs to set `STAGING_BASE_URL` and `PLAN_PERSONALIZE_TOKEN` (service-role) plus `PLAN_PERSONALIZE_USER_IDS` (comma-separated UUID list seeded to cover all 5 rules) to enable the staging-side budget gate.

## Self-Check: PASSED

Verified the following claims:

```
$ ls -la supabase/functions/plan-personalize/index.ts
FOUND: supabase/functions/plan-personalize/index.ts (357 lines)

$ ls -la supabase/functions/plan-personalize/index.test.ts
FOUND: supabase/functions/plan-personalize/index.test.ts (508 lines)

$ ls -la supabase/migrations/20270705000013_phase38_plan_personalize_facts_fn.sql
FOUND: supabase/migrations/20270705000013_phase38_plan_personalize_facts_fn.sql

$ ls -la leanshot/tests/perf/plan-personalize.spec.ts
FOUND: leanshot/tests/perf/plan-personalize.spec.ts (158 lines)

$ git log --oneline --all | grep -E '^(d0a5e0a|d4b7702|0eb0299)'
FOUND: d0a5e0a test(38-06): add failing RED tests …
FOUND: d4b7702 feat(38-06): plan-personalize Edge Fn + facts RPC …
FOUND: 0eb0299 perf(38-06): plan-personalize P99 budget gate …

$ deno test supabase/functions/plan-personalize/index.test.ts
FOUND: 15 passed | 0 failed (7ms)
```
