-- Phase 54 Plan 54-01 Task 1 — extend push_subscriptions for native push.
--
-- Adds: platform (web|ios|android), device_token (APNs/FCM), failure_count.
-- Backfills existing web rows: platform defaults to 'web'; endpoint/p256dh/auth
-- become nullable so native rows (which carry device_token instead) are valid.
--
-- Forward-dated to 20280201000001 (past latest applied 20280101000002) per
-- memory reference_supabase_back_dated_migration_blocks_push.
--
-- Migration is idempotent:
--   - ADD COLUMN IF NOT EXISTS
--   - DROP CONSTRAINT IF EXISTS before ADD CONSTRAINT
--   - DO $$ ... exception when duplicate_object then null; end $$ for UNIQUE
--   - DROP INDEX IF EXISTS ... CREATE UNIQUE INDEX IF NOT EXISTS
--
-- Per D-01..D-03 / PUSH-02 / PUSH-03 / PUSH-08.
-- NOTE: the rejected parallel-table name was NOT used (PUSH-02 decision D-02).

begin;

-- ─── 1. Add new columns ──────────────────────────────────────────────────────

alter table public.push_subscriptions
  add column if not exists platform     text not null default 'web',
  add column if not exists device_token text,
  add column if not exists failure_count int  not null default 0;

-- ─── 2. Platform CHECK ───────────────────────────────────────────────────────

alter table public.push_subscriptions
  drop constraint if exists push_subscriptions_platform_chk;

alter table public.push_subscriptions
  add constraint push_subscriptions_platform_chk
    check (platform in ('web', 'ios', 'android'));

-- ─── 3. Relax NOT NULL on web-only credential columns ───────────────────────
--
-- Native rows (ios/android) carry only device_token; endpoint/p256dh/auth are
-- NULL for those rows. The structural CHECK below (step 4) enforces per-platform
-- integrity instead of the NOT NULL database constraint.
--
-- Also drop the length-based nonempty CHECKs — they fire on nullable columns
-- and would reject native rows where these columns are NULL.

alter table public.push_subscriptions
  alter column endpoint drop not null,
  alter column p256dh   drop not null,
  alter column auth     drop not null;

alter table public.push_subscriptions
  drop constraint if exists push_subscriptions_endpoint_nonempty_chk,
  drop constraint if exists push_subscriptions_p256dh_nonempty_chk,
  drop constraint if exists push_subscriptions_auth_nonempty_chk;

-- ─── 4. Structural integrity CHECK (web-or-native) ──────────────────────────
--
-- Web rows: endpoint, p256dh, auth must all be NOT NULL (VAPID credentials).
-- Native rows: device_token must be NOT NULL (APNs/FCM registration token).
-- T-54-01-01 mitigation: prevents invalid hybrid rows.

alter table public.push_subscriptions
  drop constraint if exists push_subscriptions_web_or_native_chk;

alter table public.push_subscriptions
  add constraint push_subscriptions_web_or_native_chk
    check (
      (platform = 'web' and endpoint is not null and p256dh is not null and auth is not null)
      or
      (platform in ('ios', 'android') and device_token is not null)
    );

-- ─── 5. Partial unique index for native tokens ───────────────────────────────
--
-- The existing UNIQUE(user_id, endpoint) covers web rows. Native rows use
-- device_token; a partial unique index prevents token-stuffing per user.
-- T-54-01-02 mitigation: prevents duplicate native row registration.
-- WHERE device_token IS NOT NULL ensures web rows (device_token=NULL) are
-- excluded and the existing (user_id, endpoint) unique remains authoritative.

do $$
begin
  if not exists (
    select 1 from pg_indexes
     where schemaname = 'public'
       and tablename  = 'push_subscriptions'
       and indexname  = 'push_subscriptions_user_device_token_uniq'
  ) then
    execute '
      create unique index push_subscriptions_user_device_token_uniq
        on public.push_subscriptions (user_id, device_token)
        where device_token is not null
    ';
  end if;
end $$;

-- ─── 6. Column documentation (non-comment SQL so grep gates register it) ────

comment on column public.push_subscriptions.platform is
  'Push platform discriminator: web (VAPID/web-push), ios (APNs), android (FCM). Default web for all pre-Phase-54 rows. failure_count increments on delivery failure; row auto-pruned after 3 consecutive failures (PUSH-08).';

comment on column public.push_subscriptions.device_token is
  'APNs/FCM registration token for native push rows (platform = ios | android). NULL for web rows. Covered by partial unique index push_subscriptions_user_device_token_uniq.';

comment on column public.push_subscriptions.failure_count is
  'Consecutive delivery failures. Reset to 0 on success. Row deleted by push-dispatch when failure_count reaches 3 (PUSH-08 auto-prune).';

commit;
