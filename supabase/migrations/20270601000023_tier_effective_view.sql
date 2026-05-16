-- Phase 16 Plan 06 — MONEY-06 / MONEY-07 — tier_effective view.
--
-- D-02 contract: per-user effective tier is `MAX(current_period_end) > now()`
-- across ALL providers (stripe + revenuecat). One source of truth so iOS RC
-- purchases (16-05) and web Stripe upgrades (Phase 14) are honestly reconciled.
--
-- Security model:
--   `security_invoker = true` → view executes with the caller's RLS context;
--   the underlying subscriptions table's existing policy
--   ("users read own sub": auth.uid() = user_id) automatically scopes the rows.
--   No new policy needed; no SECURITY DEFINER function (avoids the
--   search_path = extensions gotcha entirely).
--
-- Note: `now()` is volatile but THAT is fine inside a VIEW — re-evaluated on
-- every SELECT. The IMMUTABLE-only rule applies to partial-index predicates,
-- not view definitions.

create or replace view public.tier_effective as
  select
    user_id,
    max(current_period_end) as effective_expires_at,
    case
      when max(current_period_end) > now() then 'paid'
      when bool_or(status = 'past_due') then 'past_due'
      else 'free'
    end as tier,
    array_agg(distinct provider order by provider) as providers
  from public.subscriptions
  where user_id is not null
  group by user_id;

-- View runs with caller's RLS context (subscriptions.auth.uid() = user_id).
alter view public.tier_effective set (security_invoker = true);

-- Allow authenticated users to read their own tier (RLS-scoped row already).
grant select on public.tier_effective to authenticated;

comment on view public.tier_effective is
  'Phase 16 D-02: per-user effective tier across Stripe + RevenueCat. tier=paid iff MAX(current_period_end) > now(). security_invoker so subscriptions RLS scopes rows.';
