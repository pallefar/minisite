---
phase: 12
plan: "03"
subsystem: e2e-security
tags: [playwright, e2e, ad-free, ci-gate, security, b2b]
dependency_graph:
  requires: []
  provides: [clinic-ad-free-gate, SC-3]
  affects: [ci-pipeline, phase-20-ad-code]
tech_stack:
  added: []
  patterns: [playwright-for-loop-test-generation, context-level-request-interception]
key_files:
  created:
    - leanshot/e2e/clinic-ad-free.spec.ts
  modified:
    - .github/workflows/ci.yml
    - leanshot/.planning/phases/12-bootstrap-bundle-foundations/12-03-PLAN.md
    - leanshot/.planning/phases/12-bootstrap-bundle-foundations/12-VALIDATION.md
decisions:
  - key: loop-vs-explicit-tests
    choice: "for loop over PROTECTED_ROUTES"
    rationale: "Plan action section explicitly prescribed a loop; produces 3 independent test entries (visible in Playwright output) while keeping the origin list DRY. The acceptance criterion count-of-3 for waitUntil was written assuming explicit test blocks but is superseded by the plan's loop instruction."
  - key: ci-option-A-explicit-named-step
    choice: "Option A — explicit named step 'Phase 12 SC-3 — Clinic ad-free e2e gate'"
    rationale: "Grep-discoverable per VALIDATION row 12-03-02; emits a distinct PR check entry; ~5s extra CI wallclock is negligible."
metrics:
  duration: "~15 minutes"
  completed_date: "2026-05-13"
  tasks_completed: 3
  files_changed: 4
---

# Phase 12 Plan 03: Clinic Ad-Free Playwright e2e Gate Summary

Three-layer Playwright ad-free gate on B2B/share/admin routes with PR-blocking CI wiring (Phase 12 D-14/D-15, SC-3, CCC-2).

## What Was Built

### Task 1: e2e/clinic-ad-free.spec.ts

Created `leanshot/e2e/clinic-ad-free.spec.ts` with:

- **AD_PROVIDER_ORIGINS** — 13 hardcoded ad-provider FQDNs covering Google (GPT, AdSense, Ads, DoubleClick, AdMob), Meta (Audience Network, fbcdn), Amazon Ads, and major programmatic SSPs (Moat/moatads.com, Index Exchange/casalemedia.com, PubMatic, Magnite/rubiconproject.com)
- **PROTECTED_ROUTES** — `/clinic`, `/share`, `/admin` (CONTEXT.md D-14)
- **3 test cases** via `for (const route of PROTECTED_ROUTES)` loop — one per route, each with three assertion layers:
  - Layer 1: `page.evaluate` queries `document.querySelectorAll('script[src]')`, filters by ad-provider origin, asserts empty array
  - Layer 2: `page.locator('[data-ad-slot], [data-testid="ad-slot"]').count()` asserts 0
  - Layer 3: `context.on('request', ...)` accumulates ad-provider network requests; asserts empty array
- Uses `page.goto(route, { waitUntil: 'networkidle' })` to ensure lazy-loaded scripts fire before assertions
- Phase 12 baseline comment (Pitfall 4 acknowledgment): SPA renders on all 3 routes → trivially zero ads today; gate becomes a real safety net when Phase 14+ ships routes AND Phase 20 ships ad code

**Mutation proof confirmed:** Temporarily injected `<script src="https://googletagservices.com/tag/js/gpt.js">` into `index.html` — spec failed with "Ad script tags found on /clinic" on all 3 routes. Removed before commit.

**Test result:** 3 passed (5.7s)

### Task 2: CI Wiring

Extended `.github/workflows/ci.yml` `test-e2e` job with a new named step immediately after "Run Playwright smoke against production build":

```yaml
- name: Phase 12 SC-3 — Clinic ad-free e2e gate
  run: npx playwright test e2e/clinic-ad-free.spec.ts --reporter=line
  env:
    CI: 'true'
```

- `grep -r clinic-ad-free .github/workflows/` returns 2 matches (step name + comment)
- `grep -cF 'Phase 12 SC-3' .github/workflows/ci.yml` returns 1
- YAML parses cleanly
- Existing `npm run test:e2e` step and `needs:` array unmodified
- The existing `test-e2e` job's `npm run test:e2e` step already picks up the spec automatically (Playwright `testMatch: /.*\.spec\.ts$/`) — the explicit step runs it a second time for grep-discoverability and a distinct PR check entry

### Task 3: Metadata flip

- `12-VALIDATION.md` rows 12-03-01 and 12-03-02: `⬜ pending` → `✅ green`
- `12-03-PLAN.md` frontmatter: `nyquist_compliant: false` → `nyquist_compliant: true`

## Commits

| Task | Hash | Message |
|------|------|---------|
| 1+2+3 | be5dfb9 | feat(12-03): clinic-ad-free Playwright e2e gate (D-14/D-15) |

## Cross-Cutting Concern #2 (CCC-2) Alignment

This spec is the Playwright (runtime DOM) layer of the TRIPLE-layered B2B no-ads defense:

1. **AD-03** (Phase 20) — component-level refusal: `<AdSlot>` component checks route and renders nothing on B2B surfaces
2. **AD-02** (Phase 20) — Edge Function refusal: ad targeting function rejects requests from B2B origin
3. **CSP report-only** — Phase 12 Plan 12-04 adds a CSP snapshot gate
4. **THIS SPEC** — Playwright runtime DOM verification: zero scripts + zero mounts + zero network requests on `/clinic/*`, `/share/*`, `/admin/*`

## Deviations from Plan

### Implementation Choice

**[Rule 1 - Structure] Loop vs. explicit test blocks for waitUntil count**

The plan's `<action>` section prescribed a `for` loop over `PROTECTED_ROUTES` to register tests. The `<acceptance_criteria>` block expected `waitUntil: 'networkidle'` to appear 3 times (one per test block), which is only satisfied by explicit test blocks. Since the plan's own loop instruction takes precedence and produces the correct 3 test entries at runtime, the loop was implemented. The criterion count-of-1 for `waitUntil` is a documentation artifact.

## Known Stubs

None — this spec has no stubs. It trivially passes today because the SPA has no ads anywhere. The "trivially true" state is documented in the spec header as a Phase 12 baseline (Pitfall 4 acknowledgment) and is not a stub — it's the intended Phase 12 behavior.

## Threat Flags

No new threat surfaces introduced. This plan only adds a test file and CI step — no new network endpoints, auth paths, file access patterns, or schema changes.

## Self-Check: PASSED

- `leanshot/e2e/clinic-ad-free.spec.ts` — EXISTS
- `.github/workflows/ci.yml` contains `clinic-ad-free` — 2 matches
- Commit `be5dfb9` exists with exactly 4 files
- `npx playwright test e2e/clinic-ad-free.spec.ts` — 3 passed
- All 13 origins present in spec
- VALIDATION rows 12-03-01/02 — ✅ green
- `nyquist_compliant: true` — SET
