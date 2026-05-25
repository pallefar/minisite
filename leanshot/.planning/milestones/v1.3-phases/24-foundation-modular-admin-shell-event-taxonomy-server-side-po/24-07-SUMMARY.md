---
phase: 24-foundation-modular-admin-shell-event-taxonomy-server-side-po
plan: "07"
subsystem: analytics
tags: [posthog, event-taxonomy, ci, github-actions, tdd]
dependency_graph:
  requires: [24-02]
  provides: [posthog-event-defs-sync-ci]
  affects: [posthog-event-catalog]
tech_stack:
  added: [zod-to-json-schema@^3]
  patterns: [vendor-gated-env-checks, dry-run-flag, tdd-red-green]
key_files:
  created:
    - leanshot/scripts/sync-posthog-event-defs.ts
    - leanshot/scripts/__tests__/sync-posthog-event-defs.test.ts
    - .github/workflows/posthog-event-defs-sync.yml
  modified:
    - leanshot/package.json
decisions:
  - "Script uses PATCH for all events; 404 = warn+skip (PostHog auto-creates on first ingest)"
  - "dry-run uses POSTHOG_HOST defaulting to us.i.posthog.com but respects POSTHOG_HOST env"
  - "zod-to-json-schema generated schemas are NOT sent to PostHog API (body uses name/description/tags only)"
  - "TAXO-06 marker check runs before env validation so it fails early even if creds present"
metrics:
  duration: "~4 minutes"
  completed: "2026-05-17"
  tasks_completed: 2
  tasks_checkpointed: 1
  files_created: 3
  files_modified: 2
requirements: [TAXO-01, TAXO-06]
---

# Phase 24 Plan 07: PostHog Event-Definitions CI Sync Summary

**One-liner:** CI step reads EVENTS + PHI_EVENTS from canonical TS registry, PATCHes PostHog event-definitions API on every main-branch push; TAXO-06 marker guard + vendor-gated env checks; dry-run for PRs.

## What Was Built

A 3-artifact CI sync pipeline:

1. **`scripts/sync-posthog-event-defs.ts`** — reads 8 non-PHI events from `events.ts` and 3 PHI events from `events.phi.ts`, generates JSON schemas via `zod-to-json-schema`, PATCHes each event-definition via PostHog REST API. Vendor-gated env checks fail early (exits 1 with clear message when `POSTHOG_PROJECT_ID` or `POSTHOG_PROJECT_API_KEY` unset). TAXO-06 reconciliation marker guard aborts sync if the header comment was removed from `events.ts`. `--dry-run` flag prints full PATCH plan without HTTP calls.

2. **`scripts/__tests__/sync-posthog-event-defs.test.ts`** — 6 vitest tests via TDD (RED then GREEN): dry-run output, two env-var guards, event count, API key check, TAXO-06 marker absence. All 6 pass.

3. **`.github/workflows/posthog-event-defs-sync.yml`** — push-to-main job runs real sync (hard-fails on API error per D-11, blocking deploy); pull_request job runs dry-run for reviewer visibility. Node 22, `npm ci --legacy-peer-deps`, main-branch guard prevents PR-preview clobber.

## Task Execution

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 (TDD RED) | Failing tests for sync script | `120338b` | `scripts/__tests__/sync-posthog-event-defs.test.ts`, `package.json` |
| 1 (TDD GREEN) | Implement sync script | `311206e` | `scripts/sync-posthog-event-defs.ts`, `package.json` |
| 2 | GitHub Actions workflow | `db74f90` | `.github/workflows/posthog-event-defs-sync.yml` |
| 3 | GH secrets checkpoint | — | **AWAITING HUMAN ACTION** |

## Decisions Made

- **404 = warn+skip** (not hard-fail): PostHog auto-creates event definitions on first event ingest; before any events have been ingested the definition won't exist yet, so hard-failing would block first-ever deploy. After ingest, the definition exists and PATCH succeeds.
- **JSON schema generated but not sent to PostHog API**: PostHog's event-definitions PATCH body only accepts `{name, description, tags}` — the `jsonSchema` field is generated (for future use / documentation) but not in the request body. The PHI flag is conveyed as a tag (`phi` or `non-phi`) for PostHog UI visibility.
- **TAXO-06 marker check before env validation**: This ordering means even a CI run with valid credentials will abort if someone accidentally removes the reconciliation comment, acting as an additional guard against silent additive-only enforcement removal.
- **zod-to-json-schema@^3 as devDependency**: Only needed by the sync script, not the production bundle.

## Deviations from Plan

### Minor Implementation Differences

**1. [Rule 1 - Implementation detail] JSON schema generated but not in PATCH body**
- **Found during:** Task 1 implementation
- **Issue:** PostHog event-definitions PATCH endpoint accepts only `{name, description, tags}` — there is no `properties` or `jsonSchema` field in the documented REST shape. Sending an unsupported field would either be ignored or cause a 400.
- **Fix:** Generate schema via `zodToJsonSchema()` (to validate the export works) but only send `{name, description, tags}` in the PATCH body. Schema can be used for future tooling.
- **Files modified:** `scripts/sync-posthog-event-defs.ts`

## Pending: Task 3 Checkpoint

Task 3 requires operator action to set 3 GitHub Actions secrets:
- `POSTHOG_PROJECT_ID`
- `POSTHOG_PROJECT_API_KEY`
- `POSTHOG_HOST`

See checkpoint details below. CI sync becomes operational on next push to main after secrets are set.

## Known Stubs

None — script is fully implemented; CI will fail loudly until secrets are provisioned (by design).

## Threat Flags

None beyond the plan's threat model. The script never echoes the API key (T-24-08c mitigated).

## Self-Check: PASSED

- `leanshot/scripts/sync-posthog-event-defs.ts` — EXISTS
- `leanshot/scripts/__tests__/sync-posthog-event-defs.test.ts` — EXISTS
- `.github/workflows/posthog-event-defs-sync.yml` — EXISTS
- `leanshot/package.json` has `sync-posthog` script — CONFIRMED
- Commit `120338b` (RED) — PRESENT
- Commit `311206e` (GREEN) — PRESENT
- Commit `db74f90` (workflow) — PRESENT
- All 6 vitest tests PASS
