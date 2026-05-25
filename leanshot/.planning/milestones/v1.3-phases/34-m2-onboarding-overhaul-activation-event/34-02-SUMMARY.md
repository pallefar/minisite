---
phase: 34-m2-onboarding-overhaul-activation-event
plan: 02
subsystem: anonymous-preview / activation
tags: [anonymous-session, pg_cron, edge-function, cookie, onboarding]
wave: 1
requires:
  - supabase/migrations/20270706000001_p34_anonymous_sessions.sql  # sibling 34-01
provides:
  - cron-job: phase34-anon-session-ttl-weekly
  - edge-fn: create-anon-session (POST /functions/v1/create-anon-session)
  - lib: leanshot/src/lib/anonymous/cookie.ts
affects:
  - supabase.cron.job
  - public.anonymous_sessions (DELETE / INSERT / UPDATE via service-role)
  - document.cookie (_ls_anon)
tech-stack:
  added:
    - none (pg_cron and supabase-js already present)
  patterns:
    - "Named dollar-quote tags inside pg_cron body ($cron$ outer, $anon_ttl$ inner)"
    - "Lazy admin singleton + test injection seam (mirrors plan-personalize)"
    - "UUID-shape regex as service-role write gate"
key-files:
  created:
    - supabase/migrations/20270706000005_p34_anon_session_ttl_cron.sql
    - supabase/functions/create-anon-session/index.ts
    - supabase/functions/create-anon-session/index.test.ts
    - supabase/functions/create-anon-session/deno.json
    - leanshot/src/lib/anonymous/cookie.ts
    - leanshot/src/lib/anonymous/cookie.test.ts
  modified: []
decisions:
  - "Migration uses direct SQL DELETE, NOT pg_net + Edge Fn invocation (no vault entry needed)"
  - "Edge Fn pre-auth (no Bearer required) — UUID-shape regex is the only write gate; AnonymousPreviewLayer calls before user session exists"
  - "Orphan / already-merged cookie_id falls through to fresh insert instead of erroring (browser never left without a session)"
  - "Cookie Max-Age=30d matches pg_cron TTL window — DB and browser expire on the same horizon"
metrics:
  duration: "~25 minutes"
  completed: 2026-05-20
  tasks_completed: 2
  files_changed: 6
  tests_added: 16   # 8 deno + 8 vitest
requirements:
  - ONBOARD-01
---

# Phase 34 Plan 34-02: Anon Session TTL + create-anon-session Edge Fn Summary

One-liner: Weekly pg_cron TTL job for orphan anonymous sessions, plus the
`create-anon-session` Edge Function and `_ls_anon` browser cookie helpers
that the AnonymousPreviewLayer (Plan 34-06) will consume on first hit.

## What shipped

### Cron job — `phase34-anon-session-ttl-weekly`

- Schedule: `0 3 * * 0` (Sunday 03:00 UTC, weekly).
- Body: `DELETE FROM public.anonymous_sessions WHERE last_activity_at < now() - interval '30 days' AND merged_user_id IS NULL;`
- Pre-flight `do $unschedule$ ... $unschedule$` block makes re-applying the migration safe.
- Named dollar-quote tags exclusively — outer `$cron$ … $cron$`, inner `$anon_ttl$ … $anon_ttl$`. Bare `$$` is **never** used inside the cron body (would silently close the outer quote and crash apply with "syntax error at or near DECLARE").
- Cron body wraps the DELETE in an exception handler so a single failed sweep raises a NOTICE but never marks the job as failed (keeps the schedule healthy across migrations).

### Edge Function — `create-anon-session`

- POST `/functions/v1/create-anon-session`, no Bearer required (pre-auth surface).
- Request: `{ cookie_id?: string }` — UUID v4 shape; any other value is ignored.
- Response: `{ cookie_id: string }`.
- Two paths:
  1. **Warm-touch:** valid UUID-shape cookie matching an un-merged row → `UPDATE last_activity_at = now()` and return the same id. Resets the TTL clock.
  2. **Cold-start / orphan fall-through:** no cookie, malformed cookie, or cookie that does not match an un-merged row → `INSERT { cookie_id = crypto.randomUUID() }` and return the new id.
- OPTIONS preflight → 204 + CORS headers.
- Non-POST → 405 `method_not_allowed`.
- DB error → 500 `db_error` (no PII leak).
- Skeleton mirrors `supabase/functions/plan-personalize/index.ts`: CORS helpers, lazy admin singleton, test injection seam, `Deno.serve` guard, `__internal` export.
- **Does not import** `_shared/posthog-server.ts` (activation_completed is Plan 34-03's responsibility) nor `_shared/sentry.ts` (failures degrade silently to local-only flow).

### Browser cookie helpers — `leanshot/src/lib/anonymous/cookie.ts`

- `ANON_COOKIE_NAME = '_ls_anon'`
- `readAnonCookie(): string | null` — URI-decodes; returns `null` when absent, when document is unavailable, or when percent-encoding is malformed.
- `writeAnonCookie(value: string): void` — sets `Path=/; Max-Age=2592000; SameSite=Lax` and `Secure` when `location.protocol === 'https:'`.
- `clearAnonCookie(): void` — expires the cookie with `Max-Age=0`.
- Each helper short-circuits to a no-op when `document === undefined` (SSR / non-browser tests).

## Test coverage

- **Deno (`supabase/functions/create-anon-session/index.test.ts`)** — 8 tests, all pass under `deno test --allow-env --allow-net --no-check`:
  - T1 cold-start insert, T2 warm-touch update, T3 malformed input → fresh insert, T3b orphan UUID falls through to insert, T4 OPTIONS 204+CORS, T5 GET 405, T6 update DB error → 500, T7 insert DB error → 500.
- **Vitest (`leanshot/src/lib/anonymous/cookie.test.ts`)** — 8 tests, all pass under `npm run test:unit -- --run src/lib/anonymous/cookie.test.ts`:
  - constant export, null when absent, write+read round-trip, attribute assertion (Path / Max-Age / SameSite / no Secure on http), clear nulls subsequent reads, URI-decode, malformed encoding tolerated, no prefix bleed across cookies.
- **Migration regex gate** — node one-liner asserts `$anon_ttl$` ≥ 2×, `$cron$` ≥ 2×, no bare `$$` inside the cron body, job name + 30-day predicate + `merged_user_id is null` + `cron.unschedule` all present.

## Commits

| Hash      | Type | Description                                                           |
| --------- | ---- | --------------------------------------------------------------------- |
| `1d27ccc` | feat | phase34 anon session TTL weekly cron (D-09)                           |
| `34e69e3` | feat | create-anon-session Edge Fn + _ls_anon cookie helpers (8 deno + 8 vitest) |

## Deviations from Plan

None — plan executed exactly as written. Test count exceeded the spec's minimum-of-5 floor (8 Deno + 8 vitest) to cover the orphan fall-through and DB-error paths explicitly.

## Threat-model mitigations applied

| Threat ID    | Mitigation in this plan                                                                                                          |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| T-34-02-01   | `normalizeCookieId()` enforces UUID v4 regex; existence check via `.is('merged_user_id', null)` blocks reuse of merged rows; falls back to fresh row on mismatch. |
| T-34-02-03   | `_ls_anon` value is UUID v4 (122 bits of entropy); cookie attributes are `SameSite=Lax` + `Secure` (https only); value carries no PII.  |
| T-34-02-04   | Cron body is unconditional DELETE within a fixed predicate; no parameter input → safe by construction.                          |

T-34-02-02 (DoS) and T-34-02-05 (repudiation) carry `accept` dispositions per the plan's threat register — no implementation work required.

## Deploy notes (handoff to Wave-1 orchestrator)

- Migration `20270706000005_p34_anon_session_ttl_cron.sql` requires `supabase db push --linked` (depends on `20270706000001` from Plan 34-01 already being applied).
- Edge Fn `create-anon-session` requires `supabase functions deploy create-anon-session` **without** the `--linked` flag (memory `reference_supabase_functions_deploy_no_linked_flag`); link is auto-read from `supabase/.temp/`.
- No environment variables required beyond the project default `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`.

## Operational expectations

- First weekly tick: Sunday 03:00 UTC after migration apply.
- Expected DELETE volume on day 30 of production traffic: bounded by the anonymous-preview funnel size; rows are tiny (UUID + jsonb prefs + jsonb draft entries) so DELETE cost is negligible.
- Monitor `cron.job_run_details` for `phase34-anon-session-ttl-weekly` failures (status != 'succeeded'). Single failure is harmless (next week's sweep absorbs the missed rows); repeated failures indicate vault/role drift.

## Self-Check: PASSED

- Files exist:
  - `supabase/migrations/20270706000005_p34_anon_session_ttl_cron.sql` FOUND
  - `supabase/functions/create-anon-session/index.ts` FOUND
  - `supabase/functions/create-anon-session/index.test.ts` FOUND
  - `supabase/functions/create-anon-session/deno.json` FOUND
  - `leanshot/src/lib/anonymous/cookie.ts` FOUND
  - `leanshot/src/lib/anonymous/cookie.test.ts` FOUND
- Commits exist:
  - `1d27ccc` FOUND (Task 1: cron migration)
  - `34e69e3` FOUND (Task 2: Edge Fn + cookie helpers)
- Test runs:
  - Deno test: 8 passed / 0 failed
  - Vitest: 8 passed / 0 failed
  - TypeScript: tsc -p tsconfig.app.json --noEmit exit 0
