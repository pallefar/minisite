-- Phase 38 Plan 01 — win_back_sends table (RECOMMEND-10, D-10).
--
-- 30-day cap enforced in the winback-scorer Edge Fn (Plan 38-05), not via a
-- partial unique index — `now()` is volatile and cannot be used in an index
-- predicate. The Edge Fn uses:
--   NOT EXISTS (SELECT 1 FROM win_back_sends WHERE user_id = $1
--               AND last_sent_at > now() - interval '30 days')
-- Backed by the (user_id, last_sent_at DESC) index below.
--
-- Status enum widening (memory `feedback_planner_missed_status_enum_widening`):
--   pending_handoff, handed_off, delivered, failed

create table if not exists public.win_back_sends (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references auth.users(id) on delete cascade,
  last_sent_at       timestamptz not null default now(),
  reason             text not null default 'inactive_14d',
  save_engine_status text not null default 'pending_handoff'
    check (save_engine_status in ('pending_handoff','handed_off','delivered','failed'))
);

comment on table public.win_back_sends is
  'Phase 38 — win-back outreach log (RECOMMEND-10). 30d cap enforced in Edge Fn via (user_id, last_sent_at) index.';

alter table public.win_back_sends enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'win_back_sends' and policyname = 'wbs_select_own') then
    create policy wbs_select_own on public.win_back_sends
      for select
      to authenticated
      using (user_id = auth.uid());
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'win_back_sends' and policyname = 'wbs_super_admin_select') then
    create policy wbs_super_admin_select on public.win_back_sends
      for select
      to authenticated
      using (
        exists (
          select 1 from public.profiles p
          where p.id = auth.uid() and p.is_staff = true
        )
      );
  end if;
end $$;

create index if not exists win_back_sends_user_last_sent_idx
  on public.win_back_sends (user_id, last_sent_at desc);
