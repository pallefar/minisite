---
slug: phase4-deno-test-discovery
status: resolved
trigger: ci-red-since-phase4-ship
goal: find_and_fix
tdd_mode: false
created: 2026-05-12
resolved: 2026-05-12
phase_ref: 04-supabase-cloud-bootstrap-ai-proxy-on-edge-functions
flagged_by:
  - leanshot/.planning/phases/06-supabase-cloud-sync-and-migration/06-CONTEXT.md:146
  - leanshot/.planning/phases/06-supabase-cloud-sync-and-migration/06-VALIDATION.md:76
---

# Debug Session: phase4-deno-test-discovery

## Symptoms

The CI job `deno-test` (`.github/workflows/ci.yml` lines 183-203) has been red since Phase 4 shipped. Expected failure: "No test modules found".

CI command (ci.yml:203):
```
deno test --allow-net=api.moonshot.ai --allow-read --allow-env \
  --import-map=supabase/functions/import_map.json supabase/functions/tests/
```

Test file present: `/Users/karstenhaldan/minisite/supabase/functions/tests/ai-chat-refusal-test.ts` (contains `Deno.test(...)` calls — orchestrator pre-checked, debugger re-confirmed).

## Hypothesis (provided by orchestrator)

Deno's default directory-mode test-discovery glob is `{*_,*.,}test.{js,mjs,ts,mts,jsx,tsx}` (`*_test.*`, `*.test.*`, `test.*`). A `*-test.ts` (hyphen) file does NOT match. Supabase docs use the hyphen convention, which works only when passing the explicit file path, not a directory.

## Evidence

- timestamp: 2026-05-12T08:00Z source: gh-cli (run 25719186847, latest red `deno-test` job)
  ```
  Run deno test --allow-net=api.moonshot.ai --allow-read --allow-env --import-map=supabase/functions/import_map.json supabase/functions/tests/
  error: No test modules found
  ##[error]Process completed with exit code 1.
  ```
  Exact failure string matches hypothesis. Pre-flight `test -f` guards (refusal.ts, import_map.json, ai-chat-refusal-test.ts) all passed, so file presence is not the issue — the file exists but is not discovered.

- timestamp: 2026-05-12T08:00Z source: https://docs.deno.com/runtime/reference/cli/test/
  > "Directory arguments are expanded to all contained files matching the glob `{*_,*.,}test.{js,mjs,ts,mts,jsx,tsx}`"
  Brace-expansion decodes to: `*_test.{...}`, `*.test.{...}`, `test.{...}`. Hyphen-form (`*-test.*`) is NOT in the set.

- timestamp: 2026-05-12T08:00Z source: test-file inspection
  `supabase/functions/tests/ai-chat-refusal-test.ts` contains `Deno.test(...)` registrations (corpus loop + 2 standalone tests). Tests themselves are valid; only the filename is wrong for directory-mode discovery.

- timestamp: 2026-05-12T08:00Z source: local environment check
  `which deno` → not found on dev machine. Verification deferred to CI rather than installing Deno locally (avoids 100 MB toolchain install for a one-line filename fix).

- timestamp: 2026-05-12T08:00Z source: ci.yml inspection
  ci.yml:201 has a hard `test -f supabase/functions/tests/ai-chat-refusal-test.ts` guard referencing the old hyphen filename — this also had to be updated to the new dot filename, otherwise the rename would flip the guard from pass to fail.

- timestamp: 2026-05-12T08:00Z source: post-fix vitest run
  `npm run test:unit -- --run shared/refusal.test.ts` → **104/104 tests pass**. Browser-side parity over the same `ADVERSARIAL_CORPUS` is intact, so the Deno-runtime equivalent (which iterates the same corpus with identical assertions) will green up once Deno can discover the renamed file.

## Root Cause

`supabase/functions/tests/ai-chat-refusal-test.ts` used a hyphen-prefixed `*-test.ts` filename. Deno's `deno test <directory>` only walks for files matching the glob `{*_,*.,}test.{js,mjs,ts,mts,jsx,tsx}` — i.e. `*_test.*`, `*.test.*`, or `test.*`. The hyphen variant is a Supabase docs convention that works only when the file path is passed explicitly. Because ci.yml:203 passes the **directory** `supabase/functions/tests/`, Deno found zero matching modules and exited 1 with "No test modules found".

The Phase 4 `04-PATTERNS.md` RESEARCH §9 actually anticipated the hyphen-vs-dot ambiguity but the chosen convention contradicted Deno's directory-mode glob.

## Fix Applied

1. `git mv supabase/functions/tests/ai-chat-refusal-test.ts supabase/functions/tests/ai-chat-refusal.test.ts` — dot before `test`, matches Deno's `*.test.*` glob AND aligns with the vitest convention used in the rest of the repo.
2. `.github/workflows/ci.yml:201` — updated the pre-flight `test -f` guard to the new dot filename. Diff: one line.
3. Updated stale doc-comment references in three live source files (the orchestrator scoped planning artifacts as out-of-bounds, so 04-PATTERNS.md / 04-RESEARCH.md / 04-03-PLAN.md / 04-03-SUMMARY.md retain the historical hyphen reference):
   - `/Users/karstenhaldan/minisite/shared/refusal.test.ts:4`
   - `/Users/karstenhaldan/minisite/shared/refusal.ts:157`
   - `/Users/karstenhaldan/minisite/leanshot/vite.config.ts:104`
4. Pre-push verification: `npm run typecheck` clean, `npm run lint` 0 errors (5 pre-existing unrelated warnings), `npm run format:check` clean, `npm run test:unit -- --run shared/refusal.test.ts` → 104/104 passing.

Local `deno test` was NOT run because Deno is not installed on the dev machine. CI is the verifier — the next push triggers the `deno-test` job and we expect it to green.

## Resolution

- **Root cause:** Hyphenated `ai-chat-refusal-test.ts` does not match Deno's directory-mode discovery glob `{*_,*.,}test.{js,mjs,ts,mts,jsx,tsx}`. CI passed `supabase/functions/tests/` as a directory to `deno test`, so the file was never enrolled, producing "No test modules found" + exit 1.
- **Fix:** Renamed to `ai-chat-refusal.test.ts` (matches `*.test.*` arm of the glob) + updated the `test -f` guard in `ci.yml:201` to point at the new filename.
- **Backref:** Closes the future-work callouts at `leanshot/.planning/phases/06-supabase-cloud-sync-and-migration/06-CONTEXT.md:146` and `…/06-VALIDATION.md:76`, which routed this to a dedicated `/gsd-debug` session.
- **Verifier:** Next CI run on `main` — the `deno-test` job should transition from "No test modules found" red to all corpus rows + 2 standalone meta tests green.
