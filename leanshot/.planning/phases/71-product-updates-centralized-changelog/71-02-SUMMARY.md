---
phase: "71"
plan: "71-02-store-notes-sync"
subsystem: release-pipeline
tags: [fastlane, changelog, store-release-notes, build-script, PU-04]
requires:
  - "71-01-admin-push-updates: changelog_entries status + version columns"
provides:
  - "Build-time markdown→plain-text store-notes sync from newest published changelog entry"
  - "fastlane upload lanes refresh App Store + Play 'What's new' from the single changelog source of truth"
affects:
  - "leanshot/fastlane/Fastfile (upload_testflight, upload_play lanes)"
tech-stack:
  added: []
  patterns:
    - "Fail-soft build script (warn to stderr + exit 0 on missing env / no match) — mirrors build-research-rss.mjs / seed-photo-soak-fixture.mjs"
    - "main() guarded by import.meta.url so pure helpers are unit-testable without a DB call"
    - "Dedicated vitest project for scripts/**/__tests__/*.test.mjs (top-level test.include masked by projects: block — vitest 4.x)"
key-files:
  created:
    - "leanshot/scripts/sync-store-release-notes.mjs"
    - "leanshot/scripts/__tests__/sync-store-release-notes.test.mjs"
    - "leanshot/fastlane/metadata/android/en-US/changelogs/.gitkeep"
  modified:
    - "leanshot/fastlane/Fastfile"
    - "leanshot/vitest.config.ts"
decisions:
  - "Added a dedicated 'scripts-unit' vitest project (not the default test.include the plan suggested) because vitest 4.x masks the top-level test.include when a projects: block is present."
  - "Scoped the scripts-unit include to the named test file (not a broad scripts/**/__tests__/*.test.mjs glob) so the sibling notion-mirror node:test .mjs isn't swept into vitest."
metrics:
  duration: "~20m"
  completed: "2026-05-30"
  tasks: 2
  files: 5
requirements: [PU-04]
---

# Phase 71 Plan 71-02: Centralized Changelog → Store Release-Notes Sync Summary

Build-time Node ESM script that queries the newest `status='published'` `changelog_entries` row for the current build version, strips its markdown `body_md` to plain text, and writes both fastlane metadata files (iOS `release_notes.txt` + Android `changelogs/<versionCode>.txt`); wired to run before the `upload_testflight` / `upload_play` lanes so one admin-authored entry drives both the in-app drawer (Plan 01) and the App Store + Play "What's new" release notes (PU-04).

## What Was Built

- **`scripts/sync-store-release-notes.mjs`** — service-role supabase query (`from('changelog_entries').select(...).eq('status','published').eq('version', appVersion).order('published_at', desc).limit(1)`), markdown→plain-text transform, dual fastlane write. App version from `package.json` (2.0.0); Android `versionCode` parsed from `apps/android/app/build.gradle` (regex `versionCode\s+(\d+)` → 1). Fail-soft on missing env or no matching entry (warn to stderr + `exit 0`, existing metadata untouched). `main()` guarded by `import.meta.url === file://${process.argv[1]}`, and `@supabase/supabase-js` is lazy-`import()`ed inside `main()`, so importing the module in tests never touches the DB.
  - Exported pure helpers: `markdownToPlainText`, `resolveTargets`, `pickEntry`, `entryToReleaseNotes`, `readAppVersion`, `readVersionCode`.
  - `markdownToPlainText` strips ATX headings, bold/italic (`**` `__` `*` `_`), inline links (`[text](url)`→`text`), ordered/unordered list markers, blockquotes, inline code backticks; collapses 3+ newlines to 2; trims.
- **`scripts/__tests__/sync-store-release-notes.test.mjs`** — 16 vitest cases covering the transform (CONTEXT sample + headings/emphasis/code/blockquote/ordered-list/collapse/null), `resolveTargets` (android `changelogs/<versionCode>.txt`, ios `release_notes.txt`), `pickEntry` (newest published wins, drafts ignored, null on no-match/empty), and `entryToReleaseNotes` (title prepend + markdown stripped).
- **`fastlane/metadata/android/en-US/changelogs/.gitkeep`** — tracks the new Android changelogs dir that `supply` reads versioned notes from.
- **`fastlane/Fastfile`** — `sh("node", "scripts/sync-store-release-notes.mjs")` inserted as the first executable step in `upload_testflight` (before match/gym/pilot) and `upload_play` (before gradle/supply). Lane edits only; no signing/credentials/secrets touched, no lane renamed.
- **`vitest.config.ts`** — added a `scripts-unit` project (node env) scoped to the named test file.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Dedicated vitest project instead of widening the default `test.include`**
- **Found during:** Task 1 (running the transform test)
- **Issue:** The plan instructed extending the DEFAULT top-level `test.include` to add `scripts/**/__tests__/*.test.mjs`. But `vitest.config.ts` has a `projects:` block, and under vitest 4.x that masks the top-level `test.include` — the test was collected by **no** project (`vitest list` showed zero `sync-store` matches; filter run reported "No test files found, exiting with code 1"). This is the documented `reference_vitest_4_projects_config_masks_default` / `reference_multiple_vitest_configs_include_overlap` behavior.
- **Fix:** Reverted the top-level include change; added a dedicated `scripts-unit` project (`environment: 'node'`, `globals: true`). Scoped its `include` to the **named** file `scripts/__tests__/sync-store-release-notes.test.mjs` rather than a broad `scripts/**/__tests__/*.test.mjs` glob, because the sibling `notion-mirror-hipaa-policies.test.mjs` uses `node:test` (not vitest) and would fail collection if swept in (`feedback_vitest_project_include_too_broad`).
- **Files modified:** `leanshot/vitest.config.ts`
- **Commit:** cfa64812
- **Outcome:** Test now collected and green via both path-filter and `--project=scripts-unit`; the `node:test` sibling still passes 10/10 under `node --test` and is not affected.

## Verification Results

| # | Check | Result |
|---|-------|--------|
| 1 | `node --check scripts/sync-store-release-notes.mjs` | PARSE_OK |
| 2 | `vitest run scripts/__tests__/sync-store-release-notes.test.mjs` | 16/16 passed |
| 2b | `vitest run --project=scripts-unit` | 16/16 passed (named file only) |
| 3 | Fail-soft no env (`env -u SUPABASE_URL -u SUPABASE_SERVICE_ROLE_KEY -u VITE_SUPABASE_URL node scripts/...`) | exit=0, stderr warning, iOS file md5 unchanged, no Android file written |
| 4 | `grep -c "sync-store-release-notes" fastlane/Fastfile` | 2 (upload_testflight + upload_play; unsigned lanes untouched) |
| 5 | `ruby -c fastlane/Fastfile` | Syntax OK |
| 6 | Transform/target smoke (`SYNC_TRANSFORM_OK`) | pass — no `#`/`*`/`](` leaks, android path ends `changelogs/1.txt` |
| 7 | Live write-logic smoke (`entryToReleaseNotes`) | title prepended, markdown stripped, URL dropped, blank lines collapsed |
| 8 | Regression: `notion-mirror-hipaa-policies.test.mjs` under `node --test` | 10/10 pass (not swept into vitest) |

Pre-existing unrelated failures: a full-config `vitest run` shows 18 pre-existing failed test files (Wave-1 / prior-phase test drift). These are out of scope for this plan (not introduced by these changes) and left untouched per the executor scope boundary.

## Known Stubs

None. The script reads live data at release time; no hardcoded/placeholder values in the production path.

## Self-Check: PASSED

- FOUND: leanshot/scripts/sync-store-release-notes.mjs
- FOUND: leanshot/scripts/__tests__/sync-store-release-notes.test.mjs
- FOUND: leanshot/fastlane/metadata/android/en-US/changelogs/.gitkeep
- FOUND: leanshot/fastlane/Fastfile (2 sync invocations)
- FOUND: leanshot/vitest.config.ts (scripts-unit project)
- FOUND commit: cfa64812 (Task 1)
- FOUND commit: f0d58a15 (Task 2)
