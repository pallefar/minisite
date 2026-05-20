-- Phase 38 Plan 01 — weekly_digest_sends audit table.
--
-- Stores every weekly digest send attempt (sent/failed/skipped) for replay,
-- audit, and dedup (6h window enforced by cron caller in Plan 38-09).
--
-- Threat T-38-05: Repudiation — append-only with PRIMARY KEY (id); index on
-- (user_id, sent_at DESC) for the dedup check.
--
-- Status enum (memory `feedback_planner_missed_status_enum_widening` — widening
-- shipped in originating migration to avoid 23514 in prod):
--   pending_review, sent, failed, skipped_redflag, skipped_optout

create table if not exists public.weekly_digest_sends (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references auth.users(id) on delete cascade,
  org_id             uuid,
  sent_at            timestamptz not null default now(),
  narrative          text not null,
  actions_jsonb      jsonb not null default '[]'::jsonb,
  status             text not null check (status in ('pending_review','sent','failed','skipped_redflag','skipped_optout')),
  model_id           text not null,
  prompt_cache_hit   boolean not null default false
);

comment on table public.weekly_digest_sends is
  'Phase 38 — weekly digest audit log. Append-only. 6h dedup window enforced by cron caller.';

alter table public.weekly_digest_sends enable row level security;

-- ----------------------------------------------------------------------------
-- RLS policies — user SELECT own; super-admin SELECT all; service_role bypass.
-- ----------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'weekly_digest_sends' and policyname = 'wds_select_own') then
    create policy wds_select_own on public.weekly_digest_sends
      for select
      to authenticated
      using (user_id = auth.uid());
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'weekly_digest_sends' and policyname = 'wds_super_admin_select') then
    create policy wds_super_admin_select on public.weekly_digest_sends
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

create index if not exists weekly_digest_sends_user_sent_idx
  on public.weekly_digest_sends (user_id, sent_at desc);

create index if not exists weekly_digest_sends_status_idx
  on public.weekly_digest_sends (status, sent_at desc);
