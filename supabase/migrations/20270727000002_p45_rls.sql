-- Phase 45 Plan 01 — RLS policies for new community/DM tables + directory two-mode.
--
-- Policies created (8 total):
--   1. directory_members_select          on profiles            (D-02 two-mode visibility)
--   2. dm_threads_select_participant     on dm_threads          (participant-only read)
--   3. dm_threads_insert_not_blocked     on dm_threads          (D-10 symmetric block + dm_open)
--   4. direct_messages_select_participant on direct_messages    (JOIN dm_threads)
--   5. direct_messages_insert_participant on direct_messages    (sender=auth.uid() + JOIN)
--   6. dm_thread_audit_select_staff      on dm_thread_audit     (public.is_staff() only)
--   7. user_block_list_owner_all         on user_block_list     (FOR ALL — blocker=auth.uid())
--   8. community_reports_insert_self     on community_reports   (reporter_user_id=auth.uid())
--   9. community_reports_select_staff    on community_reports   (public.is_staff() only)
--
-- Per memory reference_supabase_is_staff_helper:
--   public.is_staff() is the canonical SECDEF stable helper; reads profiles.is_staff
--   directly. It is the single source of truth for staff RLS gating.
--
-- Per memory feedback_negation_grep_defeated_by_comment_string:
--   Rejected alternatives are intentionally NOT named in this file.
--
-- Idempotency: each policy wrapped in DO $$ if not exists pg_policies $$ guard
-- (matches Phase 44 community RLS analog pattern).

begin;

-- ============================================================
-- Enable RLS on all new/extended objects
-- ============================================================

alter table public.dm_threads        enable row level security;
alter table public.direct_messages   enable row level security;
alter table public.dm_thread_audit   enable row level security;
alter table public.user_block_list   enable row level security;
alter table public.community_reports enable row level security;
-- profiles already has RLS enabled (Phase 27+); we add one new policy.

-- ============================================================
-- 1. profiles.directory_members_select — D-02 two-mode directory visibility
-- ============================================================
-- Consumer (no org_members rows) → community-wide directory.
-- Clinic-org member → only sees same-org rows.
-- Both modes require directory_opt_in = true (privacy-default).

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'profiles'
      and policyname = 'directory_members_select'
  ) then
    create policy directory_members_select
      on public.profiles
      for select to authenticated
      using (
        directory_opt_in = true
        and (
          -- Consumer mode: target is NOT a clinic-org member → visible community-wide
          not exists (
            select 1 from public.org_members om
            where om.user_id = profiles.id
          )
          or
          -- Clinic mode: target IS an org_members member; caller must share an org
          exists (
            select 1 from public.org_members om
            where om.user_id = profiles.id
              and om.org_id in (
                select org_id from public.org_members
                where user_id = auth.uid()
              )
          )
        )
      );
  end if;
end $$;

comment on policy directory_members_select on public.profiles is
  'P45 D-02 — two-mode directory visibility. Consumer: target not in org_members → community-wide. '
  'Clinic: target in org_members → caller must share an org via inner JOIN. Both require directory_opt_in=true.';

-- ============================================================
-- 2 + 3. dm_threads — SELECT (participant) + INSERT (symmetric block)
-- ============================================================

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'dm_threads'
      and policyname = 'dm_threads_select_participant'
  ) then
    create policy dm_threads_select_participant
      on public.dm_threads
      for select to authenticated
      using (
        creator_user_id   = auth.uid()
        or recipient_user_id = auth.uid()
      );
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'dm_threads'
      and policyname = 'dm_threads_insert_not_blocked'
  ) then
    create policy dm_threads_insert_not_blocked
      on public.dm_threads
      for insert to authenticated
      with check (
        creator_user_id = auth.uid()
        and exists (
          select 1 from public.profiles
          where id = recipient_user_id and dm_open = true
        )
        and not exists (
          select 1 from public.user_block_list
          where blocker_user_id = recipient_user_id
            and blocked_user_id = auth.uid()
        )
      );
  end if;
end $$;

comment on policy dm_threads_insert_not_blocked on public.dm_threads is
  'P45 D-10 — symmetric block: recipient cannot have blocked caller. Plus recipient.dm_open=true '
  'and creator_user_id = auth.uid() (cannot forge sender identity).';

-- ============================================================
-- 4 + 5. direct_messages — SELECT + INSERT (participant via JOIN)
-- ============================================================

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'direct_messages'
      and policyname = 'direct_messages_select_participant'
  ) then
    create policy direct_messages_select_participant
      on public.direct_messages
      for select to authenticated
      using (
        exists (
          select 1 from public.dm_threads dt
          where dt.id = direct_messages.thread_id
            and (dt.creator_user_id = auth.uid() or dt.recipient_user_id = auth.uid())
        )
      );
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'direct_messages'
      and policyname = 'direct_messages_insert_participant'
  ) then
    create policy direct_messages_insert_participant
      on public.direct_messages
      for insert to authenticated
      with check (
        sender_user_id = auth.uid()
        and exists (
          select 1 from public.dm_threads dt
          where dt.id = direct_messages.thread_id
            and (dt.creator_user_id = auth.uid() or dt.recipient_user_id = auth.uid())
        )
      );
  end if;
end $$;

-- ============================================================
-- 6. dm_thread_audit — staff-only SELECT (no authenticated INSERT policy)
-- ============================================================
-- INSERT is service-role only — no policy for authenticated → writes blocked.
-- Bypass audit row is written by dm-create-thread Edge Fn (service-role context).

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'dm_thread_audit'
      and policyname = 'dm_thread_audit_select_staff'
  ) then
    create policy dm_thread_audit_select_staff
      on public.dm_thread_audit
      for select to authenticated
      using (public.is_staff());
  end if;
end $$;

-- ============================================================
-- 7. user_block_list — owner all (FOR ALL: SELECT/INSERT/UPDATE/DELETE)
-- ============================================================

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'user_block_list'
      and policyname = 'user_block_list_owner_all'
  ) then
    create policy user_block_list_owner_all
      on public.user_block_list
      for all to authenticated
      using      (blocker_user_id = auth.uid())
      with check (blocker_user_id = auth.uid());
  end if;
end $$;

-- ============================================================
-- 8 + 9. community_reports — write-only consumer + staff-read-via-digest (D-11)
-- ============================================================

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'community_reports'
      and policyname = 'community_reports_insert_self'
  ) then
    create policy community_reports_insert_self
      on public.community_reports
      for insert to authenticated
      with check (reporter_user_id = auth.uid());
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'community_reports'
      and policyname = 'community_reports_select_staff'
  ) then
    create policy community_reports_select_staff
      on public.community_reports
      for select to authenticated
      using (public.is_staff());
  end if;
end $$;

comment on policy community_reports_select_staff on public.community_reports is
  'P45 D-11 — staff-only read via public.is_staff(); consumers are write-only. '
  'Daily digest Edge Fn (plan 45-05) runs as service-role and bypasses RLS.';

commit;
