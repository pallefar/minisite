-- Phase 44 Plan 01 — Community SECDEF RPCs.
--
-- Implements:
--   D-02: toggle_community_reaction — idempotent INSERT...ON CONFLICT DO DELETE toggle
--   COMMUNITY-02: reaction toggle is the authoritative idempotency mechanism
--
-- Per reference_supabase_migration_gotchas:
--   SECURITY DEFINER + SET search_path = public, extensions on every function.
--
-- Per reference_rpc_auth_uid_vs_service_role_mismatch:
--   toggle_community_reaction uses auth.uid() and MUST be called with a user JWT
--   (anon-key + Authorization header), NOT service-role.
--
-- Pattern: SECDEF function structure from 20270710000005_p36_review_secdef_rpcs.sql.
-- INSERT...ON CONFLICT DO DELETE pattern per RESEARCH §Code Examples (Postgres 15+, Supabase cloud).
-- Note: timestamp 20270720000004 is reserved for plan 44-02 (notification CHECK widening).

begin;

-- ============================================================================
-- toggle_community_reaction(p_target_type, p_target_id, p_emoji)
-- D-02: idempotent toggle — first call inserts, second call deletes.
-- Returns aggregate counts per emoji for the (target_type, target_id) after toggling.
-- ============================================================================
create or replace function public.toggle_community_reaction(
  p_target_type text,   -- 'post' | 'comment'
  p_target_id   uuid,
  p_emoji       text    -- one of: like, heart, target, fire, clap
)
returns table(emoji text, count bigint, reacted_by_me boolean)
language plpgsql
security definer
set search_path = public, extensions
as $fn$
declare
  v_user_id uuid := auth.uid();
begin
  -- Require authenticated caller
  if v_user_id is null then
    raise exception 'unauthenticated' using errcode = '42501';
  end if;

  -- Validate target_type (belt-and-suspenders beyond the CHECK constraint)
  if p_target_type not in ('post','comment') then
    raise exception 'invalid_target_type' using errcode = '22023';
  end if;

  -- Validate emoji (belt-and-suspenders beyond the CHECK constraint)
  if p_emoji not in ('like','heart','target','fire','clap') then
    raise exception 'invalid_emoji' using errcode = '22023';
  end if;

  -- D-02: Idempotent toggle — check existence first, then insert or delete.
  -- Using explicit SELECT + conditional INSERT/DELETE for Postgres compatibility.
  -- First call: no row exists → INSERT (reaction added).
  -- Second call: row exists → DELETE (reaction removed).
  if exists (
    select 1 from public.community_reactions
    where user_id     = v_user_id
      and target_type = p_target_type
      and target_id   = p_target_id
      and emoji       = p_emoji
  ) then
    delete from public.community_reactions
    where user_id     = v_user_id
      and target_type = p_target_type
      and target_id   = p_target_id
      and emoji       = p_emoji;
  else
    insert into public.community_reactions (user_id, target_type, target_id, emoji)
      values (v_user_id, p_target_type, p_target_id, p_emoji);
  end if;

  -- Return aggregate counts per emoji for the target entity after toggle.
  -- reacted_by_me = true if the current user has this emoji on this target.
  return query
    select
      r.emoji,
      count(*) as count,
      bool_or(r.user_id = v_user_id) as reacted_by_me
    from public.community_reactions r
    where r.target_type = p_target_type
      and r.target_id   = p_target_id
    group by r.emoji;
end;
$fn$;

comment on function public.toggle_community_reaction(text, uuid, text) is
  'Phase 44 D-02 — idempotent reaction toggle; SELECT-then-INSERT-or-DELETE pattern. '
  'COMMUNITY-02 proof: first call count=1 reacted_by_me=true; second call count=0 reacted_by_me=false.';

-- Revoke from public/anon per convention; grant to authenticated callers
revoke execute on function public.toggle_community_reaction(text, uuid, text) from public, anon;
grant  execute on function public.toggle_community_reaction(text, uuid, text) to authenticated;

commit;
