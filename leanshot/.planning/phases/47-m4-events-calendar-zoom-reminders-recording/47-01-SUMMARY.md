---
phase: 47-m4-events-calendar-zoom-reminders-recording
plan: 01
subsystem: community / events / schema-rls
tags: [supabase, migration, rls, events, community-spaces, tier-gate, column-allowlist, d-01, d-15, d-16, d-18]
requires:
  - community_spaces table (Phase 44 — 20270720000001_p44_community_schema.sql)
  - tier_effective view (Phase 43 — 20270715000002_p43_tier_effective_view_v2.sql)
  - org_members table (Phase 28)
  - course_modules table (Phase 46 — 20270725000001_p46_course_schema.sql) [sequencing: apply Phase 46 BEFORE Phase 47]
  - public.is_staff() helper (Phase 15 — 20261101000006_is_staff_helper.sql)
provides:
  - public.events table (16 columns; D-01/D-15/D-16)
  - public.events_updated_at() trigger function
  - RLS policies: event_select_via_space, event_insert_staff, event_update_staff, event_delete_staff
  - Column allowlist gating join_url + zoom_meeting_id off direct SELECT
affects:
  - Foundation row for Wave 0 plans 47-02 (RSVPs), 47-03 (SECDEF event_get_join_url RPC), 47-04 (event_attendees), 47-05 (RLS test scaffolds)
  - Wave 1+ plans that FK into events.id
tech-stack:
  added: []
  patterns: [supabase-rls-inherit-via-join, column-grant-allowlist-secret-hiding, secdef-staff-only-write, tier-effective-tier-gate]
key-files:
  created:
    - supabase/migrations/20270801000001_p47_events_schema.sql
    - supabase/migrations/20270801000002_p47_events_rls.sql
  modified: []
decisions:
  - "D-01 implemented: events.space_id NOT NULL FK to community_spaces ON DELETE CASCADE; tier-gate + org-isolation inherited via RLS JOIN — no new tier-check code."
  - "D-15 implemented: attach_to_module_id uuid REFERENCES public.course_modules(id) (Phase 46 schema; FK resolves at apply time given 20270801* sequencing) + recording_mux_asset_id + recording_playback_id for standalone (no-lesson) recordings."
  - "D-16 implemented: cover_url text column for event-card hero image."
  - "D-18 implemented: column-level allowlist (REVOKE SELECT then GRANT SELECT on 15-column allowlist) hides join_url + zoom_meeting_id from direct client SELECT; only event_get_join_url SECDEF RPC (47-03) returns them after rsvp_status='going' + 15-min pre-window."
  - "Inlined tier-gate predicate (Phase 44 cpost_select_tier shape) — Phase 44 SECDEF migration does NOT ship can_see_community_space helper (verified via grep). Trial users get pro-level access matching Phase 44 convention."
  - "Inlined per-table events_updated_at() SECDEF trigger function (search_path = public, extensions, pg_catalog per memory reference_supabase_migration_gotchas) — no project-wide set_updated_at() helper exists (verified via grep)."
  - "Filename slug uses underscores; 14-digit timestamp 20270801000001/000002 strict per memory reference_supabase_migration_filename_regex; lands chronologically AFTER all of Phase 44 (20270720*), Phase 46 (20270725*), Phase 45 (20270727*) and BEFORE Phase 48 (20270901*)."
metrics:
  duration_minutes: 8
  tasks_completed: 2
  files_created: 2
  files_modified: 0
  lines_added: 241
  commits: 2
completed: 2026-05-24
---

# Phase 47 Plan 01: Events Table Schema + RLS Policies (D-01) Summary

**One-liner:** Ships the `public.events` foundation table (FK to community_spaces + course_modules) with RLS that inherits Phase 44 space visibility and column-level allowlist hiding `join_url` + `zoom_meeting_id` from direct client SELECT.

## What Was Built

### Task 1 — `public.events` schema + indexes + updated_at trigger

**File:** `supabase/migrations/20270801000001_p47_events_schema.sql` (107 lines)
**Commit:** `f2be4ad3`

- 16-column `public.events` table per D-01/D-15/D-16:
  - Identity: `id uuid pk default gen_random_uuid()`, `created_by uuid not null references auth.users(id)`, `created_at`, `updated_at`
  - Parent: `space_id uuid not null references public.community_spaces(id) on delete cascade`
  - Content: `title text not null`, `description text`, `start_at timestamptz not null`, `end_at timestamptz not null`, `capacity integer not null default 0` (0 = unlimited)
  - Secret URLs (hidden by column allowlist in RLS migration): `join_url text`, `zoom_meeting_id text`, `zoom_managed boolean not null default false`
  - Lesson-conversion FK (D-15): `attach_to_module_id uuid references public.course_modules(id)` — FK resolves at apply time given 20270801* lands after Phase 46 (20270725*)
  - Recording (D-15 standalone branch when no module attached): `recording_mux_asset_id text`, `recording_playback_id text`
  - Hero image (D-16): `cover_url text`
- `constraint events_time_chk check (end_at > start_at)` — rejects zero-length / inverted events
- Indexes: `events_space_start_idx (space_id, start_at)` mirrors Phase 44 community_posts_space_created_idx shape; `events_start_idx (start_at)` for the fan-out cron's "next-N-min" scan
- `events_updated_at()` SECDEF trigger function (`search_path = public, extensions, pg_catalog`) + `before update on public.events` trigger — inline because no project-wide `set_updated_at()` helper exists (verified via grep)
- Comment strings on table + every sensitive column referencing D-01/D-15/D-16/D-18

### Task 2 — Events RLS policies + column-level allowlist (D-01/D-18)

**File:** `supabase/migrations/20270801000002_p47_events_rls.sql` (134 lines)
**Commit:** `abf679f8`

- `alter table public.events enable row level security`
- **`event_select_via_space`** — caller can SELECT an event iff the parent community_spaces row passes visibility:
  - Global space (`cs.org_id is null`) → tier-gate via `tier_effective` (free / pro+trial+lifetime / lifetime), matching Phase 44 `cpost_select_tier` shape
  - Org-private space (`cs.org_id is not null`) → `exists (select 1 from public.org_members om where om.org_id = cs.org_id and om.user_id = auth.uid())`
  - Trial users get pro-level access per Phase 44 convention (`te.tier_label in ('pro','lifetime','trial')`)
  - **Inlined inline because `can_see_community_space(uuid, uuid)` helper does NOT exist** in Phase 44 SECDEF migration (verified by grep across `supabase/migrations/`)
- **`event_insert_staff` / `event_update_staff` / `event_delete_staff`** — gated by `public.is_staff()`. Users RSVP via SECDEF RPC (Plan 47-03); service-role bypasses RLS for cron + Edge Fn paths
- **Column-level allowlist (D-18):**
  ```sql
  revoke select on public.events from authenticated;
  revoke select on public.events from anon;
  grant select (id, space_id, title, description, start_at, end_at, capacity,
                zoom_managed, attach_to_module_id, cover_url,
                recording_mux_asset_id, recording_playback_id,
                created_by, created_at, updated_at)
    on public.events to authenticated;
  grant select (<same 15-column allowlist>) on public.events to anon;
  grant insert, update, delete on public.events to authenticated;
  ```
  - Excluded from both grants: `join_url`, `zoom_meeting_id` (the only path to read these is the SECDEF `event_get_join_url(p_event_id)` RPC shipped in Plan 47-03, which double-checks `rsvp_status='going'` AND `now() BETWEEN start_at - INTERVAL '15 minutes' AND end_at` per D-18)
- Comment strings on every policy reference D-01/D-18 + STRIDE T-47-01..T-47-05 mitigations
- No reference to rejected alternative name `staff_users` anywhere in committed SQL (per memory `feedback_negation_grep_defeated_by_comment_string`)

## Acceptance Criteria — All Pass

| # | Gate | Expected | Actual |
|---|------|----------|--------|
| 1 | `create table if not exists public.events` count | 1 | 1 |
| 2 | `references public.community_spaces(id) on delete cascade` count | 1 | 1 |
| 3 | `references public.course_modules(id)` count | 1 | 1 |
| 4 | `constraint events_time_chk` count | 1 | 1 |
| 5 | `alter table public.events enable row level security` count | 1 | 1 |
| 6 | `revoke select on public.events from authenticated` count | 1 | 1 |
| 7 | `revoke select on public.events from anon` count | 1 | 1 |
| 8 | `recording_playback_id` mentions in RLS file | ≥2 | 2 (both grants) |
| 9 | `join_url|zoom_meeting_id` outside comments in RLS file | 0 | 0 |
| 10 | `staff_users` references in RLS file | 0 | 0 |

Filename regex strict `^[0-9]{14}_.+\.sql$` — both files PASS (no letter suffix; underscores only in slug).

## Threat Model Mitigations Shipped

| Threat ID | Component | Mitigation |
|-----------|-----------|------------|
| T-47-01 | events.join_url | Column-level `revoke select(join_url)` from authenticated + anon; only via SECDEF `event_get_join_url` RPC (47-03) with rsvp_status='going' + 15-min pre-window check |
| T-47-02 | events.zoom_meeting_id | Same column-revoke mechanism as T-47-01 |
| T-47-03 | Cross-tenant org-event probe | `event_select_via_space` RLS JOIN to `community_spaces.org_id` + `org_members` membership |
| T-47-04 | Non-staff event INSERT | `event_insert_staff` policy: `with check (public.is_staff())` |
| T-47-05 | Tier-gated event visible to free user | Inherits `community_spaces.min_tier` via inlined tier_effective predicate matching Phase 44 |

## Sequencing Notes

- **Phase 47 EXECUTE cannot start until Phase 46 EXECUTE merges** — the `attach_to_module_id uuid REFERENCES public.course_modules(id)` FK resolves at apply time. Migration files are committed in Wave 0; `supabase db push --linked` deferred to Wave 3 close-out.
- Migration timestamps land between Phase 45 (20270727*) and Phase 48 (20270901*):
  - 20270720* — Phase 44 community
  - 20270725* — Phase 46 courses (provides `course_modules`)
  - 20270727* — Phase 45 spaces extension
  - **20270801* — Phase 47 events (this plan)**
  - 20270901* — Phase 48 moderation

## Deviations from Plan

### Auto-fixed Issues

None. Plan executed exactly as written.

### Discoveries Embedded in Implementation (informational, not deviations)

1. **`can_see_community_space(uuid, uuid)` helper does not exist** in any Phase 44 SECDEF migration. Plan correctly anticipated this with the conditional ("If `can_see_community_space` helper does not exist verbatim, inline the same predicate") — predicate inlined directly using the Phase 44 `cpost_select_tier` shape. No new helper created (out of scope for 47-01).
2. **No project-wide `set_updated_at()` helper exists.** Plan said "if helper exists, otherwise inline `before update` trigger" — verified by grep across `supabase/migrations/`; inlined the per-table `events_updated_at()` function following the Phase 31 `cohort_definitions_updated_at` pattern. SECDEF + `search_path = public, extensions, pg_catalog` per memory `reference_supabase_migration_gotchas`.

## Known Stubs

None. This is a pure schema + RLS migration; no UI surface to stub.

## Authentication Gates

None hit during execution.

## Commits

| Hash | Type | Description |
|------|------|-------------|
| `f2be4ad3` | feat | events table schema + indexes + updated_at trigger |
| `abf679f8` | feat | events RLS policies + column-level allowlist (D-01/D-18) |

## Files Created

| Path | Lines |
|------|-------|
| `supabase/migrations/20270801000001_p47_events_schema.sql` | 107 |
| `supabase/migrations/20270801000002_p47_events_rls.sql` | 134 |

## Self-Check

```
[ -f supabase/migrations/20270801000001_p47_events_schema.sql ] → FOUND
[ -f supabase/migrations/20270801000002_p47_events_rls.sql ] → FOUND
git log --oneline | grep f2be4ad3 → FOUND
git log --oneline | grep abf679f8 → FOUND
all 10 acceptance-criteria greps → PASS
both filenames match ^[0-9]{14}_.*\.sql$ → PASS
```

## Self-Check: PASSED
