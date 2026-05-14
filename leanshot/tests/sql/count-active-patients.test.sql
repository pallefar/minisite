-- Phase 14 Plan 01 — pgTAP-style plain-SQL test for count_active_patients().
--
-- Schema note: The live DB uses public.orgs (not clinics) and public.memberships
-- (not clinic_memberships). Active membership = revoked_at IS NULL.
-- Patient role = 'View-only' (the default role assigned on invite acceptance).
--
-- Fixture:
--   1 org + 1 Owner membership + 5 patient (View-only) memberships
--   3 patients: revoked_at IS NULL + recent injection row  → counted
--   1 patient:  revoked_at IS NULL + NO logs               → excluded (D-02 no-activity)
--   1 patient:  revoked_at IS NOT NULL + recent injection  → excluded (inactive/revoked)
--
-- Expected: count_active_patients(org_id) = 3
--
-- Run via:
--   psql "$SUPABASE_DB_URL" -f leanshot/tests/sql/count-active-patients.test.sql
-- Expect clean ROLLBACK output (no ERROR or RAISE EXCEPTION output).
--
-- The test runs in a BEGIN/ROLLBACK block so the fixture cleans itself up
-- automatically — safe to run against the live DB.

BEGIN;

DO $$
DECLARE
  v_org_id       uuid := gen_random_uuid();
  v_owner_id     uuid := gen_random_uuid();
  v_view_role_id uuid;

  -- Patient user IDs
  v_p1           uuid := gen_random_uuid();  -- active + logs  → counted
  v_p2           uuid := gen_random_uuid();  -- active + logs  → counted
  v_p3           uuid := gen_random_uuid();  -- active + logs  → counted
  v_p4           uuid := gen_random_uuid();  -- active + NO logs → excluded
  v_p5           uuid := gen_random_uuid();  -- REVOKED + logs  → excluded

  v_count        integer;
BEGIN
  -- 1. Insert org row directly (bypass create_org RPC to avoid seeding system roles
  --    via trigger — we'll manually insert just the roles we need for this test).
  INSERT INTO public.orgs (id, slug, name, owner_user_id)
  VALUES (v_org_id, 'cap-test-' || left(v_org_id::text, 8), 'CAP Test Org', v_owner_id);

  -- 2. The seed_system_roles trigger fires automatically after the orgs INSERT above.
  --    Retrieve the View-only role id (seeded by the trigger).
  SELECT id INTO v_view_role_id
  FROM public.roles
  WHERE org_id = v_org_id
    AND name = 'View-only'
    AND is_system = true;

  IF v_view_role_id IS NULL THEN
    RAISE EXCEPTION 'seed_system_roles trigger did not seed View-only role for org %', v_org_id;
  END IF;

  -- 3. Insert 5 patient memberships with View-only role.
  --    P1–P3: active (revoked_at IS NULL).
  --    P4:    active, no activity logs.
  --    P5:    revoked (revoked_at IS NOT NULL) — should be excluded.
  INSERT INTO public.memberships (user_id, org_id, role_id, accepted_at)
  VALUES
    (v_p1, v_org_id, v_view_role_id, now()),
    (v_p2, v_org_id, v_view_role_id, now()),
    (v_p3, v_org_id, v_view_role_id, now()),
    (v_p4, v_org_id, v_view_role_id, now());

  -- P5: insert then immediately revoke.
  INSERT INTO public.memberships (user_id, org_id, role_id, accepted_at, revoked_at)
  VALUES (v_p5, v_org_id, v_view_role_id, now(), now());

  -- 4. Insert injection rows for active+logged patients (P1, P2, P3) within last 30 days.
  --    Using a random log_id per row (injections has PK (user_id, log_id)).
  INSERT INTO public.injections (user_id, log_id, medication, dose, unit, site, notes, logged_at)
  VALUES
    (v_p1, gen_random_uuid()::text, 'ozempic', '0.5', 'mg', 'thigh-l', '', now() - interval '7 days'),
    (v_p2, gen_random_uuid()::text, 'ozempic', '0.5', 'mg', 'thigh-r', '', now() - interval '14 days'),
    (v_p3, gen_random_uuid()::text, 'ozempic', '1.0', 'mg', 'abdomen-ul', '', now() - interval '1 day');

  -- Also insert an injection for P5 (revoked) — should NOT be counted.
  INSERT INTO public.injections (user_id, log_id, medication, dose, unit, site, notes, logged_at)
  VALUES (v_p5, gen_random_uuid()::text, 'ozempic', '0.5', 'mg', 'thigh-l', '', now() - interval '2 days');

  -- P4 intentionally has NO activity logs.

  -- 5. Call count_active_patients as service_role (auth.uid() = NULL in this context).
  SELECT public.count_active_patients(v_org_id) INTO v_count;

  IF v_count <> 3 THEN
    RAISE EXCEPTION 'count_active_patients expected 3 active patients, got %  (org: %)', v_count, v_org_id;
  END IF;

  RAISE NOTICE 'count_active_patients test PASSED: returned % (expected 3)', v_count;
END $$;

ROLLBACK;
