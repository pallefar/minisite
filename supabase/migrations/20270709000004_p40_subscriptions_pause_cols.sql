-- Phase 40 Plan 40-02 — ALTER subscriptions: add pause lifecycle columns.
--
-- Adds three columns for mirroring Stripe's pause_collection state locally:
--   paused_until  timestamptz  — Stripe's resumes_at unix-sec → ISO timestamp (null if not paused)
--   is_paused     boolean      — true when pause_collection ≠ null on the Stripe subscription
--   reminded_t7   boolean      — dedup flag: set true after T-7d reminder sent; reset on auto-resume
--
-- Partial index accelerates the T-7d cron query:
--   WHERE is_paused = true AND reminded_t7 = false
-- predicate is column-only (IMMUTABLE-safe per reference_supabase_migration_gotchas Pitfall 1).
--
-- A8 pre-check (executed at plan time):
--   grep -rn 'alter table public.subscriptions' supabase/migrations/ | grep -v 20260601000019
--   Found: 20270101000003_subscriptions_provider_guard.sql, 20270601200001_p29_reconcile.sql
--   Both are prior phases — no concurrent Phase 40 ALTER collision.
--
-- subscriptions.id is TEXT (Stripe sub_* format) per reference_minisite_monorepo_layout.

alter table public.subscriptions
  add column if not exists paused_until  timestamptz,
  add column if not exists is_paused     boolean not null default false,
  add column if not exists reminded_t7   boolean not null default false;

-- Partial index: used by pause-reminder-fire cron Fn to find candidates efficiently.
create index if not exists idx_subscriptions_pause_t7
  on public.subscriptions(paused_until)
  where is_paused = true and reminded_t7 = false;

comment on column public.subscriptions.paused_until is
  'Stripe pause_collection.resumes_at as ISO timestamp. null when subscription is not paused. Set by stripe-webhook/events/subscription-updated.ts (40-02).';

comment on column public.subscriptions.is_paused is
  'true when Stripe subscription has pause_collection ≠ null. Mirrors Stripe state for UI gating (D-07). Set by stripe-webhook/events/subscription-updated.ts (40-02).';

comment on column public.subscriptions.reminded_t7 is
  'Dedup flag: set to true once the T-7d pause reminder email has been sent. Reset to false on auto-resume so future pauses re-arm. Managed by pause-reminder-fire Edge Fn (40-02).';

comment on index idx_subscriptions_pause_t7 is
  'Partial index for T-7d cron query: subscriptions approaching paused_until (within 7d window) where reminder not yet sent. Phase 40 Plan 40-02.';
