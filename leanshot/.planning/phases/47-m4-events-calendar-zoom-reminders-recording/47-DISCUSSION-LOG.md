# Phase 47 Discussion Log

**Session:** 2026-05-23
**Mode:** default (4 single-question turns per area, batched 2–4 per AskUserQuestion call)

## Gray areas presented

1. Schema, scoping & waitlist
2. Zoom / meeting integration
3. Reminder pipeline (cron + channels)
4. Calendar UI + recording→lesson workflow

User selected: all 4.

---

## Area 1 — Schema, scoping & waitlist

### Q1: Event ↔ community_space relationship?

**Options:**
- (a) space_id NOT NULL (always belongs to a space) — *Recommended*
- (b) Nullable space_id (standalone events allowed)
- (c) Two tables: clinic_events + community_events

**Selected:** (a). RLS + tier-gating + org-scoping all inherited from Phase 44 community_spaces without duplication. Locked as D-01.

### Q2: Capacity enforcement mechanic?

**Options:**
- (a) SECDEF RPC rsvp_create() with SELECT FOR UPDATE on the events row — *Recommended*
- (b) BEFORE INSERT trigger on event_rsvps
- (c) Optimistic INSERT + post-hoc count check

**Selected:** (a). Mirrors Phase 35 freeze-token + Phase 44 reaction RPC. Race-safe atomic count. Locked as D-02.

### Q3: Waitlist auto-promote when an attendee cancels?

**Options:**
- (a) AFTER UPDATE/DELETE trigger on event_rsvps (synchronous) — *Recommended*
- (b) Per-minute pg_cron sweep
- (c) Admin manual approve queue

**Selected:** (a). Instant promotion + FIFO via waitlist_position. Locked as D-03.

### Q4: PHI marker for SES vs Resend routing on event reminders?

**Options:**
- (a) Derive from space.org_id IS NOT NULL — *Recommended*
- (b) Explicit is_phi boolean on events row

**Selected:** (a). Reuses Phase 25 D-03 cleanly; no new column. Locked as D-04.

---

## Area 2 — Zoom / meeting integration

### Q1: Zoom integration depth?

**Options:**
- (a) Both paste-link AND Zoom OAuth auto-generate — *Recommended* (matches success criterion #3)
- (b) Paste-link only v1; OAuth deferred to v2

**Selected:** (a). Spec-locked at ROADMAP level. Locked as D-06.

### Q2: Zoom OAuth account model?

**Options:**
- (a) Platform-shared Zoom account (one LeanShot Zoom user) — *Recommended*
- (b) Per-admin OAuth
- (c) Per-org OAuth

**Selected:** (a). Simplest auth flow; single S2S OAuth token in vault. Per-admin / per-org deferred. Locked as D-07.

### Q3: Google Meet parity?

**Options:**
- (a) Zoom only v1; paste-link covers other providers — *Recommended*
- (b) Add Google Meet OAuth integration too

**Selected:** (a). REQUIREMENTS EVENT-03 satisfied: Zoom OAuth + Meet via paste-link. Locked as D-08.

### Q4: Meeting deep-link visibility?

**Options:**
- (a) Edge Fn 'event-join-url' that checks RSVP status before returning URL — *Recommended*
- (b) Column-level RLS on events.join_url
- (c) Just store URL + frontend conditionally renders (leaky)

**Selected:** (a). Mirrors mux-sign-playback shape. Locked as D-09.

---

## Area 3 — Reminder pipeline

### Q1: Reminder cron architecture?

**Options:**
- (a) Hourly pg_cron + per-user-TZ fan-out Edge Fn (mirror Phase 38 weekly-digest) — *Recommended*
- (b) Per-event scheduled rows + cron sweep dispatches
- (c) Per-user-TZ resolved at event create-time into a queue table

**Selected:** (a). Mirrors Phase 38 verbatim; single fan-out path; idempotent via UNIQUE. Locked as D-10.

### Q2: Reminder channels?

**Options:**
- (a) Email only v1 (Resend / SES per Phase 25)
- (b) Email + web-push (Phase 42 push_subscriptions) — *Recommended*
- (c) Email + web-push + in-app banner

**Selected:** (a) — **deliberate scope trim against recommendation**. Locked as D-11; web-push + in-app banner moved to Deferred Ideas.

### Q3: Reminder send-time tolerance + dedup?

**Options:**
- (a) 1h granularity + UNIQUE(event_id, user_id, kind) — *Recommended*
- (b) 15-min cron for tighter window

**Selected:** (a). Locked as D-12.

---

## Area 4 — Calendar UI + recording→lesson workflow

### Q1: Calendar surface?

**Options:**
- (a) New top-level TabId 'events' (parallel to classroom) — *Recommended*
- (b) Sub-view under 'community' tab
- (c) Per-space drill-in only

**Selected:** (a). Locked as D-13.

### Q2: Calendar layout + library?

**Options:**
- (a) List-only chronological — *Recommended*
- (b) Month-grid + list via @schedule-x/react
- (c) Month-grid + list via FullCalendar / react-big-calendar

**Selected:** (a). No new calendar lib; bundle-budget protected. Month-grid deferred. Locked as D-14.

### Q3: Recording → lesson attachment workflow?

**Options:**
- (a) Admin pre-configures target at event creation; auto-attach on Mux ready — *Recommended*
- (b) Post-event manual pick
- (c) Auto-attach to a 'Recordings' bucket course

**Selected:** (a). `events.attach_to_module_id` + mux-webhook branch on `kind='event-recording'`. Locked as D-15.

### Q4: Recurring events + iCal export + Zoom Cloud auto-pull?

**Options:**
- (a) All three OUT of scope (defer to v2) — *Recommended*
- (b) Add .ics download; defer recurring + auto-pull
- (c) Include Zoom Cloud Recording auto-pull

**Selected:** (a). All three documented in Deferred Ideas.

---

## Decisions captured

- 16 implementation decisions (D-01..D-16) — 15 followed recommendations; 1 deliberate scope trim (D-11 email-only reminders).
- Carried-forward locks (no re-ask): Phase 25 D-03 PHI email routing; Phase 38 cron + profiles.timezone; Phase 43 tier_effective; Phase 44 community_spaces + Mux pipeline; Phase 46 course_lessons attachment target.
- Out of scope: recurring events, iCal export, Zoom Cloud auto-pull, web-push reminders, in-app banner, Google Meet / Teams OAuth, per-admin / per-org Zoom OAuth, multi-host, polls/Q&A, month-grid, native push, standalone events.

## Deferred ideas surfaced

(See `47-CONTEXT.md` `<deferred>` block — 14 items documented for future-phase backlog.)
