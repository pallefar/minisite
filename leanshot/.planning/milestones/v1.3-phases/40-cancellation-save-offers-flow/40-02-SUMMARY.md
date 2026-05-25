---
phase: 40
plan: "02"
subsystem: "stripe-webhook + email-router + pause-cron"
tags: [pause-mechanics, email, pg-cron, stripe-webhook, POLISH-03]
dependency_graph:
  requires: []
  provides:
    - subscriptions.paused_until
    - subscriptions.is_paused
    - subscriptions.reminded_t7
    - stripe-webhook pause_collection mirror
    - pause-reminder-fire Edge Fn (T-7d + reconcile modes)
    - email-router EmailTemplate union widening
  affects:
    - 40-04: reads is_paused for D-07 UI gating (READ-ONLY during pause)
    - 40-06: cron.job table now has p40 entries (verified in close-out UAT)
tech_stack:
  added:
    - pause-reminder-fire Deno Edge Fn (cron worker)
    - pause-reminder-t7.ts email template
    - pause-resumed-t0.ts email template
  patterns:
    - pg_cron + vault.decrypted_secrets (P35 exact analog)
    - EmailTemplate union widening (same-commit atomic per [[feedback_planner_missed_status_enum_widening]])
    - Test-spy injection pattern for sendEmail + Stripe (P40PauseSpy interface)
key_files:
  created:
    - supabase/migrations/20270709000004_p40_subscriptions_pause_cols.sql
    - supabase/migrations/20270709000005_p40_pause_reminder_cron.sql
    - supabase/migrations/20270709000006_p40_pause_autoresume_reconcile_cron.sql
    - supabase/functions/pause-reminder-fire/index.ts
    - supabase/functions/pause-reminder-fire/index.test.ts
    - supabase/functions/pause-reminder-fire/deno.json
    - supabase/functions/_shared/email-templates/pause-reminder-t7.ts
    - supabase/functions/_shared/email-templates/pause-resumed-t0.ts
  modified:
    - supabase/functions/stripe-webhook/events/subscription-updated.ts
    - supabase/functions/stripe-webhook/events/subscription-updated.test.ts
    - supabase/functions/_shared/email-router.ts
decisions:
  - "No new case arms in stripe-webhook/index.ts — pause_collection detection extends subscription-updated.ts in-place (RESEARCH §Pitfall 1)"
  - "card_last4 column does not exist on subscriptions or profiles — pause_reminder_t7 template uses 'on file' fallback string"
  - "Auto-resume T-0 email skipped when Stripe customer object is unexpanded (string ID only); A3 reconcile cron catches this within 4h"
  - "P40PauseSpy test interface added to subscription-updated.ts to enable sendEmail injection without live API calls"
  - "pause-reminder-fire supports both mode=fire (T-7d) and mode=reconcile (A3) via single Fn; reconcile cron calls with ?mode=reconcile"
metrics:
  duration: "693s (~12 min)"
  completed: "2026-05-21T16:16:45Z"
  tasks: 3
  files_created: 10
  files_modified: 3
---

# Phase 40 Plan 02: Stripe Webhook Extension + Pause-Reminder Cron + Email-Router Union Widening Summary

**One-liner:** Pause-lifecycle infrastructure — Stripe webhook pause_collection mirror, T-7d/T-0 reminder emails, pg_cron hourly + 4h sweeps, email-router widened with `pause_reminder_t7` | `pause_resumed_t0` templates.

## Tasks Executed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | ALTER subscriptions + partial index | 6caa307 | `20270709000004_p40_subscriptions_pause_cols.sql` |
| 2 | Extend subscription-updated + email-router + templates | 1dd3c54 | `subscription-updated.ts`, `.test.ts`, `email-router.ts`, `pause-reminder-t7.ts`, `pause-resumed-t0.ts` |
| 3 | pg_cron migrations + pause-reminder-fire Edge Fn | adc151e | `20270709000005*.sql`, `20270709000006*.sql`, `pause-reminder-fire/index.ts`, `.test.ts`, `deno.json` |

## Verification Results

- **`grep -c "case 'customer.subscription.paused'" stripe-webhook/index.ts`** → 0 (zero new case arms)
- **`grep -c "case 'customer.subscription.resumed'" stripe-webhook/index.ts`** → 0
- **bare `$$` in cron migrations** → 0
- **`grep -c "pause_reminder_t7\|pause_resumed_t0" email-router.ts`** → 6 (union + subjectFor + renderTemplate × 2)
- **subscription-updated.test.ts**: 18/18 pass (8 existing + 5 new P40 tests + 5 D-05 tests)
- **pause-reminder-fire/index.test.ts**: 6/6 pass (T1..T6)

## Concurrent ALTER check (A8)

Pre-execution grep: `grep -rn 'alter table public.subscriptions' supabase/migrations/ | grep -v 20260601000019`
Found: `20270101000003_subscriptions_provider_guard.sql`, `20270601200001_p29_reconcile.sql` — both are prior phases, no concurrent Phase 40 ALTER collision.

## Profile `last4` column status

`grep -rn 'card_last4\|last_four\|last4' supabase/migrations/` → no results.
**Decision:** `card_last4` column does not exist on any table. `pause_reminder_t7` template uses `'on file'` fallback string. Deferred: if last4 is added to `subscriptions` or `profiles` in future, `pause-reminder-fire/index.ts` line ~101 should pass it via `vars.last4`.

## Cron jobs registered

Both p40 cron entries registered via migrations. Live verification (after `supabase db push` in 40-06) should confirm:

```sql
select jobname, schedule, active from cron.job where jobname like 'p40-pause-%';
-- Expected:
-- p40-pause-t7-reminder        | 0 * * * *    | true
-- p40-pause-autoresume-reconcile | 15 */4 * * * | true
```

## Deferred items

- **`customer.subscription.paused`/`.resumed` Stripe Dashboard subscription:** Per RESEARCH §Pitfall 1, these events never fire for `pause_collection` pauses. CONTEXT §Deferred documents this as a HUMAN-UAT item for 40-06: verify no-op if accidentally subscribed.
- **`card_last4` in T-7d email:** Template renders "Card on file: on file" as fallback. If a future migration adds this column, wire it at `pause-reminder-fire/index.ts` fetchProfile + vars.
- **T-0 email from unexpanded customer object:** When `subscription.customer` is a string ID (not expanded), T-0 email is skipped and logged. A3 reconcile cron fires within 4h as fail-safe.

## Deviations from Plan

### Auto-fixed Issues

None — plan executed exactly as written.

### Implementation notes

1. **Linter rollback pattern**: The Deno linter / Claude Code tool system rolled back Edit operations twice (email-router.ts). Both times the file was re-written in full using Write tool to avoid partial-edit ambiguity. Final state verified via `grep -c` counts.

2. **Test mock complexity**: The existing `buildMockAdmin` in subscription-updated.test.ts only had `upsert`. The new pause code adds `select().eq().maybeSingle()` + `update().eq()` chains. A new `buildPauseMockAdmin` was written that differentiates select vs update mode via internal state tracking, with the update chain returning a thenable from `.eq()` (matching supabase-js semantics).

3. **P40PauseSpy interface**: Added to `subscription-updated.ts` exports as a test seam for the `sendEmail` call inside the pause logic. This avoids importing live `sendResendEmail` in test contexts.

## Threat surface scan

No new network endpoints, auth paths, or schema changes beyond what the plan's `<threat_model>` covers:
- `pause-reminder-fire` is gated by `checkServiceRoleBearer` (T-40-02-08)
- SES/Resend routing via PHI flag from server-derived `clinic_id IS NOT NULL` (T-40-02-03)
- Sentry logs err.message only — no payload (T-40-02-05)
- LIMIT 100/200 guards on both cron modes (T-40-02-06)

## Self-Check: PASSED

Files verified:
- `supabase/migrations/20270709000004_p40_subscriptions_pause_cols.sql` — FOUND
- `supabase/migrations/20270709000005_p40_pause_reminder_cron.sql` — FOUND
- `supabase/migrations/20270709000006_p40_pause_autoresume_reconcile_cron.sql` — FOUND
- `supabase/functions/pause-reminder-fire/index.ts` — FOUND
- `supabase/functions/pause-reminder-fire/index.test.ts` — FOUND
- `supabase/functions/_shared/email-templates/pause-reminder-t7.ts` — FOUND
- `supabase/functions/_shared/email-templates/pause-resumed-t0.ts` — FOUND
- `supabase/functions/stripe-webhook/events/subscription-updated.ts` — MODIFIED
- `supabase/functions/_shared/email-router.ts` — MODIFIED

Commits verified:
- 6caa307 — Task 1 (ALTER subscriptions)
- 1dd3c54 — Task 2 (webhook extension + email-router)
- adc151e — Task 3 (cron + Fn)
