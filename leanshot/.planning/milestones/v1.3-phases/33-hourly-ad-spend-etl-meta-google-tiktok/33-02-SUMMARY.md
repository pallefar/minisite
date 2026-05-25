---
phase: 33-hourly-ad-spend-etl-meta-google-tiktok
plan: "02"
subsystem: analytics-event-taxonomy
tags: [aem, meta-capi, eslint, events, phase33, hipaa]
dependency_graph:
  requires: []
  provides:
    - EventDef.aem_priority (1..8) on events.ts
    - EventDef.aem_dropped optional field on events.ts
    - ESLint phi-aem-conflict rule in additive-only-events.cjs
  affects:
    - leanshot/src/lib/analytics/events.ts
    - leanshot/eslint-rules/additive-only-events.cjs
tech_stack:
  added: []
  patterns:
    - TDD RED/GREEN for ESLint rule extension
    - AST-walk structural invariant check (phi+aem cross-check)
key_files:
  created: []
  modified:
    - leanshot/src/lib/analytics/events.ts
    - leanshot/eslint-rules/additive-only-events.cjs
    - leanshot/eslint-rules/__tests__/additive-only-events.test.js
decisions:
  - D-05: aem_priority and aem_dropped added as optional fields to EventDef (additive per D-05)
  - D-06: Top-8 ordering proposed from funnel analysis; PENDING plan-checker iter-1 user confirmation
  - D-08: PHI guardrail enforced at compile time via phi-aem-conflict ESLint rule (belt+suspenders)
  - refund_issued at priority 5 is FLAGGED for user confirmation — Meta supports negative signals but some advertisers exclude refunds
metrics:
  duration: "6 minutes"
  completed: "2026-05-18T17:51:30Z"
  tasks_completed: 2
  files_modified: 3
---

# Phase 33 Plan 02: AEM Priority Register + ESLint PHI Guard Summary

**One-liner:** AEM priority fields added to EventDef with top-8 events annotated; ESLint phi-aem-conflict rule enforces PHI guardrail at build time.

## What Was Built

### Task 1: EventDef AEM Priority Extension (events.ts)

Two new optional readonly fields added to `EventDef`:

- `aem_priority?: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8` — ranks events for Meta CAPI forwarding
- `aem_dropped?: true` — marks explicitly excluded AEM candidates (no runtime effect; documents the decision)

File-level comment added: `// Phase 33 D-05/D-06: AEM priority register — top-8 ordering PROPOSED, pending plan-checker iter-1 user confirmation.`

### AEM Top-8 Proposed Ordering (PENDING USER CONFIRMATION)

| Priority | Event | Rationale | Status |
|----------|-------|-----------|--------|
| 1 | `payment_completed` | Highest conversion value for Meta Ads optimization | Proposed |
| 2 | `signup_completed` | Top-of-funnel acquisition signal | Proposed |
| 3 | `activation_first_log` | Activation = purchase intent signal | Proposed |
| 4 | `payment_initiated` | Micro-conversion (purchase intent) | Proposed |
| 5 | `refund_issued` | Negative optimization signal; Meta supports this | **FLAGGED** |
| 6 | `rag_citation_clicked` | Engagement signal (Phase 50 event — exists in events.ts) | Proposed |
| 7 | `rag_newsletter_subscribed` | Acquisition signal from RAG hub (Phase 50 event — exists) | Proposed |
| — | `feature_flag_evaluated` | `aem_dropped: true` — low signal for Meta, explicitly excluded | Dropped |

**User action required at plan-checker iter-1:**
1. Confirm or reorder priorities 1-7
2. Specifically: Is `refund_issued` at priority 5 intentional? Meta CAPI accepts negative signals for bid optimization, but some advertisers prefer to exclude refunds from optimization data. If excluded, priority 6 drops to 5, 7 drops to 6, leaving slot 7 open.
3. `rag_citation_clicked` (priority 6) is `server_only: true` — the meta-capi-relay (Plan 33-04) reads from `events_mirror` which captures server-only events correctly.

### Task 2: ESLint PHI+AEM Cross-Check (TDD)

**RED commit:** `468de4d` — 5 failing tests added for `phi-aem-conflict` behavior

**GREEN commit:** `03c6657` — Implementation passes all 5 new tests + all 5 existing tests

New helper `checkPhiAemConflicts()` added to `additive-only-events.cjs`:
- Walks current AST's EVENTS object on every lint run (structural invariant, not a diff check)
- Fires `phi-aem-conflict` if any event has both `phi: true` AND `aem_priority` set
- `aem_dropped: true` is NOT blocked (documents exclusion; doesn't forward to CAPI)
- `phi: true` + `aem_dropped: true` → no error (documenting the exclusion is fine)

**New messageId:**
```
'phi-aem-conflict': 'Event "{{eventName}}" has phi:true but also aem_priority={{priority}}. PHI events cannot be forwarded to Meta CAPI (D-08). Remove aem_priority or move event out of PHI scope.'
```

## Verification Results

| Check | Result |
|-------|--------|
| `grep -c "readonly aem_priority" events.ts` | 1 (type declaration) |
| `grep -c "aem_priority:" events.ts` | 7 (event annotations) |
| `grep "aem_dropped" events.ts` | `aem_dropped: true,` on feature_flag_evaluated |
| `grep -c "phi-aem-conflict" additive-only-events.cjs` | 3 (comment, report, messages key) |
| No false positives on current events.ts | Confirmed — all phi:false, zero errors |
| TypeScript: events.ts produces no type errors | Confirmed (zod module resolution error is pre-existing worktree artifact; clean in main repo) |

## Commits

| # | Hash | Type | Description |
|---|------|------|-------------|
| 1 | `1793d93` | feat | Extend EventDef with aem_priority+aem_dropped; annotate AEM top-8 |
| 2 | `468de4d` | test | Add PHI+AEM cross-check tests (RED phase) |
| 3 | `03c6657` | feat | Extend additive-only-events ESLint rule with PHI+AEM cross-check (GREEN) |

## Deviations from Plan

None — plan executed exactly as written.

**AEM top-8 alignment with parallel-execution prompt:**
The prompt listed `rag_question_asked` and `rag_answer_returned` in the suggested top-8. These events do NOT exist in events.ts (they are not in Phase 50's RAG taxonomy). The plan's own context block takes precedence: `rag_citation_clicked` (priority 6) and `rag_newsletter_subscribed` (priority 7) both exist and were correctly used. This alignment is documented here for user confirmation.

## TDD Gate Compliance

| Gate | Commit | Status |
|------|--------|--------|
| RED (test) | `468de4d` | PASS — Test 6 verified to fail against pre-implementation rule |
| GREEN (feat) | `03c6657` | PASS — All 5 new + 5 existing tests pass |
| REFACTOR | N/A | No cleanup needed |

## Threat Surface Scan

No new network endpoints, auth paths, file access patterns, or schema changes introduced. This plan is pure TypeScript type extension + ESLint rule — compile-time only. No new threat surface.

## Known Stubs

None — no stub patterns. The `aem_priority` values are real proposed priorities, not placeholders. The user-confirmation flag is a documented planning decision, not a stub.

## Self-Check (pre-commit)

- [x] `leanshot/src/lib/analytics/events.ts` — modified, committed `1793d93`
- [x] `leanshot/eslint-rules/__tests__/additive-only-events.test.js` — modified, committed `468de4d`
- [x] `leanshot/eslint-rules/additive-only-events.cjs` — modified, committed `03c6657`
- [x] All 3 commits exist on branch `worktree-agent-aa1ab83da816e309c`
