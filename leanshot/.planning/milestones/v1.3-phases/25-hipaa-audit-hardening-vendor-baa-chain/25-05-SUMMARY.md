---
phase: 25-hipaa-audit-hardening-vendor-baa-chain
plan: "05"
subsystem: CI lint / HIPAA compliance
tags: [hipaa, stripe, phi, ci, lint, banking-exemption]
requirements: [HIPAA-08]

dependency_graph:
  requires: []
  provides:
    - lint-stripe-phi CI gate (HIPAA-08 banking-exemption boundary enforcement)
  affects:
    - .github/workflows/ci.yml (test-e2e job gains Stripe PHI lint step)

tech_stack:
  added:
    - scripts/lint-stripe-phi.ts — Node 22 + tsx, zero external deps beyond Node built-ins
    - scripts/stripe-phi-keywords.json — static 23-keyword D-09 curated list
    - scripts/__tests__/lint-stripe-phi.test.ts — 10-case vitest subprocess test suite
  patterns:
    - Regex call-site detection (stripe.<resource>.<verb>({...})), intentionally loose per RESEARCH Pitfall 11
    - Word-boundary anchoring (\bKW\b) for single-word keywords; literal substring for multi-word/hyphenated
    - Allowlist via inline comment; reason= field required (missingReason enforcement)
    - GitHub Actions ::error file=PATH,line=N:: annotation format (Pattern S8)
    - --json mode for machine-readable output; --root=PATH for test isolation

key_files:
  created:
    - leanshot/scripts/lint-stripe-phi.ts
    - leanshot/scripts/stripe-phi-keywords.json
    - leanshot/scripts/__tests__/lint-stripe-phi.test.ts
  modified:
    - .github/workflows/ci.yml

decisions:
  - key: script-extension
    choice: .ts (via npx tsx)
    reason: tsx present in devDeps (confirmed in leanshot/package.json); matches plan decision rule
  - key: call-site-detection
    choice: regex over AST
    reason: plan specifies regex approach; AST upgrade deferred per RESEARCH Pitfall 11 (>10%/month FP rate trigger)
  - key: keyword-list
    choice: 23 D-09 keywords (brand + generic names + vitals)
    reason: plan-specified list; version 1 / lastReviewed 2026-05-17 in JSON
  - key: ci-step-position
    choice: after Security check step in test-e2e job
    reason: plan specified; unique step name avoids 25-06/25-10 collision

metrics:
  duration: ~25 minutes
  completed: "2026-05-18"
  tasks_completed: 2
  tasks_total: 2
  files_created: 3
  files_modified: 1
---

# Phase 25 Plan 05: Stripe PHI Keyword CI Lint Summary

**One-liner:** Regex-based PHI keyword CI gate for Stripe call sites using 23 D-09 brand/generic/vitals keywords with word-boundary anchoring and require-reason allowlist enforcement.

## Tasks Completed

| Task | Name | Commit | Key Files |
|------|------|--------|-----------|
| 1 | Keyword JSON + CI script + vitest tests | e26c571 | scripts/lint-stripe-phi.ts, scripts/stripe-phi-keywords.json, scripts/__tests__/lint-stripe-phi.test.ts |
| 2 | CI workflow integration | 0172a9f | .github/workflows/ci.yml |

## What Was Built

### lint-stripe-phi.ts

Zero-dependency Node 22 script (runnable via `npx tsx`) that:

1. Parses `--json`, `--strict`, `--root=PATH` CLI flags
2. Loads 23 keywords from `stripe-phi-keywords.json`
3. Recursively walks `src/` and `supabase/functions/` (excludes `node_modules`, `dist`, `.next`, `__tests__`, `__mocks__`, `*.test.ts`, `*.spec.ts`)
4. Fast-path: skips files without `/\bstripe\b/i`
5. Detects Stripe call sites via regex: `(?:stripe|[A-Za-z_]\w*[Ss]tripe)\.\w+\.(create|update|...) \({...})`
6. Extracts string values from `description`, `statement_descriptor`, `name` fields + bare metadata values
7. Checks each value for keyword matches:
   - Single-word keywords: `\bKW\b` word-boundary anchored (RESEARCH Pitfall 11)
   - Multi-word/hyphenated keywords: case-insensitive substring match
8. Allowlist: `// stripe-phi-lint:allow reason='...'` on same line or within 3 lines above; missing `reason=` is a lint failure
9. Emits `::error file=PATH,line=N::` annotations; JSON mode for machine output
10. Exits 0 on clean, 1 on violations, 2 on usage error

### stripe-phi-keywords.json

23 D-09 keywords (version 1, lastReviewed 2026-05-17):
- Brand names: Ozempic, Wegovy, Mounjaro, Zepbound
- Generic names: semaglutide, tirzepatide, dulaglutide, liraglutide, medication, peptide
- Clinical terms: patient, diagnosis, dose, lab, injection
- Units: mg, ml
- Vitals: blood pressure, weight, BMI, A1C, glucose
- Misc: GLP-1

### vitest test suite (10 cases)

1. Clean stripe call passes (exit 0)
2. PHI keyword "Ozempic" in description fails (exit 1 + ::error with keyword name)
3. Allowlist with `reason=` passes (exit 0)
4. Allowlist without `reason=` fails (exit 1 + ::error about missing reason)
5. Non-stripe file (no `\bstripe\b`) passes (exit 0)
6. Case-insensitive "OZEMPIC" fails (exit 1)
7. Partial-word "patientId" does NOT trigger `\bpatient\b` (exit 0) — RESEARCH Pitfall 11 proof
8. Multi-word "blood pressure" fails (exit 1)
9. File in `__tests__/` directory excluded (exit 0)
10. `--json` mode emits valid JSON array with file/line/keyword shape

### CI step

Added to `test-e2e` job after the existing "Security check" step:
```yaml
- name: Stripe PHI keyword lint (Phase 25 HIPAA-08)
  run: npx tsx scripts/lint-stripe-phi.ts
```

Step name is unique — will not collide with Plan 25-06 (`audit-sentry-mask`) or Plan 25-10 additions.

## Baseline Scan Result

Initial scan on current codebase (v1.3 main, aeae5c2 base): **0 violations (exit 0)**.

No false positives across `src/` (SPA TypeScript) or `supabase/functions/` (22 Edge Functions). Stripe call sites in the codebase do not use any D-09 keywords in string literal descriptions.

## Extension Decision

Script shipped as `.ts` (runnable via `npx tsx`) because `tsx` is present in `leanshot/package.json` devDependencies. No new build dependency added — `tsx` was already used by `scripts/sync-posthog-event-defs.ts`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Test isolation: shared tmp dir caused test interference**
- **Found during:** Task 1 (test run)
- **Issue:** Tests 5 and 7 failed because the shared `TMP_DIR` accumulated fixture files from prior tests (tests 2, 4, 6 had violations), causing later "clean" tests to fail
- **Fix:** Rewrote tests to use per-test isolated tmp dirs with `afterEach` cleanup
- **Files modified:** `scripts/__tests__/lint-stripe-phi.test.ts`
- **Commit:** e26c571

**2. [Rule 1 - Bug] Test 5 fixture had "stripe" in comment**
- **Found during:** Task 1 debugging
- **Issue:** Fixture for "non-stripe call" had `// No stripe import — fast-path skip` which contains the word "stripe", triggering the fast-path and the `notStripe` call site regex
- **Fix:** Changed fixture comment to avoid any `stripe` token; changed service name to `otherService` 
- **Files modified:** `scripts/__tests__/lint-stripe-phi.test.ts`
- **Commit:** e26c571

## Known Stubs

None — script is fully wired. Initial scan passes on current codebase.

## Threat Flags

None — no new network endpoints, auth paths, or file access patterns introduced. Script is read-only CI tooling.

## Self-Check

### Created files exist:
- [x] `leanshot/scripts/lint-stripe-phi.ts` — FOUND
- [x] `leanshot/scripts/stripe-phi-keywords.json` — FOUND
- [x] `leanshot/scripts/__tests__/lint-stripe-phi.test.ts` — FOUND

### Commits exist:
- [x] e26c571 — Task 1 (script + keywords + tests)
- [x] 0172a9f — Task 2 (CI wiring)

## Self-Check: PASSED
