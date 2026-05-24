---
phase: 47-m4-events-calendar-zoom-reminders-recording
plan: 04
subsystem: events-infrastructure
tags: [storage, rls, notifications, check-constraint, migration]
dependency-graph:
  requires:
    - public.is_staff() helper (supabase/migrations/20261101000006_is_staff_helper.sql)
    - public.profiles (id PK)
    - notification_settings (PK user_id+category) + 3 sibling tables w/ category_chk
    - notification_category_config (PK category)
    - Phase 45 9-category widening (20270727000004_p45_notification_widening.sql)
  provides:
    - event-covers Supabase Storage bucket (public; 2MB; jpeg/png/webp)
    - 4 storage.objects RLS policies scoped to event-covers
    - 12-category CHECK constraint snapshot on 4 notification tables
    - 3 notification_category_config rows (event_reminders_1d/1h, event_promotion)
    - per-user backfill notification_settings rows (defaults ON)
  affects:
    - Phase 47 later plans: event cover upload Fn (writes to event-covers), event-reminders-fanout Fn (writes to user_notifications under new categories)
    - Phase 48 widening at 20270901000012 will additively widen its own snapshot (no collision)
tech-stack:
  added: []
  patterns:
    - FORK Phase 44 community-media bucket → public + smaller cap + staff gate
    - FORK Phase 45 notification widening → underscored categories + per-user backfill
    - INSERT … ON CONFLICT DO NOTHING (idempotent backfill)
    - UPSERT category_config (idempotent re-apply)
    - single-txn drop+add CHECK on N tables (Phase 44/45 lesson)
key-files:
  created:
    - supabase/migrations/20270801000005_p47_event_covers_bucket.sql
    - supabase/migrations/20270801000006_p47_notification_event.sql
  modified: []
decisions:
  - D-16: event-covers bucket is public=true (covers render on unauth landing); 2MB cap; jpeg/png/webp only — svg explicitly excluded for T-47-16 (XSS via inline scripts)
  - D-19: 3 new categories use underscored naming (event_reminders_1d, event_reminders_1h, event_promotion) per spec; Phase 44/45 community-* used hyphens — CHECK doesn't care
  - Per-user backfill defaults all 3 categories ON for existing users; admins can opt out post-hoc
  - Channel defaults per category: 1d=push+email+in_app, 1h=push+in_app (no email — same opt-in churn), promotion=email+in_app (no push — no promo push spam)
  - Single transaction widens all 4 notification CHECK tables together (T-47-17 mitigation: no visible state has inconsistent enum)
metrics:
  duration: ~12 min
  completed: 2026-05-24
---

# Phase 47 Plan 04: Storage Bucket + Notification CHECK Widening Summary

Two infrastructure migrations: (1) `event-covers` Supabase Storage bucket with admin-only writes and public read (D-16); (2) 4-table notification CHECK constraint widening with 3 new event categories, config seed, and per-user backfill (D-19).

## Outcomes

**Task 1 — event-covers bucket** (`20270801000005_p47_event_covers_bucket.sql`, commit `aa737ff6`)
- Bucket inserted: `id='event-covers'`, `public=true`, `file_size_limit=2097152` (2 MB), `allowed_mime_types={image/jpeg, image/png, image/webp}` — svg explicitly excluded for T-47-16.
- 4 RLS policies on `storage.objects` scoped to this bucket:
  - `event_covers_public_read` — SELECT for `authenticated, anon` (covers render on unauthenticated landing).
  - `event_covers_admin_insert` — INSERT for `authenticated` with `public.is_staff()` check (T-47-15 admin-only upload).
  - `event_covers_admin_update` — UPDATE for `authenticated` with `public.is_staff()` (replace-in-place).
  - `event_covers_admin_delete` — DELETE for `authenticated` with `public.is_staff()`.
- All policies wrapped in `do $$ if not exists … $$` guards for idempotency (Phase 44 pattern).
- Bucket insert uses `ON CONFLICT (id) DO NOTHING`.
- Entire migration wrapped in `begin; … commit;`.

**Task 2 — notification CHECK widening** (`20270801000006_p47_notification_event.sql`, commit `f678e0d0`)
- 4 tables widened in ONE transaction: `notification_settings`, `notification_category_config`, `user_notifications`, `notification_dismissal_state`.
- Each `drop constraint if exists … add constraint …` with full enumeration of the prior 9-category Phase 45 set plus 3 new event categories: `event_reminders_1d`, `event_reminders_1h`, `event_promotion`.
- 3 `notification_category_config` rows seeded via UPSERT:
  - `event_reminders_1d`: daily_cap=5, push+email+in_app all true.
  - `event_reminders_1h`: daily_cap=5, push+in_app true, email false.
  - `event_promotion`: daily_cap=2, email+in_app true, push false.
- Per-user backfill: `INSERT INTO notification_settings (user_id, category, in_app, email) SELECT p.id, c.category, true, true FROM profiles p CROSS JOIN VALUES(…) ON CONFLICT (user_id, category) DO NOTHING` — defaults ON for every existing user, idempotent on re-apply.
- Entire migration wrapped in `begin; … commit;`.

## Acceptance Criteria — all passing

| Gate | File | Required | Actual |
|------|------|----------|--------|
| `'event-covers'` literal present | bucket | ≥1 | 7 |
| `2097152` (2 MB cap) exactly once | bucket | =1 | 1 |
| `public.is_staff()` references | bucket | ≥3 | 4 |
| `staff_users` references | bucket | =0 | 0 |
| `event_reminders_1d` mentions | notif | ≥3 | 6 |
| `event_reminders_1h` mentions | notif | ≥3 | 6 |
| `event_promotion` mentions | notif | ≥3 | 6 |
| `drop constraint if exists` lines | notif | ≥4 | 4 |
| `begin;` / `commit;` wrap | both | yes | yes (lines 32→120, 51→137) |
| Filename regex `^[0-9]{14}_.+\.sql$` | both | yes | both PASS |

## Deviations from Plan

None — plan executed exactly as written. The plan's `<action>` blocks proposed `for select to authenticated, anon`, `for insert to authenticated` etc., and that is what shipped. Per-user backfill uses `CROSS JOIN VALUES(…)` (semantically equivalent to the plan's comma-cross-product but with explicit JOIN syntax for clarity).

One minor note: the plan's grep gate for `'event-covers'` mention count is ≥1; the file ends up with 7 because each policy + bucket-insert references the bucket id. Far exceeds the floor.

## Threat Surface Coverage

| Threat | Mitigation Shipped |
|--------|---------------------|
| T-47-15 (non-admin uploads cover) | INSERT policy gated on `public.is_staff()`; non-admins rejected before object lands. |
| T-47-16 (svg with embedded JS) | `allowed_mime_types` whitelist enumerates jpeg/png/webp only; svg cannot be uploaded. |
| T-47-17 (category enum drift between 4 tables) | All 4 CHECK constraints dropped+added in ONE `begin; … commit;` — no observable state with inconsistent enum. |

## Operational Notes (for phase close-out)

- These migrations are NOT pushed by this plan. The phase close-out plan (47-NN) must `cd /Users/karstenhaldan/minisite && supabase db push --linked` to apply, OR be staged onto a Wave that owns push.
- Once pushed, validate live with:
  - `select id, public, file_size_limit, allowed_mime_types from storage.buckets where id='event-covers';`
  - `select pg_get_constraintdef(oid) from pg_constraint where conname like '%_category_chk';` — should show 12 categories.
  - `select count(*) from notification_settings where category like 'event_%';` — should equal `profiles_count * 3`.
- No back-dated-migration risk: timestamps `20270801000005` / `000006` are after Phase 45 (`20270727…`) and before Phase 48 (`20270901…`) — order is monotonic.

## Commits

| Hash | Subject |
|------|---------|
| `aa737ff6` | feat(47-04): event-covers Storage bucket + admin RLS (D-16) |
| `f678e0d0` | feat(47-04): widen notification CHECK with 3 event categories + seed + backfill (D-19) |

## Self-Check: PASSED

- `supabase/migrations/20270801000005_p47_event_covers_bucket.sql` — FOUND
- `supabase/migrations/20270801000006_p47_notification_event.sql` — FOUND
- Commit `aa737ff6` — FOUND in `git log`
- Commit `f678e0d0` — FOUND in `git log`
- All 10 acceptance gates — PASS
- No `staff_users` references in either file — PASS
- Both files start with `begin;` and end with `commit;` — PASS
