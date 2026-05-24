---
phase: 47-m4-events-calendar-zoom-reminders-recording
type: carry-over
created: 2026-05-24
deferred_to: v1.3-milestone-close
status: shipped (automated-verify-only); operator HUMAN-UAT + live infra mutations deferred
---

# Phase 47 — Carry-Over

Phase 47 shipped 11/12 plans (47-01..47-11) via worktree-executor dispatch + 47-12 partial close-out (Task 1 verify + Task 4 metadata only; Tasks 2-3 deferred per operator decision 2026-05-24).

Pattern: `feedback_autonomous_false_close_out_partial_execution` + `feedback_milestone_uat_deferral_consolidation`.

## Migration push verification matrix

| Plan | Migration files | db push status |
|------|-----------------|----------------|
| 47-01 | 20270801000001 (schema), 20270801000002 (rls) | **pending** |
| 47-02 | 20270801000007 (event_rsvps) | **pending** |
| 47-03 | 20270801000003 (rsvp/join SECDEF RPCs), 20270801000004 (waitlist FIFO trigger), 20270801000008 (event_reminder_sent + promotion_queue) | **pending** |
| 47-04 | 20270801000005 (event-covers bucket), 20270801000006 (notification event categories) | **pending** |
| 47-05 | 20270801000010 (pg_cron — event-reminders-fanout hourly) | **pending** |
| 47-08 | 20270801000009 (select_event_reminder_targets RPC) | **pending** |

Total: **10 migrations pending push**. All filenames pass strict 14-digit regex.

**Ordering constraint** (per memory `feedback_fn_deploy_before_cron_db_push`): deploy `event-reminders-fanout` Edge Fn FIRST. Migration `20270801000010` registers hourly cron targeting that Fn.

## Edge Fn deploy status

**CRITICAL pair-deploy** (per memory `reference_mux_fn_pair_deploy_passthrough_drift`): mux-create-upload + mux-webhook MUST deploy atomically — Phase 47 adds the THIRD passthrough kind `'event-recording'` (after Phase 44 `community-post` and Phase 46 `course-lesson`). Partial deploy causes silent UPDATE-wrong-table.

| Fn | Status | Notes |
|----|--------|-------|
| zoom-create-meeting | **pending deploy** | NEW. Needs ZOOM_S2S_ACCOUNT_ID + ZOOM_S2S_CLIENT_ID + ZOOM_S2S_CLIENT_SECRET. |
| event-join-url | **pending deploy** | NEW. No new secrets. |
| event-reminders-fanout | **pending deploy** | NEW. Cron-invoked hourly. Deploy BEFORE 20270801000010 cron migration. |
| mux-create-upload | **pending redeploy** | EXTENDED for kind:'event-recording'. PAIR-deploy with mux-webhook. |
| mux-webhook | **pending redeploy** | EXTENDED for kind:'event-recording' dispatch. PAIR-deploy with mux-create-upload. Deploy webhook FIRST (dormant), then upload (activates caller in 47-11). |

Operator commands:
```bash
cd /Users/karstenhaldan/minisite/supabase

# Set 3 NEW Function Secrets first
supabase secrets set --project-ref ytnsipxxmzgaebkqmokp \
  ZOOM_S2S_ACCOUNT_ID="<from Zoom App Marketplace>" \
  ZOOM_S2S_CLIENT_ID="<from Zoom>" \
  ZOOM_S2S_CLIENT_SECRET="<from Zoom>"

# Deploy 5 Fns (order: webhook first to seed dormant, then upload to activate, then 3 new)
supabase functions deploy mux-webhook              # PAIR — webhook FIRST (dormant)
supabase functions deploy mux-create-upload         # PAIR — upload SECOND (activates caller)
supabase functions deploy event-reminders-fanout    # MUST precede db push (cron 20270801000010)
supabase functions deploy zoom-create-meeting
supabase functions deploy event-join-url

# THEN push migrations
supabase db push --linked
```

## Vendor secret pre-flight status

Phase 47 introduces **3 new Function Secrets** (all Zoom S2S):

| Secret | Status | Action |
|--------|--------|--------|
| ZOOM_S2S_ACCOUNT_ID | **NOT SET** | From Zoom App Marketplace → Server-to-Server OAuth app → Account ID. |
| ZOOM_S2S_CLIENT_ID | **NOT SET** | Same S2S OAuth app → Client ID. |
| ZOOM_S2S_CLIENT_SECRET | **NOT SET** | Same S2S OAuth app → Client Secret. NEVER browser-exposed. |

Inherited (no Phase 47 action — verify before mux pair deploy):
- MUX_TOKEN_ID, MUX_TOKEN_SECRET, MUX_WEBHOOK_SECRET (Phase 44/46) — may also need setting per earlier session note
- SUPABASE_SERVICE_ROLE_KEY (sb_secret_*)

## HUMAN-UAT signal status — ALL DEFERRED to v1.3 milestone UAT

Per memory `feedback_multi_signal_human_verify_checkpoint_pattern`. All deferred 2026-05-24:

| Signal | Status | Defer reason |
|--------|--------|--------------|
| 1: Admin creates event with `zoom_managed=true` → real Zoom meeting created | **deferred** | Needs Zoom S2S secrets + Fn deploy + live admin |
| 2: User RSVPs → capacity invariant + waitlist FIFO promotion | **deferred** | Needs db push + 2+ live users + capacity-of-1 event |
| 3: User clicks Join → event-join-url returns Zoom URL within window | **deferred** | Needs Fn deploy + db push + RSVP fixture |
| 4: Hourly reminder fan-out → email arrives at 24h/1h marks | **deferred** | Needs cron registered + Fns deployed + wall-clock wait |
| 5: PHI routing → clinical-space event reminders route through SES not Resend | **deferred** | Needs Phase 25 SES infra + live clinical space |
| 6: Admin uploads event recording → mux-create-upload + mux-webhook process | **deferred** | Needs mux pair deploy + admin + sample MP4 |

Disposition: all 6 signals exercised at v1.3 milestone UAT walkthrough (consolidated with Phase 32 + 45 + 46 + 48 deferred HITL gates).

## Pre-flight verification (operator may skip Task 1 at re-attempt)

| Check | Result | Evidence |
|-------|--------|----------|
| Per-Fn Deno tests (within plans 47-06/07/08/09 executors) | PASS at executor time | 51/51 mux tests + Fn-specific tests green during plan dispatch |
| Cross-Fn Deno sweep (at close-out) | **18 RED scaffolds remain** | 47-05 TODO stubs intentionally deferred to operator-time per 47-05 + 47-08 SUMMARYs; GREEN after deploy + db push |
| tsc clean | **exit 0** | `cd leanshot && npx tsc -p tsconfig.app.json --noEmit` |
| 10 migrations present + valid 14-digit regex | **PASS** | `ls supabase/migrations/20270801*_p47_*.sql \| wc -l` = 10 |

## Known residuals / accepted

- **18 RED Deno scaffolds** — intentional per 47-05 plan body (Wave 0 ships scaffolds, Wave 1+ plans replace bodies, but the cross-Fn integration scaffolds in `supabase/functions/__tests__/` + `tests/integration/` + `tests/rls/` need live db + staging to GREEN). Documented per-test-file in 47-05 SUMMARY.
- **EmailTemplate union widening** (event_reminder_1d, event_reminder_1h, event_promotion) — 47-08 cast via `as EmailTemplate`; runtime falls through email-router default arm. PHI routing remains correct. Add template modules at 47-12 close-out OR future cleanup.
- **`@sentry/capacitor` sibling check** — `--ignore-scripts` workaround used in worktree executors per memory.
- **`leanshot/vitest.config.ts` projects-config drift** — under Vitest 4.x, projects block masks default test config.

## Re-attempt close-out (operator)

When ready:
1. Set 3 NEW Zoom S2S Function Secrets (+ verify Phase 44 Mux secrets present).
2. Deploy 5 Edge Fns in order: mux-webhook FIRST (PAIR), mux-create-upload SECOND (PAIR), event-reminders-fanout (cron precursor), zoom-create-meeting, event-join-url.
3. `supabase db push --linked` (10 migrations transactional per file).
4. Re-run Deno sweep — 18 RED scaffolds should flip GREEN against linked staging.
5. Walk 6 HUMAN-UAT signals per Plan 47-12 Task 3 script.
6. Flip CARRY-OVER status → "complete (UAT validated)" if all signals pass.
