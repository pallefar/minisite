-- Phase 19 Plan 19-07 — Conversion-fraud BEFORE INSERT trigger (D-24, D-25).
--
-- Spec references:
--   - 19-CONTEXT.md D-24: ANY single signal match flags. Signals:
--       (a) converter IP /24 == affiliate ip_signup /24
--       (b) converter fingerprint == affiliate fingerprint_signup
--       (c) converter email-domain == affiliate email-domain
--           EXCLUDING public-email allowlist
--           (gmail.com, yahoo.com, outlook.com, icloud.com, hotmail.com).
--   - 19-CONTEXT.md D-25: auto-action on flag — route to P22 ADMIN-06 admin queue,
--     no auto-reject. Set status='flagged'; flagged conversions still get inserted.
--   - 19-RESEARCH.md §"Pattern 3: Fraud-signal trigger" lines 452-517.
--
-- Trigger contract:
--   trg_flag_conversion_fraud  BEFORE INSERT ON public.affiliate_conversions
--   FOR EACH ROW EXECUTE FUNCTION public.flag_conversion_fraud()
--
-- Data sources for converter signals:
--   - IP / fingerprint: the most-recent affiliate_clicks row for NEW.user_id
--     (within last 30d) that attributed to NEW.affiliate_id. This is the click
--     that PRECEDED the conversion — the visitor's signup-time signal.
--   - Email: auth.users.email for NEW.user_id. If user_id is null (rare —
--     conversion attributed via subscription metadata before signup completes),
--     email signal is skipped (`v_user_email` stays null → signal (c) no-ops).
--
-- Landmines (reference_supabase_migration_gotchas):
--   - SECURITY DEFINER with `set search_path = public, auth, extensions, pg_catalog`
--     so auth.users lookup + digest()/inet ops resolve cleanly.
--   - No CREATE POLICY here — RLS for affiliate_conversions ships in
--     20270101000005_affiliate_rls.sql.
--   - BEFORE INSERT semantics: trigger mutates NEW.status + NEW.fraud_signals so the
--     INSERT lands with the correct values atomically; no UPDATE round-trip.

create or replace function public.flag_conversion_fraud()
returns trigger
language plpgsql
security definer
set search_path = public, auth, extensions, pg_catalog
as $$
declare
  v_aff_ip inet;
  v_aff_fp text;
  v_aff_email text;
  v_user_ip inet;
  v_user_fp text;
  v_user_email text;
  v_public_domains text[] := array['gmail.com','yahoo.com','outlook.com','icloud.com','hotmail.com'];
  v_user_domain text;
  v_aff_domain text;
  v_flagged boolean := false;
  v_signals jsonb := '[]'::jsonb;
begin
  -- 1. Look up affiliate signup-time signals (D-24 source-of-truth).
  select ip_signup, fingerprint_signup, lower(email)
    into v_aff_ip, v_aff_fp, v_aff_email
    from public.affiliates
   where id = new.affiliate_id;

  -- 2. Look up converter's IP + fingerprint from the most-recent attributed
  --    click within the last 30 days. Null when no click row exists (e.g.
  --    conversion attributed by subscription metadata without a /r/{code} hit).
  if new.user_id is not null then
    select ip, fingerprint
      into v_user_ip, v_user_fp
      from public.affiliate_clicks
     where user_id = new.user_id
       and affiliate_id = new.affiliate_id
       and created_at > now() - interval '30 days'
     order by created_at desc
     limit 1;

    -- 3. Look up converter's email from auth.users.
    select lower(email)
      into v_user_email
      from auth.users
     where id = new.user_id;
  end if;

  -- Signal (a): IP /24 match.
  if v_user_ip is not null and v_aff_ip is not null
     and set_masklen(v_user_ip, 24) = set_masklen(v_aff_ip, 24) then
    v_flagged := true;
    v_signals := v_signals || '"ip_24_match"'::jsonb;
  end if;

  -- Signal (b): device-fingerprint match.
  if v_user_fp is not null and v_aff_fp is not null
     and v_user_fp = v_aff_fp then
    v_flagged := true;
    v_signals := v_signals || '"fingerprint_match"'::jsonb;
  end if;

  -- Signal (c): email-domain match with public-email allowlist exemption.
  if v_user_email is not null and v_aff_email is not null then
    v_user_domain := lower(split_part(v_user_email, '@', 2));
    v_aff_domain  := lower(split_part(v_aff_email,  '@', 2));
    if v_user_domain <> ''
       and v_aff_domain <> ''
       and v_user_domain = v_aff_domain
       and not (v_user_domain = any(v_public_domains)) then
      v_flagged := true;
      v_signals := v_signals || '"email_domain_match"'::jsonb;
    end if;
  end if;

  -- D-25: route flagged conversions to admin queue (no auto-reject).
  if v_flagged then
    new.status := 'flagged';
    new.fraud_signals := v_signals;
  end if;

  return new;
end;
$$;

revoke all on function public.flag_conversion_fraud() from public;
grant execute on function public.flag_conversion_fraud() to service_role;

comment on function public.flag_conversion_fraud() is
  'AFF-07 (D-24, D-25): BEFORE INSERT trigger fn — flags affiliate_conversions rows when ANY of three self-conversion signals (IP /24, fingerprint, non-public email-domain) match. Routes to P22 ADMIN-06 admin queue via status=''flagged''.';

create trigger trg_flag_conversion_fraud
  before insert on public.affiliate_conversions
  for each row execute function public.flag_conversion_fraud();

comment on trigger trg_flag_conversion_fraud on public.affiliate_conversions is
  'AFF-07 (D-24): per-row fraud-signal screen on affiliate_conversions INSERT. Fires for service-role + authenticated inserts alike.';
