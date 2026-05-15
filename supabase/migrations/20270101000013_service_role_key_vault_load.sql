-- Phase 19 Plan 19-09 — BL-7: Vault-based service_role_key access for pg_cron.
--
-- IMPORTANT: this migration contains NO SECRET MATERIAL. The actual key value
-- is loaded out-of-band via Supabase Dashboard → Project Settings → Vault
-- → "Add new secret" with name = 'service_role_key' (Plan 19-09 Task 0).
--
-- The reason we don't use `alter database … set app.service_role_key = ...` is
-- that GUC values land in pg_settings and the migration file would either need
-- the literal key (committed to migration history) or have to read the key
-- from somewhere else — neither is acceptable.
--
-- Migration 20270101000011 (monthly cron) reads the secret via:
--   select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key' limit 1
--
-- This file is a presence + posture guard. It:
--   1. Verifies the `vault.decrypted_secrets` view is available on the project
--      tier (free tier supports Vault since GA — but defensive check anyway).
--   2. Surfaces a clear error if Vault is unavailable.
--   3. Documents the out-of-band setup step in a schema comment so future
--      operators reading `\dn+` immediately see where to look.
--
-- STRIDE register:
--   T-19-09-I Information Disclosure (vault secret in migration history):
--     Mitigated — this file contains zero secret material; the value is held
--     in vault.decrypted_secrets only.

do $$
begin
  if not exists (
    select 1 from information_schema.tables
     where table_schema = 'vault' and table_name = 'decrypted_secrets'
  ) then
    raise exception
      'vault.decrypted_secrets is unavailable on this project. Enable Supabase Vault before applying this migration. Phase 19 Plan 19-09 Task 0 documents the Dashboard step.';
  end if;
end$$;

comment on schema vault is
  'BL-7 (Phase 19 Plan 19-09): service_role_key is loaded into vault.secrets via Dashboard → Project Settings → Vault (out-of-band). pg_cron job affiliate-monthly-payout (migration 20270101000011) reads it via vault.decrypted_secrets to authenticate the call to functions/v1/affiliate-payout.';
