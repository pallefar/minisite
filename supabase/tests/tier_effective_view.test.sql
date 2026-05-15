-- Phase 19 Plan 01 — tier_effective view forward-compat test (D-02 + D-04).
--
-- Spec reference: 19-01-PLAN.md Task 2 File 3.
-- Run via: psql "$LOCAL_DB_URL" -f supabase/tests/tier_effective_view.test.sql
--
-- Scenario A (D-02 reformulated SC#4): Two overlapping Stripe subs reconcile to
--   MAX(current_period_end). winning_provider = 'stripe'.
-- Scenario B (D-04 forward-compat): Adding a RevenueCat row with later expiry flips the
--   winning_provider to 'revenuecat'. Proves zero-change P16-06 integration.

begin;

-- Use a deterministic user UUID for assertions.
do $$
declare
  v_user_a uuid;
  v_effective_a timestamptz;
  v_winner_a text;
  v_effective_b timestamptz;
  v_winner_b text;
begin
  -- Seed auth.users row (best-effort; if a real row already exists at this UUID we reuse it).
  v_user_a := '11111111-1111-1111-1111-111111111111';
  insert into auth.users (id, email)
    values (v_user_a, 'tier-test-a@leanshot.test')
    on conflict (id) do nothing;

  -- ----- Scenario A: two overlapping Stripe subs -----
  insert into public.subscriptions (id, provider, user_id, status, current_period_end)
  values
    ('sub_tier_a_short', 'stripe', v_user_a, 'active', now() + interval '7 days'),
    ('sub_tier_a_long',  'stripe', v_user_a, 'active', now() + interval '30 days');

  select effective_period_end, winning_provider
    into v_effective_a, v_winner_a
    from public.tier_effective
   where user_id = v_user_a;

  if v_effective_a is null then
    raise exception 'tier_effective returned no row for user A after two Stripe subs';
  end if;

  if v_effective_a < now() + interval '29 days' then
    raise exception 'expected effective_period_end ~30 days out, got %', v_effective_a;
  end if;

  if v_winner_a <> 'stripe' then
    raise exception 'expected winning_provider=stripe for Stripe-only rows, got %', v_winner_a;
  end if;

  raise notice 'PASS (A): two Stripe subs reconcile to MAX(current_period_end)=stripe (D-02)';

  -- ----- Scenario B: add a RevenueCat row with later expiry -----
  insert into public.subscriptions (id, provider, user_id, status, current_period_end)
  values ('sub_tier_a_rc', 'revenuecat', v_user_a, 'active', now() + interval '60 days');

  select effective_period_end, winning_provider
    into v_effective_b, v_winner_b
    from public.tier_effective
   where user_id = v_user_a;

  if v_effective_b < now() + interval '59 days' then
    raise exception 'expected effective_period_end ~60 days out after RC row, got %', v_effective_b;
  end if;

  if v_winner_b <> 'revenuecat' then
    raise exception 'expected winning_provider=revenuecat after RC row with later expiry (D-04 forward-compat), got %', v_winner_b;
  end if;

  raise notice 'PASS (B): RC row flips winning_provider to revenuecat (D-04 P16-06 forward-compat)';
  raise notice 'TIER EFFECTIVE VIEW TEST — ALL ASSERTIONS PASSED';
end $$;

rollback;
