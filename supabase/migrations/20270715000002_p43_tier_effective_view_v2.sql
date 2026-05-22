-- Phase 43 Plan 01 — D-01 (4-tier label) + D-02 (lifetime source) + RESEARCH OQ-1 RESOLVED
-- (column-superset via CREATE OR REPLACE, no CASCADE).
--
-- Spec references:
--   - 43-CONTEXT.md D-01: tier_effective gets a 4th tier value: free / trial / pro / lifetime.
--     has_active=true for both 'pro' and 'lifetime'. Downstream checks tier_label='lifetime'.
--   - 43-CONTEXT.md D-02: lifetime_purchases UNION ALL alongside active subscriptions.
--   - 43-RESEARCH.md OQ-1 RESOLVED: column NAMES + ORDER preserved verbatim 1..5
--     (user_id, effective_period_end, has_active, has_past_due, winning_provider);
--     tier_label text APPENDED as column 6.
--   - 43-PATTERNS.md "View create pattern" (analog: 20270101000004_tier_effective_view.sql:22-39).
--
-- Pitfall 1 (CASCADE dependency on cohort_profile_view):
--   public.cohort_profile_view (20270602000010_cohort_definitions.sql:117-119) LEFT JOINs
--   public.tier_effective t on t.user_id = p.id and reads only t.has_active. Because P43
--   preserves the column-superset and APPENDS tier_label, `create or replace view` works
--   WITHOUT cascade. Verified: this migration contains zero DROP-VIEW statements.
--
-- Threat mitigations:
--   - T-43-01-03 Information Disclosure (cross-user read of lifetime row):
--       Preserve `with (security_invoker = true)` — RLS on public.lifetime_purchases (self-read
--       policy) and public.subscriptions (existing P19 RLS) are honored at query time.

-- ============================================================================
-- View: tier_effective v2 — UNION ALL subscriptions + lifetime_purchases.
-- ============================================================================
-- Column ORDER (1..5) preserved verbatim from P19. Column 6 (tier_label) APPENDED.
--
-- Inner source: CTE pair
--   - sub_rows:      one row per active/relevant subscription
--   - lifetime_rows: one row per un-refunded lifetime purchase
-- UNION ALL → group by user_id → outer aggregation reproduces P19 semantics + the new tier_label.
--
-- Lifetime row mapping (per RESEARCH OQ-1):
--   effective_period_end = NULL (permanent), row_active = TRUE, row_past_due = FALSE,
--   row_provider = 'stripe', row_tier_label = 'lifetime'.
--   MAX(NULL, t) = t in Postgres → a user with BOTH a sub and a lifetime row keeps the sub expiry.
--
-- Subscription row mapping:
--   row_tier_label = 'trial' (status='trialing') / 'pro' (active|past_due|unpaid) / 'free' (else).
create or replace view public.tier_effective
  with (security_invoker = true)
as
with
  sub_rows as (
    select
      user_id,
      current_period_end                      as effective_period_end,
      (status in ('active','trialing'))       as row_active,
      (status in ('past_due','unpaid'))       as row_past_due,
      provider::text                          as row_provider,
      case
        when status = 'trialing'                          then 'trial'
        when status in ('active','past_due','unpaid')     then 'pro'
        else                                                   'free'
      end                                     as row_tier_label
    from public.subscriptions
    where user_id is not null
  ),
  lifetime_rows as (
    select
      user_id,
      null::timestamptz                       as effective_period_end,
      true                                    as row_active,
      false                                   as row_past_due,
      'stripe'::text                          as row_provider,
      'lifetime'::text                        as row_tier_label
    from public.lifetime_purchases
    where refunded_at is null
  ),
  unioned as (
    select * from sub_rows
    union all
    select * from lifetime_rows
  )
select
  user_id,
  max(effective_period_end)                                                   as effective_period_end,
  bool_or(row_active)                                                         as has_active,
  bool_or(row_past_due)                                                       as has_past_due,
  (array_agg(row_provider order by effective_period_end desc nulls last))[1]  as winning_provider,
  case
    when bool_or(row_tier_label = 'lifetime') then 'lifetime'
    when bool_or(row_tier_label = 'pro')      then 'pro'
    when bool_or(row_tier_label = 'trial')    then 'trial'
    else                                            'free'
  end                                                                         as tier_label
from unioned
group by user_id;

comment on view public.tier_effective is
  'P43 MEMBER-01: extends P19 tier_effective with lifetime_purchases UNION ALL; '
  'has_active=true for pro+lifetime; tier_label distinguishes (free/trial/pro/lifetime); '
  'lifetime rows have NULL effective_period_end (permanent).';

grant select on public.tier_effective to authenticated;
