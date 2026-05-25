---
phase: 46
plan: 03
subsystem: courses-browser-primitives
tags: [courses, types, hmac, tier-gate, browser-crypto]
requires:
  - phase-44-community-tier-gate
  - phase-46-plan-01-course-schema
provides:
  - course-domain-types
  - browser-cert-verify-hmac
  - lesson-resource-tier-gate
affects:
  - phase-46-plan-07 (cert-hmac.ts MUST mirror payload format byte-for-byte)
  - phase-46-plan-08 (consumer course UI imports types + dompurify config)
  - phase-46-plan-09 (admin gates import isResourceAllowed)
  - phase-46-plan-10 (verify route imports verifyCertToken)
tech-stack:
  added: []
  patterns:
    - web-crypto-hmac-sha256-base64url (mirrors nps-token.ts replace-chain)
    - constant-time-xor-accumulator-compare
    - dompurify-policy-re-export (no new sanitize policy in course/)
key-files:
  created:
    - leanshot/src/lib/course/course-types.ts
    - leanshot/src/lib/course/dompurify-config.ts
    - leanshot/src/lib/course/cert-verify-token.ts
    - leanshot/src/lib/course/cert-verify-token.test.ts
    - leanshot/src/lib/community/tier-gate.test.ts
  modified:
    - leanshot/src/lib/community/tier-gate.ts
decisions:
  - "HMAC payload format LOCKED at `${certId}:${userId}:${courseId}:${issuedAt}` (colon-separated, 4 fields, NO whitespace, NO trailing padding) — Plan 46-07 cert-hmac.ts MUST match byte-for-byte"
  - "base64url replace-chain: +→-, /→_, trailing = stripped (same as nps-token.ts / RFC 4648 §5)"
  - "verifyCertToken uses constant-time XOR-accumulator compare (T-46-03 timing-oracle mitigation)"
  - "isResourceAllowed treats trial as Pro-equivalent (matches Phase 44 isVideoAllowed semantics)"
metrics:
  duration_minutes: 7
  completed_date: 2026-05-24
  tasks_completed: 3
  files_created: 5
  files_modified: 1
  test_count: 17  # 5 cert-verify + 12 tier-gate (5 baseline + 7 new isResourceAllowed)
---

# Phase 46 Plan 03: Browser-side Course Primitives Summary

**One-liner:** Browser TypeScript primitives — course/module/lesson/progress/certificate domain types + DOMPurify policy re-export + Web Crypto HMAC-SHA256 cert-verify-token helpers (mint/verify) + `isResourceAllowed` extension on the tier-gate.

## What Was Built

### File 1 — `src/lib/course/course-types.ts` (NEW)
Pure TypeScript domain types, no runtime exports, no DOM/React imports:
- `Course` — root of the 3-level hierarchy (D-01, D-11, D-12).
- `CourseModule` — section grouping (D-01).
- `CourseLesson` — Mux-backed leaf lesson (D-01/05/06/07).
- `MuxStatus` — `'pending' | 'processing' | 'ready' | 'rejected' | 'errored'` lifecycle (D-05).
- `LessonProgress` — per-user per-lesson position incl. anti-skip server-of-record `max_position_reached_seconds` (D-04, D-09, D-12).
- `Certificate` — per-user per-course certificate carrying HMAC `verification_token` (D-14).
- `LessonProgressInput` — `Pick<LessonProgress, 'lesson_id' | 'last_position_seconds' | 'max_position_reached_seconds'>` for the `update_lesson_position` RPC argument shape.

All fields snake_case to mirror supabase-js column names (matches `src/lib/community/community-types.ts` convention).

### File 2 — `src/lib/course/dompurify-config.ts` (NEW)
Single-line `export * from '@/lib/community/dompurify-config';` — verbatim re-export of the Phase 44 sanitize policy. **No new sanitize policy** (T-46-05 mitigation; plan-checker rule = no DOMPurify constructor allowed in `src/lib/course/*` or `src/components/course/*`).

### File 3 — `src/lib/course/cert-verify-token.ts` (NEW)
Two async exports + 2 internal helpers:
- `mintCertToken(certId, userId, courseId, issuedAt, secret): Promise<string>` — Web Crypto `subtle.sign('HMAC')` SHA-256 → base64url.
- `verifyCertToken(token, certId, userId, courseId, issuedAt, secret): Promise<boolean>` — recomputes expected then constant-time XOR-accumulator compare.
- Internal `hmacSha256(secret, message)` and `constantTimeEqual(a, b)`.

### File 4 — `src/lib/course/cert-verify-token.test.ts` (NEW)
5 vitest cases — base64url shape, determinism, exact-match → true, each of 5 tampered fields → false (table-driven), empty/garbage-length → false.

### File 5 — `src/lib/community/tier-gate.test.ts` (NEW — see Deviations)
12 vitest cases — 5 baseline (isVideoAllowed + canAccessSpace) + 7 new (isResourceAllowed across 4 known tiers + unknown-tier fallback).

### File 6 — `src/lib/community/tier-gate.ts` (MODIFIED)
Added 2 exports at end of file:
- `export type ResourceType = 'pdf' | 'video' | 'zip';` (Phase 46 D-16)
- `export function isResourceAllowed(tier, _resourceType): boolean` returning true for pro/lifetime/trial.

## Contract Reminder for Plan 46-07

> The Edge Fn HMAC helper (`supabase/functions/_shared/cert-hmac.ts`) MUST sign
> `${certId}:${userId}:${courseId}:${issuedAt}` with **NO** other whitespace,
> separators, or padding. The base64url encoding MUST apply
> `+→-`, `/→_`, trailing `=` stripped (RFC 4648 §5).
>
> Any deviation produces silently-non-verifying tokens at the
> `/verify/<cert_id>` consumer surface (Plan 46-10) — verification fails as
> "Certificate not found" with no telemetry to root-cause the drift.

## Verification

- `vitest run src/lib/course/cert-verify-token.test.ts src/lib/community/tier-gate.test.ts` → **17 passed (17)** ✓
- `tsc -p tsconfig.app.json --noEmit` → **clean** ✓
- `grep -rE 'new DOMPurify|createDOMPurify' src/lib/course/ src/components/course/` → **no matches** ✓
- `grep -qE "export \* from '@/lib/community/dompurify-config'" src/lib/course/dompurify-config.ts` → **match** ✓
- `grep -cE '^export (interface|type) (Course|CourseModule|CourseLesson|LessonProgress|Certificate|MuxStatus|LessonProgressInput)' src/lib/course/course-types.ts` → **7** ✓
- `grep -qE 'export function isResourceAllowed' src/lib/community/tier-gate.ts` → **match** ✓

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — Blocking issue] Created `src/lib/community/tier-gate.test.ts` from scratch**
- **Found during:** Task 3 (`read_first` step)
- **Issue:** Plan's `read_first` and `files_modified` list reference `src/lib/community/tier-gate.test.ts`, but no such file existed in the repo (Phase 44 shipped `tier-gate.ts` without test coverage). The TDD `behavior` block requires extending a test file that wasn't there.
- **Fix:** Created the test file new with baseline coverage for the pre-existing exports (isVideoAllowed, canAccessSpace) PLUS the 7 new isResourceAllowed cases the plan called for. No behaviour from the plan was dropped; the file is now MORE comprehensive than the plan's `<behavior>` block specified.
- **Files modified:** `src/lib/community/tier-gate.test.ts` (created, 87 LOC).
- **Commit:** `8d6588be` (test RED) + `229072a6` (impl GREEN).

**2. [Rule 3 — Tooling workaround] Test-only vitest config**
- **Found during:** Task 2 verification step
- **Issue:** Project's `vitest.config.ts` defines only the `phase38-eval` project under `projects:`, which (in vitest 4.x) silently drops the root `test.include` config — `npx vitest run src/...` returns "No test files found" even for pre-existing tests. This is a pre-existing project-wide bug also affecting `npm run test:unit` in CI, NOT a regression introduced by this plan.
- **Fix:** Per verification, temporarily swap `vitest.config.ts` aside and use an ad-hoc isolated config (`vitest-46-03.config.ts`) for the duration of the test run, then restore. No persistent config change shipped.
- **Scope:** Did NOT fix the underlying vitest.config.ts bug — that lives in Phase 38 territory and would be a much wider change. Logged here as a deferred item.
- **Commit:** N/A (transient workaround; no committed config change).

## Deferred Items

- **Pre-existing `vitest.config.ts` ignores root `test.include` when `projects:` is set.** Affects `npm run test:unit` discoverability of all `src/**/*.test.ts` files (not just this plan's). Out of scope for Plan 46-03 per executor scope boundary. Recommend a dedicated Phase 38 follow-up plan to either drop the `projects:` wrapper or add a `default` project entry covering `src/**`.

## Known Stubs

None. All exports are functionally complete and round-trip-verified.

## Threat Flags

None. New surface (cert-verify HMAC, resource tier-gate) is fully covered by the plan's `<threat_model>` (T-46-03 + T-46-05) and existing Phase 44 RLS / Storage gates.

## Self-Check: PASSED

Files exist:
- FOUND: leanshot/src/lib/course/course-types.ts
- FOUND: leanshot/src/lib/course/dompurify-config.ts
- FOUND: leanshot/src/lib/course/cert-verify-token.ts
- FOUND: leanshot/src/lib/course/cert-verify-token.test.ts
- FOUND: leanshot/src/lib/community/tier-gate.test.ts
- FOUND: leanshot/src/lib/community/tier-gate.ts (modified)

Commits in git log:
- FOUND: f1786ef7 (Task 1 — types + dompurify re-export)
- FOUND: 072d622e (Task 2 RED — cert-verify-token test)
- FOUND: 3931e06c (Task 2 GREEN — cert-verify-token impl)
- FOUND: 8d6588be (Task 3 RED — tier-gate test)
- FOUND: 229072a6 (Task 3 GREEN — isResourceAllowed impl)

## TDD Gate Compliance

Plan-level TDD enforcement (per-task tdd="true"):
- Task 2: `test(46-03)` (072d622e) → `feat(46-03)` (3931e06c) ✓
- Task 3: `test(46-03)` (8d6588be) → `feat(46-03)` (229072a6) ✓

Both RED→GREEN gate sequences satisfied. No refactor commits needed (clean code, no duplication).
