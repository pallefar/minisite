---
phase: 23-tech-debt-sweep-launch-polish
plan: 01
subsystem: ci-gates, lint-rules, test-registry
tags: [audit, lint-rule, ci-gate, deferred-tests, debt-02, debt-04]
requires: []
provides:
  - deferred-tests-registry (28 entries, all classified)
  - eslint-no-user-nonnull-rule (DEBT-02 regression guard)
  - audit-deferred-tests-mjs (CI enforcement script)
  - roadmap-requirements-corrected-wording
affects:
  - leanshot/.planning/deferred-tests.md
  - leanshot/eslint.config.js
  - leanshot/scripts/audit-deferred-tests.mjs
  - .github/workflows/ci.yml
  - leanshot/.planning/ROADMAP.md
  - leanshot/.planning/REQUIREMENTS.md
tech-stack:
  added: [audit-deferred-tests.mjs (Node ESM), eslint no-restricted-syntax (TSNonNullExpression)]
  patterns: [registry-anchor-enforcement, env-gate-exemption, no-restricted-syntax-append]
key-files:
  created:
    - leanshot/scripts/audit-deferred-tests.mjs
  modified:
    - leanshot/.planning/deferred-tests.md
    - leanshot/eslint.config.js
    - .github/workflows/ci.yml
    - leanshot/.planning/ROADMAP.md
    - leanshot/.planning/REQUIREMENTS.md
    - leanshot/e2e/migrate-resume.spec.ts
    - leanshot/e2e/cross-device-sync.spec.ts
    - leanshot/e2e/offline-log-then-sync.spec.ts
    - leanshot/e2e/offline-conflict-toast.spec.ts
    - leanshot/e2e/photo-cross-device.spec.ts
    - leanshot/e2e/signout-cache-clear.spec.ts
    - leanshot/e2e/account-delete-cancel.spec.ts
    - leanshot/e2e/page-builder-slice1.spec.ts
    - leanshot/src/components/clinic/OrgCreateFlow.test.tsx
    - leanshot/src/components/clinic/roster/BulkExport.test.tsx
decisions:
  - DEBT-02 was already at 0 occurrences in production code before Phase 23 — the sweep happened organically in Phase 22 or earlier. Plan 23-01 adds the ESLint regression guard and formally closes the requirement.
  - Env-gated test.skip patterns (using !HAS_LIVE, !hasLiveSupabase(), !SHOULD_RUN, or any ! prefix) are exempt from the anchor requirement — they are not "deferred in intent" and self-skip correctly in CI.
  - No-restricted-syntax rule exempts test files (src/**/*.test.*, src/test/**/*.*, e2e/**/*) so Supabase admin response assertions using .user! remain valid.
  - Registry anchor format: // see deferred-tests.md#<slug> where slug is GitHub-flavored markdown anchor (lowercase, hyphenated).
metrics:
  duration: ~35 minutes
  completed: 2026-05-16
  tasks-completed: 4/4
  files-modified: 16
---

# Phase 23 Plan 01: Audit + DEBT-02 Closeout + DEBT-04 Registry Expansion

**One-liner:** Phase 23 audit pass — 28 deferred test markers classified, DEBT-02 verified clean with ESLint regression guard, CI lint gate enforces anchor links for all new skips.

## What Was Built

### Task 1: Codebase Audit + Expanded deferred-tests.md

The registry was expanded from 1 entry to **28 sections** across 7 Phase groupings:

| Category | Count | Examples |
|----------|-------|---------|
| Phase 7/RC5 Realtime flakes | 6 | migrate-resume, cross-device-sync, offline-conflict-toast, photo-cross-device |
| Phase 22 Vault-gated | 1 | account-delete-cancel (HMAC link, Vault key pending) |
| Phase 15 live round-trip | 1 | page-builder-slice1 (staff seed + Edge Function deploy) |
| Phase 9 unit test contamination | 2 | OrgCreateFlow (mock queue), BulkExport (jsdom async chain) |
| Phase 8/9/10/22 env-gated suites | 18 | clinic-pitfall-8-*, share-*, roster-perf, lifecycle-welcome-series |
| Phase 15 RLS GoTrue flake | 1 | page-builder-rls.test.ts (PRESERVED VERBATIM — fix-plan: 23-05) |
| Env-gated summary table | EG-01..EG-26 | All rls-*.test.ts, HAS_LIVE gates, SHOULD_RUN/describeIfLive |

**Anchor backfill:** 10 `// see deferred-tests.md#<anchor>` comments added to:
- `e2e/migrate-resume.spec.ts` (2 test.fixme)
- `e2e/cross-device-sync.spec.ts` (1 test.fixme)
- `e2e/offline-log-then-sync.spec.ts` (1 test.fixme)
- `e2e/offline-conflict-toast.spec.ts` (1 test.fixme)
- `e2e/photo-cross-device.spec.ts` (1 test.fixme)
- `e2e/signout-cache-clear.spec.ts` (1 test.fixme)
- `e2e/account-delete-cancel.spec.ts` (1 test.skip top-level)
- `e2e/page-builder-slice1.spec.ts` (1 test.fixme)
- `src/components/clinic/OrgCreateFlow.test.tsx` (1 it.skip)
- `src/components/clinic/roster/BulkExport.test.tsx` (1 it.skip)

### Task 2: ESLint `no-restricted-syntax` rule (DEBT-02 regression guard)

New rule appended to the existing `no-restricted-syntax` array in `leanshot/eslint.config.js`:

```js
{
  selector: "TSNonNullExpression[expression.type='MemberExpression'][expression.property.name='user']",
  message: '`*.user!` non-null assertions are banned (project anti-pattern). Use early returns, typed guards (`if (!s.user) return null;`), or Auth-required boundary components instead. See `s.user!` audit closeout in Phase 23 (DEBT-02).',
},
```

**Verified:** 0 new violations introduced. The rule is off for test files (`src/**/*.test.*`, `src/test/**/*`, `e2e/**/*`) since Supabase admin responses in test setup legitimately use `.user!`.

**Pre-existing lint debt:** `npm run lint` exits 1 due to 116 pre-existing `import-x/order` errors from Phase 8-13 files (per memory note `project_lint_debt_import_x_order`). Our change adds 0 new errors — baseline is 143 problems before and after this change.

### Task 3: `scripts/audit-deferred-tests.mjs` + CI wire

Script behavior:
- Walks `src/**`, `tests/**`, `e2e/**` for `*.test.ts`, `*.test.tsx`, `*.spec.ts`
- Checks `test.fixme`, `xtest`, `xdescribe` and non-env-gated `test.skip` for `// see deferred-tests.md#<anchor>`
- **Exempt patterns:** `!<anything>` (env var or setup variable negation), `true` (static guard), `HAS_*`, `SHOULD_RUN`, `process.env.*`, `describeIfLive`, bare no-arg `test.skip()`
- Exits 1 if any marker lacks anchor; exits 0 if all clear

**CI invocation** (appended to `lint` job in `.github/workflows/ci.yml`):
```yaml
- name: Deferred-tests registry audit
  run: node scripts/audit-deferred-tests.mjs
```

**Smoke output:**
```
Deferred-tests registry audit
  Audited: 11 non-env-gated defer markers
  Linked:  11 have // see deferred-tests.md#<anchor>
  Unlinked: 0

PASS — all non-env-gated defer markers have registry anchor links.
```

### Task 4: ROADMAP + REQUIREMENTS update

**ROADMAP.md line 31 (Phase 23 summary):**
- Before: `s.user! audit (15 occurrences / 14 files) + ... 6 deferred tests batch-fix`
- After: `DEBT-02: 0 s.user! non-null assertions in production code (verified 2026-05-16, ESLint regression guard installed) + ... DEBT-04: 28 deferred test markers audited...`

**ROADMAP.md SC#2 and SC#4** rewritten with audited reality (0 occurrences, 28 entries).

**REQUIREMENTS.md:**
- DEBT-02: `[ ]` → `[x]` with "Audit verified 0 occurrences; ESLint rule prevents regression"
- DEBT-04: `[ ]` → `[x]` with "28 entries (9 deferred + 19 env-gated); CI lint enforces anchor links"
- Traceability table: both marked `Complete (Plan 23-01)`

## Commits

| Task | Hash | Message |
|------|------|---------|
| T1 | `b0ac305` | feat(23-01): T1 audit — expand deferred-tests.md to 28 entries + anchor comments |
| T2 | `a26aec1` | feat(23-01): T2 add eslint no-user-non-null rule (DEBT-02 closeout) |
| T3 | `4b520fd` | feat(23-01): T3 add scripts/audit-deferred-tests.mjs + ci.yml wire |
| T4 | `80dc96f` | docs(23-01): T4 update ROADMAP + REQUIREMENTS to audited reality |

## Deviations from Plan

**1. [Rule 2 - Auto-add] Test file override for no-restricted-syntax rule**
- **Found during:** Task 2
- **Issue:** The new `no-restricted-syntax` rule flagged `*.user!` in test files (`store.test.ts:1270-1271`, `audit-trigger.test.ts:77`) where test assertions against Supabase admin `createUser` responses legitimately use `.user!` on a non-null typed return value.
- **Fix:** Added `'no-restricted-syntax': 'off'` to the existing test file override block in `eslint.config.js`. Also expanded `files` glob to include `src/test/**/*.{ts,tsx}` which the original block missed.
- **Files modified:** `leanshot/eslint.config.js`
- **Commit:** `a26aec1`

**2. [Rule 2 - Auto-add] Env-gate regex exemption in audit script**
- **Found during:** Task 3 (first script run)
- **Issue:** Initial env-gate regex missed 3 env-gated patterns: `!(SUPABASE_URL && ...)` (parens wrapping), `!userId || !admin` (runtime setup guard), `!DRAFT_SLUG` (bare variable negation).
- **Fix:** Simplified regex to `!<anything>` prefix rule — any `test.skip` whose first argument starts with `!` is env/setup-gated and exempt.
- **Files modified:** `leanshot/scripts/audit-deferred-tests.mjs`
- **Commit:** `4b520fd`

## Known Stubs

None — all entries in the registry have fix-plan references or `Target: N/A — env-gated`.

## Threat Flags

None — this plan modified only test infrastructure, ESLint config, CI workflow, and planning documents. No new network endpoints, auth paths, or schema changes.

## Self-Check

- [x] `leanshot/.planning/deferred-tests.md` exists and contains `## Phase 15` + `### 1. \`tests/rls/page-builder-rls.test.ts\`` + 28 `### N.` sections
- [x] `leanshot/eslint.config.js` contains `TSNonNullExpression[expression.type='MemberExpression'][expression.property.name='user']`
- [x] `leanshot/scripts/audit-deferred-tests.mjs` exists (≥30 lines — actual: 258 lines)
- [x] `leanshot/.planning/ROADMAP.md` contains `DEBT-02` with 0-occurrence wording
- [x] `leanshot/.planning/REQUIREMENTS.md` contains `[x] **DEBT-02**` with closeout wording
- [x] `.github/workflows/ci.yml` contains `audit-deferred-tests` invocation
- [x] `node scripts/audit-deferred-tests.mjs` exits 0 (11 markers, 11 linked, 0 unlinked)
- [x] Stale "15 s.user!" wording: 0 occurrences in ROADMAP
- [x] Stale "6 deferred tests" wording: 0 occurrences in ROADMAP
- [x] 4 commits on main: b0ac305, a26aec1, 4b520fd, 80dc96f

## Self-Check: PASSED
