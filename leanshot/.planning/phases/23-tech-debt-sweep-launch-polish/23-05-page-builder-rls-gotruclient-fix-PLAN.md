---
phase: 23-tech-debt-sweep-launch-polish
plan: 05
type: execute
wave: 2
depends_on: [23-01]
files_modified:
  - leanshot/tests/rls/page-builder-rls.test.ts
  - leanshot/.planning/deferred-tests.md
autonomous: true
requirements: [DEBT-04]
tags: [rls, test-fixture, gotruclient, batch-fix, deferred-test-closeout]

must_haves:
  truths:
    - "`tests/rls/page-builder-rls.test.ts` no longer calls `buildAnonClient(...).auth.signInWithPassword(...)` to acquire authenticated sessions for staff-role tests — instead injects a service-role-minted JWT via the `headers.Authorization` option on `createClient`, per the documented fix-plan in [[reference-rls-fixture-gotruclient-flake]]."
    - "The 4 previously-`test.fixme`-marked `is_staff CAN ...` tests are re-enabled (no `.fixme` / `.skip` marker) and pass GREEN locally + in CI three runs in a row (rather than the prior 'pass once / re-run-once' workaround)."
    - "`.planning/deferred-tests.md` Phase 15 entry is marked FIXED 2026-05-16 (or current date) with a brief note pointing at the commit hash + this plan."
    - "No new `test.fixme` / `test.skip` / `describe.only` is introduced anywhere in `tests/rls/page-builder-rls.test.ts` (CI lint from Plan 23-01 enforces registry-link comment for any deferred test; this plan REMOVES the existing defer, doesn't add new ones)."
  artifacts:
    - path: "leanshot/tests/rls/page-builder-rls.test.ts"
      provides: "RLS fixture using service-role-JWT injection; no GoTrueClient instances created in test runtime"
      contains_pattern: "createClient(.*headers.*Authorization.*Bearer"
      no_match_pattern: "signInWithPassword|test\\.fixme|describe\\.fixme"
    - path: "leanshot/.planning/deferred-tests.md"
      provides: "Updated Phase 15 entry marked FIXED"
      contains: "FIXED"

dependency_graph:
  requires:
    - "23-01 (deferred-tests.md exists in canonical layout — needed for the registry update step + the new anchor-comment CI lint should not fire on a removed defer)"
  provides:
    - "Closeout of CONTEXT D-11 (Phase 15 RLS GoTrue flake batch-fix)"
    - "Closeout of the only existing entry in deferred-tests.md as of 2026-05-16 — reduces v1.2's deferred-test debt to 0 if no other defers are surfaced by 23-01 Task 1 audit"
  affects:
    - "Plan 23-01 deferred-tests.md content (additive on the Phase 15 entry — both plans edit the same file but on different sections, so parallel-execution-safe via pathspec commits per [[feedback-parallel-executor-git-isolation]])"

tech_stack:
  added: []
  patterns:
    - "Service-role-JWT injection at createClient boundary (no GoTrueClient instantiation) — closes the supabase-js v2.105 cross-contamination class for vitest fixtures"

key_files:
  modified:
    - leanshot/tests/rls/page-builder-rls.test.ts
    - leanshot/.planning/deferred-tests.md

---

# Plan 23-05: Phase 15 RLS Page-Builder GoTrueClient Flake Fix

## Goal

Close CONTEXT D-11 (the only deferred-test entry in `.planning/deferred-tests.md` as of 2026-05-16). Replace the GoTrueClient-based fixture pattern in `tests/rls/page-builder-rls.test.ts` with the documented service-role-minted-JWT pattern from [[reference-rls-fixture-gotruclient-flake]], then re-enable the 4 `is_staff CAN ...` tests that have been sitting under `test.fixme` since Phase 15.

## Why this is a separate plan

Plan 23-01 audits + expands the deferred-tests registry (additive). Plan 23-05 removes one entry from that registry (the Phase 15 RLS flake) by FIXING the underlying flake. The fix is a self-contained test-file rewrite with a precise documented recipe — perfect MVP-mode vertical slice. Putting it in its own plan keeps the audit work (23-01) decoupled from the actual code change (23-05) and lets Wave 2 run 23-02 + 23-03 + 23-05 in parallel.

## Reference reading (required before executing)

- [[reference-rls-fixture-gotruclient-flake]] — root-cause analysis + documented fix recipe (service-role-JWT via `headers.Authorization` option on `createClient`).
- [[feedback-rls-per-file-slug-prefix]] — sibling rule for RLS test fixtures (file-scoped TEST_SLUG_PREFIX); this plan does NOT need to touch slug prefixes but should NOT regress the existing prefix-isolation in `page-builder-rls.test.ts`.
- `.planning/deferred-tests.md` Phase 15 entry — fix plan section spells out the swap mechanically. Mirror it exactly.

## Tasks

<task>
  <name>Task 1: Swap signInWithPassword fixtures to service-role-JWT injection</name>
  <files>leanshot/tests/rls/page-builder-rls.test.ts</files>
  <action>Read `tests/rls/page-builder-rls.test.ts` end-to-end. Identify every `buildAnonClient(...).auth.signInWithPassword({email, password})` call used to acquire an authenticated `staff` session. Replace each with a service-role-minted JWT injected via `createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { global: { headers: { Authorization: \`Bearer ${jwt}\` } }, auth: { persistSession: false, autoRefreshToken: false } })`. The JWT is minted server-side via the existing `mintTestJwt(userId, role)` helper if one exists in `tests/helpers/`; if no helper exists, add a small one that signs a JWT with the `SUPABASE_JWT_SECRET` env var (Supabase project ref `ytnsipxxmzgaebkqmokp` per [[reference-supabase-project]]) using the `jose` library that's already a project dep. The minted JWT must include `aud: "authenticated"`, `role: "authenticated"`, `sub: <userId>`, `exp: <now + 600s>` — minimum claims for supabase-js to accept it. Verify NO `signInWithPassword` calls remain in the file via grep. The 4 affected `is_staff CAN ...` tests stay as-is structurally (just the auth setup changes). Per [[feedback-rls-fixture-gotruclient-flake]] this eliminates the GoTrueClient instantiation entirely — no `Multiple GoTrueClient instances` warning + no auth cross-contamination between buildAnonClient calls.</action>
  <done>`grep -c "signInWithPassword" tests/rls/page-builder-rls.test.ts` returns 0. `grep -c "headers.*Authorization.*Bearer" tests/rls/page-builder-rls.test.ts` returns >=1 (one per per-test fixture).</done>
</task>

<task>
  <name>Task 2: Remove test.fixme markers from the 4 is_staff CAN tests + verify GREEN x3</name>
  <files>leanshot/tests/rls/page-builder-rls.test.ts</files>
  <action>Find the 4 `test.fixme(...)` (or `it.fixme(...)`) markers on the `is_staff user CAN INSERT / UPDATE / DELETE landing_pages`, `is_staff CAN INSERT a new revision`, `leads: is_staff CAN SELECT`, and `page-assets: is_staff CAN upload and delete a test image` tests. Replace `.fixme` with the normal `test(...)` / `it(...)` form. Run the full file 3 times: `cd leanshot && for i in 1 2 3; do npx vitest run tests/rls/page-builder-rls.test.ts || exit 1; done`. All 3 runs must pass GREEN — if ANY run goes RED, the swap is incomplete or there's a different latent issue; debug before claiming done. Capture the 3 GREEN run outputs to the SUMMARY.md evidence section.</action>
  <done>3 consecutive `vitest run` invocations of `tests/rls/page-builder-rls.test.ts` exit 0. Grep shows 0 `.fixme` / `.skip` markers in the file. The 4 newly-enabled tests appear in the test output as passed.</done>
</task>

<task>
  <name>Task 3: Mark Phase 15 entry FIXED in deferred-tests.md</name>
  <files>leanshot/.planning/deferred-tests.md</files>
  <action>Edit `.planning/deferred-tests.md`. In the Phase 15 entry (currently the only entry as of 2026-05-16), prepend `**FIXED 2026-05-16** (commit `<commit-hash-of-task-1-and-2>`) — service-role-JWT swap landed via Plan 23-05; 4 affected tests re-enabled and GREEN three runs in a row.` to the entry's top, BEFORE the existing description (preserve all historical content as audit trail). If Plan 23-01 has already executed and added new entries to this file, COORDINATE: only edit the Phase 15 entry — do not touch the other entries 23-01 wrote. Use `git commit -- leanshot/.planning/deferred-tests.md` per [[feedback-parallel-executor-git-isolation]] to avoid sweeping unrelated changes.</action>
  <done>`grep -c "FIXED 2026-05-16" .planning/deferred-tests.md` returns >=1. The historical Phase 15 entry's body is preserved unchanged below the new FIXED marker.</done>
</task>

## Verification

- 3 consecutive GREEN runs of `npx vitest run tests/rls/page-builder-rls.test.ts` (no flaky pass-once-then-fail pattern).
- `git log -- tests/rls/page-builder-rls.test.ts` includes a single commit matching `^fix\(23-05\)` or `^feat\(23-05\)` with the swap.
- `.planning/deferred-tests.md` Phase 15 entry shows FIXED with date + commit hash.
- CI for this plan's commit passes the existing `tests/rls/page-builder-rls.test.ts` job (no fixmes skipped — they're now real PASS results in the test counts).

## Rollback

If the swap proves unstable in CI (unlikely given [[reference-rls-fixture-gotruclient-flake]] documented it as deterministic outside vitest, and the swap removes vitest from the failure mode), revert the commit. The 4 affected tests go back under `test.fixme` and the deferred-tests.md entry's FIXED marker is removed. No production code is touched by this plan — pure test-fixture work — so rollback risk to shipped features is zero.

## Cross-references

- CONTEXT D-11: "Batch-fix the known Phase 15 RLS GoTrue flake using the documented fix-plan ... Re-enable the 4 affected `is_staff CAN ...` tests."
- [[reference-rls-fixture-gotruclient-flake]] — fix recipe
- [[feedback-defer-then-batch-fix-pattern]] — project rule: never permanently skip SC tests; this plan executes the batch-fix end of the pattern.
- Plan 23-01 — companion plan in same phase; expands the registry. This plan reduces it by 1.
