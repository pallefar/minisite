-- Phase 43 Plan 02 — MEMBER-02 admin SECDEF write RPCs (mirror of cohort_define audit-suppress pattern).
--
-- CONTEXT references:
--   - MEMBER-02 / D-03: admin-managed per-cohort grandfathered Stripe price overrides.
--   - Pattern S2 (denial-by-default): grandfathered_prices has no write RLS
--     policies; these SECDEF RPCs are the only path to mutate the table.
--   - Pattern S3 (audit-suppress): each RPC sets app.suppress_audit then calls
--     log_admin_action explicitly to avoid the trigger-driven duplicate.
--
-- Three functions, all `language plpgsql security definer set search_path =
-- public, extensions, pg_catalog`:
--
--   1. grandfathered_price_create(p_cohort_id, p_stripe_price_id, p_effective_from, p_effective_until) returns uuid
--   2. grandfathered_price_update(p_id, p_stripe_price_id, p_effective_from, p_effective_until) returns boolean
--   3. grandfathered_price_delete(p_id) returns boolean
--
-- All three:
--   - require auth.uid() (raise 'not_authenticated' / '28000' otherwise)
--   - require is_admin_at_least('admin') (raise 'forbidden' / '42501' otherwise)
--   - perform set_config('app.suppress_audit', 'on', true) before INSERT/UPDATE/DELETE
--   - call public.log_admin_action(p_action_name, p_target_user_id, p_table_name, p_row_pk, p_before, p_after)
--     with p_target_user_id = null (these mutations aren't per-user) and
--     p_table_name = 'public.grandfathered_prices'
--   - end with `revoke all from public; grant execute to authenticated;`
--
-- Input validation errcodes:
--   - 'invalid_cohort_id' / '22023'  — null or not in cohort_definitions
--   - 'invalid_stripe_price_id' / '22023'  — null/empty or fails ^price_[A-Za-z0-9]+$
--   - 'invalid_effective_window' / '22023'  — effective_until <= effective_from
--   - 'not_found' / 'P0002'  — update/delete target row missing

-- ============================================================================
-- 1. grandfathered_price_create — admin-gated insert with audit
-- ============================================================================
create or replace function public.grandfathered_price_create(
  p_cohort_id       uuid,
  p_stripe_price_id text,
  p_effective_from  timestamptz,
  p_effective_until timestamptz
)
returns uuid
language plpgsql
security definer
set search_path = public, extensions, pg_catalog
as $$
declare
  v_caller uuid := auth.uid();
  v_row_id uuid;
  v_effective_from timestamptz;
  v_cohort_exists boolean;
begin
  if v_caller is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if not public.is_admin_at_least('admin'::public.admin_role) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  -- Cohort FK pre-check (defensive — FK would also raise, but with a less helpful errcode).
  if p_cohort_id is null then
    raise exception 'invalid_cohort_id' using errcode = '22023';
  end if;
  select exists (
    select 1 from public.cohort_definitions where id = p_cohort_id
  ) into v_cohort_exists;
  if not v_cohort_exists then
    raise exception 'invalid_cohort_id' using errcode = '22023';
  end if;

  -- Stripe price id shape check (mitigates T-43-02-02 tampering).
  if p_stripe_price_id is null
     or length(trim(p_stripe_price_id)) = 0
     or p_stripe_price_id !~ '^price_[A-Za-z0-9]+$' then
    raise exception 'invalid_stripe_price_id' using errcode = '22023';
  end if;

  v_effective_from := coalesce(p_effective_from, now());

  if p_effective_until is not null and p_effective_until <= v_effective_from then
    raise exception 'invalid_effective_window' using errcode = '22023';
  end if;

  -- Suppress the audit-trigger duplicate; we'll call log_admin_action below.
  perform set_config('app.suppress_audit', 'on', true);

  insert into public.grandfathered_prices (
    cohort_id, stripe_price_id, effective_from, effective_until, created_by
  )
  values (
    p_cohort_id, p_stripe_price_id, v_effective_from, p_effective_until, v_caller
  )
  returning id into v_row_id;

  perform public.log_admin_action(
    p_action_name    => 'grandfathered_price_created',
    p_target_user_id => null,
    p_table_name     => 'public.grandfathered_prices',
    p_row_pk         => v_row_id::text,
    p_before         => null,
    p_after          => jsonb_build_object(
                          'cohort_id', p_cohort_id,
                          'stripe_price_id', p_stripe_price_id,
                          'effective_from', v_effective_from,
                          'effective_until', p_effective_until
                        )
  );

  return v_row_id;
end;
$$;

comment on function public.grandfathered_price_create(uuid, text, timestamptz, timestamptz) is
  'P43 MEMBER-02: admin-gated INSERT of a per-cohort grandfathered Stripe '
  'price override. Validates cohort FK + stripe_price_id shape + effective '
  'window; suppresses audit trigger and calls log_admin_action explicitly '
  '(action_name=grandfathered_price_created). Returns the new row id.';

revoke all on function public.grandfathered_price_create(uuid, text, timestamptz, timestamptz) from public;
grant execute on function public.grandfathered_price_create(uuid, text, timestamptz, timestamptz) to authenticated;

-- ============================================================================
-- 2. grandfathered_price_update — admin-gated update with audit
-- ============================================================================
create or replace function public.grandfathered_price_update(
  p_id              uuid,
  p_stripe_price_id text,
  p_effective_from  timestamptz,
  p_effective_until timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = public, extensions, pg_catalog
as $$
declare
  v_caller   uuid := auth.uid();
  v_prev_row public.grandfathered_prices%rowtype;
  v_before   jsonb;
  v_after    jsonb;
  v_new_stripe_price_id text;
  v_new_effective_from  timestamptz;
  v_new_effective_until timestamptz;
begin
  if v_caller is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if not public.is_admin_at_least('admin'::public.admin_role) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select * into v_prev_row
    from public.grandfathered_prices
    where id = p_id
    for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;

  -- COALESCE NULL params to current values (partial-update semantics).
  v_new_stripe_price_id := coalesce(p_stripe_price_id, v_prev_row.stripe_price_id);
  v_new_effective_from  := coalesce(p_effective_from, v_prev_row.effective_from);
  -- effective_until is nullable and meaningful-as-null (open-ended); we cannot
  -- use COALESCE to keep existing value when caller passes NULL. Treat as
  -- "always overwrite" — caller must pass the existing value to preserve it.
  v_new_effective_until := p_effective_until;

  -- Re-validate shape after coalesce.
  if v_new_stripe_price_id is null
     or length(trim(v_new_stripe_price_id)) = 0
     or v_new_stripe_price_id !~ '^price_[A-Za-z0-9]+$' then
    raise exception 'invalid_stripe_price_id' using errcode = '22023';
  end if;

  if v_new_effective_until is not null and v_new_effective_until <= v_new_effective_from then
    raise exception 'invalid_effective_window' using errcode = '22023';
  end if;

  v_before := to_jsonb(v_prev_row);

  perform set_config('app.suppress_audit', 'on', true);

  update public.grandfathered_prices
    set stripe_price_id = v_new_stripe_price_id,
        effective_from  = v_new_effective_from,
        effective_until = v_new_effective_until
    where id = p_id
    returning to_jsonb(public.grandfathered_prices.*) into v_after;

  perform public.log_admin_action(
    p_action_name    => 'grandfathered_price_updated',
    p_target_user_id => null,
    p_table_name     => 'public.grandfathered_prices',
    p_row_pk         => p_id::text,
    p_before         => v_before,
    p_after          => v_after
  );

  return true;
end;
$$;

comment on function public.grandfathered_price_update(uuid, text, timestamptz, timestamptz) is
  'P43 MEMBER-02: admin-gated UPDATE of a per-cohort grandfathered Stripe '
  'price override. Partial-update semantics for stripe_price_id + '
  'effective_from (COALESCE-to-existing); effective_until is always '
  'overwritten (NULL is meaningful = open-ended). Calls log_admin_action with '
  'action_name=grandfathered_price_updated.';

revoke all on function public.grandfathered_price_update(uuid, text, timestamptz, timestamptz) from public;
grant execute on function public.grandfathered_price_update(uuid, text, timestamptz, timestamptz) to authenticated;

-- ============================================================================
-- 3. grandfathered_price_delete — admin-gated delete with audit
-- ============================================================================
create or replace function public.grandfathered_price_delete(p_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, extensions, pg_catalog
as $$
declare
  v_caller   uuid := auth.uid();
  v_prev_row public.grandfathered_prices%rowtype;
  v_before   jsonb;
begin
  if v_caller is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if not public.is_admin_at_least('admin'::public.admin_role) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select * into v_prev_row
    from public.grandfathered_prices
    where id = p_id
    for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;

  v_before := to_jsonb(v_prev_row);

  perform set_config('app.suppress_audit', 'on', true);

  delete from public.grandfathered_prices where id = p_id;

  perform public.log_admin_action(
    p_action_name    => 'grandfathered_price_deleted',
    p_target_user_id => null,
    p_table_name     => 'public.grandfathered_prices',
    p_row_pk         => p_id::text,
    p_before         => v_before,
    p_after          => null
  );

  return true;
end;
$$;

comment on function public.grandfathered_price_delete(uuid) is
  'P43 MEMBER-02: admin-gated DELETE of a per-cohort grandfathered Stripe '
  'price override. Captures before-row jsonb snapshot for audit. Calls '
  'log_admin_action with action_name=grandfathered_price_deleted.';

revoke all on function public.grandfathered_price_delete(uuid) from public;
grant execute on function public.grandfathered_price_delete(uuid) to authenticated;
