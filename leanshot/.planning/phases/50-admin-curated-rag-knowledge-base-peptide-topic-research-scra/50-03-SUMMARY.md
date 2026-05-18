---
phase: 50-admin-curated-rag-knowledge-base-peptide-topic-research-scra
plan: 03
subsystem: analytics
tags: [analytics, posthog, hipaa-17, rag, taxonomy, additive-only]
dependency_graph:
  requires:
    - Phase 24 EVENTS registry shape (Plan 24-02) — extended with optional server_only flag
    - Phase 24 additive-only ESLint rule (eslint-rules/additive-only-events.cjs)
    - Phase 24 D-13 mandate — await shutdown on server-side PostHog clients
    - Phase 25 HIPAA-17 path-deny set (clinic, patient, admin/users, dose-log, share, auth)
  provides:
    - 13 canonical rag_* events with zod payload schemas
    - DISABLE_RECORDING_URL_REGEX single source of truth (re-exported via src/lib/analytics.ts)
    - captureRagEvent(distinctId, name, properties, factory) typed helper
    - scrubPhi() defensive PHI strip for server-side capture
    - server_only:true type-system flag for ITP/uBlock-resilient events
  affects:
    - Plans 50-02 / 50-04 / 50-06 / 50-08 / 50-09 unblocked — telemetry registry entries available
    - Plan 50-06 / 50-08 / 50-09 server-side capture sites consume captureRagEvent
    - HIPAA-17 audit lineage extended to /admin/rag/* and /research/*
tech_stack:
  added:
    - (none — uses existing zod + vitest dependencies)
  patterns:
    - Additive-only event registry extension (D-10)
    - Factory-injected PostHog client (testable + Deno-portable)
    - try/finally shutdown guard for ephemeral server runtimes (D-13)
    - Optional readonly type field for server-only event classification
key_files:
  created:
    - leanshot/src/lib/posthog/disable-recording-regex.ts
    - leanshot/src/lib/posthog/__tests__/disable-recording-regex.test.ts
    - leanshot/src/lib/posthog/posthog-server.ts
    - leanshot/src/lib/posthog/__tests__/rag-server-events.test.ts
    - leanshot/src/lib/analytics/__tests__/events-registry.test.ts
  modified:
    - leanshot/src/lib/analytics/events.ts (+186 lines — 13 rag_* + EventDef.server_only)
    - leanshot/src/lib/analytics.ts (+5 lines — re-export DISABLE_RECORDING_URL_REGEX)
decisions:
  - "captureRagEvent placed at src/lib/posthog/posthog-server.ts (NOT supabase/functions/_shared/) per orchestrator override 'No supabase/ touches'. Future plan 50-06/50-08 will inline into a Deno runtime file under supabase/functions/_shared/posthog-server.ts."
  - "EventDef extended with optional `readonly server_only?: true` (additive — every existing entry still satisfies the new wider type)."
  - "Tests written in vitest (not Deno test) because the orchestrator override means the helper currently runs in the same Node/Vite environment as the rest of the lib."
  - "Boundary safety regex uses `(\\/|$)` terminator so `/research-tool`, `/researchers`, `/admin/rag-broken` correctly do NOT match — explicit non-match cases pinned in the snapshot test."
  - "Defensive scrubPhi strips user_id + patient_id even though rag_* events declare phi:false — defense-in-depth atop the events.phi.ts import-zone rule."
metrics:
  duration: "~30 minutes"
  completed_date: "2026-05-18"
  tasks_completed: 4
  files_created: 5
  files_modified: 2
  commits: 4
  tests_added: 58
---

# Phase 50 Plan 50-03: RAG telemetry registry + HIPAA path-deny extension Summary

One-liner: 13 canonical `rag_*` events appended to `src/lib/analytics/events.ts` with zod payloads matching CONTEXT D-35 verbatim; PostHog session-recording deny-list extended to `/admin/rag/*` + `/research/*` per D-34 + HIPAA-17; typed `captureRagEvent` helper with PHI scrub + mandatory shutdown gate added at `src/lib/posthog/posthog-server.ts`.

## What shipped

### Task 1 — 13 rag_* events appended to canonical registry
Commit `1bb24ce`. `src/lib/analytics/events.ts` extended with 13 entries grouped by surface:
- **Admin curation (3):** `rag_topic_created`, `rag_topic_edited`, `rag_topic_deleted`
- **Pipeline (1):** `rag_scrape_run`
- **Moderation (3):** `rag_chunk_reviewed` (6 reject reasons), `rag_chunk_published`, `rag_chunk_retracted`
- **User-facing server-only (4):** `rag_tip_impression`, `rag_tip_clicked`, `rag_citation_clicked`, `rag_hub_pageview` — flagged `server_only: true`
- **Newsletter (2):** `rag_newsletter_subscribed`, `rag_newsletter_unsubscribed`

`EventDef` type extended with optional `readonly server_only?: true` (additive — no existing entry's shape changes; additive-only ESLint rule passes).

### Task 2 — Session-recording deny-list regex
Commit `ce30188`. Single source of truth at `src/lib/posthog/disable-recording-regex.ts`:
```ts
export const DISABLE_RECORDING_URL_REGEX =
  /\/(clinic|patient|admin\/users|admin\/rag|dose-log|share|auth|research)(\/|$)/i;
```
Re-exported from `src/lib/analytics.ts` so global PostHog init reads the same constant. 34-case snapshot test covers Phase 25 HIPAA-17 regression + Phase 50 D-34 additions + boundary safety (`/research-tool` MUST NOT match).

### Task 3 — captureRagEvent typed helper
Commit `b2b1e49`. `src/lib/posthog/posthog-server.ts`:
- Compile-time event-name union (6 server-side events: 4 server_only + 2 cron-emitted admin events).
- `scrubPhi()` defensively removes `user_id` / `patient_id` before capture.
- `await ph.shutdown()` runs inside `try/finally` so flush completes even when `capture()` throws (D-13 mandate).
- Empty/whitespace `distinctId` throws BEFORE factory invocation (fail-fast).
- Factory-injected PostHog client so tests use a vi-mock and the future Deno port swaps `import { PostHog } from 'https://esm.sh/posthog-node'` without touching call sites.

13 vitest cases cover scrubPhi (5), capture + shutdown ordering (2), PHI strip (2), fail-fast distinctId (3), shutdown-on-throw (1), all-6-event-names compile-check (1).

### Task 4 — events-registry vitest
Commit `433c192`. `src/lib/analytics/__tests__/events-registry.test.ts` — 11 cases, belt-and-suspenders atop the AST-based ESLint rule. Confirms 13 rag_* registered, all phi:false, 4 server_only flagged, exhaustive enum validations, and pins the 9 prior P24/P32 event names so a future plan can't silently remove them.

## Deviations from Plan

### [Rule 3 - Blocking] Orchestrator override: no supabase/ touches
- **Found during:** plan ingestion
- **Issue:** Plan Task 3 specifies modifying `supabase/functions/_shared/posthog-server.ts` and writing a Deno test, but the orchestrator prompt explicitly stated `No supabase/ touches.` Additionally, no `supabase/` directory exists in this worktree at all — Phase 24 did not ship the Edge Fn factory yet.
- **Fix:** Placed `captureRagEvent` at `src/lib/posthog/posthog-server.ts` with the same typed contract + PHI scrub + shutdown semantics. Documented in module header that a follow-up plan (50-06/50-08) will inline the helper into a Deno runtime file. Test written in vitest instead of Deno.
- **Files modified:** `src/lib/posthog/posthog-server.ts`, `src/lib/posthog/__tests__/rag-server-events.test.ts`
- **Commit:** `b2b1e49`

### [Rule 1 - Bug] Test fixture UUIDs invalid under zod v4 strict UUID regex
- **Found during:** Task 4 test run
- **Issue:** Initial fixture used `'11111111-1111-1111-1111-111111111111'` for `topic_id` / `chunk_id`. Zod v4's `z.string().uuid()` enforces the RFC-9562 variant nibble `[89abAB]` in the fourth group; `111…` failed validation.
- **Fix:** Replaced all occurrences with a valid v4 UUID `178b7308-9b47-44a2-a429-fefda1b04173`.
- **Files modified:** `src/lib/analytics/__tests__/events-registry.test.ts`
- **Commit:** `433c192`

### [Adaptation] Registry shape: Record not array
- **Found during:** Task 1 read_first inspection
- **Issue:** Plan describes `EVENTS as const … satisfies EventRegistry[]` array shape. Actual P24 file is `Record<string, EventDef>` keyed by event name.
- **Fix:** Appended entries in the actual Record convention; `name` key matches the Record key. No behavioral impact — the ESLint additive-only rule operates on the AST and accepts either shape.

### [Adaptation] EventDef required fields not in plan spec
- **Found during:** Task 1
- **Issue:** Plan property specs omit `owner` and `description` which are required fields on `EventDef`. Each rag_* event needs both.
- **Fix:** Added `owner` (`'admin'` for curation/moderation, `'product'` for user-facing surfaces, `'growth'` for newsletter + hub pageview) and concise `description` for each.

## Tooling notes

- `npm install` was NOT run in the worktree (would leak into main per memory entry `feedback_worktree_executor_npm_install_leak`). Instead `node_modules` was symlinked from `/Users/karstenhaldan/minisite/leanshot/node_modules`. The symlink shows as untracked; the orchestrator's cleanup will discard it on merge.
- Out-of-scope pre-existing lint debt: `src/lib/analytics/__tests__/capture.test.ts` + `identify.test.ts` carry 6 `import-x/order` errors. Matches the known baseline (`project_lint_debt_import_x_order` memory). Not touched.

## Verification

- `npm run typecheck` — green.
- `npx vitest run src/lib/analytics/__tests__/ src/lib/posthog/__tests__/ src/lib/analytics/events.test.ts` — 8 files / 81 tests passed.
- `npx eslint src/lib/analytics/events.ts src/lib/posthog/` — green (no errors in files modified by this plan).
- Grep `await ph.shutdown()` present in `captureRagEvent` — confirmed (line 112).
- Grep `DISABLE_RECORDING_URL_REGEX` includes `admin\/rag` AND `research` — confirmed.

## Self-Check: PASSED

- `leanshot/src/lib/analytics/events.ts` — FOUND
- `leanshot/src/lib/posthog/disable-recording-regex.ts` — FOUND
- `leanshot/src/lib/posthog/__tests__/disable-recording-regex.test.ts` — FOUND
- `leanshot/src/lib/posthog/posthog-server.ts` — FOUND
- `leanshot/src/lib/posthog/__tests__/rag-server-events.test.ts` — FOUND
- `leanshot/src/lib/analytics/__tests__/events-registry.test.ts` — FOUND
- Commit `1bb24ce` — FOUND
- Commit `ce30188` — FOUND
- Commit `b2b1e49` — FOUND
- Commit `433c192` — FOUND
