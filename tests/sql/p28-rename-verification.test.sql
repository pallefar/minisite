-- Phase 28 Plan 28-00 RECONCILE — post-rename verification queries.
-- Addendum A1 (2026-05-17) + CONTEXT D-11.
--
-- Run via: supabase db query --linked --file tests/sql/p28-rename-verification.test.sql
--
-- Expected outcomes documented per query below.

-- Test 1: organizations table exists and rows preserved (expected: 105 rows).
select count(*) as organizations_row_count from public.organizations;

-- Test 2: orgs table no longer accessible under old name (expected: NULL).
select to_regclass('public.orgs') as old_orgs_regclass;

-- Test 3: org_status enum values (expected: active, suspended, archived).
select unnest(enum_range(NULL::public.org_status)) as org_status_values;

-- Test 4: new D-11 columns present (expected: 4 rows).
select column_name
from information_schema.columns
where table_schema = 'public'
  and table_name = 'organizations'
  and column_name in ('status', 'is_public_listing', 'current_rank_weights_version', 'created_by')
order by column_name;

-- Test 5: old owner_user_id column absent (expected: 0 rows).
select column_name
from information_schema.columns
where table_schema = 'public'
  and table_name = 'organizations'
  and column_name = 'owner_user_id';

-- Test 6: FKs from sibling tables point at organizations (expected: memberships, invites, roles, role_permissions).
select conname, confrelid::regclass as references_table
from pg_constraint
where contype = 'f'
  and confrelid = 'public.organizations'::regclass
order by conname;
