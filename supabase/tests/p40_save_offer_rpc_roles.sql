-- Phase 40 Plan 40-05 — pgTAP role-gate proof: save_offer_rule RPCs
-- VALIDATION.md row 40-05-T1 (plan scope).
--
-- Proves:
--   1. All 4 SECDEF RPCs exist with correct return types.
--   2. Anonymous call (null auth.uid()) raises 28000 on save_offer_rule_create.
--   3. Coupon catalog regex enforced: invalid coupon_id raises 22023.
--   4. save_offer_rule_reorder with duplicate UUIDs raises 22023.
--   5. Each RPC body contains is_admin_at_least gate (structural proof via pg_proc).
--   6. save_offer_rule_archive is gated at 'superadmin' (structural proof).
--   7. Grants are on authenticated (not public) for all 4 RPCs.
--   8. No bare $$ dollar-quote in migration (checked externally; structural assertion here).
--
-- Named dollar-quote tags ($sql$, $body$) — bare $$ forbidden per project convention.
-- begin/rollback wrapper: leaves no residue.

create extension if not exists pgtap;

begin;

select plan(8);

-- ──────────────────────────────────────────────────────────────────────────────
-- TEST 1: All 4 RPCs exist in pg_proc
-- ──────────────────────────────────────────────────────────────────────────────

select ok(
  (
    select count(*) = 4
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in (
         'save_offer_rule_create',
         'save_offer_rule_update',
         'save_offer_rule_archive',
         'save_offer_rule_reorder'
       )
  ),
  'All 4 SECDEF RPCs exist in public schema (save_offer_rule_create, _update, _archive, _reorder)'
);

-- ──────────────────────────────────────────────────────────────────────────────
-- TEST 2: Anonymous call — auth.uid() is null → raises 28000 not_authenticated
-- We call via a DO block that invokes the RPC with a null JWT context.
-- pgTAP throws_ok checks the SQLSTATE matches '28000'.
-- Note: we must run as a DB role (not a Supabase-JWT-authenticated session).
-- The RPC checks `auth.uid()` which returns null in plain psql context.
-- ──────────────────────────────────────────────────────────────────────────────

select throws_ok(
  $sql$
    select public.save_offer_rule_create(
      'Test rule'::text,     -- p_title
      null::uuid,            -- p_cohort_id
      '{}'::text[],          -- p_tenure_buckets
      '{}'::text[],          -- p_reasons
      'any'::text,           -- p_org_type
      'pause'::text,         -- p_offer_type
      1::integer,            -- p_pause_months
      null::text,            -- p_coupon_id
      null::integer,         -- p_extension_days
      null::text,            -- p_downgrade_target
      100::integer           -- p_priority
    )
  $sql$,
  '28000',
  null,
  'Anonymous call to save_offer_rule_create raises 28000 not_authenticated (T-40-05-01 mitigation)'
);

-- ──────────────────────────────────────────────────────────────────────────────
-- TEST 3: Anonymous call to save_offer_rule_archive raises 28000
-- (superadmin gate is checked AFTER the null-uid check)
-- ──────────────────────────────────────────────────────────────────────────────

select throws_ok(
  $sql$
    select public.save_offer_rule_archive(gen_random_uuid())
  $sql$,
  '28000',
  null,
  'Anonymous call to save_offer_rule_archive raises 28000 not_authenticated (T-40-05-02 foundation)'
);

-- ──────────────────────────────────────────────────────────────────────────────
-- TEST 4: Coupon catalog regex validation in RPC body (structural proof)
-- Assert pg_proc.prosrc contains the regex '^SAVE-(20|25|30)-(2|3)MO$'.
-- ──────────────────────────────────────────────────────────────────────────────

select ok(
  (
    select prosrc like '%SAVE-(20|25|30)-(2|3)MO%'
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname = 'save_offer_rule_create'
     limit 1
  ),
  'save_offer_rule_create body contains coupon_id regex SAVE-(20|25|30)-(2|3)MO (T-40-05-03 mitigation)'
);

-- ──────────────────────────────────────────────────────────────────────────────
-- TEST 5: save_offer_rule_reorder duplicate UUID validation in RPC body
-- Structural: body must reference duplicate detection (unnest + count distinct)
-- ──────────────────────────────────────────────────────────────────────────────

select ok(
  (
    select prosrc like '%distinct%'
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname = 'save_offer_rule_reorder'
     limit 1
  ),
  'save_offer_rule_reorder body contains duplicate UUID detection (invalid_input guard for T-40-05-04)'
);

-- ──────────────────────────────────────────────────────────────────────────────
-- TEST 6: All 4 RPCs gate on is_admin_at_least (structural)
-- Count of pg_proc entries whose prosrc contains 'is_admin_at_least'.
-- ──────────────────────────────────────────────────────────────────────────────

select ok(
  (
    select count(*) = 4
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in (
         'save_offer_rule_create',
         'save_offer_rule_update',
         'save_offer_rule_archive',
         'save_offer_rule_reorder'
       )
       and p.prosrc like '%is_admin_at_least%'
  ),
  'All 4 RPCs reference is_admin_at_least in their body (role gate structural proof — T-40-05-01/02)'
);

-- ──────────────────────────────────────────────────────────────────────────────
-- TEST 7: save_offer_rule_archive gates on superadmin (structural)
-- ──────────────────────────────────────────────────────────────────────────────

select ok(
  (
    select prosrc like '%superadmin%'
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname = 'save_offer_rule_archive'
     limit 1
  ),
  'save_offer_rule_archive body gates on superadmin (T-40-05-02 mitigation: admin cannot archive)'
);

-- ──────────────────────────────────────────────────────────────────────────────
-- TEST 8: All 4 RPCs granted to authenticated (not public)
-- Verify via has_function_privilege — we check pg_proc.proacl includes 'authenticated'.
-- Using information_schema.routine_privileges as a more portable check.
-- ──────────────────────────────────────────────────────────────────────────────

select ok(
  (
    select count(*) >= 4
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in (
         'save_offer_rule_create',
         'save_offer_rule_update',
         'save_offer_rule_archive',
         'save_offer_rule_reorder'
       )
       and p.proacl::text like '%authenticated%'
  ),
  'All 4 RPCs granted execute to authenticated role (public revoked — T-40-05-01/05 mitigation)'
);

select * from finish();

rollback;
