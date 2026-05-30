---
plan: "71-02-store-notes-sync"
phase: "71"
wave: 2
depends_on:
  - "71-01-admin-push-updates"
autonomous: true
type: execute
requirements:
  - PU-04
files_modified:
  - leanshot/scripts/sync-store-release-notes.mjs
  - leanshot/scripts/__tests__/sync-store-release-notes.test.mjs
  - leanshot/fastlane/metadata/android/en-US/changelogs/.gitkeep
  - leanshot/fastlane/Fastfile
  - leanshot/vitest.config.ts
must_haves:
  truths:
    - "running-sync-script-writes-newest-published-entry-for-build-version-to-both-fastlane-files"
    - "markdown-body-is-converted-to-plain-text-before-writing"
    - "ios-release_notes.txt-and-android-changelogs-versionCode.txt-both-written"
    - "missing-env-or-no-matching-entry-fails-soft-without-crashing-build"
    - "sync-runs-before-upload_testflight-and-upload_play-lanes"
  artifacts:
    - path: "leanshot/scripts/sync-store-release-notes.mjs"
      provides: "Build-time markdown→plain-text store-notes sync from newest published changelog entry"
      min_lines: 60
    - path: "leanshot/scripts/__tests__/sync-store-release-notes.test.mjs"
      provides: "Unit test for the markdown→plain-text transform + file-target selection"
      min_lines: 30
    - path: "leanshot/fastlane/metadata/android/en-US/changelogs/.gitkeep"
      provides: "Android changelogs/ directory (new) that supply reads versioned notes from"
  key_links:
    - from: "leanshot/scripts/sync-store-release-notes.mjs"
      to: "changelog_entries (status='published', version=<build version>)"
      via: "service-role supabase query, newest published"
      pattern: "status.*published"
    - from: "leanshot/fastlane/Fastfile"
      to: "leanshot/scripts/sync-store-release-notes.mjs"
      via: "sh node scripts/... before pilot/supply"
      pattern: "sync-store-release-notes"
---

<objective>
Plan 02 — Centralized changelog → App Store + Play release-notes sync (PU-04).

A build-time Node script (`scripts/sync-store-release-notes.mjs`) queries the newest `published` `changelog_entries` row whose `version` matches the current build version, converts its markdown `body_md` to plain text, and writes it into both fastlane metadata files: `fastlane/metadata/ios/en-US/release_notes.txt` and `fastlane/metadata/android/en-US/changelogs/<versionCode>.txt`. The script is wired to run BEFORE the existing `upload_testflight` / `upload_play` lanes (lane edit only — signing/secrets stay owned by Phase 70). This completes the single-source-of-truth pipeline: one admin-authored entry drives BOTH the in-app drawer (Plan 01) AND the store release notes.

Depends on Plan 01: this script reads the `status` and `version` columns that Plan 01's migration adds.

Reuse, do NOT rebuild: follow the existing `.mjs` build-script conventions (`build-research-rss.mjs`, `build-sitemap.ts`) — service-role supabase client, fail-soft on missing env (warn to stderr, do NOT fail the build), Node ESM.

Purpose: PU-04 (centralized changelog → store release notes at release time). Completes Phase 71.

Output: 1 sync script + 1 transform unit test, the new Android `changelogs/` dir, and 2 lane edits in the Fastfile.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/phases/71-product-updates-centralized-changelog/71-CONTEXT.md
@.planning/phases/71-product-updates-centralized-changelog/71-01-PLAN-admin-push-updates.md

# Reuse templates + targets (read before writing):
@leanshot/scripts/build-research-rss.mjs
@leanshot/fastlane/Fastfile
@leanshot/fastlane/metadata/ios/en-US/release_notes.txt

<interfaces>
<!-- Contracts the executor needs. -->

Build version sources (grounded this session):
  - leanshot/package.json  "version": "2.0.0"   ← the published-entry `version` to match on
  - leanshot/apps/android/app/build.gradle  versionCode 1  ← Android changelogs/<N>.txt filename
  (Parse versionCode with a regex over build.gradle: /versionCode\s+(\d+)/. Parse the app
   version from package.json "version".)

changelog_entries columns available AFTER Plan 01 migration (20290110000001):
  id, slug, title, body_md, version (text, nullable), status (draft|published|archived),
  created_by, published_at, created_at, updated_at
  RLS: authenticated SELECT = published-or-admin. The sync script uses the SERVICE-ROLE key
  (SUPABASE_SERVICE_ROLE_KEY) — service role bypasses RLS, but STILL filter .eq('status','published')
  explicitly (CONTEXT: query the newest published entry for the build's version).

Existing .mjs script conventions (build-research-rss.mjs / seed-photo-soak-fixture.mjs):
  - import { createClient } from '@supabase/supabase-js'
  - SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL
  - SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
  - if env missing → warn to stderr, exit 0 (fail-soft; do not crash the build)
  - __dirname via fileURLToPath(import.meta.url); LEANSHOT_DIR = resolve(__dirname,'..')

Fastlane lane targets (Fastfile):
  ios   lane :upload_testflight  → match() → gym() → pilot(...)   ← insert sync BEFORE pilot
  android lane :upload_play      → gradle() → supply(track:'internal', ...)  ← insert sync BEFORE supply
  Working dir convention: fastlane is invoked with --project-root = leanshot/, so a lane
  can run `sh("node", "scripts/sync-store-release-notes.mjs")` with leanshot/ as cwd.

Fastlane file targets (relative to leanshot/):
  fastlane/metadata/ios/en-US/release_notes.txt          (exists — overwrite)
  fastlane/metadata/android/en-US/changelogs/<versionCode>.txt   (changelogs/ is NEW — create)
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: sync-store-release-notes.mjs + markdown→plain-text transform + transform unit test</name>
  <files>leanshot/scripts/sync-store-release-notes.mjs, leanshot/scripts/__tests__/sync-store-release-notes.test.mjs, leanshot/fastlane/metadata/android/en-US/changelogs/.gitkeep</files>
  <behavior>
    - markdownToPlainText(md): strips markdown syntax → plain text. '# Title\n\n- **Bold** item\n- [link](https://x)' → 'Title\n\nBold item\nlink' (headings unwrapped, list markers normalized to a bullet or blank, bold/italic markers removed, link text kept + URL dropped). Collapses 3+ blank lines to 1; trims trailing whitespace.
    - resolveTargets(version, versionCode) returns { iosPath, androidPath } where androidPath ends with `changelogs/<versionCode>.txt`.
    - pickEntry(rows, version): returns the newest published row matching version, or null if none.
    - main(): if SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY unset → warn to stderr + exit 0 (no write). If no matching published entry → warn + exit 0 (leave existing files untouched).
  </behavior>
  <action>
Write `leanshot/scripts/sync-store-release-notes.mjs` (Node ESM) mirroring `build-research-rss.mjs` structure (path setup via fileURLToPath, fail-soft env handling).

1. Read the app version from `leanshot/package.json` ("version") and the Android `versionCode` from `leanshot/apps/android/app/build.gradle` (regex `/versionCode\s+(\d+)/`).
2. Service-role supabase client (createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)). Query: `from('changelog_entries').select('title, body_md, version, status, published_at').eq('status','published').eq('version', appVersion).order('published_at', {ascending:false}).limit(1)`.
3. `markdownToPlainText(body_md)` — implement inline (do NOT add a new dependency): strip ATX headings (`^#+\s`), bold/italic markers (`**` `__` `*` `_`), inline-link syntax keeping the text (`[text](url)` → `text`), list markers (`^\s*[-*+]\s` → nothing or a single bullet), blockquote markers (`^>\s`), inline code backticks; collapse 3+ newlines to 2; trim. Keep it dependency-free + pure so the test can import it.
4. Write the plain text to BOTH target files: `fastlane/metadata/ios/en-US/release_notes.txt` and `fastlane/metadata/android/en-US/changelogs/<versionCode>.txt` (mkdir -p the changelogs dir first). Prefer prepending the entry `title` as the first line if present.
5. Export `markdownToPlainText`, `resolveTargets`, `pickEntry` (named exports) for testability; guard the live `main()` run with `if (import.meta.url === \`file://${process.argv[1]}\`)` so importing the module in the test does NOT trigger a DB call.
6. Create `leanshot/fastlane/metadata/android/en-US/changelogs/.gitkeep` so the new dir is tracked.

Write `leanshot/scripts/__tests__/sync-store-release-notes.test.mjs` (import from 'vitest'). NOTE: this `.mjs` test must be picked up by a vitest project. The `src-lib-unit` / `src-ui-unit` includes do NOT match `scripts/`. Add a tiny dedicated entry: in `vitest.config.ts`, extend the DEFAULT top-level `test.include` (currently `['src/**/*.test.ts','src/**/*.test.tsx']`) to ALSO include `'scripts/**/__tests__/*.test.mjs'` (single additive array entry — keep existing globs). Assert: markdownToPlainText converts the sample markdown above to the expected plain text (no `#`, no `**`, no `](`); resolveTargets('2.0.0', 1).androidPath ends with `changelogs/1.txt`; pickEntry returns the newest by published_at and null when version doesn't match.
  </action>
  <verify>
    <automated>cd /tmp/leanshot-p71/leanshot && test -f scripts/sync-store-release-notes.mjs && test -f fastlane/metadata/android/en-US/changelogs/.gitkeep && node -e "import('./scripts/sync-store-release-notes.mjs').then(m=>{const t=m.markdownToPlainText('# Title\n\n- **Bold** item\n- [link](https://x)');if(/[#*]|\]\(/.test(t))process.exit(1);if(!m.resolveTargets('2.0.0',1).androidPath.endsWith('changelogs/1.txt'))process.exit(1);console.log('SYNC_TRANSFORM_OK')})" && npx vitest run --config vitest.config.ts scripts/__tests__/sync-store-release-notes.test.mjs 2>&1 | grep -qE "passed \(|Test Files.*passed" && echo SYNC_TESTS_PASS</automated>
  </verify>
  <done>Script writes both fastlane files from the newest published entry for the build version, strips markdown to plain text, fails soft on missing env / no match, the changelogs/ dir is tracked, and the transform/target/pick test passes.</done>
</task>

<task type="auto">
  <name>Task 2: Wire sync into upload_testflight + upload_play fastlane lanes</name>
  <files>leanshot/fastlane/Fastfile</files>
  <action>
Edit ONLY the two gated upload lanes (no signing/secret changes — Phase 70 owns those).

1. In `lane :upload_testflight`, add `sh("node", "scripts/sync-store-release-notes.mjs")` as the FIRST step, BEFORE `match(...)` / `gym(...)` / `pilot(...)` — so the iOS `release_notes.txt` is fresh before `pilot` reads metadata. Add a one-line comment: `# Phase 71 PU-04 — refresh App Store "What's new" from newest published changelog entry`.
2. In `lane :upload_play`, add the same `sh("node", "scripts/sync-store-release-notes.mjs")` as the FIRST step, BEFORE `gradle(...)` / `supply(...)` — so `supply` uploads the fresh Android `changelogs/<versionCode>.txt`.
3. Do NOT touch the unsigned build lanes, the match/gym/pilot/gradle/supply config, or any ENV references. Do NOT rename any lane (stable CI contract per Fastfile header).
  </action>
  <verify>
    <automated>cd /tmp/leanshot-p71/leanshot && awk '/lane :upload_testflight/{f=1} f&&/sync-store-release-notes/{print "ios";exit}' fastlane/Fastfile | grep -q ios && awk '/lane :upload_play/{g=1} g&&/sync-store-release-notes/{print "android";exit}' fastlane/Fastfile | grep -q android && ! grep -qE "lane :build_(ios|android)_unsigned.*sync-store" fastlane/Fastfile && echo LANES_WIRED</automated>
  </verify>
  <done>Both upload lanes invoke the sync script before their upload step; build/unsigned lanes and all signing config are untouched; no lane renamed.</done>
</task>

</tasks>

<verification>
Phase-level checks for this plan:

1. Sync writes both targets from a sample published entry (smoke with a stubbed query is unit-tested; live write is exercised by the transform test):
   `cd /tmp/leanshot-p71/leanshot && npx vitest run --config vitest.config.ts scripts/__tests__/sync-store-release-notes.test.mjs`
2. Fail-soft when env is unset (must NOT crash):
   `cd /tmp/leanshot-p71/leanshot && env -u SUPABASE_URL -u SUPABASE_SERVICE_ROLE_KEY -u VITE_SUPABASE_URL node scripts/sync-store-release-notes.mjs; echo "exit=$?"` → exit=0 with a stderr warning, no file overwrite.
3. Lanes wired before upload:
   `cd /tmp/leanshot-p71/leanshot && grep -c "sync-store-release-notes" fastlane/Fastfile` → 2.
4. No regression to other scripts' test surfaces:
   `cd /tmp/leanshot-p71/leanshot && npx vitest run --config vitest.config.ts scripts`
</verification>

<success_criteria>
- Running `node scripts/sync-store-release-notes.mjs` (with env + a matching published entry) writes the newest published entry for the current build version to BOTH `fastlane/metadata/ios/en-US/release_notes.txt` and `fastlane/metadata/android/en-US/changelogs/<versionCode>.txt` as plain text (PU-04).
- The markdown→plain-text transform is unit-tested (CONTEXT success criterion: "new tests cover ... the markdown→plain-text store-notes transform").
- Missing env or no matching entry fails soft (warn + exit 0, no build crash, existing files untouched).
- The sync runs BEFORE `upload_testflight` and `upload_play`; signing/secrets remain Phase-70-owned and untouched.

Goal-backward check vs 71-CONTEXT success criteria:
- "Running the store-notes sync script writes the latest published entry (for current version) to both fastlane release-notes files as plain text" → Tasks 1+2 (PU-04). ✓
- "new tests cover ... the markdown→plain-text store-notes transform" → Task 1 test. ✓
- Single source of truth (BOTH in-app + store, locked decision 1) → Plan 01 drawer + this plan's store sync read the same `changelog_entries` published rows. ✓
</success_criteria>

<output>
Create `.planning/phases/71-product-updates-centralized-changelog/71-02-SUMMARY.md` when done.
</output>
