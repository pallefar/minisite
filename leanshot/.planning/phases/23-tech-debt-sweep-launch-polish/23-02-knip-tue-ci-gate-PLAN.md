---
phase: 23-tech-debt-sweep-launch-polish
plan: 02
type: execute
wave: 2
depends_on: [23-01]
files_modified:
  - leanshot/package.json
  - leanshot/package-lock.json
  - leanshot/knip.config.ts
  - leanshot/ts-unused-exports.json
  - leanshot/scripts/check-unused-baseline.sh
  - .github/workflows/ci.yml
  - .github/workflows/baselines/unused-exports.json
autonomous: true
requirements: [DEBT-05]
tags: [ci-gate, knip, ts-unused-exports, tech-debt, baseline-diff]

must_haves:
  truths:
    - "`knip` and `ts-unused-exports` are installed as devDependencies in `leanshot/package.json`."
    - "`knip.config.ts` excludes `.planning/**`, `supabase/migrations/**`, `e2e/**`, `scripts/**`, `*.config.{ts,js,mjs}`, `src/**/__tests__/**`, `dist/**`, `dist-marketing/**`, `node_modules/**`, plus Vite entry points (`src/main.tsx`, `src/main.marketing.tsx`) and lazy-import targets per D-15."
    - "`scripts/check-unused-baseline.sh` runs `npx knip --reporter=json` and `npx ts-unused-exports tsconfig.app.json --json`, diffs each warn count against the baseline file at `.github/workflows/baselines/unused-exports.json`, exits non-zero ONLY when `current_warns > baseline_warns` for either tool."
    - "`.github/workflows/baselines/unused-exports.json` exists and contains the current `main`-branch warn counts as `{knip_warns: N, tue_warns: M}` — initial commit captures the as-of-merge baseline."
    - "`.github/workflows/ci.yml` invokes the baseline script as a parallel `unused-check` job (peer of `lint`, `typecheck`, `test-unit`)."
    - "`npm run unused-check` script in `package.json` invokes `bash scripts/check-unused-baseline.sh` so devs can run locally."
  artifacts:
    - path: "leanshot/package.json"
      provides: "knip + ts-unused-exports devDeps + `unused-check` npm script"
      contains: "knip"
    - path: "leanshot/knip.config.ts"
      provides: "knip configuration (entry, project, ignore globs per D-15)"
      min_lines: 25
    - path: "leanshot/ts-unused-exports.json"
      provides: "ts-unused-exports config (exclude pathRegex per D-15)"
      min_lines: 10
    - path: "leanshot/scripts/check-unused-baseline.sh"
      provides: "Baseline diff runner — warn-on-new posture"
      min_lines: 40
    - path: ".github/workflows/ci.yml"
      provides: "`unused-check` job parallel to lint/typecheck"
      contains: "unused-check"
    - path: ".github/workflows/baselines/unused-exports.json"
      provides: "Initial baseline JSON with current main-branch warn counts"
      contains: "knip_warns"
  key_links:
    - from: ".github/workflows/ci.yml"
      to: "leanshot/scripts/check-unused-baseline.sh"
      via: "unused-check job step"
      pattern: "check-unused-baseline"
    - from: "leanshot/scripts/check-unused-baseline.sh"
      to: ".github/workflows/baselines/unused-exports.json"
      via: "baseline file read + comparison"
      pattern: "baselines/unused-exports"
    - from: "leanshot/scripts/check-unused-baseline.sh"
      to: "knip + ts-unused-exports CLIs"
      via: "npx invocation with --reporter=json / --json"
      pattern: "npx (knip|ts-unused-exports)"
---

<objective>
Install `knip` and `ts-unused-exports` as PR-level CI gates with a warn-on-new posture (per D-16): captures the current `main`-branch warn count as a baseline, fails the PR only when the warn count INCREASES vs baseline. Prevents new dead-code debt from sneaking in (the Plan 10-06 `WORKSPACE_LOADED` defect from anti-pattern #6) without forcing a one-shot cleanup of existing tech debt. Per D-17 the posture self-escalates to `fail-on-any-warn` once a separate cleanup PR drives baseline to 0 (organic, no flag flip).

Purpose: DEBT-05 closeout. Lands the CI gate first (this plan), defers triage of existing warnings to a follow-up cleanup PR (out of Phase 23 scope per D-17).

Output: knip + tue installed, configs in place per D-15 exclusions, baseline-diff shell wrapper per D-16, CI workflow job per D-18, initial baseline JSON committed.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@leanshot/.planning/phases/23-tech-debt-sweep-launch-polish/23-CONTEXT.md
@leanshot/package.json
@leanshot/tsconfig.app.json
@leanshot/eslint.config.js

# CI workflow lives at /Users/karstenhaldan/minisite/.github/workflows/ci.yml
# `defaults.run.working-directory: leanshot` applies to all steps unless overridden.
# Pattern for new job: copy the existing `lint` job (lines ~19-32) — checkout + setup-node@v4 with cache + npm ci + run step.

# knip docs (Context7 if needed during implementation): https://knip.dev/
# Key knip config options for this project:
#   - entry: ["src/main.tsx", "src/main.marketing.tsx"]
#   - project: ["src/**/*.{ts,tsx}"]
#   - ignore: per D-15 exclusion list
#   - ignoreDependencies: any tool that knip falsely flags (e.g. eslint plugins, @types/* indirectly used)

# ts-unused-exports config shape (ts-unused-exports.json):
#   - "entry": ["src/main.tsx", "src/main.marketing.tsx"]
#   - "pathsToIgnore": [".planning", "supabase", "e2e", "scripts", "dist", "dist-marketing", "node_modules", "src/.*__tests__"]

# Baseline file location: .github/workflows/baselines/unused-exports.json (NEW directory — git-tracked).
# Shape: {"knip_warns": <int>, "tue_warns": <int>, "captured_at": "<iso8601>", "captured_from_commit": "<sha>"}.
# The initial commit captures the warn count produced by running knip + tue against current main. Subsequent merges to main auto-update via a small workflow step (out of scope here — manual update via PR for now per D-16).

# CRITICAL — exclude paths per D-15:
#   - .planning/**           (planning docs)
#   - supabase/migrations/** (SQL files knip might mistake for unused)
#   - e2e/**                 (Playwright specs — never imported, run via CLI)
#   - scripts/**             (CLI tools)
#   - *.config.{ts,js,mjs}   (Vite, ESLint, Vitest, Tailwind configs — entry-equivalents)
#   - src/**/__tests__/**    (vitest specs — used by test runner not source)
#   - dist/**, dist-marketing/**, node_modules/**

# CRITICAL — Vite entry points + lazy-import targets MUST be declared in `entry`:
#   - src/main.tsx              (primary Vite entry per index.html)
#   - src/main.marketing.tsx    (marketing entry per Phase 8+)
#   - All React.lazy(() => import(...)) targets in src/App.tsx — these are dynamic-import targets that knip can usually trace, but if it false-flags them, add to `entry` or `ignore` explicitly.

<interfaces>
knip.config.ts shape:
```typescript
import type { KnipConfig } from 'knip';

const config: KnipConfig = {
  entry: ['src/main.tsx', 'src/main.marketing.tsx'],
  project: ['src/**/*.{ts,tsx}'],
  ignore: [
    '.planning/**',
    'supabase/**',
    'e2e/**',
    'scripts/**',
    '*.config.{ts,js,mjs}',
    'src/**/__tests__/**',
    'dist/**',
    'dist-marketing/**',
    'node_modules/**',
  ],
  ignoreDependencies: [
    // populate during implementation if knip false-flags any devDep used only via CLI
  ],
};

export default config;
```

ts-unused-exports.json shape:
```json
{
  "entry": ["src/main.tsx", "src/main.marketing.tsx"],
  "pathsToIgnore": [
    ".planning",
    "supabase",
    "e2e",
    "scripts",
    "dist",
    "dist-marketing",
    "node_modules",
    "src/.*__tests__"
  ],
  "ignoreFilesRegex": [".*\\.config\\.(ts|js|mjs)$"]
}
```

scripts/check-unused-baseline.sh shape (pseudo):
```bash
#!/usr/bin/env bash
set -euo pipefail
BASELINE=".github/workflows/baselines/unused-exports.json"
if [[ ! -f "../$BASELINE" ]]; then
  echo "Baseline not found at $BASELINE — first run? Initialize via Task 4."
  exit 1
fi
BASE_KNIP=$(jq -r '.knip_warns' "../$BASELINE")
BASE_TUE=$(jq -r '.tue_warns' "../$BASELINE")
KNIP_JSON=$(npx knip --reporter=json 2>/dev/null || true)
KNIP_WARNS=$(echo "$KNIP_JSON" | jq '[.files,.exports,.types,.enumMembers,.classMembers,.duplicates,.dependencies,.devDependencies] | flatten | length')
TUE_JSON=$(npx ts-unused-exports tsconfig.app.json --json 2>/dev/null || true)
TUE_WARNS=$(echo "$TUE_JSON" | jq '[.[].exports[]] | length')
echo "knip: $KNIP_WARNS (baseline $BASE_KNIP) | tue: $TUE_WARNS (baseline $BASE_TUE)"
if (( KNIP_WARNS > BASE_KNIP )) || (( TUE_WARNS > BASE_TUE )); then
  echo "FAIL — new unused exports/files vs baseline"
  exit 1
fi
exit 0
```
Adjust jq paths after running the tools once against current code — knip JSON shape may differ from this skeleton.

CI workflow new job (peer of `lint`):
```yaml
unused-check:
  name: Unused exports check
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v4
    - uses: actions/setup-node@v4
      with:
        node-version: '22'
        cache: 'npm'
        cache-dependency-path: leanshot/package-lock.json
    - run: npm ci
    - run: bash scripts/check-unused-baseline.sh
```
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Install knip + ts-unused-exports devDeps + add npm script</name>
  <files>leanshot/package.json, leanshot/package-lock.json</files>
  <action>From `leanshot/` working directory run `npm install --save-dev knip ts-unused-exports`. Add to `scripts` section of `package.json`: `"unused-check": "bash scripts/check-unused-baseline.sh"`. Verify `npm ls knip ts-unused-exports` shows both as direct devDeps (not hoisted only). Do NOT pin to exact versions — use `^` ranges npm picks. Commit both `package.json` AND `package-lock.json` together.</action>
  <verify>
    <automated>cd leanshot && npx knip --version && npx ts-unused-exports --version && jq -r '.scripts["unused-check"]' package.json</automated>
  </verify>
  <done>Both tools installed, `unused-check` npm script defined, lockfile updated and committed.</done>
</task>

<task type="auto">
  <name>Task 2: Write knip.config.ts + ts-unused-exports.json with D-15 exclusions</name>
  <files>leanshot/knip.config.ts, leanshot/ts-unused-exports.json</files>
  <action>Create `leanshot/knip.config.ts` per the `<interfaces>` shape with the D-15 exclusion list. Create `leanshot/ts-unused-exports.json` per the `<interfaces>` shape. Run `cd leanshot && npx knip --reporter=json > /tmp/knip-initial.json 2>&1` and `cd leanshot && npx ts-unused-exports tsconfig.app.json --json > /tmp/tue-initial.json 2>&1` to (a) confirm both tools parse the configs, (b) capture initial warn counts for Task 4's baseline. If knip false-flags any dependency in `package.json` that's used only via CLI (e.g. `eslint-plugin-*`, `prettier`, `vitest`, `@playwright/test`), append to `ignoreDependencies`. Iterate config until knip exits without parse errors (non-zero exit on warns is FINE here — the baseline absorbs warn count).</action>
  <verify>
    <automated>cd leanshot && npx knip --reporter=json 2>&1 | head -5; cd leanshot && npx ts-unused-exports tsconfig.app.json --json 2>&1 | head -5</automated>
  </verify>
  <done>Both configs exist, both tools parse without error, initial warn counts captured.</done>
</task>

<task type="auto">
  <name>Task 3: Write scripts/check-unused-baseline.sh + capture initial baseline JSON</name>
  <files>leanshot/scripts/check-unused-baseline.sh, .github/workflows/baselines/unused-exports.json</files>
  <action>Create `leanshot/scripts/check-unused-baseline.sh` per the `<interfaces>` skeleton (`set -euo pipefail`, jq for JSON parsing, baseline at `../.github/workflows/baselines/unused-exports.json` since script runs from leanshot/ working directory). Adjust the jq selector paths after inspecting actual knip + tue JSON shapes from Task 2's outputs — knip's JSON structure depends on its current version. Capture the initial baseline: create `.github/workflows/baselines/unused-exports.json` (NEW directory, mkdir -p first) with shape `{"knip_warns": <N from Task 2>, "tue_warns": <M from Task 2>, "captured_at": "2026-05-16T<HH:MM>Z", "captured_from_commit": "$(git rev-parse HEAD)"}`. Run `cd leanshot && bash scripts/check-unused-baseline.sh` — must exit 0 (current = baseline). Then test the gate by manually editing baseline file to `knip_warns: <N-1>` and re-running — must exit 1. Restore baseline. `chmod +x` the script.</action>
  <verify>
    <automated>cd leanshot && bash scripts/check-unused-baseline.sh; echo "exit=$?"; cat /Users/karstenhaldan/minisite/.github/workflows/baselines/unused-exports.json</automated>
  </verify>
  <done>Script exits 0 against current baseline, exits 1 when baseline is manually decremented, baseline JSON committed.</done>
</task>

<task type="auto">
  <name>Task 4: Wire unused-check job into .github/workflows/ci.yml</name>
  <files>.github/workflows/ci.yml</files>
  <action>**FIRST: Read `/Users/karstenhaldan/minisite/.github/workflows/ci.yml` from HEAD before editing** — Plan 23-01 (wave 1, completed before this task) appended an `audit-deferred-tests` step into the existing `lint` job. Do NOT diff from a pre-23-01 snapshot or you'll clobber 23-01's addition. The current HEAD already has the audit-deferred-tests step landed. Append a new `unused-check` job to ci.yml per the `<interfaces>` snippet — peer of `lint` / `typecheck` / `test-unit` (no `needs:` dependency — runs in parallel for fast feedback per D-18). Use the same `actions/checkout@v4` + `actions/setup-node@v4` (node-version: '22', cache: 'npm', cache-dependency-path: `leanshot/package-lock.json`) + `npm ci` pattern as the existing `lint` job. The step `bash scripts/check-unused-baseline.sh` inherits the workflow-level `defaults.run.working-directory: leanshot` so the script runs from `leanshot/` and resolves `../.github/workflows/baselines/unused-exports.json` correctly. Do NOT add to `needs:` of any downstream job (e2e etc.) — DEBT-05 is signal-only at first, not a blocker for other CI surfaces. After editing, verify with `grep -c "audit-deferred-tests\|unused-check" /Users/karstenhaldan/minisite/.github/workflows/ci.yml` returns >=2 (1 for 23-01's step + 1 for this new job).</action>
  <verify>
    <automated>grep -A15 "unused-check:" /Users/karstenhaldan/minisite/.github/workflows/ci.yml; cd /Users/karstenhaldan/minisite && yq '.jobs."unused-check"' .github/workflows/ci.yml 2>/dev/null || python3 -c "import yaml;d=yaml.safe_load(open('.github/workflows/ci.yml'));print('unused-check' in d['jobs'])"</automated>
  </verify>
  <done>CI workflow has `unused-check` job, syntactically valid YAML, parallel to existing jobs.</done>
</task>

</tasks>

<verification>
1. `cd leanshot && npm run unused-check` exits 0 locally.
2. `cd leanshot && npm run lint && npm run typecheck && npm run unused-check` all exit 0.
3. CI yml parses: `python3 -c "import yaml;yaml.safe_load(open('/Users/karstenhaldan/minisite/.github/workflows/ci.yml'))"` exits 0.
4. Baseline file exists + has both `knip_warns` and `tue_warns` numeric values.
5. Manual regression test: introduce an unused export → script exits 1 → revert.
</verification>

<success_criteria>
- knip + ts-unused-exports installed, configured per D-15.
- Baseline-diff gate per D-16 working: blocks PRs that ADD warnings, passes PRs that match or reduce baseline.
- CI job runs per-PR per D-18 (not nightly).
- Escalation per D-17 happens automatically when a future cleanup PR lands baseline at 0 — no plan needed.
</success_criteria>

<output>
After completion, create `.planning/phases/23-tech-debt-sweep-launch-polish/23-02-SUMMARY.md` with: tool versions installed, baseline warn counts (knip + tue), CI job name + YAML location, manual regression-test result, and any false-flag exclusions added to ignoreDependencies / pathsToIgnore beyond D-15.
</output>
