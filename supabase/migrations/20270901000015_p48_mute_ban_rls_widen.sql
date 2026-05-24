-- Phase 48 Plan 48-06 Task 3 — Mute + Ban RLS predicate widening (4 tables).
--
-- Implements:
--   D-08 / D-09 / T-48-05 (mute silent-suspend at SELECT): muted author SEES
--     their own content; non-author non-staff SEES zero rows.
--   D-09 / T-48-06 (ban write-deny WITH CHECK): banned + temp_suspended users
--     cannot INSERT/UPDATE/DELETE on the 4 content tables — durable backstop
--     vs residual JWT (Edge-Fn session-revoke is the primary; RLS is the
--     last line of defence per Plan 48-09).
--
-- Tables (4): community_posts, community_comments, community_reactions, direct_messages.
--   - community_posts + community_comments use author_id column for authorship.
--   - community_reactions uses user_id column.
--   - direct_messages uses sender_user_id (per Phase 45 45-01-PLAN schema —
--     5 tables: dm_threads + direct_messages with sender_user_id; recipient
--     lives on dm_threads).
--
-- Memory references (load-bearing):
--   feedback_planner_missed_status_enum_widening — all 4-table DROP+CREATE
--     atomic in ONE begin/commit.
--   reference_supabase_is_staff_helper — public.is_staff() is the canonical
--     staff RLS guard; used directly in the mute-SELECT clause (staff can see
--     muted content for moderation review).
--   feedback_rpc_auth_uid_vs_service_role_mismatch — these policies reference
--     auth.uid(); service-role callers bypass RLS entirely.
--   reference_supabase_migration_gotchas — partial-index expressions IMMUTABLE
--     (n/a here — RLS predicates, not indexes); ums lookups use the partial
--     index from 20270901000005 user_moderation_state_muted_idx /
--     user_moderation_state_blocked_idx.
--
-- Cross-plan integration:
--   - user_moderation_state: 20270901000005 (Plan 48-03).
--   - is_staff(): pre-existing public.is_staff() helper.
--   - Phase 44 community_* tables + Phase 45 direct_messages: must be applied
--     in same `supabase db push --linked` batch by Plan 48-12 close-out (cron
--     timestamp ordering ensures Phase 44 → 45 → 48 application order).
--
-- Per leanshot/src/lib/moderation/rls-predicates.ts — Plan 48-11 ships a
-- doc-only TS module documenting the equivalent client-side predicate so the
-- SPA can render mute/ban state transparently.

begin;

-- ============================================================================
-- community_posts — SELECT (mute hide) + INSERT/UPDATE (ban write-deny)
-- ============================================================================

-- SELECT mute-aware: tier gate (Phase 44) AND (own row OR staff OR not-muted)
drop policy if exists cpost_select_tier on public.community_posts;
create policy cpost_select_mute_aware
  on public.community_posts for select to authenticated
  using (
    deleted_at is null
    and exists (
      select 1 from public.community_spaces cs
      join public.tier_effective te on te.user_id = auth.uid()
      where cs.id = community_posts.space_id
        and (
          cs.min_tier = 'free'
          or (cs.min_tier = 'pro'      and te.tier_label in ('pro','lifetime','trial'))
          or (cs.min_tier = 'lifetime' and te.tier_label = 'lifetime')
        )
    )
    and (
      author_id = auth.uid()
      or public.is_staff()
      or not exists (
        select 1 from public.user_moderation_state ums
        where ums.user_id = community_posts.author_id
          and ums.status = 'muted'
      )
    )
  );

-- INSERT ban-aware: tier gate AND (not banned/temp_suspended)
drop policy if exists cpost_insert_authenticated on public.community_posts;
create policy cpost_insert_ban_aware
  on public.community_posts for insert to authenticated
  with check (
    author_id = auth.uid()
    and exists (
      select 1 from public.community_spaces cs
      join public.tier_effective te on te.user_id = auth.uid()
      where cs.id = community_posts.space_id
        and (
          cs.min_tier = 'free'
          or (cs.min_tier = 'pro'      and te.tier_label in ('pro','lifetime','trial'))
          or (cs.min_tier = 'lifetime' and te.tier_label = 'lifetime')
        )
    )
    and not exists (
      select 1 from public.user_moderation_state ums
      where ums.user_id = auth.uid()
        and ums.status in ('banned','temp_suspended')
    )
  );

-- UPDATE ban-aware: author-only AND (not banned/temp_suspended)
drop policy if exists cpost_update_author on public.community_posts;
create policy cpost_update_author_ban_aware
  on public.community_posts for update to authenticated
  using (
    author_id = auth.uid()
    and not exists (
      select 1 from public.user_moderation_state ums
      where ums.user_id = auth.uid()
        and ums.status in ('banned','temp_suspended')
    )
  )
  with check (
    author_id = auth.uid()
    and not exists (
      select 1 from public.user_moderation_state ums
      where ums.user_id = auth.uid()
        and ums.status in ('banned','temp_suspended')
    )
  );

-- ============================================================================
-- community_comments — SELECT (mute hide) + INSERT/UPDATE (ban write-deny)
-- ============================================================================

drop policy if exists ccomment_select_tier on public.community_comments;
create policy ccomment_select_mute_aware
  on public.community_comments for select to authenticated
  using (
    deleted_at is null
    and exists (
      select 1 from public.community_posts p
      join public.community_spaces cs on cs.id = p.space_id
      join public.tier_effective te on te.user_id = auth.uid()
      where p.id = community_comments.post_id
        and p.deleted_at is null
        and (
          cs.min_tier = 'free'
          or (cs.min_tier = 'pro'      and te.tier_label in ('pro','lifetime','trial'))
          or (cs.min_tier = 'lifetime' and te.tier_label = 'lifetime')
        )
    )
    and (
      author_id = auth.uid()
      or public.is_staff()
      or not exists (
        select 1 from public.user_moderation_state ums
        where ums.user_id = community_comments.author_id
          and ums.status = 'muted'
      )
    )
  );

drop policy if exists ccomment_insert_authenticated on public.community_comments;
create policy ccomment_insert_ban_aware
  on public.community_comments for insert to authenticated
  with check (
    author_id = auth.uid()
    and exists (
      select 1 from public.community_posts p
      join public.community_spaces cs on cs.id = p.space_id
      join public.tier_effective te on te.user_id = auth.uid()
      where p.id = community_comments.post_id
        and p.deleted_at is null
        and (
          cs.min_tier = 'free'
          or (cs.min_tier = 'pro'      and te.tier_label in ('pro','lifetime','trial'))
          or (cs.min_tier = 'lifetime' and te.tier_label = 'lifetime')
        )
    )
    and not exists (
      select 1 from public.user_moderation_state ums
      where ums.user_id = auth.uid()
        and ums.status in ('banned','temp_suspended')
    )
  );

drop policy if exists ccomment_update_author on public.community_comments;
create policy ccomment_update_author_ban_aware
  on public.community_comments for update to authenticated
  using (
    author_id = auth.uid()
    and not exists (
      select 1 from public.user_moderation_state ums
      where ums.user_id = auth.uid()
        and ums.status in ('banned','temp_suspended')
    )
  )
  with check (
    author_id = auth.uid()
    and not exists (
      select 1 from public.user_moderation_state ums
      where ums.user_id = auth.uid()
        and ums.status in ('banned','temp_suspended')
    )
  );

-- ============================================================================
-- community_reactions — SELECT (mute hide via reaction author) + INSERT/DELETE
-- ============================================================================

-- Reactions use user_id (not author_id); mute hides reactions from muted users
-- to non-author non-staff viewers.
drop policy if exists creaction_select_authenticated on public.community_reactions;
create policy creaction_select_mute_aware
  on public.community_reactions for select to authenticated
  using (
    user_id = auth.uid()
    or public.is_staff()
    or not exists (
      select 1 from public.user_moderation_state ums
      where ums.user_id = community_reactions.user_id
        and ums.status = 'muted'
    )
  );

drop policy if exists creaction_insert_self on public.community_reactions;
create policy creaction_insert_ban_aware
  on public.community_reactions for insert to authenticated
  with check (
    user_id = auth.uid()
    and not exists (
      select 1 from public.user_moderation_state ums
      where ums.user_id = auth.uid()
        and ums.status in ('banned','temp_suspended')
    )
  );

drop policy if exists creaction_delete_self on public.community_reactions;
create policy creaction_delete_ban_aware
  on public.community_reactions for delete to authenticated
  using (
    user_id = auth.uid()
    and not exists (
      select 1 from public.user_moderation_state ums
      where ums.user_id = auth.uid()
        and ums.status in ('banned','temp_suspended')
    )
  );

-- ============================================================================
-- direct_messages — SELECT (mute hide sender) + INSERT/UPDATE/DELETE ban-deny
-- ============================================================================
--
-- direct_messages.sender_user_id is the authorship column (per Phase 45 schema).
-- recipient lives on dm_threads (1:1 thread model).
--
-- This widening REPLACES the Phase 45-owned base SELECT/INSERT/UPDATE/DELETE
-- policies. Plan 48-12 close-out ensures Phase 45 ships its base policies in a
-- migration with a timestamp BEFORE 20270901000015 so the DROP IF EXISTS lands
-- against a real policy. Names mirror Phase 45 convention (dm_<verb>_*).

drop policy if exists dm_select_participant on public.direct_messages;
create policy dm_select_mute_aware
  on public.direct_messages for select to authenticated
  using (
    exists (
      select 1 from public.dm_threads dt
      where dt.id = direct_messages.thread_id
        and (dt.creator_user_id = auth.uid() or dt.recipient_user_id = auth.uid())
    )
    and (
      sender_user_id = auth.uid()
      or public.is_staff()
      or not exists (
        select 1 from public.user_moderation_state ums
        where ums.user_id = direct_messages.sender_user_id
          and ums.status = 'muted'
      )
    )
  );

drop policy if exists dm_insert_sender on public.direct_messages;
create policy dm_insert_ban_aware
  on public.direct_messages for insert to authenticated
  with check (
    sender_user_id = auth.uid()
    and exists (
      select 1 from public.dm_threads dt
      where dt.id = direct_messages.thread_id
        and (dt.creator_user_id = auth.uid() or dt.recipient_user_id = auth.uid())
    )
    and not exists (
      select 1 from public.user_moderation_state ums
      where ums.user_id = auth.uid()
        and ums.status in ('banned','temp_suspended')
    )
  );

drop policy if exists dm_update_sender on public.direct_messages;
create policy dm_update_ban_aware
  on public.direct_messages for update to authenticated
  using (
    sender_user_id = auth.uid()
    and not exists (
      select 1 from public.user_moderation_state ums
      where ums.user_id = auth.uid()
        and ums.status in ('banned','temp_suspended')
    )
  )
  with check (
    sender_user_id = auth.uid()
    and not exists (
      select 1 from public.user_moderation_state ums
      where ums.user_id = auth.uid()
        and ums.status in ('banned','temp_suspended')
    )
  );

drop policy if exists dm_delete_sender on public.direct_messages;
create policy dm_delete_ban_aware
  on public.direct_messages for delete to authenticated
  using (
    sender_user_id = auth.uid()
    and not exists (
      select 1 from public.user_moderation_state ums
      where ums.user_id = auth.uid()
        and ums.status in ('banned','temp_suspended')
    )
  );

commit;
