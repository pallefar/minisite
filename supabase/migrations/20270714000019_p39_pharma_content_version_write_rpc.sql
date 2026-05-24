-- Phase 39 Plan 39-08 — pharma_content_version_write SECDEF RPC.
--
-- CONTEXT references (39-CONTEXT.md):
--   D-05 + D-06 (safety-info carveout integrity requires immutable audit of
--     any pharma copy edit).
--   PHARMA-07 (admin sees + creates version history for pharma content).
--
-- STRIDE register (39-08-PLAN.md <threat_model>):
--   T-39-08-02 Tampering: pharma_content_versions is append-only. This RPC
--     is the ONLY write path. The table's RLS has NO INSERT/UPDATE/DELETE
--     policies (proven by Plan 39-05 pgTAP). SECDEF here bypasses RLS to
--     append, but cannot rewrite (it only INSERTs).
--   T-39-08-05 Spoofing: is_admin_at_least('admin') gate at top of body.
--
-- Pattern memory:
--   - [[reference_supabase_migration_gotchas]]: SECURITY DEFINER requires
--     `set search_path = extensions, public, pg_temp`.
--   - Sibling SECDEF pattern: 20270714000017_p39_admin_ship_below_95_rpc.sql.
--   - pharma_content_versions table shipped by 20270714000005.

create or replace function public.pharma_content_version_write(
  p_content_id           uuid,
  p_diff                 jsonb,
  p_clinical_signoff_by  uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = extensions, public, pg_temp
as $$
declare
  v_author_id uuid;
  v_new_id    uuid;
begin
  -- T-39-08-05 Spoofing gate.
  if not public.is_admin_at_least('admin'::public.admin_role) then
    raise exception 'forbidden_not_admin'
      using errcode = '42501',
            hint = 'pharma_content_version_write requires admin role.';
  end if;

  -- Input validation.
  if p_content_id is null then
    raise exception 'invalid_content_id'
      using errcode = '22023',
            hint = 'p_content_id must not be null.';
  end if;

  if p_diff is null then
    raise exception 'invalid_diff'
      using errcode = '22023',
            hint = 'p_diff must not be null (pass {} for an empty diff).';
  end if;

  -- FK existence check — fail fast with a useful errcode instead of a generic FK violation.
  if not exists (select 1 from public.pharma_content where id = p_content_id) then
    raise exception 'pharma_content_not_found'
      using errcode = 'P0002',
            hint = 'p_content_id does not match any pharma_content row.';
  end if;

  v_author_id := auth.uid();

  insert into public.pharma_content_versions (
    content_id,
    diff,
    author_id,
    clinical_signoff_by,
    clinical_signoff_at
  ) values (
    p_content_id,
    p_diff,
    v_author_id,
    p_clinical_signoff_by,
    case when p_clinical_signoff_by is not null then now() else null end
  )
  returning id into v_new_id;

  return v_new_id;
end;
$$;

comment on function public.pharma_content_version_write(uuid, jsonb, uuid) is
  'Phase 39 PHARMA-07 + T-39-08-02/05: admin-only SECDEF RPC that appends one '
  'pharma_content_versions row with diff + author_id (auth.uid) + optional '
  'clinical_signoff_by (auto-sets clinical_signoff_at when supplied). Returns '
  'the new row id. ONLY write path for pharma_content_versions — table has no '
  'INSERT/UPDATE/DELETE RLS policies (default-deny). Idempotent only at the '
  'caller layer (no UNIQUE constraint — every edit is a distinct audit row).';

revoke all on function public.pharma_content_version_write(uuid, jsonb, uuid) from public;
grant execute on function public.pharma_content_version_write(uuid, jsonb, uuid)
  to authenticated;
