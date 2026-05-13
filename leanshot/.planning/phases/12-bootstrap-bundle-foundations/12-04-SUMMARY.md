---
phase: 12-bootstrap-bundle-foundations
plan: "04"
subsystem: security/csp
tags: [csp, security, vitest, snapshot-test, ci-gate]
dependency_graph:
  requires:
    - leanshot/vercel.json (post-Phase-8-hot-fix CSP as source of truth)
    - leanshot/vite.config.ts (test infrastructure)
  provides:
    - tests/csp/csp-snapshot.txt (deterministic CSP baseline for all future phases)
    - tests/csp/csp-snapshot.test.ts (Vitest unit test — CI gate against CSP drift)
  affects:
    - Phases 14/16/17/19/20/22 — each must update snapshot when widening CSP
    - plan-checker for CSP-widening phases (D-12 contract enforcement)
tech_stack:
  added: []
  patterns:
    - Vitest unit test reading JSON config file from disk (node:fs + node:path, no browser APIs)
    - Alphabetical-sort normalization for non-deterministic directive ordering
    - Mutation-proven snapshot test (verified to fail on unintentional drift)
key_files:
  created:
    - leanshot/tests/csp/csp-snapshot.txt
    - leanshot/tests/csp/csp-snapshot.test.ts
  modified:
    - leanshot/vite.config.ts
    - leanshot/.planning/phases/12-bootstrap-bundle-foundations/12-04-PLAN.md
    - leanshot/.planning/phases/12-bootstrap-bundle-foundations/12-VALIDATION.md
decisions:
  - D-10 (LOCKED): Tight CSP + CI snapshot test; each later phase widens as SDK lands
  - D-11 (LOCKED): Snapshot at tests/csp/csp-snapshot.txt; one directive per line; alphabetical sort
  - D-12 (LOCKED): Plan-checker contract — any CSP-widening phase MUST include both vercel.json diff AND snapshot update in same commit
metrics:
  duration: "~3 minutes"
  completed: "2026-05-13"
  tasks_completed: 3
  files_changed: 5
---

# Phase 12 Plan 04: CSP Snapshot Test Summary

**One-liner:** Vitest unit test captures current post-Phase-8-hot-fix CSP from vercel.json into alphabetically-sorted snapshot and fails LOUDLY on any directive drift.

## What Was Built

### Task 1: Initial CSP snapshot capture

`tests/csp/csp-snapshot.txt` was created with 11 directives extracted from `vercel.json`, sorted alphabetically by directive name, each semicolon-terminated. Content was verified byte-for-byte against the Python canonicalization one-liner from the plan.

Directives captured (alphabetical order):
1. `base-uri 'self';`
2. `connect-src 'self' https://*.supabase.co wss://*.supabase.co ...` (Supabase + Sentry + PostHog + Anthropic)
3. `default-src 'none';`
4. `font-src 'self' data: https://fonts.gstatic.com;`
5. `form-action 'self';`
6. `frame-src 'none';`
7. `img-src 'self' data: blob:;`
8. `object-src 'none';`
9. `script-src 'self';`
10. `style-src 'self' 'unsafe-inline' https://fonts.googleapis.com;`
11. `worker-src 'self' blob:;`

### Task 2: Vitest unit test + vite.config.ts extension

`tests/csp/csp-snapshot.test.ts` implements:
- `parseCSP(rawValue)` helper that splits by `;`, trims, filters empties, appends `;`, sorts alphabetically
- Reads `vercel.json`, finds the `Content-Security-Policy` header, throws explicit error if missing
- Reads `tests/csp/csp-snapshot.txt`, normalizes and sorts
- Asserts `liveSorted` equals `snapshotSorted` with directive-level diff on failure

`vite.config.ts` `test.include` extended from 2 entries to 3:
```
include: ['src/**/*.test.{ts,tsx}', 'tests/**/*.test.ts', '../shared/**/*.test.ts']
```

**Mutation proof:** Temporarily appended `; report-uri /csp-violation` to vercel.json CSP — test failed with a clear diff showing the new directive. Reverted before commit.

### Task 3: Commit + metadata update

- VALIDATION.md rows 12-04-01, 12-04-02, 12-04-03 flipped to `✅ green`
- 12-04-PLAN.md `nyquist_compliant: true`
- Commit `e96421e` — exactly 5 files, pathspec form

## Commits

| Hash | Message |
|------|---------|
| `e96421e` | feat(12-04): CSP snapshot test + vite.config.ts test.include extension (D-10/D-11/D-12) |

## Deviations from Plan

None — plan executed exactly as written. `import.meta.dirname` worked on Node v22.18.0 (no fallback needed). Snapshot content matched RESEARCH §3 byte-for-byte.

## Cross-Phase Plan-Checker Contract (D-12)

Every phase that widens CSP (Phase 14 Stripe, Phase 16 Capacitor, Phase 17 web-push, Phase 19 RevenueCat, Phase 20 GPT/AdSense/AdMob, Phase 22 Resend tracking pixels) MUST:

1. Update `vercel.json` CSP header with the new origin
2. Update `tests/csp/csp-snapshot.txt` with the sorted directive change
3. Commit both files in the same commit

**Plan-checker for those phases** flags absence of either file in the CSP-widening commit as a BLOCKER (D-12).

The 5-step update procedure is documented in the header comment of `csp-snapshot.test.ts`.

## Threat Surface Scan

No new network endpoints, auth paths, file access patterns, or schema changes introduced. This plan adds only read-only test infrastructure (reads `vercel.json` from disk, no browser API usage).

## Self-Check: PASSED

- `leanshot/tests/csp/csp-snapshot.txt` — FOUND
- `leanshot/tests/csp/csp-snapshot.test.ts` — FOUND
- `leanshot/vite.config.ts` (tests glob) — FOUND
- Commit `e96421e` — FOUND (5 files, pathspec form)
- `npm run test:unit -- tests/csp` — 1 passed (verified)
- Mutation proof — confirmed test fails on CSP drift
