-- Phase 47 Plan 01 — Events schema: events table + indexes + CHECK constraints + updated_at trigger.
--
-- Decisions implemented:
--   D-01: events.space_id NOT NULL FK to community_spaces (tier-gate + org-isolation inherited)
--   D-15: attach_to_module_id FK to course_modules(id) — Phase 46 dependency; recording_mux_asset_id
--         + recording_playback_id columns when attach_to_module_id is NULL (post-event recording)
--   D-16: cover_url column for event card hero image
--   D-18: column-level allowlist (defined in RLS migration 20270801000002) hides join_url +
--         zoom_meeting_id from direct client SELECT; only event_get_join_url SECDEF RPC (47-03)
--         can return them after rsvp_status='going' + 15-min pre-window check.
--
-- Sequencing: Phase 46 migrations land at 20270725*; Phase 47 uses 20270801* so the FK to
-- public.course_modules(id) resolves at apply time. Phase 47 EXECUTE cannot start until
-- Phase 46 EXECUTE merges (sequencing constraint, not a plan-time blocker).
--
-- Anti-patterns avoided (per Phase 28 + Phase 44 conventions):
--   - No tautological-bypass predicates
--   - No GUC-based predicates (RLS lives in 20270801000002)
--   - Explicit per-table CHECK constraints (events_time_chk for end_at > start_at)
--   - No reference to rejected alternative names (per memory feedback_negation_grep_defeated_by_comment_string)

begin;

-- ============================================================
-- events — One event per row, lives in a community space (D-01)
-- ============================================================
create table if not exists public.events (
  id                       uuid        primary key default gen_random_uuid(),
  -- D-01: NOT NULL FK to community_spaces; on-delete-cascade so deleting a space
  -- removes its events. Tier-gate + org-isolation inherited via RLS JOIN.
  space_id                 uuid        not null references public.community_spaces(id) on delete cascade,
  title                    text        not null,
  description              text,
  start_at                 timestamptz not null,
  end_at                   timestamptz not null,
  -- 0 = unlimited capacity (no cap); positive integer enforces a hard cap at RSVP time.
  capacity                 integer     not null default 0,
  -- D-18: join_url + zoom_meeting_id are NOT in the column-level allowlist (see RLS migration).
  -- Clients can NEVER SELECT these directly — only event_get_join_url SECDEF RPC (47-03) returns them.
  join_url                 text,
  zoom_meeting_id          text,
  zoom_managed             boolean     not null default false,
  -- D-15: Phase 46 dependency — FK to course_modules(id); when set, the event recording
  -- gets converted to a lesson under this module. Sequencing means Phase 46 must apply first.
  attach_to_module_id      uuid        references public.course_modules(id),
  -- D-16: cover image for event card; stored as a path or URL.
  cover_url                text,
  -- D-15: when attach_to_module_id IS NULL, recording lives on the event row itself as
  -- a standalone Mux asset (no lesson conversion).
  recording_mux_asset_id   text,
  recording_playback_id    text,
  created_by               uuid        not null references auth.users(id),
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  -- end_at strictly after start_at — zero-length events are rejected.
  constraint events_time_chk check (end_at > start_at)
);

comment on table  public.events                          is 'P47 D-01: Events live in a community space; visibility + tier-gate inherited from space.';
comment on column public.events.space_id                 is 'P47 D-01: parent space; tier-gate + org-isolation inherited via RLS JOIN to community_spaces.';
comment on column public.events.join_url                 is 'P47 D-18: hidden from direct client SELECT (column allowlist); only event_get_join_url RPC returns this after rsvp_status=going + 15-min pre-window.';
comment on column public.events.zoom_meeting_id          is 'P47 D-18: hidden from direct client SELECT (same as join_url).';
comment on column public.events.attach_to_module_id      is 'P47 D-15: optional FK to course_modules(id); when set, recording converts to a lesson under this module.';
comment on column public.events.cover_url                is 'P47 D-16: event card hero image path/URL.';
comment on column public.events.recording_mux_asset_id   is 'P47 D-15: standalone Mux asset id when attach_to_module_id is NULL (no lesson conversion).';
comment on column public.events.recording_playback_id    is 'P47 D-15: Mux playback id for the recording (standalone case).';

-- ============================================================
-- Indexes
-- ============================================================

-- Mirrors Phase 44 community_posts_space_created_idx shape: cursor-paginated per-space event list.
create index if not exists events_space_start_idx
  on public.events (space_id, start_at);

-- Fan-out cron reads this index to find events starting within the next N minutes
-- (T-15min reminder window, T-1h reminder window, etc.). Plain (start_at) for range scans.
create index if not exists events_start_idx
  on public.events (start_at);

-- ============================================================
-- updated_at trigger
-- ============================================================
-- No project-wide set_updated_at() helper exists (verified via grep); inline per-table
-- function + trigger following the Phase 31 cohort_definitions pattern.

create or replace function public.events_updated_at()
returns trigger
language plpgsql
security definer
set search_path = public, extensions, pg_catalog
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

comment on function public.events_updated_at() is 'P47 D-01: BEFORE UPDATE trigger body that stamps events.updated_at = now().';

drop trigger if exists events_set_updated_at on public.events;
create trigger events_set_updated_at
  before update on public.events
  for each row
  execute function public.events_updated_at();

commit;
