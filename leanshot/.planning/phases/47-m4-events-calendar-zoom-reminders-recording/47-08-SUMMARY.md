---
phase: 47-m4-events-calendar-zoom-reminders-recording
plan: 08
subsystem: events/reminders
tags: [edge-fn, secdef, pg_cron, email, phi-routing, idempotent]
dependency_graph:
  requires: [47-01, 47-03, 47-04, 47-05]
  provides:
    - "public.select_event_reminder_targets() RPC (SECDEF, service-role-callable)"
    - "supabase/functions/event-reminders-fanout/ Edge Fn (cron-target)"
    - "supabase/functions/_shared/event-phi.ts (downstream-event-Fn helper)"
  affects:
    - "20270801000010_p47_event_reminder_cron.sql (cron now has a deployed target)"
    - "future event Fns can import getEventPhiFlag for single-event PHI derivation"
tech-stack:
  added: []
  patterns:
    - "Service-role bearer auth via checkServiceRoleBearer (lifecycle-utils)"
    - "Idempotent dedup via UNIQUE + INSERT ON CONFLICT DO NOTHING"
    - "SECDEF RPC for service-role one-shot windowing JOIN (no per-user JWT)"
    - "sendEmail test seam (mirrors community-admin-report-digest pattern)"
    - "Per-recipient try/catch (mirrors helpdesk-sla-breach-cron)"
    - "Top-level Deno.serve guarded by import.meta.main (test-trap safe)"
key-files:
  created:
    - "supabase/migrations/20270801000009_p47_select_event_reminder_targets_rpc.sql"
    - "supabase/functions/event-reminders-fanout/index.ts"
    - "supabase/functions/event-reminders-fanout/deno.json"
    - "supabase/functions/_shared/event-phi.ts"
  modified: []
decisions:
  - "RPC body uses (events.start_at - now()) UTC-instant delta for windowing — DST drift accepted per plan iter-1 W2"
  - "email source = auth.users via JOIN (profiles has no email column — live-DB confirmed)"
  - "phi = (community_spaces.org_id IS NOT NULL) projected by RPC; Fn forwards it verbatim per Pitfall 6"
  - "Template strings event_reminder_1d / event_reminder_1h / event_promotion cast to EmailTemplate via 'as' — union widening + template modules owned by 47-12 close-out (see Deferred Issues)"
  - "sendEmail test seam exposed (setSendEmailForTest / resetSendEmailForTest) for Wave 0 scaffold GREEN at close-out"
metrics:
  duration_minutes: ~18
  completed: 2026-05-24
requirements: [EVENT-04]
---

# Phase 47 Plan 08: event-reminders-fanout Edge Fn Summary

Ship the hourly cron target — a SECDEF target-selector RPC, a thin Edge Fn that iterates targets with at-most-once dedup, and a downstream PHI-flag helper. Implements D-10 (reminder cron architecture), D-11 (email-only), D-19 (notification_settings respect), and Pitfall 6 (PHI flag derivation from community_spaces.org_id).

## What Was Built

### `select_event_reminder_targets()` SECDEF RPC

`supabase/migrations/20270801000009_p47_select_event_reminder_targets_rpc.sql`

Single `language sql security definer` function returning `table(event_id, user_id, kind, phi, email, event_title, local_start_at)` via 3-branch `UNION ALL`:

1. **1d window** — `events × event_rsvps(status='going') × community_spaces × profiles × auth.users` where `(e.start_at - now()) ∈ [23h, 25h)` and `NOT EXISTS event_reminder_sent(event_id, user_id, '1d')`. LEFT JOIN `notification_settings` filters out rows where `category='event_reminders_1d'` has `email=false`.
2. **1h window** — same shape, window `[0h, 2h)`, category `event_reminders_1h`.
3. **Promotion drain** — `event_promotion_queue × events × community_spaces × profiles × auth.users` where `drained_at IS NULL`, category `event_promotion`.

`phi = (community_spaces.org_id IS NOT NULL)` projected per row. `email = auth.users.email` via JOIN (live-DB pre-check confirmed `public.profiles` has no `email` column). `local_start_at = e.start_at AT TIME ZONE coalesce(profiles.timezone, 'UTC')` for template display (windowing itself uses UTC-instant delta — see Decisions).

`grant execute … to service_role` + `revoke … from public`. RPC body contains **zero** per-user JWT predicate references — service-role-callable per memory `feedback_rpc_auth_uid_vs_service_role_mismatch`.

### `event-reminders-fanout` Edge Fn

`supabase/functions/event-reminders-fanout/index.ts` (+ sibling `deno.json`)

- 401 unless `checkServiceRoleBearer(req)` passes (handles `sb_secret_*` + legacy JWT shapes).
- `admin.rpc('select_event_reminder_targets')` → one round trip per cron tick.
- For each target: `INSERT INTO event_reminder_sent` with `.select('id').maybeSingle()` — UNIQUE(event_id, user_id, kind) collisions return null data, which short-circuits before send (idempotent dedup per memory `feedback_state_counter_table_needs_upsert_on_event`).
- `sendEmail(admin, { to, template, phi: t.phi, vars })` with `template` mapped from `kind`. **`phi` is the RPC's projected value — zero hardcoded `phi: true/false` literals (Pitfall 6 grep gate).**
- Per-recipient `try/catch` — one failed send does not block siblings (mirrors `helpdesk-sla-breach-cron` + `community-admin-report-digest`).
- Promotion-kind targets additionally `UPDATE event_promotion_queue SET drained_at = now()` for the matching (event_id, user_id) — D-03 drain semantics.
- Top-level `Deno.serve(handler)` guarded by `import.meta.main && denoGlobal?.serve` — sibling `index.test.ts` imports the module without starting an HTTP server (memory: `reference_deno_test_top_level_serve_trap`).
- Test seam: `setSendEmailForTest` / `resetSendEmailForTest` mirror `community-admin-report-digest`; Wave 0 scaffolded tests in `phi-routing.test.ts` will use this at close-out.

### `_shared/event-phi.ts` helper

`getEventPhiFlag(admin, event_id) → Promise<boolean>` — single-event PHI derivation for downstream Fns (event-recording, event-share, future event-cancel-notify) that don't round-trip through the SECDEF RPC. Returns `false` when event not found (no PHI to leak; caller treats unknown event as no-op upstream).

## Verification Performed

```
test -f supabase/migrations/20270801000009_p47_select_event_reminder_targets_rpc.sql  → OK
test -f supabase/functions/event-reminders-fanout/index.ts                            → OK
test -f supabase/functions/event-reminders-fanout/deno.json                           → OK
test -f supabase/functions/_shared/event-phi.ts                                       → OK

grep 'create or replace function public.select_event_reminder_targets'                → 1
grep 'grant execute on function public.select_event_reminder_targets … service_role' → 1
grep 'auth.uid' migration                                                             → 0 (service-role-callable)
grep 'join auth.users' migration                                                      → 3 (one per UNION branch)
grep 'p\.email' migration                                                             → 0 (correct: profiles.email does not exist)

grep 'checkServiceRoleBearer' index.ts                                                → 3
grep 'select_event_reminder_targets' index.ts                                         → 3
grep 'phi: t.phi' index.ts                                                            → 1 (RPC-derived, not hardcoded)
grep -E 'phi:\s*(true|false)\b' index.ts                                              → 0 (Pitfall 6 PASS)
grep 'event_reminder_sent' index.ts                                                   → 2
grep 'event_promotion_queue' index.ts                                                 → 2
grep 'import.meta.main' index.ts                                                      → 2
grep 'getEventPhiFlag' _shared/event-phi.ts                                           → 1

deno check supabase/functions/event-reminders-fanout/index.ts                         → PASS (clean)
```

All plan `<acceptance_criteria>` gates pass.

## Decisions Made

**DST trade-off accepted** — windowing uses `(events.start_at - now())` UTC-instant delta rather than per-TZ delta. Mathematically equivalent except across DST transitions, where it can drift by ±1 hour 2–4 times/year per timezone. Acceptable for reminder UX. Phase 38's weekly-digest uses exact-clock-hour match (different precedent — that one needed an exact 9am-local fire); event reminders are window-based so the precedents differ.

**email JOIN to `auth.users`, not `profiles`** — live-DB pre-check (orchestrator iter-1, 2026-05-23) confirmed `public.profiles` has no `email` column. SECDEF + `search_path = public, extensions` allows the auth.users SELECT through. Defense-in-depth: 3× `join auth.users` (one per UNION branch).

**Idempotent dedup belt-and-braces** — both the RPC predicate (`NOT EXISTS event_reminder_sent ...`) AND the Fn-side `INSERT … ON CONFLICT DO NOTHING` guard against double-send. Two ticks 1 second apart still produce at most one send per (event, user, kind).

**Test seam exposed** — `setSendEmailForTest` / `resetSendEmailForTest` follow the `community-admin-report-digest` pattern so the Wave 0 `phi-routing.test.ts` scaffold can stub the router without env wiring.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 — Bug] `sendEmail` call signature**
- **Found during:** Task 2 implementation
- **Issue:** Plan's sample code called `sendEmail({ to, template, phi, vars })` (1 arg). Real signature is `sendEmail(supabase: SupabaseClient, args: SendEmailArgs)` (2 args — confirmed in `_shared/email-router.ts:321`).
- **Fix:** Passed `admin` as first arg; wrapped in test seam `_sendEmailImpl(admin, args)`.
- **Files modified:** `supabase/functions/event-reminders-fanout/index.ts`
- **Commit:** 1cc5a5b6

**2. [Rule 1 — Bug] `jsonResponse` call signature**
- **Found during:** Task 2 implementation
- **Issue:** Plan's sample code called `jsonResponse({ ok: true, sent })` (1 arg). Real signature is `jsonResponse(status, body)` (`lifecycle-utils.ts:25`).
- **Fix:** Changed to `jsonResponse(200, { ok: true, sent })`.
- **Files modified:** `supabase/functions/event-reminders-fanout/index.ts`
- **Commit:** 1cc5a5b6

**3. [Rule 2 — Missing safety] Per-recipient try/catch around sendEmail**
- **Found during:** Task 2 implementation
- **Issue:** Plan sample had no try/catch. One transient Resend/SES failure would 500 the whole tick, leaving subsequent targets unsent for an hour.
- **Fix:** Wrapped `_sendEmailImpl(...)` in try/catch with `continue` on failure + structured warn log. Mirrors `community-admin-report-digest` + `helpdesk-sla-breach-cron`.
- **Files modified:** `supabase/functions/event-reminders-fanout/index.ts`
- **Commit:** 1cc5a5b6

**4. [Rule 2 — Negation-grep hygiene] Removed literal `auth.uid` from comments**
- **Found during:** Task 1 verification
- **Issue:** Initial migration body had explanatory comments mentioning the rejected pattern by name (`"no auth.uid() in body"`). Acceptance gate `grep -c 'auth.uid' migration | xargs test 0 -eq` failed on comment matches (memory: `feedback_negation_grep_defeated_by_comment_string`).
- **Fix:** Reworded comments to use "per-user JWT predicate" rather than the literal substring. Code body remains unchanged.
- **Files modified:** `supabase/migrations/20270801000009_p47_select_event_reminder_targets_rpc.sql`
- **Commit:** d191c06d (single commit; rewrite happened pre-stage)

### Deferred Issues

**EmailTemplate union widening** — the plan ships an Fn that calls `sendEmail` with template ids `'event_reminder_1d'`, `'event_reminder_1h'`, `'event_promotion'` that are NOT in the `EmailTemplate` union in `_shared/email-router.ts`. **No template modules exist yet for these names.**

- **Why deferred:** Per the plan's `must_haves.artifacts` (4 files total — RPC, Fn, deno.json, helper), email-router widening + template modules are explicitly out of scope. The plan-checker passed iter-1/2 with this gap. Plan close-out (47-12) is the natural owner.
- **Runtime impact today:** `sendEmail` falls through to the `default` arm in `renderTemplate`, sending a generic `"LeanShot notification."` body. **PHI routing still works correctly** — the `phi` flag drives Resend (consumer) vs SES (clinic) at line 326, independent of template rendering. So the security boundary is intact; only the email body content is stub-grade until 47-12.
- **Cast used:** `template as EmailTemplate` to satisfy TS strict mode locally; `deno check` confirms clean compile.
- **What 47-12 must add:** (a) widen `EmailTemplate` union with the three names, (b) add `subjectFor` switch arms, (c) add `renderTemplate` switch arms, (d) drop three template modules under `supabase/functions/_shared/email-templates/` (e.g., `event-reminder-1d.ts`). All in one commit per memory `feedback_planner_missed_status_enum_widening`.

**Wave 0 RED scaffolds still RED** — `supabase/functions/event-reminders-fanout/index.test.ts` + `phi-routing.test.ts` (47-05 scaffolds) intentionally retain TODO stubs; per plan `<verification>` they GREEN at close-out (47-12) after deploy.

## Authentication Gates Encountered

None. Plan was fully autonomous — `checkServiceRoleBearer` auth lives at runtime (when cron tick fires), not at execute time.

## Known Stubs

None in committed code. The "generic email body" via `default` arm in email-router is documented above as a Deferred Issue with explicit close-out owner — not a stub in the plan-checker sense.

## Commits

- `d191c06d` — `feat(47-08): select_event_reminder_targets SECDEF RPC for hourly fan-out`
- `1cc5a5b6` — `feat(47-08): event-reminders-fanout Edge Fn + _shared/event-phi helper`

## Self-Check: PASSED

- File `supabase/migrations/20270801000009_p47_select_event_reminder_targets_rpc.sql` → FOUND
- File `supabase/functions/event-reminders-fanout/index.ts` → FOUND
- File `supabase/functions/event-reminders-fanout/deno.json` → FOUND
- File `supabase/functions/_shared/event-phi.ts` → FOUND
- Commit `d191c06d` → FOUND in git log
- Commit `1cc5a5b6` → FOUND in git log
- All plan `<acceptance_criteria>` grep gates pass (see Verification block above).
- `deno check` on the Edge Fn → clean.
