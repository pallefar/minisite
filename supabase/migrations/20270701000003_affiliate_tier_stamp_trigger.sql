-- Phase 26 Plan 01 — BEFORE INSERT trigger stamping tier_at_conversion_time (D-19).
--
-- AFFTIER-02 success criterion #1: every INSERT into public.affiliate_conversions
-- atomically copies the current affiliate.tier into NEW.tier_at_conversion_time
-- inside the same row write. Application code physically CANNOT bypass this
-- (vs. relying on app-layer stamping in invoice-paid.ts, which would break the
-- historical-immutability invariant).
--
-- Plan-checker grep gate: the commission-rate CASE arms below (0.20 / 0.30 / 0.25)
-- MUST match leanshot/src/lib/affiliate/tier-config.ts TIER_COMMISSION_PCT — both
-- are the canonical source of truth (D-01). Drift between SQL and TS is a BLOCKER.
--
-- For 'lifetime' tier the trigger ALSO populates recurring_commission_pct_basis
-- (25.00 = TIER_COMMISSION_PCT.lifetime * 100); the Plan 26-06 cron reads this
-- column to compute commission on each monthly recurring payment.
--
-- The trigger is data-path only — it does NOT set app.suppress_audit. The
-- existing affiliate_conversions audit triggers (if any are added in later
-- phases) are explicit canonical audit emitters; this trigger does not
-- emit audit rows.
--
-- search_path is LOCKED to (public, pg_catalog) per [[reference_supabase_migration_gotchas]]:
-- SECURITY DEFINER functions MUST set an explicit search_path or risk privilege
-- escalation via search-path hijack.
--
-- Behaviour:
--   - affiliate not found  → raise exception (errcode 22023) — INSERT blocked.
--   - tier in ('standard','gold')  → set NEW.tier_at_conversion_time only.
--   - tier = 'lifetime'    → set NEW.tier_at_conversion_time AND
--                            NEW.recurring_commission_pct_basis = 25.00.
--   - commission_cents     → left as caller supplied (NOT NULL constraint on
--                            affiliate_conversions.commission_cents already
--                            blocks empty inserts; trigger is invariant-free).

create or replace function public.stamp_affiliate_conversion_tier()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_tier text;
begin
  select tier into v_tier
    from public.affiliates
   where id = NEW.affiliate_id;

  if v_tier is null then
    raise exception 'affiliate % not found', NEW.affiliate_id
      using errcode = '22023';
  end if;

  NEW.tier_at_conversion_time := v_tier;

  -- Per TIER_COMMISSION_PCT.lifetime (0.25) * 100 = 25.00.
  -- Only stamped for lifetime tier — standard + gold use the flat commission_cents
  -- shape inherited from Phase 19 ledger.
  if v_tier = 'lifetime' then
    NEW.recurring_commission_pct_basis := 25.00;
  end if;

  return NEW;
end
$$;

revoke all on function public.stamp_affiliate_conversion_tier() from public;

drop trigger if exists trg_affiliate_conversion_stamp
  on public.affiliate_conversions;

create trigger trg_affiliate_conversion_stamp
  before insert on public.affiliate_conversions
  for each row execute function public.stamp_affiliate_conversion_tier();
