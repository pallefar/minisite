---
phase: 38-m5b-ai-recommender-pgvector-claude-digest
plan: "02"
type: handoff-doc
status: 3-failed-dispatches
created: 2026-05-20
---

# Phase 38-02 dispatch handoff — pre-loaded discoveries

3 background dispatches failed before producing any commits:
- **Attempt #1** (2026-05-20): socket-crashed at 43 tool_uses / 236s → 0 commits, 0 files. Per [[background-executor-socket-crash-recovery]].
- **Attempt #2**: self-aborted at 66% own-context, pre-execution → 0 commits.
- **Attempt #3**: self-aborted at 67% own-context, pre-execution → 0 commits.

Pattern: standard gsd-executor boilerplate + 38-02 plan-load + 38-AI-SPEC.md + 38-RESEARCH.md + sibling-file discovery consumes ~65% of executor context BEFORE Task 1 starts. Re-dispatching without pre-loading context will hit the same wall.

## Fresh-session dispatch prompt (pre-loaded discoveries embedded)

Use this prompt verbatim in a fresh `Agent(subagent_type="gsd-executor", run_in_background=true)` call. The discoveries below mean the executor can SKIP the exploration phase and start writing files immediately at ~10% own-context.

```
Read $HOME/.claude/agents/gsd-executor.md for instructions.

**FOURTH DISPATCH 2026-05-20.** Three prior attempts (1) socket-crashed, (2)+(3) self-aborted pre-execution at 66-67% own-context. ZERO partial state on disk. This dispatch pre-loads all discoveries to skip the exploration phase.

<objective>
Execute Phase 38 Plan 38-02 (Wave 1) as ONE atomic run: 3 tasks / ~14 files / _shared helpers for AI Recommender backend.

Working directory: /Users/karstenhaldan/minisite/leanshot
Plan file: /Users/karstenhaldan/minisite/leanshot/.planning/phases/38-m5b-ai-recommender-pgvector-claude-digest/38-02-PLAN.md

Plan is `autonomous: true`. No human checkpoints, no DB push, no auth gates.

## PRE-LOADED PATH RESOLUTION (skip discovery)

Plan `<files_modified>` paths resolve to **git root `/Users/karstenhaldan/minisite/`**, NOT `leanshot/`. Existing helpers all under parent path:
- `/Users/karstenhaldan/minisite/supabase/functions/_shared/anthropic-baa-allowlist.ts` — EXTEND (currently has `claude-sonnet-4-5`, `claude-opus-4-6`, `claude-haiku-4-5-20251001`; add `claude-sonnet-4-6`)
- `/Users/karstenhaldan/minisite/supabase/functions/_shared/posthog-server.ts` — OFF-LIMITS (38-09 scope)
- `/Users/karstenhaldan/minisite/supabase/functions/_shared/baa-scope.ts` — reuse
- `/Users/karstenhaldan/minisite/supabase/functions/_shared/email-router.ts` — reuse (Phase 25)
- `/Users/karstenhaldan/minisite/supabase/functions/_shared/sentry.ts` — has `captureException` + `captureMessage` but NO `addBreadcrumb` export; either extend sentry.ts to add `addBreadcrumb` OR import `SentryNode` and call `SentryNode.addBreadcrumb` directly
- `/Users/karstenhaldan/minisite/shared/refusal.ts` — at PARENT `shared/` (NOT under `supabase/functions/_shared/`); existing import_map already aliases `shared/refusal` to this
- `/Users/karstenhaldan/minisite/supabase/functions/import_map.json` — exists with `shared/refusal`, `shared/disclaimers`, `stripe` aliases; MERGE not overwrite when adding `shared/` directory alias if needed

## PRE-LOADED PROJECT CONVENTIONS (from 38-01)

- Super-admin RLS check: `EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.is_staff = true)`. `app.is_super_admin()` helper does NOT exist.
- Org column on profiles: `primary_org_id` (NOT `org_id`).
- No `vitest.config` in `leanshot/` — only `vite.config.ts`. Tests run via `npm run test` → vitest default discovery. Deno tests under `supabase/functions/**/<name>.test.ts`.
- Sibling 38-01 shipped 13 files / 4 commits in ~12 min. Comparable scope to 38-02.

## CRITICAL CONSTRAINTS (skip re-reading AI-SPEC)

1. **Anthropic model ID HYPHENATED**: `'anthropic/claude-sonnet-4-6'` (NOT dotted). Pin in `anthropic-summarize.ts` + tests + must_haves.
2. **BAA allowlist same-plan extension**: add `claude-sonnet-4-6` to `anthropic-baa-allowlist.ts` — load-bearing for 38-05 consumer (no temporal 403 gap).
3. **Vercel AI Gateway routes Anthropic at `/v1/messages`** (NOT `/chat/completions`). Use `output_config.format.json_schema` for structured output.
4. **Breadcrumb-order load-bearing**: `baa.scope.resolved` Sentry breadcrumb MUST precede `anthropic.messages.create` (AI-SPEC §6 O3).
5. **User-context vector recipe = Option B (deterministic facts-template)**: ~150-token deterministic template stringification of last-30d-event-summary + profile.
6. **Whitelist enum** (`DigestActionSchema` Zod): `read_kb:<slug> | log_weight | log_injection | log_meal | view_curve | share_with_doctor | complete_onboarding_step | try_recipe:<slug> | watch_tutorial:<slug>`. NO free-text.
7. **Deno test filename**: `<name>.test.ts` per [[deno-test-discovery]].

## EXECUTION DISCIPLINE

- Per task: write files → run verify → atomic git commit → next task. Don't pre-explore; the discoveries above ARE the exploration.
- End with 38-02-SUMMARY.md commit.
- If you find yourself debating scope splits, hedge instructions, or pre-execution context worry: STOP overthinking and WRITE FILES. Sibling 38-01 just did this cleanly. Plan is well-scoped.

Return: completion_status, task_progress, commits array, files_modified count, baa_allowlist_test_result.
```

## After 38-02 lands → Wave 2 dispatch

Wave 2 = 4 parallel background gsd-executor leaves:
- 38-03 recommender Edge Fn (depends on 38-01 RPC + 38-02 anthropic-summarize + openai-embed)
- 38-04 embed-content-nightly Edge Fn (depends on 38-01 schema + 38-02 openai-embed)
- 38-05 weekly-digest Edge Fn (depends on 38-01 + 38-02 anthropic-summarize)
- 38-06 plan-personalize Edge Fn (depends on 38-01 only; rule-based no LLM)

Each plan body is already iter-2 PASS'd. Apply the same path-resolution + project-convention pre-loading to each dispatch prompt.

## Phase 38 Wave 1 state at handoff

- ✅ 38-01: 4 commits (`05915bc`, `3a90451`, `606fd4c`, metadata); SUMMARY committed; 13 files; 12 migrations in `20270705000001..00012`
- ❌ 38-02: 3 failed dispatches; ZERO commits; ZERO files on disk; this handoff doc enables clean fresh-session attempt #4

## Memory references that apply

- [[anthropic-model-id-hyphenated-format]] — dotted vs hyphenated
- [[supabase-back-dated-migration-blocks-push]] — won't hit this in 38-02 (no DB push); relevant at Wave 2/3 cron migrations
- [[background-executor-socket-crash-recovery]] — diagnose attempt #1 pattern
- [[minisite-monorepo-layout]] — git root vs leanshot/ path resolution
- [[parallel-chunked-planning-for-large-phases]] — leaf executors safe in background
- [[deno-test-discovery]] — `<name>.test.ts` filename pattern

## Untracked items at handoff

- `.clone/` (gitignored or ad-hoc workspace)
- `leanshot/.planning/phases/51-*/.gitkeep` (empty placeholder)
- `leanshot/.planning/phases/51-*/STATE.md` (Phase 51 blocker note from earlier session)

Working tree otherwise clean.
