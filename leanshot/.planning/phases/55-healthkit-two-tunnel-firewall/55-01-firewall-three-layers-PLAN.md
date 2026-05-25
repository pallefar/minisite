---
phase: 55-healthkit-two-tunnel-firewall
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - leanshot/eslint-rules/no-health-in-ad-context.cjs
  - leanshot/eslint-rules/__tests__/no-health-in-ad-context.test.cjs
  - leanshot/src/lib/native/healthAssert.ts
  - leanshot/src/lib/native/healthAssert.test.ts
  - leanshot/scripts/check-no-health-in-ad-context.sh
  - leanshot/scripts/__tests__/check-no-health-in-ad-context.test.ts
  - leanshot/eslint.config.js
  - leanshot/package.json
  - .github/workflows/ci.yml
autonomous: true
requirements: [HEALTH-04, HEALTH-08]
must_haves:
  truths:
    - "An ad/marketing/analytics/affiliate file that imports health.ts fails `npm run lint` (ESLint layer)"
    - "Calling the runtime guard in an ad context throws in dev/test (runtime layer)"
    - "The CI grep gate exits non-zero when an ad-context file imports health.ts (CI layer)"
    - "Each of the 3 layers has its own passing unit test that proves it catches a violation"
  artifacts:
    - path: "leanshot/eslint-rules/no-health-in-ad-context.cjs"
      provides: "Layer 1 — ESLint AST rule blocking health imports in ad-context files"
      contains: "module.exports"
    - path: "leanshot/src/lib/native/healthAssert.ts"
      provides: "Layer 2 — runtime guard that throws in dev/test, warns in prod"
      exports: ["assertHealthTunnel"]
    - path: "leanshot/scripts/check-no-health-in-ad-context.sh"
      provides: "Layer 3 — comment-stripped CI grep gate"
      contains: "set -euo pipefail"
    - path: "leanshot/eslint-rules/__tests__/no-health-in-ad-context.test.cjs"
      provides: "Layer 1 unit test (RuleTester)"
      min_lines: 20
    - path: "leanshot/src/lib/native/healthAssert.test.ts"
      provides: "Layer 2 unit test (throws in dev/test)"
      min_lines: 15
    - path: "leanshot/scripts/__tests__/check-no-health-in-ad-context.test.ts"
      provides: "Layer 3 unit test (gate exits non-zero on violation fixture)"
      min_lines: 15
  key_links:
    - from: "leanshot/eslint.config.js"
      to: "leanshot/eslint-rules/no-health-in-ad-context.cjs"
      via: "require + plugin rule registration"
      pattern: "no-health-in-ad-context"
    - from: ".github/workflows/ci.yml"
      to: "leanshot/scripts/check-no-health-in-ad-context.sh"
      via: "bash run step in lint job"
      pattern: "check-no-health-in-ad-context"
---

<objective>
Build the three independent enforcement layers of the two-tunnel firewall (HEALTH-04 / HEALTH-08) that structurally prevent HealthKit/PHI data from ever reaching ad-targeting surfaces (Apple §5.1.3). This is the patient-trust + App-Store-compliance centerpiece of the phase: each layer MUST be genuinely independent and individually unit-tested.

The three layers mirror the validated Phase 39 PHARMA-02 precedent exactly (D-06 3-layer MUST-NEVER pattern):
1. Build-time ESLint AST rule
2. Runtime guard helper
3. CI grep gate (comment-stripped)

Purpose: A single bypass (eslint-disable comment, a missed code review, a dynamic import) cannot cause a §5.1.3 compliance breach because three orthogonal gates must all be defeated.
Output: One new ESLint custom rule + its test, one runtime guard + its test, one shell gate + its test, plus wiring into eslint.config.js, package.json, and ci.yml.

NOTE: This plan does NOT touch `src/lib/native/health.ts` — that file is owned by Plan 55-03. The runtime guard (`healthAssert.ts`) created here is imported by health.ts in 55-03. Keeping the guard in its own file is what lets 55-01 and 55-03 not collide.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/ROADMAP.md
@.planning/STATE.md

# Phase 39 PHARMA-02 precedent — copy the structure of these three files verbatim,
# swapping the domain (safety_category/Paywall → health import / ad context):
@leanshot/eslint-rules/no-paywall-on-safety-category.cjs
@leanshot/eslint-rules/__tests__/no-paywall-on-safety-category.test.cjs
@leanshot/scripts/check-no-paywall-on-safety-category.sh
@leanshot/src/lib/pharma/phaCheck.ts

<interfaces>
<!-- Existing firewall wiring the executor extends. DO NOT replace; ADD to it. -->

eslint.config.js already has (Phase 12 Zones 1-6) `import-x/no-restricted-paths`
rules blocking `health.ts` from FLOWING INTO ad/analytics/affiliate/ads/marketing/
stripe directories + a `*.ad-eligible.ts` block + a `posthog*.ts` block. Those stay.
This plan adds a NAMED custom rule for HEALTH-08 (the reverse-direction, individually
identifiable layer) — additive, after the existing Phase 39 `leanshot-pharma` plugin block.

eslint.config.js custom-rule registration precedent (Phase 39):
```js
const noPaywallOnSafetyCategoryRule = _require('./eslint-rules/no-paywall-on-safety-category.cjs');
// ...
{
  files: ['src/components/pharma/**/*.{ts,tsx}'],
  plugins: { 'leanshot-pharma': { rules: { 'no-paywall-on-safety-category': noPaywallOnSafetyCategoryRule } } },
  rules: { 'leanshot-pharma/no-paywall-on-safety-category': 'error' },
},
```

package.json scripts precedent (Phase 39 layer 3):
```
"lint:safety": "bash scripts/check-no-paywall-on-safety-category.sh src",
```

ci.yml `lint` job (job key `lint:`, name "Lint") already runs:
```
- run: npm run lint
- run: bash scripts/check-css-logical-properties.sh   # additive shell gate precedent
```
Add the new firewall gate as a sibling `- run: bash scripts/check-no-health-in-ad-context.sh src` step in the SAME `lint` job (working-directory is `leanshot/` per the job's defaults).

healthAssert env-detection precedent (from phaCheck.ts): use `import.meta.env.DEV`
+ `import.meta.env.MODE === 'test'`; fall back to loud-by-default (true) when
`import.meta.env` is undefined (Node test runner importing directly).
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Layer 1 — ESLint AST rule + RuleTester test</name>
  <files>leanshot/eslint-rules/no-health-in-ad-context.cjs, leanshot/eslint-rules/__tests__/no-health-in-ad-context.test.cjs, leanshot/eslint.config.js</files>
  <behavior>
    - INVALID: an ImportDeclaration in a file matching `/(ads?|marketing|analytics|affiliate)/` whose source is `./native/health`, `@/lib/native/health`, or `*/native/health.ts` → reports messageId `crossImport`.
    - INVALID: same for a file matching `*.ad-eligible.ts`.
    - VALID: a file matching the ad-context pattern importing anything that is NOT health (e.g. `./platform`) → 0 errors.
    - VALID: a non-ad file (e.g. `src/lib/native/health.ts` itself, or `src/components/healthkit/Foo.tsx`) importing health → 0 errors (rule is scoped to ad-context importers only).
  </behavior>
  <action>Create `eslint-rules/no-health-in-ad-context.cjs` mirroring the structure of `no-paywall-on-safety-category.cjs` (CommonJS `.cjs` because package.json declares `"type": "module"`). Rule semantics: in `create(context)`, read `context.getFilename()`; if the filename does NOT match the forbidden-importer regex (ad/marketing/analytics/affiliate directory OR a `*.ad-eligible.ts` suffix), return `{}` (no-op). Otherwise register an `ImportDeclaration` visitor that reports messageId `crossImport` when `node.source.value` matches a health-module import (the `native/health` or `@/lib/native/health` paths). meta.type='problem'; meta.docs.description must name HEALTH-04/HEALTH-08 and Apple §5.1.3; meta.messages.crossImport must name the importer and the rule purpose. Use a NAMED message, schema: []. Create the RuleTester test in `__tests__/no-health-in-ad-context.test.cjs` mirroring the sibling test harness (flat-config RuleTester, `node:test`), with the 4 fixtures from `<behavior>`. Wire into `eslint.config.js`: add a `_require('./eslint-rules/no-health-in-ad-context.cjs')` near the other custom-rule requires, and a new flat-config block AFTER the Phase 39 `leanshot-pharma` block scoping `files: ['src/lib/ads/**/*.{ts,tsx}','src/lib/analytics/**/*.{ts,tsx}','src/lib/marketing/**/*.{ts,tsx}','src/lib/affiliate/**/*.{ts,tsx}','src/lib/native/ads*.ts','src/**/*.ad-eligible.ts']`, `plugins: { 'leanshot-health': { rules: { 'no-health-in-ad-context': noHealthInAdContextRule } } }`, `rules: { 'leanshot-health/no-health-in-ad-context': 'error' }`. DO NOT modify or remove the existing Phase 12 Zone 1-6 import-x blocks. NEGATION-GREP TRAP: do not write rejected module names like `admob`/`adsense` as bare prose tokens anywhere in committed source; the regex literals are fine (they live in the rule file by necessity).</action>
  <verify>
    <automated>cd leanshot && node --test eslint-rules/__tests__/no-health-in-ad-context.test.cjs && npm run lint</automated>
  </verify>
  <done>RuleTester test passes all 4 fixtures; `npm run lint` passes (rule wired, no false positives on existing code).</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Layer 2 — runtime guard helper + test</name>
  <files>leanshot/src/lib/native/healthAssert.ts, leanshot/src/lib/native/healthAssert.test.ts</files>
  <behavior>
    - In a loud environment (DEV or MODE==='test', or import.meta.env undefined): `assertHealthTunnel('someCaller')` THROWS an Error whose message names the caller context and Apple §5.1.3.
    - In a non-loud (production) environment: `assertHealthTunnel` does NOT throw; it calls `console.error` once with the same message.
    - The loud-environment detection is a module-level boolean read (single evaluation at import).
  </behavior>
  <action>Create `src/lib/native/healthAssert.ts` exporting `assertHealthTunnel(callerContext: string): void`, mirroring the env-detection + dev/test-throws / prod-warns shape of `src/lib/pharma/phaCheck.ts`. Message format: `Two-tunnel firewall: health data accessed in ad context [${callerContext}]. Apple §5.1.3 violation.` Use `import.meta.env.DEV` / `import.meta.env.MODE === 'test'` with a try/catch fallback to loud-by-default (true) when `import.meta.env` is unavailable (Node test runner). This guard is the call-site belt-AND-suspenders layer invoked by health.ts public exports in Plan 55-03. Create the vitest test `healthAssert.test.ts`: assert it throws under the test environment (Vitest sets MODE=test); assert the thrown message contains the caller context and "§5.1.3". Do NOT write rejected ad-SDK names as prose tokens in this file (negation-grep trap) — describe the rejection in the SUMMARY/commit message only.</action>
  <verify>
    <automated>cd leanshot && npx vitest run src/lib/native/healthAssert.test.ts</automated>
  </verify>
  <done>Test passes: assertHealthTunnel throws in test env with a §5.1.3 message naming the caller.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 3: Layer 3 — CI grep gate + test + ci.yml/package.json wiring</name>
  <files>leanshot/scripts/check-no-health-in-ad-context.sh, leanshot/scripts/__tests__/check-no-health-in-ad-context.test.ts, leanshot/package.json, .github/workflows/ci.yml</files>
  <behavior>
    - Gate exits 0 on a clean tree (no ad-context file imports health).
    - Gate exits 1 when a fixture ad-context file contains a comment-stripped `from '@/lib/native/health'` import.
    - eslint-disable / block-comment text mentioning health does NOT trigger a false positive (the gate is comment-stripped via perl -0).
  </behavior>
  <action>Create `scripts/check-no-health-in-ad-context.sh` mirroring `scripts/check-no-paywall-on-safety-category.sh` exactly (src-root resolution: try `leanshot/src`, then `src`, then script-relative `../src`; `set -euo pipefail`; exit code 2 if src root not found). Strategy: enumerate every `*.ts`/`*.tsx` file under the ad-context surfaces (directories `ads`, `marketing`, `analytics`, `affiliate` and `*.ad-eligible.ts` files), excluding `*.test.ts`, `*.test.tsx`, `__tests__`, `node_modules`, `dist`, `dist-marketing`, `coverage`; for each, slurp + strip `/* */` and `//` comments with `perl -0pe 's{/\*.*?\*/}{}gs; s{//[^\n]*}{}g'`; if the stripped content matches `from ['\"].*native/health` then record the hit. Exit 1 with `::error::` + offending file list if any hit; else echo OK + exit 0. Add `"lint:health-firewall": "bash scripts/check-no-health-in-ad-context.sh src"` to package.json scripts. Wire into `.github/workflows/ci.yml` `lint` job (job key `lint:`) as a new `- run: bash scripts/check-no-health-in-ad-context.sh src` step immediately after the existing `bash scripts/check-css-logical-properties.sh` step. Create the gate test `scripts/__tests__/check-no-health-in-ad-context.test.ts` (vitest): write a temp dir with a fake `ads/leak.ts` containing a health import, run the script against it via `child_process.execSync`, assert exit code 1; then a clean temp dir asserts exit code 0; then a temp file whose ONLY health reference is inside a `/* */` comment asserts exit 0 (comment-strip proof). Grep-gate hygiene: the gate matches on the comment-stripped import string only, never a bare token count.</action>
  <verify>
    <automated>cd leanshot && npx vitest run scripts/__tests__/check-no-health-in-ad-context.test.ts && bash scripts/check-no-health-in-ad-context.sh src</automated>
  </verify>
  <done>Gate test passes (exit 1 on violation, 0 on clean, 0 on comment-only); gate run against real src exits 0; ci.yml + package.json wired.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| health module → ad/marketing/analytics modules | PHI must NEVER cross this boundary (Apple §5.1.3 / HIPAA) |
| developer edit → committed code | a missed review or eslint-disable could introduce a cross-import |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-55-01-01 | Information Disclosure | health.ts imported by an ad-context file | mitigate | Layer 1 ESLint AST rule errors at build (`leanshot-health/no-health-in-ad-context`) |
| T-55-01-02 | Information Disclosure | dynamic/runtime health access in ad path | mitigate | Layer 2 `assertHealthTunnel` throws in dev/test, console.error in prod |
| T-55-01-03 | Tampering | eslint-disable comment silences Layer 1 | mitigate | Layer 3 comment-stripped grep gate cannot be disabled by comments; runs in CI lint job |
| T-55-01-04 | Repudiation | firewall claim with no proof | accept→mitigate | Each layer has an independent unit test proving it catches a violation |
</threat_model>

<verification>
- `node --test eslint-rules/__tests__/no-health-in-ad-context.test.cjs` — Layer 1 fixtures pass
- `npx vitest run src/lib/native/healthAssert.test.ts` — Layer 2 throws in test env
- `npx vitest run scripts/__tests__/check-no-health-in-ad-context.test.ts` — Layer 3 exit codes
- `npm run lint` — rule wired, zero false positives on existing source
- `bash scripts/check-no-health-in-ad-context.sh src` — exits 0 on real tree
- Existing Phase 12 Zone 1-6 import-x rules unchanged (grep eslint.config.js confirms the six `Two-tunnel firewall (Phase 12 D-02 Zone` messages still present)
</verification>

<success_criteria>
- 3 independent firewall layers exist, each with a passing unit test that proves it catches a violation the others might miss (HEALTH-08).
- ESLint rule blocks health imports from ad-context files; CI grep gate runs in the lint job; runtime guard throws in dev/test (HEALTH-04).
- `health.ts` is NOT modified by this plan (owned by 55-03).
- No rejected-alternative ad-SDK names appear as prose tokens in committed source (negation-grep trap avoided).
</success_criteria>

<output>
Create `.planning/phases/55-healthkit-two-tunnel-firewall/55-01-SUMMARY.md` when done.
</output>
