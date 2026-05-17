-- Phase 28 Plan 01 — Task 1 (migration 6/11)
-- org_subscriptions table + RLS (skeleton — P29 owns writes).
-- Per CONTEXT D-14.
--
-- Status ownership:
--   pending → active     : P29 org-subscription-webhook Edge Function (service_role bypass)
--   active  → past_due   : P29 Stripe webhook handler
--   active  → canceled   : P29 Stripe webhook handler
--
-- v1.3 P28 ships skeleton with deny-all writes.
-- P29 adds INSERT/UPDATE policies and Stripe webhook glue via service_role.

create table if not exists public.org_subscriptions (
  org_id                 uuid        not null primary key
                                     references public.organizations(id) on delete restrict,
  stripe_customer_id     text        null,
  stripe_subscription_id text        null,
  status                 text        not null default 'pending',
  current_period_end     timestamptz null,
  seats_paid             integer     not null default 0,
  seats_used             integer     not null default 0,
  updated_at             timestamptz not null default now()
);

alter table public.org_subscriptions enable row level security;

-- SELECT: org admins only (stripe_customer_id is sensitive — T-28-01-06).
create policy "org_subscriptions_select_admins"
  on public.org_subscriptions
  for select
  to authenticated
  using (
    exists (
      select 1 from public.org_members
      where org_id = org_subscriptions.org_id
        and user_id = auth.uid()
        and role = 'admin'
    )
  );

-- v1.3: P28 ships skeleton; P29 owns writes via org-subscription-webhook
-- Edge Function with service_role bypass. No INSERT/UPDATE/DELETE policies
-- for authenticated (explicit default-deny comment per plan spec).
