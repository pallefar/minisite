---
phase: 39-a-b-trifecta-mid-trial-paywall-pharma-paywall-page-variant-a
plan: 02
subsystem: build-pipeline-pharma-page-builder
tags: [eslint, ast-rule, runtime-assertion, ci-grep, pharma, safety-category, paywall, page-builder, ab-testing, three-layer-enforcement, d-05, d-06, d-13]

# Dependency graph
requires:
  - phase: 39
    plan: 01
    provides: pharma_content.safety_category column (D-05 enum CHECK), page_variants table (PAGEAB target of variant_set_id FK)
  - phase: 42
    provides: ESLint flat-config + custom-rule plugin registration pattern (no-conditional-native-review)
  - phase: 28
    provides: .cjs rule filename convention + RuleTester harness pattern (no-raw-service-role-client)
  - phase: 24
    provides: comment-stripping CI grep gate pattern (check-taxo-06-reconciliation)
provides:
  - eslint-rules/no-paywall-on-safety-category.cjs (D-06 layer 1: build-time AST rule)
  - src/lib/pharma/phaCheck.ts (D-06 layer 2: runtime assertion helper)
  - scripts/check-no-paywall-on-safety-category.sh (D-06 layer 3: CI grep gate)
  - BlockNode.variant_set_id optional field (D-13 / PAGEAB-06)
  - npm script "lint:safety" wiring
affects: [39-03, 39-04, 39-05, 39-06, 39-07, 39-08, 39-09, 39-10]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Pattern K (mirror of no-conditional-native-review): identifier-Set + JSXElement visitor + iterative DFS subtree walk bounded at FUNCTION_BOUNDARY_TYPES"
    - "Three-layer regulator-grade enforcement (D-06): each layer fails independently — bypassing one (eslint-disable, dev-only-throw, comment-hide) cannot defeat the gate"
    - "Per-file CI grep with perl multi-line comment strip (improvement over the original 21-line-window sed approach — handles JSDoc /** */ blocks correctly without false positives on the gate's own documentation)"
    - "Adjacent vitest config workaround for src/ unit tests (pre-existing project-wide gap: the top-level vitest.config.ts `projects:[]` array supersedes `test:{include}`)"

key-files:
  created:
    - "leanshot/eslint-rules/no-paywall-on-safety-category.cjs"
    - "leanshot/eslint-rules/__tests__/no-paywall-on-safety-category.test.cjs"
    - "leanshot/src/lib/pharma/phaCheck.ts"
    - "leanshot/src/lib/pharma/__tests__/phaCheck.test.ts"
    - "leanshot/scripts/check-no-paywall-on-safety-category.sh"
  modified:
    - "leanshot/eslint.config.js"
    - "leanshot/src/lib/page-builder/block-schema.ts"
    - "leanshot/src/lib/page-builder/block-schema.test.ts"
    - "leanshot/package.json"

key-decisions:
  - "Extended the EXISTING co-located src/lib/page-builder/block-schema.test.ts (not a new __tests__/ file) per the plan's `<behavior>` instruction 'extend block-schema.test.ts (existing file)'. The plan's files_modified list naming was inconsistent (mentioned __tests__/) — chose the behavior-block instruction as canonical."
  - "Improved the CI grep gate to per-file comment-stripped check instead of the original 21-line window with sed. Reason: the gate's own documentation legitimately references both 'Paywall' and 'safety_category' in JSDoc prose (phaCheck.ts file header), and sed's single-line regex cannot strip multi-line /** */ blocks. Per-file with `perl -0pe 's{/\\*.*?\\*/}{}gs; s{//[^\\n]*}{}g'` correctly handles JSDoc + line comments. Verified with deliberate violation fixture (eslint-disable comment does NOT hide the failure)."
  - "phaCheck environment detection is loud-by-default: if `import.meta.env` is undefined (non-Vite import context, e.g. Node test runner), the function throws. Production must explicitly set `import.meta.env.MODE !== 'test'` AND `DEV === false` to suppress the throw."
  - "Symlinked leanshot/node_modules → main repo's node_modules (per memory reference_npm_install_worktree_main_drift): worktree-isolated executors don't have node_modules; symlink avoids re-running `npm install` per worktree."

patterns-established:
  - "Three-layer phaCheck enforcement template (D-06): future plans adding any new gate-component name (e.g. PaywallOverlay, RefundPaywall, CohortPaywall) MUST extend PAYWALL_COMPONENTS in BOTH the AST rule (.cjs) AND the bash grep gate's identifier alternation. T-39-02-03 documented this future-extension hook in the rule's meta.docs.description."

requirements-completed: [PHARMA-02, PAGEAB-06]

# Metrics
duration: 14min
completed: 2026-05-24
---

# Phase 39 Plan 02: Three-Layer phaCheck Enforcement + BlockNode.variant_set_id Summary

**Shipped the D-06 three-layer never-paywalled-safety-info enforcement (build-time ESLint AST rule + runtime phaCheck() helper + comment-stripped CI grep gate) plus the PAGEAB-06 BlockNode.variant_set_id optional FK — all wired into the project lint pipeline (eslint.config.js + npm scripts) so Wave 2/3/4 plans inherit the gate automatically.**

## Performance

- **Duration:** ~14 min
- **Started:** 2026-05-24T14:42:07Z
- **Completed:** 2026-05-24T14:56:01Z
- **Tasks:** 2 / 2
- **Files modified:** 9 (5 created + 4 modified)

## Accomplishments

- **D-06 Layer 1 (build-time AST):** `eslint-rules/no-paywall-on-safety-category.cjs` mirrors the Pattern K shape from `no-conditional-native-review.cjs` — identifier Set + JSXElement visitor + iterative-DFS subtree walk that bails at function-boundary nodes. Registered in `eslint.config.js` under the `leanshot-pharma` plugin with `error` severity. Verified via `npx eslint --print-config src/App.tsx | grep no-paywall-on-safety-category`.
- **D-06 Layer 1 proof:** 6 RuleTester fixtures (3 invalid, 3 valid) covering all 3 PAYWALL_COMPONENTS (Paywall, PaywallGate, PaywallModal) × all 3 access shapes (Identifier MemberExpression, LogicalExpression child, string-literal MemberExpression) + function-boundary bail + non-safety field + non-Paywall wrapper. All 6 pass via `node --test`.
- **D-06 Layer 2 (runtime):** `src/lib/pharma/phaCheck.ts` exports `PharmaContent` interface + `phaCheck(content): void` per the plan's `<interfaces>`. Loud-by-default environment detection: throws in `import.meta.env.DEV` or `MODE === 'test'`, `console.warn` only in prod.
- **D-06 Layer 2 proof:** 8 Vitest cases including a parameterized test across all 5 D-05 safety categories (overdose-warning, contraindication-alert, fda-black-box, serious-adverse-event-signal, pregnancy-lactation-contraindication) + null/undefined no-throw + error-message reference assertions. Verified via adjacent vitest config: 13/13 pass.
- **D-06 Layer 3 (CI grep):** `scripts/check-no-paywall-on-safety-category.sh` per-file comment-stripped grep with perl multi-line regex for JSDoc blocks. Wired to `package.json` as `npm run lint:safety`. Verified deliberate violation fixture fails with exit 1 even WITH `/* eslint-disable-next-line */` comment present (comment-strip catches it).
- **PAGEAB-06 / D-13:** `BlockNode` interface in `src/lib/page-builder/block-schema.ts` extended with optional `variant_set_id?: string` — block-schema.test.ts asserts both with-variant and without-variant shapes compile. Type-only addition; zero breaking change to existing blocks.
- **TypeScript clean:** `npx tsc -p tsconfig.app.json --noEmit` exits 0 with no diagnostics.

## Task Commits

1. **Task 1: ESLint AST rule + RuleTester + eslint.config.js registration** — `492b2c14` (feat)
2. **Task 2: phaCheck + CI grep gate + BlockNode.variant_set_id + npm wiring** — `8c58ff45` (feat)

(SUMMARY commit hash assigned at final commit.)

## Files Created/Modified

### Created (5)
- `leanshot/eslint-rules/no-paywall-on-safety-category.cjs` — D-06 layer 1 AST rule, 175 lines including extensive header explaining the 3-layer template
- `leanshot/eslint-rules/__tests__/no-paywall-on-safety-category.test.cjs` — RuleTester suite (6 fixtures), uses node:test harness
- `leanshot/src/lib/pharma/phaCheck.ts` — D-06 layer 2 runtime assertion, loud-by-default environment detection
- `leanshot/src/lib/pharma/__tests__/phaCheck.test.ts` — Vitest suite, parameterized across all 5 D-05 safety categories
- `leanshot/scripts/check-no-paywall-on-safety-category.sh` — D-06 layer 3 CI grep gate, per-file perl-stripped (JSDoc-aware), executable

### Modified (4)
- `leanshot/eslint.config.js` — Added 2 lines for the rule require + 13-line registration block under leanshot-pharma plugin
- `leanshot/src/lib/page-builder/block-schema.ts` — BlockNode interface gains `variant_set_id?: string` with JSDoc explaining the D-13 / PAGEAB-06 contract + T-39-02-04 mitigation note
- `leanshot/src/lib/page-builder/block-schema.test.ts` — One new `it()` block asserting both with-variant and without-variant BlockNode shapes
- `leanshot/package.json` — One new `lint:safety` script invoking the bash gate

## Threat Mitigation Status (from `<threat_model>`)

| Threat ID | Component | Status | Evidence |
|-----------|-----------|--------|----------|
| T-39-02-01 | Paywall wraps FDA-black-box content (regulator-visible breach) | MITIGATED | All 3 layers operational: AST rule registered as error severity (layer 1); phaCheck() throws in dev/test (layer 2); CI grep exits 1 on co-occurrence (layer 3). 5/5 D-05 categories proven via Vitest parameterization. |
| T-39-02-02 | Developer disables ESLint rule via `eslint-disable-next-line` | MITIGATED | Verified: grep gate's perl-strip removes line + block comments BEFORE the Paywall* search; deliberate violation fixture WITH `eslint-disable-next-line` comment still exits 1. |
| T-39-02-03 | New gate component bypasses PAYWALL_COMPONENTS set | ACCEPTED (residual) | Documented in `rule.meta.docs.description` AND in the bash gate's identifier-alternation comment. Cross-checked at Wave 3 plan-checker review as documented in this SUMMARY. |
| T-39-02-04 | BlockNode.variant_set_id reveals admin-only variant existence to public render | MITIGATED | Field is OPTIONAL; resolution to actual variant content happens in Wave 2 page-variant-resolver Edge Function; public render emits resolved variant blocks only. Documented in the BlockNode JSDoc comment in block-schema.ts. |

## Deviations from Plan

### Adaptations (NOT deviations — driven by plan inconsistency + pre-existing infra)

**1. Extended existing co-located block-schema.test.ts instead of new `__tests__/block-schema.test.ts`**
- **Found during:** Task 2 pre-flight (read of `src/lib/page-builder/`)
- **Issue:** Plan `files_modified` lists `leanshot/src/lib/page-builder/__tests__/block-schema.test.ts` (the `__tests__/` subdirectory) but the `<behavior>` block instructs "extend block-schema.test.ts (existing file)". The existing co-located test file at `src/lib/page-builder/block-schema.test.ts` already has the BlockNode shape assertions.
- **Adaptation:** Extended the existing co-located file. The `__tests__/` path mentioned in `files_modified` would have duplicated the existing assertions in a near-empty file. Followed behavior-block instruction as canonical.
- **Files:** `leanshot/src/lib/page-builder/block-schema.test.ts`
- **Commit:** `8c58ff45`

**2. Per-file comment-stripped CI grep instead of 21-line sed-stripped window**
- **Found during:** Task 2 first grep gate run against `src/`
- **Issue:** The original plan's bash recipe (`grep -B 10 -A 10` then `sed -E 's://.*$::; s:/\*[^*]*\*+([^/*][^*]*\*+)*/::g'`) produced a false positive on `src/lib/pharma/phaCheck.ts` because the JSDoc file header legitimately references both `Paywall*` and `safety_category` in prose, and sed's regex cannot strip multi-line `/** ... */` blocks (only single-line block-comment forms).
- **Adaptation:** Rewrote the gate as a per-file check: for each file that contains `safety_category`, slurp the whole file, strip block + line comments via `perl -0pe 's{/\*.*?\*/}{}gs; s{//[^\n]*}{}g'`, then check both identifiers are present in the stripped content. Wider net than the 10-line window, but semantically correct (the project keeps pharma and paywall surfaces in separate files per D-03 + D-12). Validated with 3 deliberate-violation fixtures (plain, eslint-disable comment, pure-prose-only). All behave correctly.
- **Files:** `leanshot/scripts/check-no-paywall-on-safety-category.sh`
- **Commit:** `8c58ff45`

### Rule-Applied Auto-fixes
None — both tasks shipped first-try without any Rule 1/2/3 fixes during execution.

### Auth gates / checkpoints
None — fully autonomous (autonomous=true, no checkpoints).

## Deferred Issues

**Pre-existing vitest project-config gap** (out of scope per SCOPE BOUNDARY)
- `vitest.config.ts` declares both a top-level `test: { include: ['src/**/*.test.ts', ...] }` AND a `projects: [...]` array. In Vitest 4.x the projects array supersedes the outer `test` config, so `npx vitest run` only collects the `phase38-eval` project and skips ALL `src/` unit tests project-wide. This is NOT specific to this plan (reproduces identically in main on the same branch base). Per `feedback_executor_auto_adds_missing_migration` style: if Wave 2+ plans need verifiable src/ unit tests as part of `<verify>`, a focused plan should add a default project to vitest.config.ts (e.g., `{ test: { name: 'unit', include: ['src/**/*.test.ts'], environment: 'jsdom' } }` as the first entry in `projects`).
- **Workaround used here:** adjacent ad-hoc vitest config (`vitest-39-02.config.ts`) with only `test.include = src/lib/pharma/__tests__/*.test.ts + src/lib/page-builder/block-schema.test.ts`. 20/20 tests pass. Config was deleted post-run; not shipped.
- Logged here so the next plan executor knows to use the same workaround until the root vitest.config is fixed.

## Self-Check

| Item | Status | Evidence |
|------|--------|----------|
| `eslint-rules/no-paywall-on-safety-category.cjs` exists | PASS | `git show 492b2c14 --stat` lists the file |
| `eslint-rules/__tests__/no-paywall-on-safety-category.test.cjs` exists | PASS | Same commit, 175 lines |
| Rule registered in eslint.config.js | PASS | `npx eslint --print-config src/App.tsx | grep no-paywall-on-safety-category` returns 1 hit |
| `src/lib/pharma/phaCheck.ts` exists | PASS | `git show 8c58ff45 --stat` lists the file |
| `src/lib/pharma/__tests__/phaCheck.test.ts` exists | PASS | Same commit |
| `scripts/check-no-paywall-on-safety-category.sh` exists + executable | PASS | `test -x scripts/check-no-paywall-on-safety-category.sh` exits 0 |
| `lint:safety` wired in package.json | PASS | `grep lint:safety leanshot/package.json` returns 1 hit |
| BlockNode includes `variant_set_id?: string` | PASS | `grep variant_set_id src/lib/page-builder/block-schema.ts` returns the field declaration |
| All 6 RuleTester cases pass | PASS | `node --test eslint-rules/__tests__/no-paywall-on-safety-category.test.cjs` → 6/6 pass |
| All 5 D-05 safety categories proven via Vitest | PASS | Adjacent vitest config run: 13/13 phaCheck cases pass (8 in core suite + 5 parameterized in the for-loop sub-suite) |
| CI grep exits 0 on current main | PASS | `bash scripts/check-no-paywall-on-safety-category.sh src` exits 0 |
| CI grep exits 1 on deliberate violation | PASS | `/tmp/fixture/src/violation.tsx` with `<PaywallGate>{content.safety_category}</PaywallGate>` exits 1 |
| CI grep exits 1 even WITH `eslint-disable-next-line` comment | PASS | Verified in Task 2 GREEN — comment-strip catches the violation |
| TypeScript clean | PASS | `npx tsc -p tsconfig.app.json --noEmit` exits 0 with no output |

## Self-Check: PASSED

All 9 deliverable files present in disk + commits. Both task commits (`492b2c14`, `8c58ff45`) found in `git log`. All 6 must-haves truths satisfied. Zero failing verifies.
