-- Phase 39 Plan 39-07 — pgTAP proof: admin_ship_below_95 audit trail invariant.
--
-- Proves (T-39-07-01 + T-39-07-02 mitigations):
--   1. admin_ship_below_95 rejects non-superadmin caller (insufficient_privilege /
--      forbidden_not_superadmin) — T-39-07-02 elevation gate.
--   2. admin_ship_below_95 succeeds for a superadmin caller AND writes EXACTLY
--      one admin_audit_log row with action='ship_below_95' + p_reason + p_posterior
--      populated in the context jsonb — T-39-07-01 repudiation mitigation.
--   3. admin_audit_log has RLS enabled + NO INSERT/UPDATE/DELETE policy
--      (Pattern S2 — SECDEF RPC is the only writer).
--   4. admin_ship_below_95 raises reason_required for empty p_reason — defense-
--      in-depth for the typed-confirmation modal's client-side trim contract.
--
-- Pattern: mirrors p39_rls_user_experiments.sql shape + role-impersonation via
--   set local role to authenticated + set local request.jwt.claim.sub.
--
-- Named dollar-quote tags ($auth$) per
--   [[reference_postgres_dollar_quote_nesting_in_cron_body]].
-- begin/rollback leaves zero DB residue.

begin;

select plan(7);

-- ──────────────────────────────────────────────────────────────────────────────
-- SETUP: create two synthetic auth.users + corresponding profiles rows.
-- One admin (NOT superadmin), one superadmin. We use service_role role inside
-- the SETUP block to bypass RLS / direct-write policies; the actual RPC calls
-- below switch to the authenticated role + set the jwt.sub claim.
-- ──────────────────────────────────────────────────────────────────────────────

set local role to service_role;

-- Synthetic UUIDs (deterministic for grep'ability).
\set admin_uid       '\'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa\''
\set superadmin_uid  '\'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb\''
\set variant_uid     '\'cccccccc-cccc-cccc-cccc-cccccccccccc\''

-- auth.users rows (minimal; we only need id to satisfy FKs).
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, email_change, email_change_token_new, recovery_token)
values
  (:admin_uid::uuid,      '00000000-0000-0000-0000-000000000000'::uuid, 'authenticated', 'authenticated', 'p39-admin@test.local',      '', '{}'::jsonb, '{}'::jsonb, now(), now(), '', '', '', ''),
  (:superadmin_uid::uuid, '00000000-0000-0000-0000-000000000000'::uuid, 'authenticated', 'authenticated', 'p39-superadmin@test.local', '', '{}'::jsonb, '{}'::jsonb, now(), now(), '', '', '', '');

-- profiles rows with the relevant admin_role values.
insert into public.profiles (id, admin_role)
values
  (:admin_uid::uuid,      'admin'::public.admin_role),
  (:superadmin_uid::uuid, 'superadmin'::public.admin_role)
on conflict (id) do update set admin_role = excluded.admin_role;

-- ──────────────────────────────────────────────────────────────────────────────
-- TEST 1: admin_audit_log has RLS enabled.
-- ──────────────────────────────────────────────────────────────────────────────

select ok(
  (
    select relrowsecurity
      from pg_class
     where relname = 'admin_audit_log'
       and relnamespace = 'public'::regnamespace
  ),
  'admin_audit_log has row-level security enabled'
);

-- ──────────────────────────────────────────────────────────────────────────────
-- TEST 2: admin_audit_log has NO INSERT/UPDATE/DELETE/ALL policies — Pattern S2.
-- ──────────────────────────────────────────────────────────────────────────────

select ok(
  (
    select count(*) = 0
      from pg_policies
     where schemaname = 'public'
       and tablename = 'admin_audit_log'
       and cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL')
  ),
  'admin_audit_log has NO INSERT/UPDATE/DELETE/ALL policies — '
  'denial-by-default; writes flow through SECDEF RPC only (Pattern S2)'
);

-- ──────────────────────────────────────────────────────────────────────────────
-- TEST 3: admin role (NOT superadmin) is REJECTED by admin_ship_below_95.
-- T-39-07-02 elevation gate.
-- ──────────────────────────────────────────────────────────────────────────────

set local role to authenticated;
select set_config('request.jwt.claim.sub', :admin_uid, true);

select throws_ok(
  $auth$ select public.admin_ship_below_95(
    'cccccccc-cccc-cccc-cccc-cccccccccccc'::uuid,
    'attempting to ship as admin (not superadmin)',
    0.82
  ) $auth$,
  '42501',
  'forbidden_not_superadmin',
  'admin (not superadmin) is rejected by admin_ship_below_95 — T-39-07-02'
);

reset role;

-- ──────────────────────────────────────────────────────────────────────────────
-- TEST 4: superadmin can call admin_ship_below_95 successfully.
-- ──────────────────────────────────────────────────────────────────────────────

set local role to authenticated;
select set_config('request.jwt.claim.sub', :superadmin_uid, true);

select lives_ok(
  $auth$ select public.admin_ship_below_95(
    'cccccccc-cccc-cccc-cccc-cccccccccccc'::uuid,
    'segment data already validates this variant',
    0.82
  ) $auth$,
  'superadmin can invoke admin_ship_below_95 — T-39-07-02 inverse'
);

reset role;

-- ──────────────────────────────────────────────────────────────────────────────
-- TEST 5: EXACTLY one admin_audit_log row was written for this variant by
-- the superadmin call, with the correct action + context fields populated.
-- T-39-07-01 repudiation mitigation.
-- ──────────────────────────────────────────────────────────────────────────────

set local role to service_role;

select ok(
  (
    select count(*) = 1
      from public.admin_audit_log
     where actor_id = :superadmin_uid::uuid
       and action = 'ship_below_95'
       and context->>'variant_id' = 'cccccccc-cccc-cccc-cccc-cccccccccccc'
       and context->>'reason' = 'segment data already validates this variant'
       and (context->>'posterior')::numeric = 0.82
  ),
  'admin_audit_log has EXACTLY one ship_below_95 row with full context — '
  'T-39-07-01 repudiation mitigation'
);

-- ──────────────────────────────────────────────────────────────────────────────
-- TEST 6: empty reason is rejected (defense-in-depth — modal also enforces).
-- ──────────────────────────────────────────────────────────────────────────────

set local role to authenticated;
select set_config('request.jwt.claim.sub', :superadmin_uid, true);

select throws_ok(
  $auth$ select public.admin_ship_below_95(
    'cccccccc-cccc-cccc-cccc-cccccccccccc'::uuid,
    '   ',
    0.82
  ) $auth$,
  '22023',
  'reason_required',
  'admin_ship_below_95 rejects whitespace-only reason — D-12 defense-in-depth'
);

reset role;

-- ──────────────────────────────────────────────────────────────────────────────
-- TEST 7: admin_audit_log_action_created_idx exists (operational query support).
-- ──────────────────────────────────────────────────────────────────────────────

select has_index(
  'public',
  'admin_audit_log',
  'admin_audit_log_action_created_idx',
  'admin_audit_log_action_created_idx exists for (action, created_at desc) lookups'
);

select * from finish();

rollback;
