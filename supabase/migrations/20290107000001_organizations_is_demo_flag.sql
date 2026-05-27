-- Phase 68 Plan 01 — Task 1
-- Add `is_demo` flag + `demo_extended_until` to public.organizations.
--
-- LAND-05 + LAND-06: demo/sandbox orgs for clinic-buyer prospects.
--   - is_demo: flips org into demo mode (drives auto-purge cron + admin UI label).
--   - demo_extended_until: admin can push purge out up to 30d from created_at.
--
-- Drift-safe per [[reference_postgres_do_block_drift_safe_migration]] —
-- last applied remote migration is 20290103000005; this file is post-newest-applied
-- but `public.organizations` may not exist on every environment (drift). Wrap
-- the ALTER in a DO-block + `exception when undefined_table` so the migration
-- is idempotent across local + remote + new-env scenarios.

do $$
begin
  alter table public.organizations
    add column if not exists is_demo boolean not null default false,
    add column if not exists demo_extended_until timestamptz null;
exception when undefined_table then
  raise notice 'public.organizations does not exist on this database (drift); skipping is_demo column addition';
end $$;

-- Partial index for the daily demo-org-purge cron (where is_demo = true).
-- Predicate uses only column equality — IMMUTABLE, safe for partial indexes.
-- Guard with DO-block in case the table itself is missing.
do $$
begin
  if exists (
    select 1 from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where c.relname = 'organizations' and n.nspname = 'public'
  ) then
    execute 'create index if not exists idx_organizations_is_demo
      on public.organizations(created_at)
      where is_demo = true';
  else
    raise notice 'public.organizations does not exist; skipping idx_organizations_is_demo';
  end if;
end $$;

-- Column comments (drift-safe — comment on non-existent column raises an error,
-- so wrap in DO-block too).
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'organizations' and column_name = 'is_demo'
  ) then
    execute $cmt$comment on column public.organizations.is_demo is 'Phase 68 LAND-05: demo/sandbox org for clinic-buyer prospects. Auto-purged at created_at+7d unless demo_extended_until > now() (cap 30d via admin UI).'$cmt$;
  end if;
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'organizations' and column_name = 'demo_extended_until'
  ) then
    execute $cmt$comment on column public.organizations.demo_extended_until is 'Phase 68 LAND-06: admin can extend demo org up to 30 days from created_at; cron compares this vs now() before purge.'$cmt$;
  end if;
end $$;
