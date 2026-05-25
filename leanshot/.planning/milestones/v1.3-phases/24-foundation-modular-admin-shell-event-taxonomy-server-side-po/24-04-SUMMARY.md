---
phase: 24-foundation-modular-admin-shell-event-taxonomy-server-side-po
plan: "04"
subsystem: analytics
tags:
  - posthog
  - server-side-analytics
  - edge-functions
  - identity-bridge
  - stripe-webhook
dependency_graph:
  requires:
    - 24-02  # event taxonomy (events.ts, identify.ts, capture.ts)
    - 24-01  # audit_logs + admin foundation
  provides:
    - _shared/posthog-server.ts helper (all future Edge Functions can import)
    - payment_completed + refund_issued server-side capture
    - browser identify + alias bridge (D-13)
  affects:
    - supabase/functions/stripe-webhook/index.ts
    - leanshot/src/App.tsx
    - leanshot/src/main.tsx
tech_stack:
  added:
    - posthog-node@5.10.4 via npm: Deno specifier (Edge Functions only, not in package.json)
  patterns:
    - Vendor-gated health-check (reference_vendor_gated_send_health_check)
    - try/finally shutdownPostHog before Edge return (RESEARCH PITFALL 1)
    - Dynamic posthog-js import in App.tsx to avoid static bundle cost
key_files:
  created:
    - supabase/functions/_shared/posthog-server.ts
    - supabase/functions/_shared/posthog-server.test.ts
    - supabase/functions/stripe-webhook/posthog-capture.test.ts
    - leanshot/src/lib/analytics/__tests__/auth-identify-bridge.test.ts
  modified:
    - supabase/functions/stripe-webhook/index.ts
    - leanshot/src/App.tsx
    - leanshot/src/main.tsx
decisions:
  - "identify/alias bridge placed in App.tsx SIGNED_IN branch (existing subscription) rather than main.tsx — avoids duplicate onAuthStateChange subscription (extra subscriptions cause duplicate sync work)"
  - "days_since_signup in refund_issued is intentionally 0 pending Plan 24-07 DB enrichment — plan explicitly approved this interim"
  - "Dynamic import posthog-js in App.tsx for posthog.get_distinct_id() and reset() to avoid adding posthog-js to App.tsx static graph"
metrics:
  duration: "~35 minutes"
  completed: "2026-05-17"
  tasks_completed: 3
  tasks_total: 4
  files_created: 4
  files_modified: 3
---

# Phase 24 Plan 04: Server-side PostHog Capture Summary

**One-liner:** posthog-node@5.10.4 Edge Function helper with lazy-init + always-shutdown semantics; stripe-webhook captures payment_completed + refund_issued server-side under Supabase uid; browser identify/alias bridge merges anon events on SIGNED_IN.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Build `_shared/posthog-server.ts` + Deno test | 07ed9ce | posthog-server.ts, posthog-server.test.ts |
| 2 | Wire stripe-webhook to capture payment + refund | 88f7d79 | stripe-webhook/index.ts, posthog-capture.test.ts |
| 3 | Wire browser identify + alias on auth state change | f00b762 | App.tsx, main.tsx, auth-identify-bridge.test.ts |

## Tasks Paused at Checkpoint

| Task | Name | Type | Reason |
|------|------|------|--------|
| 4 | HUMAN — set POSTHOG_PROJECT_KEY + POSTHOG_HOST | checkpoint:human-action | Supabase Function Secrets require user to provide the PostHog write key |

## What Was Built

### Task 1: `_shared/posthog-server.ts`

Lazy-init posthog-node@5.10.4 helper for Supabase Edge Functions:
- `captureServer({ userId, event, properties })` — userId required (D-13), vendor-gated no-op when `POSTHOG_PROJECT_KEY` missing
- `shutdownPostHog()` — idempotent flush; MUST be called in every Edge Function's `finally` block (RESEARCH PITFALL 1)
- 4 Deno tests all passing: no-op+warn on missing key, userId guard throws, idempotent shutdown

### Task 2: stripe-webhook PostHog integration

- Import: `captureServer + shutdownPostHog` from `../_shared/posthog-server.ts`
- `handleRequest` wrapped in try/finally — `await shutdownPostHog()` guaranteed to run
- `checkout.session.completed`: captures `payment_completed` with `user_id` from session metadata; `stripe_session_id` SHA-256 hashed (T-24-05b)
- `charge.refunded`: new dispatch case captures `refund_issued`; `days_since_signup: 0` pending Plan 24-07 enrichment
- Missing `user_id` in metadata: logs warn + skips capture; webhook always returns 200 (never throws)
- 4 new `posthog-capture.test.ts` tests + all 6 original tests still pass

### Task 3: Browser identify + alias bridge

- `App.tsx` SIGNED_IN: dynamic-import posthog-js → `identify(uid)` + `aliasAnonymousToUid(anon_id, uid)`
- `App.tsx` SIGNED_OUT: dynamic-import posthog-js → `ph.reset()` clears identity
- `aliasAnonymousToUid` is idempotent via localStorage marker (Plan 24-02)
- Added to EXISTING App.tsx onAuthStateChange (not a new subscription)
- `main.tsx`: comment documents where identify bridge lives
- 4 new `auth-identify-bridge.test.ts` tests; all 13 analytics tests pass

## Deviations from Plan

### Architectural Adaptation (no rule violation)

**1. identify/alias bridge placed in App.tsx, not main.tsx**
- **Found during:** Task 3 — reading main.tsx + App.tsx
- **Reason:** `supabase.auth.onAuthStateChange` subscription already exists in `App.tsx`. Plan instructions explicitly say "ADD to the existing callback rather than creating a new subscription." `main.tsx` doesn't have direct supabase access (it's deferred via `scheduleSyncInit`).
- **Fix:** Added identify/alias calls to App.tsx SIGNED_IN branch; posthog.reset() to SIGNED_OUT branch
- **No regression:** Existing App.tsx auth logic unchanged; analytics calls wrapped in try/catch

## Known Stubs

| Stub | File | Line | Reason |
|------|------|------|--------|
| `days_since_signup: 0` | supabase/functions/stripe-webhook/index.ts | ~185 | Plan explicitly approved this interim. Enrichment requires DB query; Plan 24-07 sync will add it. |

## Threat Surface Scan

No new network endpoints, auth paths, or trust boundary changes introduced beyond what the plan's threat model covers. The `charge.refunded` dispatch case is an internal routing addition with no new surface. SHA-256 hash of stripe_session_id confirmed (T-24-05b).

## Self-Check

- [x] `supabase/functions/_shared/posthog-server.ts` created
- [x] `supabase/functions/_shared/posthog-server.test.ts` created (4 Deno tests)
- [x] `supabase/functions/stripe-webhook/index.ts` modified (captureServer x2 + shutdownPostHog + try/finally)
- [x] `supabase/functions/stripe-webhook/posthog-capture.test.ts` created (4 Deno tests)
- [x] `leanshot/src/App.tsx` modified (identify + alias + reset wired to auth state changes)
- [x] `leanshot/src/main.tsx` updated (comment documenting identify bridge location)
- [x] `leanshot/src/lib/analytics/__tests__/auth-identify-bridge.test.ts` created (4 vitest tests)
- [x] Commits: 07ed9ce, 88f7d79, f00b762

## Self-Check: PASSED
