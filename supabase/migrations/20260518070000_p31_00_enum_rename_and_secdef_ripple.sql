-- =============================================================================
-- Plan 31-00 RECONCILE — atomic enum rename + SECDEF ripple
-- =============================================================================
-- Renames public.org_member_role enum values:
--   'admin'  → 'owner'
--   'staff'  → 'clinician'
--   'viewer' → 'staff'
--
-- ORDER IS CRITICAL (D-01 + RESEARCH Finding 1):
--   1. admin → owner  (first, so 'admin' label is freed before being referenced as target)
--   2. staff → clinician  (frees 'staff' label)
--   3. viewer → staff  (reuses the now-freed 'staff' label)
--
-- Also:
--   - Re-creates every SECDEF whose body references role string literals
--     against org_members.role (NOT the unrelated public.admin_role enum)
--   - Renames _is_org_admin → _is_org_owner (per D-13)
--   - Drops/recreates RLS policies with role-literal USING/WITH CHECK clauses
--
-- Per RESEARCH Finding 1: ALTER TYPE ... RENAME VALUE is catalog-level and does
-- NOT trigger the 55P04 "unsafe use of new value of enum type" restriction, so
-- SECDEFs may be CREATE OR REPLACE'd in the same transaction.
--
-- Idempotency:
--   - Rename guards: `if exists (select 1 from pg_enum where enumlabel = 'admin')...`
--   - CREATE OR REPLACE is idempotent
--   - DROP POLICY IF EXISTS is idempotent
--   - DROP FUNCTION IF EXISTS is idempotent
-- =============================================================================

begin;

-- =============================================================================
-- STEP 1: Rename the three enum values (idempotent guards)
-- Order: admin→owner FIRST, staff→clinician SECOND, viewer→staff THIRD
-- =============================================================================
do $$
begin
  if exists (
    select 1 from pg_enum
    where enumtypid = 'public.org_member_role'::regtype
      and enumlabel = 'admin'
  ) then
    alter type public.org_member_role rename value 'admin' to 'owner';
  end if;

  if exists (
    select 1 from pg_enum
    where enumtypid = 'public.org_member_role'::regtype
      and enumlabel = 'staff'
  ) then
    alter type public.org_member_role rename value 'staff' to 'clinician';
  end if;

  if exists (
    select 1 from pg_enum
    where enumtypid = 'public.org_member_role'::regtype
      and enumlabel = 'viewer'
  ) then
    alter type public.org_member_role rename value 'viewer' to 'staff';
  end if;
end $$;

-- =============================================================================
-- STEP 2: Rename _is_org_admin → _is_org_owner
-- Strategy: CREATE OR REPLACE with new name (new body referencing 'owner'),
-- then DROP the old function name.
-- =============================================================================

-- 2a. Create _is_org_owner (replaces _is_org_admin)
create or replace function public._is_org_owner(p_org_id uuid, p_user_id uuid)
returns boolean
  language sql
  security definer
  stable
  set search_path = pg_catalog, public, extensions
as $$
  SELECT exists (
    select 1 from public.org_members
    where org_id = p_org_id and user_id = p_user_id and role = 'owner'
  );
$$;

grant execute on function public._is_org_owner(uuid, uuid) to authenticated;

-- 2b. Drop old _is_org_admin
drop function if exists public._is_org_admin(uuid, uuid);

-- =============================================================================
-- STEP 3: Re-create SECDEF functions whose bodies reference org_member_role literals
-- Each function is re-emitted verbatim from its source migration with substitutions:
--   'admin'  → 'owner'
--   'staff'  → 'clinician'  (only when used as org_member_role value, not column name)
--   'viewer' → 'staff'
--   role in ('admin', 'staff') → role in ('owner', 'clinician')
--   v_role <> 'admin'  → v_role <> 'owner'
--   v_role not in ('admin', 'staff') → v_role not in ('owner', 'clinician')
--   v_caller_role not in ('admin', 'staff') → v_caller_role not in ('owner', 'clinician')
--   _is_org_admin → _is_org_owner
-- =============================================================================

-- -----------------------------------------------------------------------------
-- From 20270601100012_send_revoke_org_invite_rpcs.sql
-- send_org_invite: role = 'admin' → role = 'owner'
-- revoke_org_invite: role = 'admin' → role = 'owner'
-- accept_org_invite: no role literal (token-gated) — body unchanged but recreated
--   for completeness (it inserts invited_role which is an enum-typed column, resolved at
--   query time; no string comparison so no literal needs changing).
-- -----------------------------------------------------------------------------
create or replace function public.send_org_invite(
  p_org_id    uuid,
  p_email     text,
  p_role      public.org_member_role
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $$
declare
  v_uid       uuid := auth.uid();
  v_invite_id uuid;
  v_token     text;
  v_token_hash text;
begin
  if v_uid is null then
    raise exception 'unauthenticated' using errcode = '28000';
  end if;

  if not exists (
    select 1 from public.org_members
    where org_id = p_org_id
      and user_id = v_uid
      and role = 'owner'
  ) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  v_token      := encode(extensions.gen_random_bytes(32), 'hex');
  v_token_hash := encode(extensions.digest(v_token, 'sha256'), 'hex');

  insert into public.org_invites (org_id, email, invited_role, invite_token_hash, created_by)
  values (p_org_id, p_email, p_role, v_token_hash, v_uid)
  returning id into v_invite_id;

  perform public.log_admin_action(
    'org_invite_sent',
    p_org_id,
    jsonb_build_object('invite_id', v_invite_id, 'role', p_role::text)
  );

  return jsonb_build_object('invite_id', v_invite_id, 'token', v_token);
end;
$$;

revoke all on function public.send_org_invite(uuid, text, public.org_member_role) from public;
grant execute on function public.send_org_invite(uuid, text, public.org_member_role) to authenticated;

create or replace function public.revoke_org_invite(
  p_invite_id uuid
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $$
declare
  v_uid    uuid := auth.uid();
  v_org_id uuid;
begin
  if v_uid is null then
    raise exception 'unauthenticated' using errcode = '28000';
  end if;

  select org_id into v_org_id
  from public.org_invites
  where id = p_invite_id;

  if v_org_id is null then
    raise exception 'not_found' using errcode = 'P0002';
  end if;

  if not exists (
    select 1 from public.org_members
    where org_id = v_org_id
      and user_id = v_uid
      and role = 'owner'
  ) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  update public.org_invites
  set status = 'revoked', revoked_at = now()
  where id = p_invite_id
    and status = 'pending';

  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;

  perform public.log_admin_action(
    'org_invite_revoked',
    v_org_id,
    jsonb_build_object('invite_id', p_invite_id)
  );
end;
$$;

revoke all on function public.revoke_org_invite(uuid) from public;
grant execute on function public.revoke_org_invite(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- From 20270601100013_link_org_patient_rpc.sql
-- role in ('admin', 'staff') → role in ('owner', 'clinician')
-- -----------------------------------------------------------------------------
create or replace function public.link_org_patient(
  p_org_id            uuid,
  p_patient_user_id   uuid,
  p_consent_grant_id  uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $$
declare
  v_uid   uuid := auth.uid();
  v_link_id uuid;
begin
  if v_uid is null then
    raise exception 'unauthenticated' using errcode = '28000';
  end if;

  if not exists (
    select 1 from public.org_members
    where org_id = p_org_id
      and user_id = v_uid
      and role in ('owner', 'clinician')
  ) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if not exists (
    select 1 from public.org_consent_grants
    where id = p_consent_grant_id
      and org_id = p_org_id
      and patient_user_id = p_patient_user_id
      and revoked_at is null
  ) then
    raise exception 'invalid_consent_grant' using errcode = 'P0002';
  end if;

  insert into public.org_patient_links (org_id, patient_user_id, linked_by, consent_grant_id)
  values (p_org_id, p_patient_user_id, v_uid, p_consent_grant_id)
  returning id into v_link_id;

  perform public.log_admin_action(
    'org_patient_linked',
    p_org_id,
    jsonb_build_object(
      'link_id', v_link_id,
      'patient_user_id', p_patient_user_id,
      'consent_grant_id', p_consent_grant_id
    )
  );

  return jsonb_build_object('link_id', v_link_id);
end;
$$;

revoke all on function public.link_org_patient(uuid, uuid, uuid) from public;
grant execute on function public.link_org_patient(uuid, uuid, uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- From 20270601200002_count_active_patients_v2.sql
-- role = 'admin' → role = 'owner'
-- -----------------------------------------------------------------------------
drop function if exists public.count_active_patients(p_clinic_id uuid);

create or replace function public.count_active_patients(p_org_id uuid)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
stable
as $$
declare
  v_uid   uuid := auth.uid();
  v_count integer;
begin
  if v_uid is not null then
    if not exists (
      select 1 from public.org_members
      where org_id = p_org_id
        and user_id = v_uid
        and role = 'owner'
    ) then
      raise exception 'forbidden' using errcode = '42501';
    end if;
  end if;

  select count(distinct opl.patient_user_id)::integer into v_count
  from public.org_patient_links opl
  where opl.org_id = p_org_id
    and opl.unlinked_at is null
    and exists (
      select 1 from public.injections i
        where i.user_id = opl.patient_user_id and i.created_at > now() - interval '30 days'
      union all
      select 1 from public.weights w
        where w.user_id = opl.patient_user_id and w.created_at > now() - interval '30 days'
      union all
      select 1 from public.meals m
        where m.user_id = opl.patient_user_id and m.created_at > now() - interval '30 days'
      union all
      select 1 from public.mood mo
        where mo.user_id = opl.patient_user_id and mo.created_at > now() - interval '30 days'
      union all
      select 1 from public.sleep sl
        where sl.user_id = opl.patient_user_id and sl.created_at > now() - interval '30 days'
      union all
      select 1 from public.symptoms sy
        where sy.user_id = opl.patient_user_id and sy.created_at > now() - interval '30 days'
      union all
      select 1 from public.photos ph
        where ph.user_id = opl.patient_user_id and ph.created_at > now() - interval '30 days'
      union all
      select 1 from public.workouts wo
        where wo.user_id = opl.patient_user_id and wo.created_at > now() - interval '30 days'
      union all
      select 1 from public.vials vi
        where vi.user_id = opl.patient_user_id and vi.created_at > now() - interval '30 days'
      union all
      select 1 from public.ai_messages ai
        where ai.user_id = opl.patient_user_id and ai.created_at > now() - interval '30 days'
    );

  return coalesce(v_count, 0);
end;
$$;

comment on function public.count_active_patients(uuid) is
  'P31-00 updated (was P29 D-01): role check updated admin→owner. Returns count of distinct patient_user_ids in org_patient_links with any event in last 30 days.';

revoke all on function public.count_active_patients(uuid) from public;
grant execute on function public.count_active_patients(uuid) to authenticated;
grant execute on function public.count_active_patients(uuid) to service_role;

-- -----------------------------------------------------------------------------
-- From 20270601200003_org_patient_invites.sql
-- _is_org_admin → _is_org_owner (RLS policy)
-- role = 'admin' → role = 'owner' in send_org_patient_invite
-- Also: org_patient_invites_validate_scope trigger function — no role literal, keep as-is
-- -----------------------------------------------------------------------------

-- Re-create send_org_patient_invite with 'admin' → 'owner'
create or replace function public.send_org_patient_invite(
  p_org_id            uuid,
  p_patient_email     text,
  p_consent_scope     jsonb,
  p_invite_token_hash text
) returns table(invite_id uuid, status text)
  language plpgsql
  security definer
  set search_path = pg_catalog, public, extensions
as $$
declare
  v_uid           uuid := auth.uid();
  v_role          public.org_member_role;
  v_invite_id     uuid;
  v_user_id_hash  text;
begin
  if v_uid is null then
    raise exception 'unauthenticated' using errcode = '28000';
  end if;

  select role into v_role
  from public.org_members
  where org_id = p_org_id and user_id = v_uid;

  if v_role is null or v_role <> 'owner' then
    raise exception 'owner role required' using errcode = '42501';
  end if;

  insert into public.org_patient_invites(
    org_id, patient_email, invite_token_hash, consent_scope, invited_by
  )
  values(
    p_org_id, p_patient_email, p_invite_token_hash, p_consent_scope, v_uid
  )
  returning id into v_invite_id;

  v_user_id_hash := encode(
    extensions.digest(v_uid::text, 'sha256'), 'hex'
  );
  insert into public.audit_logs(
    user_id_hash, table_name, action,
    user_id, actor_user_id, action_name, row_pk, after_data, source
  ) values (
    v_user_id_hash, 'org_patient_invites', 'insert',
    v_uid, v_uid, 'send_org_patient_invite', v_invite_id::text,
    jsonb_build_object('org_id', p_org_id, 'patient_email', p_patient_email),
    'rpc'
  );

  return query select v_invite_id, 'sent'::text;
end;
$$;

revoke all on function public.send_org_patient_invite(uuid, text, jsonb, text) from public;
grant execute on function public.send_org_patient_invite(uuid, text, jsonb, text) to authenticated;

-- Replace the org_patient_invites SELECT policy to use _is_org_owner
drop policy if exists "org_patient_invites_select_by_org_admin" on public.org_patient_invites;

create policy "org_patient_invites_select_by_org_admin"
  on public.org_patient_invites
  for select
  to authenticated
  using (public._is_org_owner(org_patient_invites.org_id, auth.uid()));

-- -----------------------------------------------------------------------------
-- From 20270601200004_org_patient_invite_rpcs.sql
-- v_role <> 'admin' → v_role <> 'owner'
-- -----------------------------------------------------------------------------

-- accept_org_patient_invite_preview: no role literal (stable read-only) — no change needed

-- Re-create send_org_patient_invite already done above (it checks 'owner').
-- Note: accept_org_patient_invite has no role literal (it's token-gated, uses p_patient_user_id).
-- Only send_org_patient_invite has the role check — already re-created above.

-- But we do need to re-create for the v_role <> 'admin' check inside accept_org_patient_invite_preview
-- Actually looking at the source: accept_org_patient_invite_preview is STABLE, no role literals.
-- accept_org_patient_invite is the transactional one, also no role literal.
-- The only role literal in this file is in send_org_patient_invite which was already done.

-- Re-create accept_org_patient_invite_preview (STABLE, no role literal — but recreating for completeness
-- since we replaced send_org_patient_invite above which is in the same source migration)
create or replace function public.accept_org_patient_invite_preview(
  p_invite_token_hash text
) returns table(org_name text, org_logo_url text, scope_summary jsonb)
  language plpgsql
  security definer
  stable
  set search_path = pg_catalog, public, extensions
as $$
declare
  v_org_id    uuid;
  v_org_name  text;
  v_logo_url  text;
  v_scope     jsonb;
begin
  select
    i.org_id,
    o.name,
    coalesce(b.logo_url, ''),
    i.consent_scope
  into
    v_org_id,
    v_org_name,
    v_logo_url,
    v_scope
  from public.org_patient_invites i
  join public.organizations o on o.id = i.org_id
  left join public.org_branding b on b.org_id = i.org_id
  where i.invite_token_hash = p_invite_token_hash
    and i.accepted_at is null
    and i.expires_at > now();

  if v_org_id is null then
    raise exception 'invite not found' using errcode = 'P0002';
  end if;

  return query select v_org_name, v_logo_url, v_scope;
end;
$$;

revoke all on function public.accept_org_patient_invite_preview(text) from public;
grant execute on function public.accept_org_patient_invite_preview(text) to anon, authenticated;

-- -----------------------------------------------------------------------------
-- From 20270601300003_p30_secdef_and_triggers.sql
-- update_org_ranking_weights: v_role <> 'admin' → v_role <> 'owner'
-- set_patient_dose_thresholds: v_role not in ('admin', 'staff') → v_role not in ('owner', 'clinician')
-- acknowledge_clinician_alert: v_role not in ('admin', 'staff') → v_role not in ('owner', 'clinician')
-- snooze_clinician_alert: v_role not in ('admin', 'staff') → v_role not in ('owner', 'clinician')
-- NOTE: _notify_org_settings_weights_changed has no role literal — no change needed
-- NOTE: _trg_validate_ranking_weights has no role literal — no change needed
-- -----------------------------------------------------------------------------

create or replace function public.update_org_ranking_weights(
  p_org_id  uuid,
  p_weights jsonb
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $$
declare
  v_caller_uid uuid := auth.uid();
  v_role       public.org_member_role;
  v_user_id_hash text;
begin
  if v_caller_uid is null then
    raise exception 'unauthenticated' using errcode = '28000';
  end if;

  select role into v_role
  from public.org_members
  where org_id = p_org_id and user_id = v_caller_uid;

  if v_role is null or v_role <> 'owner' then
    raise exception 'owner role required' using errcode = '42501';
  end if;

  -- Pre-validate BEFORE the upsert (belt-and-suspenders with trigger)
  perform public._validate_ranking_weights(p_weights);

  insert into public.org_settings (org_id, ranking_weights)
  values (p_org_id, p_weights)
  on conflict (org_id) do update
    set ranking_weights = excluded.ranking_weights;

  perform set_config('app.suppress_audit', 'on', true);

  v_user_id_hash := encode(
    extensions.digest(v_caller_uid::text, 'sha256'), 'hex'
  );

  insert into public.audit_logs(
    user_id_hash, table_name, action,
    user_id, actor_user_id, action_name, row_pk, after_data, source
  ) values (
    v_user_id_hash, 'org_settings', 'update',
    v_caller_uid, v_caller_uid,
    'update_org_ranking_weights', p_org_id::text,
    jsonb_build_object('org_id', p_org_id, 'ranking_weights', p_weights),
    'rpc'
  );
end;
$$;

revoke all on function public.update_org_ranking_weights(uuid, jsonb) from public;
grant execute on function public.update_org_ranking_weights(uuid, jsonb) to authenticated;

create or replace function public.set_patient_dose_thresholds(
  p_org_id          uuid,
  p_patient_user_id uuid,
  p_thresholds      jsonb
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $$
declare
  v_caller_uid uuid := auth.uid();
  v_role       public.org_member_role;
  v_link_exists boolean;
  v_user_id_hash text;
begin
  if v_caller_uid is null then
    raise exception 'unauthenticated' using errcode = '28000';
  end if;

  select role into v_role
  from public.org_members
  where org_id = p_org_id and user_id = v_caller_uid;

  if v_role is null or v_role not in ('owner', 'clinician') then
    raise exception 'owner or clinician role required' using errcode = '42501';
  end if;

  select exists(
    select 1 from public.org_patient_links
    where org_id = p_org_id
      and patient_user_id = p_patient_user_id
      and unlinked_at is null
  ) into v_link_exists;

  if not v_link_exists then
    raise exception 'no active patient link found for this org + patient combination'
      using errcode = '42704';
  end if;

  insert into public.org_patient_thresholds(
    org_id, patient_user_id, thresholds, set_by, set_at
  )
  values(
    p_org_id, p_patient_user_id, p_thresholds, v_caller_uid, now()
  )
  on conflict (org_id, patient_user_id) do update
    set thresholds = excluded.thresholds,
        set_by     = v_caller_uid,
        set_at     = now();

  perform set_config('app.suppress_audit', 'on', true);

  v_user_id_hash := encode(
    extensions.digest(v_caller_uid::text, 'sha256'), 'hex'
  );

  insert into public.audit_logs(
    user_id_hash, table_name, action,
    user_id, actor_user_id, action_name, row_pk, after_data, source
  ) values (
    v_user_id_hash, 'org_patient_thresholds', 'upsert',
    v_caller_uid, v_caller_uid,
    'set_patient_dose_thresholds',
    format('%s:%s', p_org_id, p_patient_user_id),
    jsonb_build_object(
      'org_id', p_org_id,
      'patient_user_id', p_patient_user_id,
      'thresholds', p_thresholds
    ),
    'rpc'
  );
end;
$$;

revoke all on function public.set_patient_dose_thresholds(uuid, uuid, jsonb) from public;
grant execute on function public.set_patient_dose_thresholds(uuid, uuid, jsonb) to authenticated;

create or replace function public.acknowledge_clinician_alert(
  p_alert_id uuid
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $$
declare
  v_caller_uid uuid := auth.uid();
  v_alert      record;
  v_role       public.org_member_role;
  v_rows_updated int;
  v_user_id_hash text;
begin
  if v_caller_uid is null then
    raise exception 'unauthenticated' using errcode = '28000';
  end if;

  select id, org_id, status
  into v_alert
  from public.clinician_alerts
  where id = p_alert_id;

  if not found then
    raise exception 'alert not found' using errcode = '42704';
  end if;

  select role into v_role
  from public.org_members
  where org_id = v_alert.org_id and user_id = v_caller_uid;

  if v_role is null or v_role not in ('owner', 'clinician') then
    raise exception 'owner or clinician role required for this organization' using errcode = '42501';
  end if;

  update public.clinician_alerts
  set status = 'acknowledged',
      ack_by = v_caller_uid,
      ack_at = now()
  where id = p_alert_id
    and status = 'pending';

  get diagnostics v_rows_updated = row_count;

  if v_rows_updated = 0 then
    raise exception 'alert is not in pending status (may already be acknowledged, snoozed, or resolved)'
      using errcode = '22023';
  end if;

  perform set_config('app.suppress_audit', 'on', true);

  v_user_id_hash := encode(
    extensions.digest(v_caller_uid::text, 'sha256'), 'hex'
  );

  insert into public.audit_logs(
    user_id_hash, table_name, action,
    user_id, actor_user_id, action_name, row_pk, after_data, source
  ) values (
    v_user_id_hash, 'clinician_alerts', 'update',
    v_caller_uid, v_caller_uid,
    'acknowledge_clinician_alert', p_alert_id::text,
    jsonb_build_object(
      'status', 'acknowledged',
      'ack_by', v_caller_uid,
      'ack_at', now()
    ),
    'rpc'
  );
end;
$$;

revoke all on function public.acknowledge_clinician_alert(uuid) from public;
grant execute on function public.acknowledge_clinician_alert(uuid) to authenticated;

create or replace function public.snooze_clinician_alert(
  p_alert_id uuid,
  p_duration text
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $$
declare
  v_caller_uid uuid := auth.uid();
  v_alert      record;
  v_role       public.org_member_role;
  v_interval   interval;
  v_rows_updated int;
  v_user_id_hash text;
begin
  if v_caller_uid is null then
    raise exception 'unauthenticated' using errcode = '28000';
  end if;

  v_interval := case p_duration
    when '1h'  then interval '1 hour'
    when '4h'  then interval '4 hours'
    when '24h' then interval '24 hours'
    when '7d'  then interval '7 days'
    else null
  end;

  if v_interval is null then
    raise exception 'duration must be one of: 1h, 4h, 24h, 7d'
      using errcode = '22023';
  end if;

  select id, org_id, status
  into v_alert
  from public.clinician_alerts
  where id = p_alert_id;

  if not found then
    raise exception 'alert not found' using errcode = '42704';
  end if;

  select role into v_role
  from public.org_members
  where org_id = v_alert.org_id and user_id = v_caller_uid;

  if v_role is null or v_role not in ('owner', 'clinician') then
    raise exception 'owner or clinician role required for this organization' using errcode = '42501';
  end if;

  update public.clinician_alerts
  set status      = 'snoozed',
      snooze_until = now() + v_interval
  where id = p_alert_id
    and status = 'pending';

  get diagnostics v_rows_updated = row_count;

  if v_rows_updated = 0 then
    raise exception 'alert is not in pending status'
      using errcode = '22023';
  end if;

  perform set_config('app.suppress_audit', 'on', true);

  v_user_id_hash := encode(
    extensions.digest(v_caller_uid::text, 'sha256'), 'hex'
  );

  insert into public.audit_logs(
    user_id_hash, table_name, action,
    user_id, actor_user_id, action_name, row_pk, after_data, source
  ) values (
    v_user_id_hash, 'clinician_alerts', 'update',
    v_caller_uid, v_caller_uid,
    'snooze_clinician_alert', p_alert_id::text,
    jsonb_build_object(
      'status', 'snoozed',
      'snooze_until', now() + v_interval,
      'duration', p_duration
    ),
    'rpc'
  );
end;
$$;

revoke all on function public.snooze_clinician_alert(uuid, text) from public;
grant execute on function public.snooze_clinician_alert(uuid, text) to authenticated;

-- -----------------------------------------------------------------------------
-- From 20270601300006_p30_dose_thresholds_rpc.sql
-- v_role <> 'admin' → v_role <> 'owner'
-- -----------------------------------------------------------------------------
create or replace function public.update_org_dose_trend_thresholds(
  p_org_id     uuid,
  p_thresholds jsonb
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $$
declare
  v_caller_uid   uuid := auth.uid();
  v_role         public.org_member_role;
  v_user_id_hash text;
begin
  if v_caller_uid is null then
    raise exception 'unauthenticated' using errcode = '28000';
  end if;

  select role into v_role
  from public.org_members
  where org_id = p_org_id and user_id = v_caller_uid;

  if v_role is null or v_role <> 'owner' then
    raise exception 'owner role required' using errcode = '42501';
  end if;

  update public.org_settings
  set dose_trend_thresholds = p_thresholds
  where org_id = p_org_id;

  perform set_config('app.suppress_audit', 'on', true);

  v_user_id_hash := encode(
    extensions.digest(v_caller_uid::text, 'sha256'), 'hex'
  );

  insert into public.audit_logs(
    user_id_hash, table_name, action,
    user_id, actor_user_id, action_name, row_pk, after_data, source
  ) values (
    v_user_id_hash, 'org_settings', 'update',
    v_caller_uid, v_caller_uid,
    'update_org_dose_trend_thresholds', p_org_id::text,
    jsonb_build_object('org_id', p_org_id, 'dose_trend_thresholds', p_thresholds),
    'rpc'
  );
end;
$$;

revoke all on function public.update_org_dose_trend_thresholds(uuid, jsonb) from public;
grant execute on function public.update_org_dose_trend_thresholds(uuid, jsonb) to authenticated;

-- -----------------------------------------------------------------------------
-- From 20270601300007_p30_reset_patient_thresholds_rpc.sql
-- v_caller_role not in ('admin', 'staff') → v_caller_role not in ('owner', 'clinician')
-- -----------------------------------------------------------------------------
create or replace function public.reset_patient_dose_thresholds(
  p_org_id          uuid,
  p_patient_user_id uuid
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $$
declare
  v_caller_uid   uuid := auth.uid();
  v_caller_role  public.org_member_role;
  v_user_id_hash text;
begin
  if v_caller_uid is null then
    raise exception 'unauthenticated' using errcode = '28000';
  end if;

  select role into v_caller_role
  from public.org_members
  where org_id = p_org_id and user_id = v_caller_uid;

  if v_caller_role is null or v_caller_role not in ('owner', 'clinician') then
    raise exception 'owner or clinician role required' using errcode = '42501';
  end if;

  perform set_config('app.suppress_audit', 'on', true);

  delete from public.org_patient_thresholds
  where org_id = p_org_id
    and patient_user_id = p_patient_user_id;

  v_user_id_hash := encode(
    extensions.digest(v_caller_uid::text, 'sha256'), 'hex'
  );

  insert into public.audit_logs(
    user_id_hash, table_name, action,
    user_id, actor_user_id, action_name, row_pk, after_data, source
  ) values (
    v_user_id_hash, 'org_patient_thresholds', 'delete',
    v_caller_uid, v_caller_uid,
    'reset_patient_dose_thresholds',
    format('%s:%s', p_org_id, p_patient_user_id),
    jsonb_build_object(
      'org_id', p_org_id,
      'patient_user_id', p_patient_user_id,
      'reset_by', v_caller_uid
    ),
    'rpc'
  );
end;
$$;

revoke all on function public.reset_patient_dose_thresholds(uuid, uuid) from public;
grant execute on function public.reset_patient_dose_thresholds(uuid, uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- From 20270601300008_p30_fix_clinician_alerts_rls.sql
-- _is_org_clinician body: role in ('admin', 'staff') → role in ('owner', 'clinician')
-- Also: _is_org_admin → _is_org_owner (already done in STEP 2, but _is_org_clinician
--   needs updating too since it's the SECDEF for broader access)
-- NOTE: This migration file also has _is_org_admin — already dropped above.
-- -----------------------------------------------------------------------------
create or replace function public._is_org_clinician(p_org_id uuid, p_user_id uuid)
returns boolean
  language sql
  security definer
  stable
  set search_path = pg_catalog, public, extensions
as $$
  SELECT exists (
    select 1 from public.org_members
    where org_id = p_org_id
      and user_id = p_user_id
      and role in ('owner', 'clinician')
  );
$$;

grant execute on function public._is_org_clinician(uuid, uuid) to authenticated;

-- Replace clinician_alerts_select
drop policy if exists "clinician_alerts_select" on public.clinician_alerts;

create policy "clinician_alerts_select"
  on public.clinician_alerts
  for select
  to authenticated
  using (
    public._is_org_clinician(clinician_alerts.org_id, auth.uid())
  );

-- Replace clinician_alert_deliveries_select
drop policy if exists "clinician_alert_deliveries_select" on public.clinician_alert_deliveries;

create policy "clinician_alert_deliveries_select"
  on public.clinician_alert_deliveries
  for select
  to authenticated
  using (
    exists (
      select 1 from public.clinician_alerts ca
      where ca.id = clinician_alert_deliveries.alert_id
        and public._is_org_clinician(ca.org_id, auth.uid())
    )
  );

-- Replace org_patient_thresholds_select
drop policy if exists "org_patient_thresholds_select" on public.org_patient_thresholds;

create policy "org_patient_thresholds_select"
  on public.org_patient_thresholds
  for select
  to authenticated
  using (
    public._is_org_clinician(org_patient_thresholds.org_id, auth.uid())
  );

-- -----------------------------------------------------------------------------
-- From 20270601300011_p30_fix_get_clinic_alert_metrics_ambiguous.sql
-- v_role not in ('admin', 'staff') → v_role not in ('owner', 'clinician')
-- -----------------------------------------------------------------------------
create or replace function public.get_clinic_alert_metrics(p_org_id uuid)
returns table (
  org_id                uuid,
  alert_type            text,
  pending_count         bigint,
  acknowledged_count    bigint,
  total_count           bigint,
  ack_rate_pct          numeric,
  avg_time_to_ack_minutes numeric
)
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $$
declare
  v_caller_uid uuid := auth.uid();
  v_role       public.org_member_role;
begin
  if v_caller_uid is null then
    raise exception 'unauthenticated' using errcode = '28000';
  end if;

  select om.role into v_role
  from public.org_members om
  where om.org_id = p_org_id and om.user_id = v_caller_uid;

  if v_role is null or v_role not in ('owner', 'clinician') then
    raise exception 'owner or clinician role required' using errcode = '42501';
  end if;

  return query
  select
    m.org_id,
    m.alert_type,
    m.pending_count,
    m.acknowledged_count,
    m.total_count,
    m.ack_rate_pct,
    m.avg_time_to_ack_minutes
  from public.mv_clinic_alert_metrics m
  where m.org_id = p_org_id;
end;
$$;

revoke all on function public.get_clinic_alert_metrics(uuid) from public;
grant execute on function public.get_clinic_alert_metrics(uuid) to authenticated;

-- =============================================================================
-- STEP 4: Replace RLS policies whose USING/WITH CHECK clauses reference role literals
-- =============================================================================

-- -----------------------------------------------------------------------------
-- org_settings: org_settings_update_admins
-- role = 'admin' → role = 'owner'
-- -----------------------------------------------------------------------------
drop policy if exists "org_settings_update_admins" on public.org_settings;

create policy "org_settings_update_admins"
  on public.org_settings
  for update
  to authenticated
  using (
    exists (
      select 1 from public.org_members
      where org_id = org_settings.org_id
        and user_id = auth.uid()
        and role = 'owner'
    )
  )
  with check (
    exists (
      select 1 from public.org_members
      where org_id = org_settings.org_id
        and user_id = auth.uid()
        and role = 'owner'
    )
  );

-- -----------------------------------------------------------------------------
-- org_branding: org_branding_update_admins
-- role = 'admin' → role = 'owner'
-- -----------------------------------------------------------------------------
drop policy if exists "org_branding_update_admins" on public.org_branding;

create policy "org_branding_update_admins"
  on public.org_branding
  for update
  to authenticated
  using (
    exists (
      select 1 from public.org_members
      where org_id = org_branding.org_id
        and user_id = auth.uid()
        and role = 'owner'
    )
  )
  with check (
    exists (
      select 1 from public.org_members
      where org_id = org_branding.org_id
        and user_id = auth.uid()
        and role = 'owner'
    )
  );

-- -----------------------------------------------------------------------------
-- org_invites: org_invites_select_admins
-- role = 'admin' → role = 'owner'
-- -----------------------------------------------------------------------------
drop policy if exists "org_invites_select_admins" on public.org_invites;

create policy "org_invites_select_admins"
  on public.org_invites
  for select
  to authenticated
  using (
    exists (
      select 1 from public.org_members
      where org_id = org_invites.org_id
        and user_id = auth.uid()
        and role = 'owner'
    )
  );

-- -----------------------------------------------------------------------------
-- org_subscriptions: org_subscriptions_select_admins
-- role = 'admin' → role = 'owner'
-- -----------------------------------------------------------------------------
drop policy if exists "org_subscriptions_select_admins" on public.org_subscriptions;

create policy "org_subscriptions_select_admins"
  on public.org_subscriptions
  for select
  to authenticated
  using (
    exists (
      select 1 from public.org_members
      where org_id = org_subscriptions.org_id
        and user_id = auth.uid()
        and role = 'owner'
    )
  );

-- -----------------------------------------------------------------------------
-- org_consent_grants: org_consent_grants_select + org_consent_grants_update_revoke_only
-- role = 'admin' → role = 'owner'
-- -----------------------------------------------------------------------------
drop policy if exists "org_consent_grants_select" on public.org_consent_grants;

create policy "org_consent_grants_select"
  on public.org_consent_grants
  for select
  to authenticated
  using (
    auth.uid() = patient_user_id
    or exists (
      select 1 from public.org_members
      where org_id = org_consent_grants.org_id
        and user_id = auth.uid()
        and role = 'owner'
    )
  );

drop policy if exists "org_consent_grants_update_revoke_only" on public.org_consent_grants;

create policy "org_consent_grants_update_revoke_only"
  on public.org_consent_grants
  for update
  to authenticated
  using (
    exists (
      select 1 from public.org_members
      where org_id = org_consent_grants.org_id
        and user_id = auth.uid()
        and role = 'owner'
    )
    and revoked_at is null
  )
  with check (
    revoked_at is not null
  );

-- -----------------------------------------------------------------------------
-- clinician_alerts (direct policy, pre-_is_org_clinician era)
-- role in ('admin', 'staff') → role in ('owner', 'clinician')
-- NOTE: The SECDEF-based replacement was done in STEP 3 (from 300008 migration).
-- The original policy from 300002 is dropped here defensively (idempotent).
-- Drop already done in STEP 3 above via the 300008 re-creation block.
-- -----------------------------------------------------------------------------

-- =============================================================================
-- STEP 5: Post-flight assertions — raise if catalog is in wrong state
-- =============================================================================
do $$
begin
  -- Assert: no old enum values remain
  if exists (
    select 1 from pg_enum
    where enumtypid = 'public.org_member_role'::regtype
      and enumlabel in ('admin', 'viewer')
  ) then
    raise exception 'P31-00 post-flight FAIL: enum still contains admin/viewer';
  end if;

  -- Assert: new enum values are present
  if not exists (
    select 1 from pg_enum
    where enumtypid = 'public.org_member_role'::regtype
      and enumlabel = 'owner'
  ) then
    raise exception 'P31-00 post-flight FAIL: enum missing owner value';
  end if;

  if not exists (
    select 1 from pg_enum
    where enumtypid = 'public.org_member_role'::regtype
      and enumlabel = 'clinician'
  ) then
    raise exception 'P31-00 post-flight FAIL: enum missing clinician value';
  end if;

  if not exists (
    select 1 from pg_enum
    where enumtypid = 'public.org_member_role'::regtype
      and enumlabel = 'staff'
  ) then
    raise exception 'P31-00 post-flight FAIL: enum missing staff value';
  end if;

  -- Assert: _is_org_owner exists
  if not exists (
    select 1 from pg_proc
    where proname = '_is_org_owner'
      and pronamespace = 'public'::regnamespace
  ) then
    raise exception 'P31-00 post-flight FAIL: _is_org_owner not created';
  end if;

  -- Assert: _is_org_admin is gone
  if exists (
    select 1 from pg_proc
    where proname = '_is_org_admin'
      and pronamespace = 'public'::regnamespace
  ) then
    raise exception 'P31-00 post-flight FAIL: _is_org_admin not dropped';
  end if;
end $$;

commit;
