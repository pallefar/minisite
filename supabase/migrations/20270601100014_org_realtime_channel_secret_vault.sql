-- Phase 28 Plan 04 Task 2 — Vault entry documentation migration.
--
-- Contract: The Vault secret `org_realtime_channel_secret` (32-byte random hex,
-- generated via `openssl rand -hex 32`) MUST be minted out-of-band by the
-- operator BEFORE this migration runs (P28 Plan-04 Task 1 HUMAN-CHECKPOINT,
-- or orchestrator pre-flight in CI using the Management-API pattern).
--
-- This migration asserts the runtime contract — it raises an error if the
-- secret is MISSING so that misconfigured deployments fail loudly rather
-- than silently serving broken channel authorization.
--
-- Idempotent: safe to re-run. If the secret exists the do-block is a no-op.

do $$
begin
  if not exists (
    select 1
    from vault.decrypted_secrets
    where name = 'org_realtime_channel_secret'
  ) then
    raise exception
      'DEPLOYMENT BLOCKER: Vault secret org_realtime_channel_secret is missing. '
      'Run: SECRET=$(openssl rand -hex 32) && '
      'supabase db query --linked "select vault.create_secret(''<SECRET>'', ''org_realtime_channel_secret'');"';
  end if;
end $$;
