-- Phase 28 Plan 01 — Task 1 (migration 1/11)
-- org_member_role enum: admin | staff | viewer
-- Per CONTEXT D-12.

do $$
begin
  if not exists (select 1 from pg_type where typname = 'org_member_role') then
    create type public.org_member_role as enum ('admin', 'staff', 'viewer');
  end if;
end $$;
