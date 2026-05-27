---
phase: 66-consumer-account-security
plan: 1
subsystem: auth/security
tags: [supabase, migrations, auth, mfa, lockout, brute-force, rls, secdef-rpc]
requires:
  - supabase/migrations history through 20290104000010 (Phase 65 last)
provides:
  - public.auth_attempts_log (table + 3 indexes + RLS deny-all policy)
  - public.mfa_role_requirements (table + read/write RLS policies + 5 seed rows)
  - public.set_mfa_role_requirement(text, boolean) SECDEF RPC
affects:
  - Phase 66-02..66-09 (sign-in lockout Edge Fn, brute-force alerter, admin UI all consume these tables)
tech-stack:
  added: []
  patterns: [supabase-migration, rls-deny-all, secdef-rpc, auth-users-app-metadata-role-check]
key-files:
  created:
    - supabase/migrations/20290105000001_auth_attempts_log.sql
    - supabase/migrations/20290105000002_mfa_role_requirements.sql
  modified: []
decisions:
  - "Bare `CREATE POLICY` (no `IF NOT EXISTS`) per remote-PG limitation"
  - "`auth_attempts_log` deny-all to authenticated; service-role-bearer-only writes from Edge Fn"
  - "3 partial indexes match D-03 lookup patterns: per-email-window, per-ip-window, recent-failed-scan"
  - "`mfa_role_requirements` read-all-authenticated so client can self-check role requirement on sign-in"
  - "Superadmin-only mutation (separation of privilege; admin cannot relax MFA reqs)"
  - "RPC reads `auth.users.raw_app_meta_data->>'role'` (not `profiles.email`-style join — role lives in app_metadata)"
metrics:
  duration_min: 4
  completed: 2026-05-27T05:03:59Z
  tasks_completed: 2
  files_touched: 2
---

# Phase 66 Plan 1: Schema Foundation Summary

Ship 2 Supabase migrations that lay the schema groundwork for Phase 66's consumer-facing MFA + sign-in lockout: `auth_attempts_log` (every sign-in attempt with outcome + reason, indexed for both lockout-window and brute-force escalation queries) and `mfa_role_requirements` (per-role MFA enforcement config, mutated only via a superadmin SECDEF RPC).

## Tasks Completed

| Task | Description                                        | Commit     | Files                                                          |
| ---- | -------------------------------------------------- | ---------- | -------------------------------------------------------------- |
| 1    | `auth_attempts_log` migration (20290105000001)     | `4d80fe88` | `supabase/migrations/20290105000001_auth_attempts_log.sql`     |
| 2    | `mfa_role_requirements` migration (20290105000002) | `8c428532` | `supabase/migrations/20290105000002_mfa_role_requirements.sql` |

## What Shipped

### `auth_attempts_log` (Task 1)

- `id bigserial PK`, `attempt_at timestamptz default now()`, `email text NULL`, `ip_address inet NULL`, `user_agent text NULL`
- `outcome text CHECK IN ('success','failed','locked','captcha')` — full state machine for downstream lockout + alerter logic
- `failure_reason text NULL` — free-form ('invalid_credentials','user_not_found','locked', etc.)
- `source text DEFAULT 'password' CHECK IN ('password','magic_link','oauth','mfa')`
- 3 partial indexes covering the 3 known hot paths (lockout window per-email, lockout window per-IP, brute-force escalation scan)
- RLS enabled + a single deny-all policy for `authenticated` → Edge Fn writes via service-role-bearer only, and no PostgREST read surface (downstream Plan 66-04/05 read via SECDEF RPCs or service-role Fn)
- 30d retention cron registration **intentionally deferred** to Phase 66-07 close-out (single pg_cron-fn-deploy ordering point per `[[feedback_fn_deploy_before_cron_db_push]]`)

### `mfa_role_requirements` (Task 2)

- `role text PK`, `required boolean DEFAULT false`, `since timestamptz DEFAULT now()`, `updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL`
- RLS: `mfa_role_requirements_read_all` (SELECT to authenticated, USING true) so the client can check on sign-in whether the user's role mandates MFA enrollment
- RLS: `mfa_role_requirements_no_direct_write` (FOR ALL to authenticated, USING/WITH CHECK false) so the only mutation path is the SECDEF RPC below
- Seed rows: `superadmin=true`, `admin=true`, `staff=false`, `clinic-admin=false`, `user=false` (matches CONTEXT.md D-06)
- `set_mfa_role_requirement(p_role text, p_required boolean) RETURNS void` SECDEF function:
  - `SET search_path = public` (search-path injection hardening)
  - Null check on `auth.uid()` (defensive — RLS read can't reach this path but RPC is callable from anywhere)
  - Reads caller role from `auth.users.raw_app_meta_data->>'role'` (project-wide convention — `public.profiles` has no role column, and per memory `profiles.email` is also absent)
  - Hard-codes `caller_role IN ('superadmin')` per the **separation of privilege** decision: `admin` cannot weaken or strengthen MFA requirements on themselves or peers
  - Upsert with `since = now()` + `updated_by = auth.uid()` refresh on every toggle (admin audit trail by querying the table directly)
  - `REVOKE ALL FROM public; GRANT EXECUTE TO authenticated;` — service-role still bypasses, no anon surface

## Lessons Applied

- `[[feedback_phase_close_out_supabase_gotchas]]` — **Bare `CREATE POLICY`** (no `IF NOT EXISTS`); verified by grep.
- `[[reference_profiles_email_vs_auth_users_email]]` — Role reads `auth.users.raw_app_meta_data` directly; no `profiles` JOIN attempted.
- `[[reference_supabase_back_dated_migration_blocks_push]]` — Timestamps `20290105000001/2` strictly forward of last applied `20290104000010`.
- `[[reference_migration_filename_dependency_order]]` — Both migrations are self-contained (no cross-file column refs); safe order.

## Deviations from Plan

None — both tasks executed verbatim from PLAN.md. Both `<verify><automated>` checks pass (T1: 11 ≥ 5 matches; T2: 16 ≥ 4 matches; 0 forbidden `CREATE POLICY IF NOT EXISTS` patterns; 5 seed rows confirmed).

## Self-Check: PASSED

- `supabase/migrations/20290105000001_auth_attempts_log.sql` — FOUND, committed as `4d80fe88`
- `supabase/migrations/20290105000002_mfa_role_requirements.sql` — FOUND, committed as `8c428532`
- No `CREATE POLICY IF NOT EXISTS` in either file — verified
- `set_mfa_role_requirement` SECDEF RPC with superadmin role gate — verified
- 5 seed rows in `mfa_role_requirements` — verified

## Threat Flags

None — surface is in plan's threat model: new auth-attempt log (write-only by service role; documented retention) and MFA config table (read-all-authenticated by design for client-side gate; superadmin-only mutate).
