-- Phase 19 Plan 19-07 — Trigger behavior test for flag_conversion_fraud.
--
-- Spec reference: 19-07-PLAN.md Task 1 File 4.
-- Run via: psql "$LOCAL_DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/flag_conversion_fraud.test.sql
-- Wraps in BEGIN/ROLLBACK so the test mutates nothing permanent.
--
-- Behaviors covered (7 tests):
--   T1: fixture — insert affiliate + converter auth user + attribution click.
--   T2: IP /24 match → status='flagged' + signals @> '["ip_24_match"]'.
--   T3: fingerprint match → status='flagged' + signals @> '["fingerprint_match"]'.
--   T4: non-public email-domain match → flagged + signals @> '["email_domain_match"]'.
--   T5: gmail.com match → status='pending' (allowlist exemption, D-24).
--   T6: all 3 signals match → flagged + signals contains all 3.
--   T7: no signals match → status='pending' (default).

begin;

do $$
declare
  v_aff_id  uuid;
  v_aff2_id uuid;
  v_aff3_id uuid;
  v_aff4_id uuid;
  v_aff5_id uuid;
  v_aff_gmail_id uuid;
  v_user_ip uuid := gen_random_uuid();
  v_user_fp uuid := gen_random_uuid();
  v_user_em uuid := gen_random_uuid();
  v_user_gmail uuid := gen_random_uuid();
  v_user_all uuid := gen_random_uuid();
  v_user_clean uuid := gen_random_uuid();
  v_conv_status text;
  v_conv_signals jsonb;
begin
  -- ---- fixtures: 5 auth.users + 5 affiliates ----
  -- Auth users (one per converter case).
  insert into auth.users (id, instance_id, email, encrypted_password, email_confirmed_at,
                          created_at, updated_at, aud, role)
  values
    (v_user_ip,    '00000000-0000-0000-0000-000000000000', 'user-ip@company.io',     '', now(), now(), now(), 'authenticated', 'authenticated'),
    (v_user_fp,    '00000000-0000-0000-0000-000000000000', 'user-fp@elsewhere.com',  '', now(), now(), now(), 'authenticated', 'authenticated'),
    (v_user_em,    '00000000-0000-0000-0000-000000000000', 'user-em@matching.io',    '', now(), now(), now(), 'authenticated', 'authenticated'),
    (v_user_gmail, '00000000-0000-0000-0000-000000000000', 'user-gm@gmail.com',      '', now(), now(), now(), 'authenticated', 'authenticated'),
    (v_user_all,   '00000000-0000-0000-0000-000000000000', 'user-all@triple.io',     '', now(), now(), now(), 'authenticated', 'authenticated'),
    (v_user_clean, '00000000-0000-0000-0000-000000000000', 'user-clean@safe.io',     '', now(), now(), now(), 'authenticated', 'authenticated');

  -- Affiliates: distinct rows so each test isolates its signal.
  insert into public.affiliates
    (id, email, display_name, audience_type, audience_size, status, referral_code,
     ip_signup, fingerprint_signup)
  values
    (gen_random_uuid(), 'aff-ip@bigcorp.com',     'AffIP',    'Instagram', 1000, 'approved', 't19fraud_ip',    '10.0.0.5'::inet,   'fp-ip-affy')    returning id into v_aff_id;
  insert into public.affiliates
    (id, email, display_name, audience_type, audience_size, status, referral_code,
     ip_signup, fingerprint_signup)
  values
    (gen_random_uuid(), 'aff-fp@bigcorp.com',     'AffFP',    'TikTok',    1000, 'approved', 't19fraud_fp',    '172.16.0.1'::inet, 'fp-shared-aaa')  returning id into v_aff2_id;
  insert into public.affiliates
    (id, email, display_name, audience_type, audience_size, status, referral_code,
     ip_signup, fingerprint_signup)
  values
    (gen_random_uuid(), 'aff-em@matching.io',     'AffEM',    'YouTube',   1000, 'approved', 't19fraud_em',    '203.0.113.7'::inet,'fp-em-affy')     returning id into v_aff3_id;
  insert into public.affiliates
    (id, email, display_name, audience_type, audience_size, status, referral_code,
     ip_signup, fingerprint_signup)
  values
    (gen_random_uuid(), 'aff-gm@gmail.com',       'AffGmail', 'Newsletter',1000, 'approved', 't19fraud_gm',    '198.51.100.4'::inet,'fp-gm-affy')    returning id into v_aff_gmail_id;
  insert into public.affiliates
    (id, email, display_name, audience_type, audience_size, status, referral_code,
     ip_signup, fingerprint_signup)
  values
    (gen_random_uuid(), 'aff-all@triple.io',      'AffAll',   'Coaching',  1000, 'approved', 't19fraud_all',   '10.10.10.1'::inet, 'fp-triple-zzz')  returning id into v_aff4_id;
  insert into public.affiliates
    (id, email, display_name, audience_type, audience_size, status, referral_code,
     ip_signup, fingerprint_signup)
  values
    (gen_random_uuid(), 'aff-clean@safehouse.io', 'AffClean', 'Other',     1000, 'approved', 't19fraud_clean', '8.8.8.8'::inet,    'fp-clean-affy')  returning id into v_aff5_id;

  -- Attribution clicks (signal source: trigger reads most-recent click per (user_id,affiliate_id)).
  -- T2 — user_ip: matching IP /24 (10.0.0.99 == 10.0.0.5/24); non-matching fp + email-domain.
  insert into public.affiliate_clicks (affiliate_id, user_id, referral_code, ip, fingerprint)
    values (v_aff_id, v_user_ip, 't19fraud_ip', '10.0.0.99'::inet, 'fp-converter-xxx');
  -- T3 — user_fp: matching fingerprint; non-matching IP + email-domain.
  insert into public.affiliate_clicks (affiliate_id, user_id, referral_code, ip, fingerprint)
    values (v_aff2_id, v_user_fp, 't19fraud_fp', '198.51.100.50'::inet, 'fp-shared-aaa');
  -- T4 — user_em: matching email-domain (matching.io); non-matching IP + fp.
  insert into public.affiliate_clicks (affiliate_id, user_id, referral_code, ip, fingerprint)
    values (v_aff3_id, v_user_em, 't19fraud_em', '93.184.216.34'::inet, 'fp-converter-em');
  -- T5 — user_gmail: matching gmail.com (allowlist) — should NOT flag.
  insert into public.affiliate_clicks (affiliate_id, user_id, referral_code, ip, fingerprint)
    values (v_aff_gmail_id, v_user_gmail, 't19fraud_gm', '93.184.216.40'::inet, 'fp-converter-gm');
  -- T6 — user_all: all 3 signals match. IP /24 (10.10.10.250 == 10.10.10.1/24), fp shared, domain triple.io.
  insert into public.affiliate_clicks (affiliate_id, user_id, referral_code, ip, fingerprint)
    values (v_aff4_id, v_user_all, 't19fraud_all', '10.10.10.250'::inet, 'fp-triple-zzz');
  -- T7 — user_clean: no signals match.
  insert into public.affiliate_clicks (affiliate_id, user_id, referral_code, ip, fingerprint)
    values (v_aff5_id, v_user_clean, 't19fraud_clean', '1.2.3.4'::inet, 'fp-clean-converter');

  raise notice 'PASS: T1 fixtures inserted';

  -- ---- T2: IP /24 match ----
  insert into public.affiliate_conversions
    (affiliate_id, user_id, invoice_id, commission_cents)
  values
    (v_aff_id, v_user_ip, 'in_t2_ip_match', 1000)
  returning status, fraud_signals into v_conv_status, v_conv_signals;
  if v_conv_status <> 'flagged' then
    raise exception 'T2 expected status=flagged for IP /24 match, got %', v_conv_status;
  end if;
  if not (v_conv_signals @> '["ip_24_match"]'::jsonb) then
    raise exception 'T2 expected signals to contain "ip_24_match", got %', v_conv_signals;
  end if;
  raise notice 'PASS: T2 IP /24 match → flagged + ip_24_match signal';

  -- ---- T3: fingerprint match ----
  insert into public.affiliate_conversions
    (affiliate_id, user_id, invoice_id, commission_cents)
  values
    (v_aff2_id, v_user_fp, 'in_t3_fp_match', 1000)
  returning status, fraud_signals into v_conv_status, v_conv_signals;
  if v_conv_status <> 'flagged' then
    raise exception 'T3 expected flagged for fingerprint match, got %', v_conv_status;
  end if;
  if not (v_conv_signals @> '["fingerprint_match"]'::jsonb) then
    raise exception 'T3 expected signals to contain "fingerprint_match", got %', v_conv_signals;
  end if;
  raise notice 'PASS: T3 fingerprint match → flagged + fingerprint_match signal';

  -- ---- T4: non-public email-domain match ----
  insert into public.affiliate_conversions
    (affiliate_id, user_id, invoice_id, commission_cents)
  values
    (v_aff3_id, v_user_em, 'in_t4_em_match', 1000)
  returning status, fraud_signals into v_conv_status, v_conv_signals;
  if v_conv_status <> 'flagged' then
    raise exception 'T4 expected flagged for email-domain match, got %', v_conv_status;
  end if;
  if not (v_conv_signals @> '["email_domain_match"]'::jsonb) then
    raise exception 'T4 expected signals to contain "email_domain_match", got %', v_conv_signals;
  end if;
  raise notice 'PASS: T4 non-public email-domain match → flagged + email_domain_match signal';

  -- ---- T5: gmail.com match → NOT flagged (allowlist) ----
  insert into public.affiliate_conversions
    (affiliate_id, user_id, invoice_id, commission_cents)
  values
    (v_aff_gmail_id, v_user_gmail, 'in_t5_gmail_allowlist', 1000)
  returning status, fraud_signals into v_conv_status, v_conv_signals;
  if v_conv_status <> 'pending' then
    raise exception 'T5 expected status=pending (gmail.com allowlist), got % signals=%', v_conv_status, v_conv_signals;
  end if;
  if jsonb_array_length(v_conv_signals) <> 0 then
    raise exception 'T5 expected empty signals (allowlist exemption), got %', v_conv_signals;
  end if;
  raise notice 'PASS: T5 gmail.com domain → pending (allowlist exemption)';

  -- ---- T6: all 3 signals match ----
  insert into public.affiliate_conversions
    (affiliate_id, user_id, invoice_id, commission_cents)
  values
    (v_aff4_id, v_user_all, 'in_t6_all_three', 1000)
  returning status, fraud_signals into v_conv_status, v_conv_signals;
  if v_conv_status <> 'flagged' then
    raise exception 'T6 expected flagged for all-3 match, got %', v_conv_status;
  end if;
  if not (v_conv_signals @> '["ip_24_match"]'::jsonb)
     or not (v_conv_signals @> '["fingerprint_match"]'::jsonb)
     or not (v_conv_signals @> '["email_domain_match"]'::jsonb) then
    raise exception 'T6 expected all 3 signals, got %', v_conv_signals;
  end if;
  raise notice 'PASS: T6 all-3 signals → flagged with [ip_24_match, fingerprint_match, email_domain_match]';

  -- ---- T7: no signals match ----
  insert into public.affiliate_conversions
    (affiliate_id, user_id, invoice_id, commission_cents)
  values
    (v_aff5_id, v_user_clean, 'in_t7_clean', 1000)
  returning status, fraud_signals into v_conv_status, v_conv_signals;
  if v_conv_status <> 'pending' then
    raise exception 'T7 expected status=pending for no-signal-match, got % signals=%', v_conv_status, v_conv_signals;
  end if;
  if jsonb_array_length(v_conv_signals) <> 0 then
    raise exception 'T7 expected empty signals, got %', v_conv_signals;
  end if;
  raise notice 'PASS: T7 no signals → pending (default)';

  raise notice 'ALL 7 flag_conversion_fraud tests PASSED';
end;
$$;

rollback;
