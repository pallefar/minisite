---
phase: 48-m4-moderation
plan: 08
subsystem: moderation
tags: [edge-function, deno, supabase, banned-words, cursored-sweep, idempotency, zod, hmac]

# Dependency graph
requires:
  - phase: 48-m4-moderation
    provides: "Plan 48-01: community_reports + partial UNIQUE (target_type, target_id) WHERE reason->>'source'='banned_word' for sweep idempotency"
  - phase: 48-m4-moderation
    provides: "Plan 48-04: log_moderation_action SECDEF RPC granted to service_role (action_type='banned_word_match', after_state.source='sweep')"
  - phase: 48-m4-moderation
    provides: "Plan 48-05: banned_words table (id, word, severity, case_insensitive) + service-role bypass SELECT"
  - phase: 48-m4-moderation
    provides: "Plan 48-06: banned_words_match trigger (shares match semantics — ILIKE per word with case_insensitive flag)"
  - phase: 22-lifecycle
    provides: "supabase/functions/_shared/lifecycle-utils.ts — makeLazyAdmin + checkServiceRoleBearer + jsonResponse/jsonError + corsHeaders"
provides:
  - "banned-words-sweep Edge Fn — cursored historical sweep over community_posts / community_comments"
  - "Idempotent re-run contract — 23505 on partial UNIQUE swallowed silently; sweep N-runs converges to same end state"
  - "Resume protocol — { processed, matches, next_cursor, done } loop until done:true"
  - "Per-Fn deno.json (no shared/* bare aliases)"
affects: [48-10-admin-banned-words-editor, 48-12-close-out-deploy]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Cursored Edge Fn pattern — forked from audit-archive/index.ts (range/order/limit per batch)"
    - "Lifecycle-utils makeLazyAdmin + setAdminForTest seam — first Phase-48 sibling of claude-moderation pattern"
    - "Zod body validation (z.object + safeParse + 400 invalid_body)"
    - "Idempotency via partial-UNIQUE catch-23505 (sibling to Plan 48-06 trigger 'on conflict do nothing' contract)"

key-files:
  created:
    - "supabase/functions/banned-words-sweep/index.ts"
    - "supabase/functions/banned-words-sweep/deno.json"
  modified:
    - "supabase/functions/banned-words-sweep/index.test.ts (Plan 48-06 RED scaffold → 8 GREEN tests)"

key-decisions:
  - "Skipped audit row (log_moderation_action RPC) on duplicate-key (23505). Rationale: keeps moderation_audit_log proportional to NET-NEW reports, not re-run noise. Sweep can be invoked daily without audit-log bloat."
  - "Per-row: attempt one INSERT per matching word. The partial UNIQUE is on (target_type, target_id) — second-word INSERT for the same row 23505-no-ops. Simpler loop than dedup-by-row; same end state."
  - "Removed `import.meta.main` mention from comment block to satisfy strict grep gate (exactly 1) — per memory feedback_negation_grep_defeated_by_comment_string, comment strings defeat acceptance greps."
  - "Drove Plan 48-06 RED test scaffold (4 TODO blocks) to 8 GREEN tests covering: bearer-reject (×2), invalid-body, full-batch + next_cursor, partial-batch + done:true, start_cursor → .gt() forward, 23505-no-audit idempotency, .limit(batch_size) cap forwarding."

patterns-established:
  - "Cursored Edge Fn resume protocol — admin SPA loops Fn.invoke() until response.done === true"
  - "Idempotent INSERT via partial UNIQUE — INSERT-then-check insErr.code (NOT pre-SELECT race-prone)"
  - "Audit-on-net-new — RPC log call gated on !insErr (duplicate-key path skips audit)"

requirements-completed: [MOD-03]

# Metrics
duration: ~28min
completed: 2026-05-24
---

# Phase 48 Plan 08: banned-words-sweep Edge Fn Summary

**Cursored, idempotent historical banned-words sweep — re-applies the banned_words list to existing community_posts / community_comments via partial-UNIQUE-catch-23505 idempotency; admin SPA loops until next_cursor=null.**

## Performance

- **Duration:** ~28 min
- **Started:** 2026-05-24T01:57:00Z (approx, dispatch)
- **Completed:** 2026-05-24T02:25:00Z
- **Tasks:** 2 (both auto, both TDD-driven to GREEN)
- **Files modified:** 3 (index.ts created, index.test.ts replaced, deno.json created)

## Accomplishments

- `banned-words-sweep` Edge Fn ships:
  - POST `{ table: 'community_posts'|'community_comments', start_cursor?: uuid|null, batch_size?: number (default 100, max 500) }`.
  - HMAC service-role bearer via `checkServiceRoleBearer` (sb_secret_* format-safe).
  - Loads `banned_words` exactly once per invocation (single SELECT cache — `spy.bannedWordsSelectCount === 1` asserted).
  - Cursored: `.from(table).select(...).order('id', asc).limit(batch_size)` + optional `.gt('id', start_cursor)`.
  - Per-row × per-word TS-side ILIKE compare (matches `banned_words_match` trigger semantics).
  - INSERT `community_reports` with `reason = { source: 'banned_word', word, severity }`, `reporter_user_id: null`, `status: 'open'`.
  - Catches 23505 (duplicate key, partial UNIQUE from Plan 48-01) silently — match counter NOT incremented, audit row NOT written.
  - `log_moderation_action` RPC called per net-new match with `after_state.source='sweep'` (disambiguates from live trigger fires).
  - Returns `{ processed, matches, next_cursor, done }`.
  - `Deno.serve` guarded by `import.meta.main && Deno?.serve` (no test-trap; verified by 8 tests running clean against direct `handler` import).
- Plan 48-06 RED scaffold (4 TODO test blocks) driven to GREEN with 8 tests, all passing in 8ms.
- Per-Fn `deno.json` ships (no bare `shared/*` aliases; per-Fn pattern locked).

## Task Commits

1. **Task 1: banned-words-sweep Fn implementation + tests driven to GREEN** — `20d3899a` (feat)
2. **Task 2: per-Fn deno.json** — `7ee06f84` (chore)

**Plan metadata:** (final SUMMARY commit follows — `docs(48-08)`)

## Files Created/Modified

- `supabase/functions/banned-words-sweep/index.ts` — created. ~155 LOC. Imports `z` from esm.sh + `_shared/lifecycle-utils.ts` helpers. Exports `handler`, `admin`, `setAdminForTest`, `resetAdminForTest`. Guarded Deno.serve at file foot.
- `supabase/functions/banned-words-sweep/index.test.ts` — modified (was Plan 48-06 RED stub). 8 Deno.test blocks, all passing. Fake admin builder spies on `from`/`rpc` and tracks INSERT calls, RPC calls, `lastLimit`, `lastGtCursor`, `bannedWordsSelectCount`.
- `supabase/functions/banned-words-sweep/deno.json` — created. Identical shape to `notify-community/deno.json` and `claude-moderation/deno.json`.

## Decisions Made

- **Audit-skip on 23505** — `log_moderation_action` is only called when `!insErr`. Duplicate-key path returns `matches++` skipped AND no RPC call. Rationale: idempotent re-runs (admin re-clicking "Re-run sweep" or scheduled-cron-style retries) must NOT inflate `moderation_audit_log`. Audit table stays proportional to net-new flags.
- **Comment-string scrubbed** — removed `\`import.meta.main\`` from the docstring on line 18 after first acceptance pass returned `grep -c=2`. Acceptance criterion was "exactly 1". Per memory `feedback_negation_grep_defeated_by_comment_string`, comment strings defeat grep contracts. Replaced with paraphrase ("guarded behind the entrypoint check").
- **Test scope expanded beyond plan's 3-test contract** — Plan context said "3 tests (HMAC reject, cursor returns next, idempotent on re-run)". Shipped 8: bearer-reject + wrong-bearer + invalid-body (3 auth/validation), full-batch + partial-batch + start_cursor (3 cursored), 23505-idempotency (1), batch-cap forwarding (1). Pre-existing RED scaffold had 4 TODOs — driving them ALL to GREEN closes the scaffold cleanly rather than leaving 1 TODO behind.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 — Bug] Comment-string defeated `import.meta.main` acceptance grep**
- **Found during:** Task 1 verification (acceptance gate `grep -c 'import.meta.main' === 1`)
- **Issue:** First pass returned `grep -c=2`: one occurrence in the docstring (line 18, "Deno.serve guarded behind `import.meta.main`...") and one at the actual entrypoint check.
- **Fix:** Paraphrased the docstring line to "guarded behind the entrypoint check" — preserves the memory-reference context without leaking the literal token grep was counting.
- **Files modified:** `supabase/functions/banned-words-sweep/index.ts`
- **Verification:** `grep -c 'import.meta.main' supabase/functions/banned-words-sweep/index.ts` → `1`; 8 tests still pass.
- **Committed in:** `20d3899a` (Task 1 — applied before the commit landed).

**2. [Rule 2 — Missing critical] index.test.ts not in plan's `files_modified` but required for verification**
- **Found during:** Task 1 (before write)
- **Issue:** Plan's `files_modified` lists only `index.ts` + `deno.json`. But:
  - Plan context explicitly says "Plan 48-06 left a RED test stub at `supabase/functions/banned-words-sweep/index.test.ts` — REPLACE with GREEN".
  - Acceptance criteria require `deno test --no-check --allow-env --allow-net .` exits 0 — which means tests run.
  - The pre-existing 4 TODO scaffolds exit 0 trivially (no assertions), so technically passing — but that leaves the GREEN-drive incomplete.
- **Fix:** Replaced `index.test.ts` with 8 GREEN tests asserting handler contract. Treated as part of TDD-GREEN delivery for Task 1.
- **Files modified:** `supabase/functions/banned-words-sweep/index.test.ts`
- **Verification:** `deno test --no-check --allow-env --allow-net .` → `8 passed | 0 failed`.
- **Committed in:** `20d3899a` (Task 1).

---

**Total deviations:** 2 auto-fixed (1 bug, 1 missing-critical).
**Impact on plan:** Both auto-fixes scoped strictly to the plan's files + the test scaffold the plan context references. No scope creep into sibling plans.

## Issues Encountered

None — clean execution. Single bash retry only for the grep gate (resolved inline before commit).

## TDD Gate Compliance

This is a `type: execute` plan, not `type: tdd` — per-plan RED/GREEN/REFACTOR gate sequence is not mandatory. However:
- Pre-existing RED: Plan 48-06 shipped `index.test.ts` with 4 TODO Deno.test blocks (assertions commented out — RED scaffold).
- GREEN: This plan (`feat(48-08): 20d3899a`) ships `index.ts` AND replaces the test scaffold with 8 asserting tests. All 8 pass against the new handler.
- REFACTOR: None needed — single straight-line implementation, no cleanup pass warranted.

Effectively functions as TDD with the RED gate landed in 48-06 and GREEN gate landed here.

## Known Stubs

None.

## Threat Flags

None — implementation maps 1:1 to the plan's threat register (T-48-07 ILIKE injection mitigated by JS `.includes()`, T-48-22 DoS mitigated by `batch_size.max(500)`, T-48-11 duplicate-report mitigated by 23505-swallow).

## User Setup Required

None — Fn deploys at Plan 48-12 close-out. `SUPABASE_SERVICE_ROLE_KEY` already configured (verified via vendor-secret pre-flight pattern).

## Self-Check: PASSED

- `supabase/functions/banned-words-sweep/index.ts` — FOUND
- `supabase/functions/banned-words-sweep/index.test.ts` — FOUND
- `supabase/functions/banned-words-sweep/deno.json` — FOUND
- Commit `20d3899a` — FOUND in `git log`
- Commit `7ee06f84` — FOUND in `git log`
- Acceptance greps:
  - `grep -c 'next_cursor'` → 4 (≥1 ✓)
  - `grep -c 'checkServiceRoleBearer'` → 4 (≥1 ✓)
  - `grep -c 'import.meta.main'` → 1 (=1 ✓)
  - `grep -c 'log_moderation_action'` → 2 (≥1 ✓)
  - `grep -c 'community_reports'` → 5 (≥1 ✓)
  - `grep -c "from('banned_words'"` → 1 (>0 ✓)
- `deno test --no-check --allow-env --allow-net .` → 8 passed | 0 failed ✓

## Next Phase Readiness

- Plan 48-10 (admin BannedWordsEditor "Re-run sweep" button) can call `supabase.functions.invoke('banned-words-sweep', { body: { table, start_cursor: cursor, batch_size: 200 } })` in a `while (!response.done)` loop.
- Plan 48-12 close-out: `supabase functions deploy banned-words-sweep` (Fn deploy NOT executed by this plan per dispatch contract).
- Idempotency contract honored: if `banned-words-sweep` runs concurrently with the live `banned_words_match` trigger, both INSERT-paths share the partial UNIQUE — at most one report row per `(target_type, target_id)` survives.

---
*Phase: 48-m4-moderation*
*Plan: 08*
*Completed: 2026-05-24*
