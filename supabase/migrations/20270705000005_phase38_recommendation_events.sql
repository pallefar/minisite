-- Phase 38 Plan 01 — recommendation_events audit table (RECOMMEND-06).
--
-- Append-only event log of recommendations shown to a user, plus click/dismiss
-- engagement signals. Drives MMR de-dup (Plan 38-02) + dashboard analytics.
--
-- RLS: user reads own rows; service_role bypass; super-admin reads all.
-- action_id column is free text here; whitelist enforcement is in app layer
-- (Zod schema in Plan 38-02) — keeps the DB schema flexible for new action types.

create table if not exists public.recommendation_events (
  id                 uuid primary key default gen_random_uuid(),
  recommendation_id  uuid not null,
  user_id            uuid not null references auth.users(id) on delete cascade,
  org_id             uuid,
  source_type        text not null,
  source_id          uuid not null,
  action_id          text,
  surface_target     text[] not null,
  score              float not null,
  shown_at           timestamptz not null default now(),
  clicked_at         timestamptz,
  dismissed_at       timestamptz,
  expires_at         timestamptz not null
);

comment on table public.recommendation_events is
  'Phase 38 — recommendation audit log (RECOMMEND-06). Append-only; drives MMR de-dup + engagement metrics.';

alter table public.recommendation_events enable row level security;

-- ----------------------------------------------------------------------------
-- RLS policies
-- ----------------------------------------------------------------------------
do $$
begin
  -- User reads their own rows.
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'recommendation_events' and policyname = 'rec_events_select_own') then
    create policy rec_events_select_own on public.recommendation_events
      for select
      to authenticated
      using (user_id = auth.uid());
  end if;

  -- User can insert their own rows (recommender writes via user JWT in Plan 38-02).
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'recommendation_events' and policyname = 'rec_events_insert_own') then
    create policy rec_events_insert_own on public.recommendation_events
      for insert
      to authenticated
      with check (user_id = auth.uid());
  end if;

  -- User can update clicked_at/dismissed_at on their own rows.
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'recommendation_events' and policyname = 'rec_events_update_own') then
    create policy rec_events_update_own on public.recommendation_events
      for update
      to authenticated
      using (user_id = auth.uid())
      with check (user_id = auth.uid());
  end if;

  -- Super-admin (staff) reads all rows.
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'recommendation_events' and policyname = 'rec_events_super_admin_select') then
    create policy rec_events_super_admin_select on public.recommendation_events
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

-- ----------------------------------------------------------------------------
-- Indexes
-- ----------------------------------------------------------------------------
create index if not exists recommendation_events_user_shown_idx
  on public.recommendation_events (user_id, shown_at desc);

create index if not exists recommendation_events_recommendation_idx
  on public.recommendation_events (recommendation_id);

create index if not exists recommendation_events_expires_idx
  on public.recommendation_events (expires_at)
  where dismissed_at is null and clicked_at is null;
