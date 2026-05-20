-- Phase 38 Plan 01 — ai_suggestion_review HITL queue (RECOMMEND-07, D-12/13/14).
--
-- Human-in-the-loop review queue for AI recommendations + digests + win-back
-- copy. Super-admin only — clinic-admins do NOT have access to this table
-- (D-14 enforces super-admin gate; clinic-admin gets a separate read-only view
-- in a later phase).
--
-- Threat T-38-04 (Elevation of Privilege): mitigated by RLS using profiles.is_staff
-- check (no `app.is_super_admin()` helper exists yet on this project — verified
-- 2026-05-20 grep). Service_role bypasses RLS for the cron caller.
--
-- Status enum widening (memory `feedback_planner_missed_status_enum_widening`):
--   pending, approved, rejected, edited, auto_approved_kb

create table if not exists public.ai_suggestion_review (
  id            uuid primary key default gen_random_uuid(),
  type          text not null check (type in ('recommender','digest','win_back')),
  user_id       uuid references auth.users(id) on delete cascade,
  org_id        uuid,
  payload       jsonb not null,
  source_type   text,
  action_id     text,
  status        text not null default 'pending'
    check (status in ('pending','approved','rejected','edited','auto_approved_kb')),
  decided_by    uuid references auth.users(id),
  decided_at    timestamptz,
  decision_note text,
  created_at    timestamptz not null default now()
);

comment on table public.ai_suggestion_review is
  'Phase 38 — HITL queue for AI outputs (RECOMMEND-07). Super-admin only per D-14.';

alter table public.ai_suggestion_review enable row level security;

-- ----------------------------------------------------------------------------
-- RLS — super-admin (is_staff = true) ONLY. Service_role bypasses RLS.
-- Absence of clinic-admin policy is intentional (D-14).
-- ----------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'ai_suggestion_review' and policyname = 'asr_super_admin_all') then
    create policy asr_super_admin_all on public.ai_suggestion_review
      for all
      to authenticated
      using (
        exists (
          select 1 from public.profiles p
          where p.id = auth.uid() and p.is_staff = true
        )
      )
      with check (
        exists (
          select 1 from public.profiles p
          where p.id = auth.uid() and p.is_staff = true
        )
      );
  end if;
end $$;

create index if not exists ai_suggestion_review_status_idx
  on public.ai_suggestion_review (status, created_at);

create index if not exists ai_suggestion_review_type_status_idx
  on public.ai_suggestion_review (type, status, created_at desc);
