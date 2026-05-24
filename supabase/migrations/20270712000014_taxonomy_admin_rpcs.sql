-- Phase 51 Plan 51-09 Task 2 — Taxonomy admin SECDEF RPCs.
-- Requirements: TRAFFIC-04, TRAFFIC-05.
-- Threats mitigated: T-51-36 (privilege escalation), T-51-37 (malformed JSON),
-- T-51-38 (deleting Direct fallback breaks classifier).
--
-- 4 RPCs (all SECDEF, admin-gated, search_path-pinned):
--   - upsert_channel_group(p_id, p_label, p_priority, p_match_rule_jsonb, p_attribution_window_days)
--   - delete_channel_group(p_id)
--   - upsert_referrer_rule(p_id, p_referrer_domain, p_channel_group_label, p_priority)
--   - delete_referrer_rule(p_id)
--
-- IMPORTANT — admin gate helper name:
-- Per Plan 51-01 SUMMARY Deviation #2 (`reference_supabase_is_staff_helper`-adjacent
-- precedent for this codebase), the canonical admin gate is
--   `public.is_admin_at_least(min_role public.admin_role)`
-- — `public.is_admin()` (no-arg) does NOT exist on this database. Plan-09's
-- example used `is_admin()`; this migration uses the canonical helper.
-- (Auto-fix Rule 1 — the plan's body would 42883 at db-push otherwise.)
--
-- referrer_channel_rules.channel_group_label has a FK to channel_groups(label)
-- with ON UPDATE CASCADE (per 20271102000003 seed migration line 25); so
-- relabel-a-channel-group safely cascades into the referrer rules.
--
-- Plan 51-10 owns supabase db push --linked; this migration ships as a static
-- file in this commit.

-- ---------------------------------------------------------------------------
-- upsert_channel_group — create or update a channel-group row.
-- ---------------------------------------------------------------------------
create or replace function public.upsert_channel_group(
  p_id                      uuid,
  p_label                   text,
  p_priority                int,
  p_match_rule_jsonb        jsonb,
  p_attribution_window_days int
) returns uuid
  language plpgsql
  security definer
  set search_path = pg_catalog, public, extensions
as $$
declare
  v_id uuid;
begin
  if not public.is_admin_at_least('admin'::public.admin_role) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_attribution_window_days is null
     or p_attribution_window_days < 1
     or p_attribution_window_days > 90 then
    raise exception 'attribution_window_days_out_of_range' using errcode = '22023';
  end if;

  if p_id is null then
    insert into public.channel_groups (
      label, priority, match_rule_jsonb, attribution_window_days, is_default_fallback
    ) values (
      p_label, p_priority, coalesce(p_match_rule_jsonb, '{}'::jsonb), p_attribution_window_days, false
    )
    returning id into v_id;
  else
    update public.channel_groups
       set label                    = p_label,
           priority                 = p_priority,
           match_rule_jsonb         = coalesce(p_match_rule_jsonb, '{}'::jsonb),
           attribution_window_days  = p_attribution_window_days,
           updated_at               = now()
     where id = p_id
    returning id into v_id;
  end if;
  return v_id;
end;
$$;

revoke execute on function public.upsert_channel_group(uuid, text, int, jsonb, int) from public, anon;
grant  execute on function public.upsert_channel_group(uuid, text, int, jsonb, int) to authenticated;

comment on function public.upsert_channel_group(uuid, text, int, jsonb, int) is
  'Phase 51 / D-01 — Admin CRUD for channel_groups. SECDEF; gated by is_admin_at_least(''admin''). Default-fallback row is protected from delete (see delete_channel_group).';

-- ---------------------------------------------------------------------------
-- delete_channel_group — protects the Direct (is_default_fallback=true) row.
-- ---------------------------------------------------------------------------
create or replace function public.delete_channel_group(p_id uuid) returns void
  language plpgsql
  security definer
  set search_path = pg_catalog, public, extensions
as $$
begin
  if not public.is_admin_at_least('admin'::public.admin_role) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if exists (
    select 1 from public.channel_groups where id = p_id and is_default_fallback = true
  ) then
    -- T-51-38 mitigation: deleting the fallback breaks the classifier.
    raise exception 'cannot_delete_default_fallback' using errcode = '23514';
  end if;
  delete from public.channel_groups where id = p_id;
end;
$$;

revoke execute on function public.delete_channel_group(uuid) from public, anon;
grant  execute on function public.delete_channel_group(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- upsert_referrer_rule — create or update a referrer-domain → channel-group mapping.
-- ---------------------------------------------------------------------------
create or replace function public.upsert_referrer_rule(
  p_id                    uuid,
  p_referrer_domain       text,
  p_channel_group_label   text,
  p_priority              int
) returns uuid
  language plpgsql
  security definer
  set search_path = pg_catalog, public, extensions
as $$
declare
  v_id uuid;
begin
  if not public.is_admin_at_least('admin'::public.admin_role) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_id is null then
    insert into public.referrer_channel_rules (referrer_domain, channel_group_label, priority)
    values (lower(p_referrer_domain), p_channel_group_label, p_priority)
    returning id into v_id;
  else
    update public.referrer_channel_rules
       set referrer_domain      = lower(p_referrer_domain),
           channel_group_label  = p_channel_group_label,
           priority             = p_priority,
           updated_at           = now()
     where id = p_id
    returning id into v_id;
  end if;
  return v_id;
end;
$$;

revoke execute on function public.upsert_referrer_rule(uuid, text, text, int) from public, anon;
grant  execute on function public.upsert_referrer_rule(uuid, text, text, int) to authenticated;

-- ---------------------------------------------------------------------------
-- delete_referrer_rule — straight delete; no fallback to protect here.
-- ---------------------------------------------------------------------------
create or replace function public.delete_referrer_rule(p_id uuid) returns void
  language plpgsql
  security definer
  set search_path = pg_catalog, public, extensions
as $$
begin
  if not public.is_admin_at_least('admin'::public.admin_role) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  delete from public.referrer_channel_rules where id = p_id;
end;
$$;

revoke execute on function public.delete_referrer_rule(uuid) from public, anon;
grant  execute on function public.delete_referrer_rule(uuid) to authenticated;

comment on function public.delete_referrer_rule(uuid) is
  'Phase 51 / D-03 — Admin delete for referrer_channel_rules. SECDEF; admin-only.';
