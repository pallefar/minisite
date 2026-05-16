---
phase: 23-tech-debt-sweep-launch-polish
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - leanshot/.planning/deferred-tests.md
  - leanshot/.planning/ROADMAP.md
  - leanshot/.planning/REQUIREMENTS.md
  - leanshot/eslint.config.js
  - leanshot/scripts/audit-deferred-tests.mjs
  - .github/workflows/ci.yml
autonomous: true
requirements: [DEBT-02, DEBT-04]
tags: [audit, lint-rule, ci-gate, deferred-tests]

must_haves:
  truths:
    - "Running grep for any `*.user!` non-null assertion across leanshot/src returns 0 actual code occurrences (comment/docstring lines excluded)."
    - "`eslint.config.js` has a `no-restricted-syntax` rule that fails the lint job on any reintroduced `*.user!` non-null assertion."
    - "`.planning/deferred-tests.md` lists every `test.skip` / `test.fixme` / `it.skip` / `DEFERRED` marker found in leanshot/src + leanshot/tests + leanshot/e2e, with one section per affected file plus fix plan + target phase."
    - "`scripts/audit-deferred-tests.mjs` exits non-zero when any test file contains a defer marker WITHOUT a matching `// see deferred-tests.md#<anchor>` comment on the same line or immediate previous comment line."
    - "`.github/workflows/ci.yml` invokes `node scripts/audit-deferred-tests.mjs` in the existing `lint` job (or a sibling job that gates merge)."
    - "ROADMAP.md DEBT-02 wording matches actual state (0 occurrences) and DEBT-04 wording matches the new audited count from `deferred-tests.md`. REQUIREMENTS.md DEBT-02 + DEBT-04 statements mirror the same."
  artifacts:
    - path: "leanshot/.planning/deferred-tests.md"
      provides: "Expanded registry — Phase 15 entry preserved + new sections for every defer marker found by audit"
      contains: "## Phase"
    - path: "leanshot/eslint.config.js"
      provides: "`no-restricted-syntax` rule for `TSNonNullExpression[expression.type='MemberExpression'][expression.property.name='user']`"
      contains: "TSNonNullExpression"
    - path: "leanshot/scripts/audit-deferred-tests.mjs"
      provides: "Registry-link enforcement script"
      min_lines: 30
    - path: "leanshot/.planning/ROADMAP.md"
      provides: "Updated DEBT-02 + DEBT-04 wording (stale 15/6 counts replaced)"
      contains: "DEBT-02"
    - path: "leanshot/.planning/REQUIREMENTS.md"
      provides: "Updated DEBT-02 + DEBT-04 wording"
      contains: "DEBT-02"
    - path: ".github/workflows/ci.yml"
      provides: "Invocation of audit-deferred-tests.mjs in lint or sibling job"
      contains: "audit-deferred-tests"
  key_links:
    - from: ".github/workflows/ci.yml"
      to: "leanshot/scripts/audit-deferred-tests.mjs"
      via: "npm/node invocation in lint or unused-check job"
      pattern: "audit-deferred-tests"
    - from: "leanshot/eslint.config.js"
      to: "developer PRs"
      via: "no-restricted-syntax rule firing on `*.user!`"
      pattern: "TSNonNullExpression.*user"
    - from: "leanshot/.planning/deferred-tests.md"
      to: "every `test.skip` / `test.fixme` / `DEFERRED` marker in test files"
      via: "anchor link `// see deferred-tests.md#<anchor>`"
      pattern: "see deferred-tests"
---

<objective>
Phase 23 audit pass: verify DEBT-02 is closeout-only (no code edits needed), prevent regression via a lint rule, and expand `deferred-tests.md` from 1 entry to the full audited list of every `test.skip` / `test.fixme` / `DEFERRED` marker in the leanshot test suite. Update ROADMAP + REQUIREMENTS wording to match reality (stale counts: "15 s.user! across 14 files" → actually 0; "6 deferred tests" → actually 30+).

Purpose: Anti-regression guardrail (D-04 / D-05) + foundation for DEBT-04 batch-fix decisions in subsequent phases. The CI lint rule (D-12) is the load-bearing piece — it converts "defer with intent" from a soft convention into a hard merge gate, eliminating untracked skips.

Output: Updated `deferred-tests.md` registry, new ESLint rule, new audit script wired to CI, and corrected scope wording in ROADMAP/REQUIREMENTS for both DEBT-02 and DEBT-04.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@leanshot/.planning/phases/23-tech-debt-sweep-launch-polish/23-CONTEXT.md
@leanshot/.planning/deferred-tests.md
@leanshot/eslint.config.js

# Existing audit findings (pre-discovered — do not re-grep just for paths):
# DEBT-02: `grep -rn '\.user!' leanshot/src --include="*.ts" --include="*.tsx" | grep -v ".test\|.spec" | grep -vE "^\s*\*|^[^:]+:\s*\*"` returns 0 actual code occurrences.
# The 8 matches in src/types/snapshot.ts, src/types/clinic.ts, src/components/clinic-invite/*.tsx, src/components/dashboard/settings/sections/ActiveOrganizationsSection.tsx, src/components/dashboard/settings/EditConsentScopeModal.tsx, src/lib/clinic.ts are ALL docstring/comment lines saying "no `s.user!` non-null assertions appear in this file".
# DEBT-04: codebase contains 30+ defer markers spanning at minimum: src/components/clinic/OrgCreateFlow.test.tsx, src/components/clinic/roster/BulkExport.test.tsx, and e2e/ specs (clinic-revoke-latency, posthog-defer, clinic-photo-access, migrate-resume, clinic-pitfall-8-*, account-delete-cancel, dsar-export, clinic-metered-billing, clinic-audit, share-revocation-drill, clinic-drill-in, portal-plan-change, cross-device-sync, past-due-banner, share-print, roster-perf, account-deletion-cascade, offline-log-then-sync, page-builder-slice1, legal-pages, account-delete, auth-signup-verify-signin, clinic-realtime-negative-space, offline-conflict-toast, clinic-pitfall-8-existing-user-invited, photo-cross-device, signout-cache-clear). Categorize each as: (a) env-gated (legitimate, e.g. `HAS_LIVE` / `HAS_POSTHOG` — register but do not fix); (b) DEFERRED with known fix-plan link (preserve existing comment, ensure anchor in registry); (c) untagged skip (these are the new gaps the audit creates).

# Phase 15 RLS GoTrue flake entry — KEEP existing registry section verbatim.
# Per D-11 the batch-fix is OUT of scope for this plan and belongs to a separate plan if at all in Phase 23 (NOT planned — re-evaluate at v1.2 closeout per existing entry's "Target" line).

# CI workflow lives at MONOREPO ROOT: /Users/karstenhaldan/minisite/.github/workflows/ci.yml
# (not leanshot/.github/) — `defaults.run.working-directory: leanshot` applies to npm steps.
# The script path in CI invocation must reflect that working directory: `node scripts/audit-deferred-tests.mjs`.

# ESLint config at leanshot/eslint.config.js — existing `no-restricted-syntax` block at line 82-95 (rules for `useStore(pickFocus|generateInsights)`). APPEND the new D-05 rule to that same array, do NOT introduce a parallel block.

<interfaces>
ESLint `no-restricted-syntax` selector for D-05 (per CONTEXT.md):
```
TSNonNullExpression[expression.type='MemberExpression'][expression.property.name='user']
```
Catches: `s.user!`, `state.user!`, `useStore.getState().user!`, `auth.user!`, etc. Does NOT catch identifier `!` (e.g. `foo!`) — only `<something>.user!` member expressions.

Existing audit grep (already validated 2026-05-16):
```
grep -rn '\.user!' leanshot/src --include="*.ts" --include="*.tsx" | grep -v ".test\|.spec" | grep -vE "^\s*\*|^[^:]+:\s*\*"
```
Must return 0 lines AFTER the lint rule is added (rule is the regression guard, not a current-state fixer).

deferred-tests.md frontmatter shape (preserve):
```
---
project: leanshot
purpose: Central registry of deferred / known-flaky tests with explicit fix plans...
created: 2026-05-15
---
```

Per-entry shape (preserve from Phase 15 entry):
```
## Phase <N> (<milestone>)

### N. `path/to/test.ts` — <one-line symptom>

**Affected tests (M):** <list>
**Symptom:** <observable>
**Root cause:** <why>
**Why deferred:** <decision>
**Fix plan:** <plan> Target: <phase or polish window>
**Workaround for CI:** <if applicable>
```

Anchor format for in-test comments enforced by the lint:
```
test.skip('foo', ...);  // see deferred-tests.md#1-pathtotestts-one-line-symptom
```
or comment on previous line — slug-anchor matching GitHub-flavored markdown (lowercase, hyphenated, no punctuation).
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Audit codebase + write expanded deferred-tests.md</name>
  <files>leanshot/.planning/deferred-tests.md</files>
  <action>Run the full D-10 audit grep across `leanshot/src/**`, `leanshot/tests/**`, `leanshot/e2e/**` for: `test.skip(`, `test.fixme(`, `it.skip(`, `it.only(`, `describe.only(`, `xtest`, `xdescribe`, `\.skip\(\)`, `/* DEFERRED */`, `// DEFERRED`, `// SKIP`. For each match, classify as env-gated (legitimate conditional skip — record but mark `Target: N/A — env-gated`), DEFERRED-with-link (preserve existing fix-plan link in entry), or untagged-skip (NEW entry needed — categorize by Phase based on which planning phase the surrounding test file traces back to via git blame or naming convention). Group entries by Phase heading (existing `## Phase 15` heading stays; add `## Phase 7 / 16 / 19 / 22 / etc.` as needed). PRESERVE the existing Phase 15 RLS GoTrue flake section VERBATIM — do not edit it. For every NEW entry, use the per-entry shape from the existing format reference (Affected tests / Symptom / Root cause / Why deferred / Fix plan / Workaround). For env-gated skips, the "Symptom" line is short ("Conditional skip when `HAS_LIVE` env vars absent") and "Fix plan" is `N/A — env-gated, never deferred in CI when secrets present`. Cap total registry length at ~500 lines; if more, group env-gated skips into a single summary table at end of file. Run `grep -rn 'test\.skip\|test\.fixme\|\.skip(\|// DEFERRED\|/\* DEFERRED' leanshot/src leanshot/tests leanshot/e2e --include="*.ts" --include="*.tsx" --include="*.spec.ts"` before finalizing to confirm every match has a corresponding registry entry.</action>
  <verify>
    <automated>node -e "const fs=require('fs');const r=fs.readFileSync('leanshot/.planning/deferred-tests.md','utf8');if(!r.includes('## Phase 15'))process.exit(1);if(!r.includes('### 1. \`tests/rls/page-builder-rls.test.ts\`'))process.exit(2);const newSections=(r.match(/^### \d+\./gm)||[]).length;if(newSections<5)process.exit(3);console.log('registry has',newSections,'sections');"</automated>
  </verify>
  <done>deferred-tests.md preserves Phase 15 entry verbatim, contains ≥5 total `### N.` sections, organized by Phase headings, every grep-discoverable defer marker classified.</done>
</task>

<task type="auto">
  <name>Task 2: Add ESLint no-restricted-syntax rule for `*.user!` + verify 0 violations</name>
  <files>leanshot/eslint.config.js</files>
  <action>Append a third entry to the existing `no-restricted-syntax` rule array (at line ~82-95 of `leanshot/eslint.config.js`) with selector `TSNonNullExpression[expression.type='MemberExpression'][expression.property.name='user']` and message: `"\`*.user!\` non-null assertions are banned (project anti-pattern). Use early returns, typed guards (\`if (!s.user) return null;\`), or Auth-required boundary components instead. See \`s.user!\` audit closeout in Phase 23 (DEBT-02)."`. Do NOT introduce a parallel `no-restricted-syntax` block — append to the existing array. Per D-04 the audit already confirmed 0 actual occurrences, so the rule should NOT report any errors against current code; if it does, the audit was wrong and the new violations must be fixed before the lint rule lands green.</action>
  <verify>
    <automated>cd leanshot && npx eslint --no-eslintrc -c eslint.config.js 'src/**/*.{ts,tsx}' 2>&1 | grep -E "no-restricted-syntax.*user" | head -5; cd leanshot && npm run lint 2>&1 | tail -20</automated>
  </verify>
  <done>`leanshot/eslint.config.js` contains the new selector. `npm run lint` exits 0 (no new violations from the rule). Manual spot-check: introduce `const x = s.user!.id` in any file → `npm run lint` reports the new rule's error → revert the test edit.</done>
</task>

<task type="auto">
  <name>Task 3: Write scripts/audit-deferred-tests.mjs + wire to CI</name>
  <files>leanshot/scripts/audit-deferred-tests.mjs, .github/workflows/ci.yml</files>
  <action>Create `leanshot/scripts/audit-deferred-tests.mjs` as a Node ESM script (no deps beyond `node:fs/promises` + `node:path` + `node:glob` or `fast-glob` if already in devDeps — check `leanshot/package.json` first; if no glob is available, use `node:fs.readdir` recursively). Script behavior: walk `src/**`, `tests/**`, `e2e/**` matching `*.test.ts`, `*.test.tsx`, `*.spec.ts`; for each match of `/(test|it|describe|xtest|xdescribe)\.(skip|fixme|only)\b|\.skip\(\)|\/\*\s*DEFERRED|\/\/\s*DEFERRED|\/\/\s*SKIP/`, check the same line OR the immediately preceding non-blank comment line for `see deferred-tests.md#<slug>`. If anchor missing, print `FAIL <file>:<line> — missing deferred-tests.md anchor link` and increment fail counter. Exit non-zero if fail counter > 0; exit 0 otherwise. Print summary `Audited N markers, M registry-linked, K unlinked`. Then append a new step to the existing `lint` job in `/Users/karstenhaldan/minisite/.github/workflows/ci.yml` (or add a parallel `deferred-tests-audit` job using the same node setup pattern as the existing `lint` job): `- name: Deferred-tests registry audit\n  run: node scripts/audit-deferred-tests.mjs`. Per D-12 this is a build-failer — no `continue-on-error: true`.</action>
  <verify>
    <automated>cd leanshot && node scripts/audit-deferred-tests.mjs; echo "exit=$?"; grep -A1 "audit-deferred-tests" /Users/karstenhaldan/minisite/.github/workflows/ci.yml</automated>
  </verify>
  <done>Script exists, exits 0 when all defer markers have anchors (Task 1 ensured every existing marker now has a registry entry; Task 3 itself adds anchor comments to test files IF the audit reveals untagged skips — script + anchor backfill happen in same task to ship green). CI workflow invokes the script in lint or sibling job.</done>
</task>

<task type="auto">
  <name>Task 4: Update ROADMAP + REQUIREMENTS to match audited reality</name>
  <files>leanshot/.planning/ROADMAP.md, leanshot/.planning/REQUIREMENTS.md</files>
  <action>Per D-13: rewrite ROADMAP.md DEBT-02 line (`leanshot/.planning/ROADMAP.md:197`) from "All 15 `s.user!` non-null assertions across 14 files replaced..." to "DEBT-02: 0 `s.user!` non-null assertions in code (verified 2026-05-16 by Phase 23 audit pass — sweep happened in Phase 22 or earlier). ESLint `no-restricted-syntax` rule installed to prevent regression." Rewrite DEBT-04 line (`leanshot/.planning/ROADMAP.md:201`) from "6 deferred tests from `.planning/deferred-tests.md` re-enabled in CI..." to "DEBT-04: All `test.skip` / `test.fixme` / `DEFERRED` markers across leanshot/src + tests + e2e audited into `.planning/deferred-tests.md` registry ({N} entries, of which {E} env-gated + {D} deferred-with-fix-plan). CI lint enforces every new skip ships with a registry anchor." Use the actual N/E/D counts from Task 1's registry. Update REQUIREMENTS.md DEBT-02 + DEBT-04 statements (lines ~197 + 201) to match. Also update ROADMAP.md inline summary at line 31 (replace stale "15 occurrences / 14 files" + "6 deferred tests"). Do NOT touch DEBT-01, DEBT-03, DEBT-05 lines — those are still in-flight via Plans 23-02 / 23-03 / 23-04.</action>
  <verify>
    <automated>grep -E "DEBT-02|DEBT-04" leanshot/.planning/ROADMAP.md leanshot/.planning/REQUIREMENTS.md; grep -c "15 \`s.user" leanshot/.planning/ROADMAP.md | grep -q "^0$" && echo "stale 15 wording removed"; grep -c "6 deferred tests" leanshot/.planning/ROADMAP.md | grep -q "^0$" && echo "stale 6 wording removed"</automated>
  </verify>
  <done>ROADMAP + REQUIREMENTS reflect actual audited counts. No stale "15 s.user!" or "6 deferred tests" wording survives. Other DEBT lines untouched.</done>
</task>

</tasks>

<verification>
1. `cd leanshot && npm run lint` exits 0 with new `*.user!` rule active.
2. `cd leanshot && node scripts/audit-deferred-tests.mjs` exits 0.
3. `wc -l leanshot/.planning/deferred-tests.md` shows ≥80 lines (expanded from 30).
4. `grep -c "^### " leanshot/.planning/deferred-tests.md` returns ≥5.
5. CI dry-run: `cd /Users/karstenhaldan/minisite && cat .github/workflows/ci.yml | grep -A2 "audit-deferred-tests"` shows the step wired.
</verification>

<success_criteria>
- DEBT-02 closeout: 0 code occurrences confirmed + ESLint regression guard installed + ROADMAP/REQUIREMENTS wording corrected.
- DEBT-04 registry expansion: every defer marker in the codebase has a `deferred-tests.md` entry; CI lint enforces this going forward.
- No new lint/typecheck/test failures introduced.
</success_criteria>

<output>
After completion, create `.planning/phases/23-tech-debt-sweep-launch-polish/23-01-SUMMARY.md` with: audited marker count, registry entry count by category (env-gated / deferred / fixed-during-audit), confirmation of 0 `*.user!` occurrences, link to the ESLint rule entry, and exact CI workflow step added.
</output>
