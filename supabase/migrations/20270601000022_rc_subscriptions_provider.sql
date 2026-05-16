-- Phase 16 Plan 06 — MONEY-06 — RevenueCat provider discriminator.
--
-- Background (D-02 / D-04):
--   The `public.subscriptions` table already has a `provider` text column with
--   CHECK (provider in ('stripe','revenuecat')) from Phase 14 migration
--   20260601000019. This migration extends `subscription_events` with the same
--   discriminator AND adds a partial unique index so the RevenueCat webhook can
--   safely `upsert({...}, { onConflict: 'user_id,provider' })`.
--
-- Intentionally NO new RLS policies (subscription_events stays deny-all for
-- authenticated; service-role webhooks bypass). NO Postgres enums introduced
-- (text + CHECK matches existing subscriptions.provider shape; avoids the
-- enum-add-in-same-tx anti-pattern).
--
-- Landmines avoided (reference_supabase_migration_gotchas):
--   Pitfall 1: partial-index predicate `user_id IS NOT NULL` is IMMUTABLE
--     (column-only, no functions, no now()) — safe.
--   No SECURITY DEFINER funcs here (search_path gotcha N/A).
--
-- Renumber note: original plan filenames used 20270101000001/000002. Those
-- timestamps are EARLIER than the live registry's highest applied migration
-- (20270601000021) on project ytnsipxxmzgaebkqmokp, which would cause
-- `supabase db push --linked` to silently SKIP them (project rule:
-- reference_supabase_migration_filename_regex). Renumbered to
-- 20270601000022/000023.

-- ─── 1. Add provider column to subscription_events (idempotent) ──────────────
alter table public.subscription_events
  add column if not exists provider text not null default 'stripe';

-- ─── 2. Add CHECK constraint via DO block (portable across Postgres versions) ─
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'subscription_events_provider_check'
      and conrelid = 'public.subscription_events'::regclass
  ) then
    alter table public.subscription_events
      add constraint subscription_events_provider_check
      check (provider in ('stripe','revenuecat'));
  end if;
end $$;

-- ─── 3. Per-provider event-stream index ──────────────────────────────────────
create index if not exists idx_subscription_events_provider_received
  on public.subscription_events(provider, received_at desc);

-- ─── 4. Partial unique index on subscriptions(user_id, provider) ─────────────
-- Enables RevenueCat webhook upsert via { onConflict: 'user_id,provider' }.
-- Stripe rows with user_id IS NULL (clinic subs) remain unique only by id PK —
-- this index does not constrain them. The predicate is IMMUTABLE (column-only).
create unique index if not exists idx_subscriptions_user_provider_unique
  on public.subscriptions(user_id, provider)
  where user_id is not null;

comment on index public.idx_subscriptions_user_provider_unique is
  'Phase 16 D-02: one row per (user, provider) for user-scoped subs. Supports RC webhook upsert with onConflict: user_id,provider.';
