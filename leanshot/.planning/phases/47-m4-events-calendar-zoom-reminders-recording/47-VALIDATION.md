---
phase: 47
slug: m4-events-calendar-zoom-reminders-recording
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-05-23
---

# Phase 47 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Detailed test map lives in `47-RESEARCH.md` §Validation Architecture (lines 1004–1095).
> This file is the planner-consumable contract; planner must inject `<verify><automated>` blocks per task that resolve to the commands listed below.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest (TS, client + shared); Deno test (`deno test --no-check`) for Edge Fns |
| **Config file** | `leanshot/vite.config.ts` (vitest block); per-Fn `deno.json` files |
| **Quick run command** | `cd leanshot && npx vitest run --reporter=dot tests/events/ src/components/events/ src/lib/events/` |
| **Full suite command** | `cd leanshot && npm test -- --run && $HOME/.deno/bin/deno test --no-check supabase/functions/event-reminders-fanout/ supabase/functions/event-join-url/ supabase/functions/zoom-create-meeting/ supabase/functions/mux-webhook/` |
| **Estimated runtime** | ~5s quick / ~90s full |

---

## Sampling Rate

- **After every task commit:** Run quick command (Vitest events subset).
- **After every wave merge:** Run full suite + Deno sweep + per-worktree `tsc -p leanshot/tsconfig.app.json --noEmit`.
- **Before `/gsd-verify-work`:** Full suite green + bundle budget assertion (`events` chunk ≤25 kB gz).
- **Max feedback latency:** ~5s per task commit, ~90s per wave.

---

## Per-Task Verification Map

| Behavior | Req | Test Type | Automated Command | File | Wave |
|----------|-----|-----------|-------------------|------|------|
| Events RLS visibility (consumer SELECT) | EVENT-01 | RLS-DB test | `npx vitest run tests/rls/event-visibility.test.ts` | ❌ Wave 0 | 0 |
| Cross-tenant impersonation on org-scoped event | EVENT-01 | RLS-DB cross-tenant proof | `npx vitest run tests/rls/event-visibility-orgscope.test.ts` | ❌ Wave 0 | 0 |
| Tier-gated event invisible to free-tier user | EVENT-01 | RLS-DB tier-gate test | `npx vitest run tests/rls/event-visibility-tiergate.test.ts` | ❌ Wave 0 | 0 |
| `event_rsvp_create` returns 'going' under capacity | EVENT-02 | Deno unit | `deno test supabase/functions/__tests__/event_rsvp_create.test.ts --no-check` | ❌ Wave 0 | 0 |
| `event_rsvp_create` returns 'waitlist' at capacity | EVENT-02 | Deno unit | same | ❌ Wave 0 | 0 |
| 10 concurrent RSVPs at cap=5 → exactly 5 going + 5 waitlist | EVENT-02 | Postgres concurrent-txn integration | `npx vitest run tests/integration/event-rsvp-capacity-race.test.ts` | ❌ Wave 0 | 0 |
| Waitlist FIFO promotion on cancel | EVENT-02 | Trigger behavior unit | `npx vitest run tests/integration/waitlist-fifo-promotion.test.ts` | ❌ Wave 0 | 0 |
| Concurrent cancels do not double-promote (SKIP LOCKED proof) | EVENT-02 | Concurrent-txn integration | `npx vitest run tests/integration/waitlist-concurrent-cancel.test.ts` | ❌ Wave 0 | 0 |
| `event-join-url` returns URL when caller is `going` | EVENT-03 | Deno unit | `deno test supabase/functions/event-join-url/index.test.ts --no-check` | ❌ Wave 0 | 0 |
| `event-join-url` returns 403 for `maybe` / `not_going` / no-rsvp | EVENT-03 | Deno unit | same | ❌ Wave 0 | 0 |
| `event-join-url` 15-min pre-window gate (D-18) | EVENT-03 | Deno unit + frozen time | same | ❌ Wave 0 | 0 |
| `zoom-create-meeting` happy path → join_url + zoom_meeting_id | EVENT-03 | Deno unit + mock fetch | `deno test supabase/functions/zoom-create-meeting/index.test.ts --no-check` | ❌ Wave 0 | 0 |
| `zoom-create-meeting` 401-retry-with-refresh | EVENT-03 | Deno unit + mock fetch | same | ❌ Wave 0 | 0 |
| `event-reminders-fanout` 1d + 1h windowing per-TZ | EVENT-04 | Deno unit + frozen time, multi-TZ | `deno test supabase/functions/event-reminders-fanout/index.test.ts --no-check` | ❌ Wave 0 | 0 |
| Reminder dedup via UNIQUE constraint on event_reminder_sent | EVENT-04 | Integration | `npx vitest run tests/integration/reminder-dedup.test.ts` | ❌ Wave 0 | 0 |
| PHI router branch (SES for org-scoped, Resend for global) | EVENT-04 | Deno unit + email-router mock | `deno test supabase/functions/event-reminders-fanout/phi-routing.test.ts --no-check` | ❌ Wave 0 | 0 |
| Notification-settings off → no send | EVENT-04 (D-19) | Deno unit | same as above | ❌ Wave 0 | 0 |
| Promotion email queue drained next tick | EVENT-02 | Deno unit | same as above | ❌ Wave 0 | 0 |
| Mux `event-recording` branch + attach_to_module_id NOT NULL → INSERTs course_lessons | EVENT-05 | Deno unit + mock @mux | `deno test supabase/functions/mux-webhook/event-recording.test.ts --no-check` | ❌ Wave 0 | 0 |
| Mux `event-recording` branch + attach_to_module_id NULL → writes events.recording_* only | EVENT-05 | Deno unit | same | ❌ Wave 0 | 0 |
| Mux `event-recording` branch + missing event_id passthrough → log + 200 | EVENT-05 | Deno unit | same | ❌ Wave 0 | 0 |
| `events` chunk ≤25 kB gz | Bundle | CI bundle gate | `cd leanshot && npm run build && bash scripts/assert-bundle-budget.sh` | ❌ Wave 2 | 2 |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `leanshot/tests/rls/event-visibility.test.ts`
- [ ] `leanshot/tests/rls/event-visibility-orgscope.test.ts`
- [ ] `leanshot/tests/rls/event-visibility-tiergate.test.ts`
- [ ] `supabase/functions/__tests__/event_rsvp_create.test.ts`
- [ ] `leanshot/tests/integration/event-rsvp-capacity-race.test.ts`
- [ ] `leanshot/tests/integration/waitlist-fifo-promotion.test.ts`
- [ ] `leanshot/tests/integration/waitlist-concurrent-cancel.test.ts`
- [ ] `supabase/functions/event-join-url/index.test.ts`
- [ ] `supabase/functions/zoom-create-meeting/index.test.ts`
- [ ] `supabase/functions/event-reminders-fanout/index.test.ts`
- [ ] `supabase/functions/event-reminders-fanout/phi-routing.test.ts`
- [ ] `leanshot/tests/integration/reminder-dedup.test.ts`
- [ ] `supabase/functions/mux-webhook/event-recording.test.ts`
- [ ] `leanshot/scripts/assert-bundle-budget.sh` — extend with `events` chunk 25 kB gz entry (Wave 2)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Real Zoom OAuth meeting created against Zoom prod | EVENT-03 | Live API; requires real Zoom S2S app + secrets set | Wave 2 HUMAN-UAT: operator runs admin event-create, picks "Generate Zoom meeting", verifies meeting appears in Zoom admin console |
| Real Resend + SES delivery to inbox | EVENT-04 | Live email send; requires SES + Resend prod creds + BAA flag | Wave 2 HUMAN-UAT: operator RSVPs to a global event + an org-scoped event, fast-forwards reminder cron, confirms inbox routing matches `phi:boolean` |
| Mux recording end-to-end (upload → asset.ready → course_lessons row) | EVENT-05 | Mux processing latency 1-5 min | Wave 2 HUMAN-UAT: operator uploads MP4 via admin Mux uploader, waits for asset.ready, verifies new lesson appears in target module |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 90s full suite
- [ ] `nyquist_compliant: true` set in frontmatter (planner flips after Wave 0 manifest matches)

**Approval:** pending
