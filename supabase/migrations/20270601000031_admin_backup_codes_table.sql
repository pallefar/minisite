-- Phase 24: admin_backup_codes table for HMAC-hashed single-use TOTP recovery codes
-- Decision ref: D-08
--
-- On TOTP enrollment, 10 recovery codes are issued as HMAC-hashed rows here.
-- The issuing + consuming RPCs ship in Plan 24-05 (`admin.issue_backup_codes`,
-- `admin.consume_backup_code`).
--
-- D-08: codes are HMAC-hashed at rest; plaintext is shown to the user once
-- (during enrollment) and never stored. Re-display is impossible.
--
-- Single-use enforcement: `used_at` timestamp; consume RPC checks `used_at IS NULL`
-- and sets it atomically. `unique(user_id, code_hash)` prevents duplicate codes.
--
-- RLS:
--   SELECT: only the owning user when at aal2 (TOTP step-up required to view own codes)
--   INSERT/UPDATE/DELETE: REVOKED for all non-postgres roles; only SECURITY DEFINER
--     functions (Plan 24-05) can write.

create table if not exists public.admin_backup_codes (
  id         uuid        primary key default gen_random_uuid(),
  user_id    uuid        not null references auth.users(id) on delete cascade,
  code_hash  text        not null,
  used_at    timestamptz,
  created_at timestamptz not null default now()
);

create unique index if not exists admin_backup_codes_user_hash
  on public.admin_backup_codes (user_id, code_hash);

alter table public.admin_backup_codes enable row level security;

-- SELECT: only the owning user at aal2 (Supabase MFA step-up)
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'admin_backup_codes'
      and policyname = 'abc_select_own_aal2'
  ) then
    create policy "abc_select_own_aal2"
      on public.admin_backup_codes
      for select
      using (
        user_id = auth.uid()
        and (auth.jwt() ->> 'aal') = 'aal2'
      );
  end if;
end $$;

-- REVOKE direct write for all non-owner roles; Plan 24-05 SECURITY DEFINER RPCs own inserts.
revoke insert on public.admin_backup_codes from authenticated, anon, service_role;
revoke update on public.admin_backup_codes from authenticated, anon, service_role;
revoke delete on public.admin_backup_codes from authenticated, anon, service_role;
grant insert, update, delete on public.admin_backup_codes to postgres;
