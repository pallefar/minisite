-- Phase 19 Plan 19-09 — BL-6 cascade SQL function for account-delete (AFF-10 + MONEY-10).
--
-- Locked spec (plan-checker iter-2):
--   `public.finalize_affiliate_cascade(p_user_id uuid) RETURNS TEXT`
--   Returns the ORIGINAL email BEFORE anonymizing so the Edge Function wrapper
--   can call Resend `contacts.remove` with it. Returns NULL if no affiliate row
--   exists for the user (clean no-op).
--
-- D-33 step alignment (10-step cascade):
--   Step 1  — pre-flight check for open payouts (raise P0010 → 409 from Edge Fn).
--   Steps 2-4 — DB-side anonymize (this function).
--   Steps 5-10 — Stripe / Resend / Storage / auth.admin.deleteUser (Edge Fn).
--
-- IRS retention (D-33 step 4): payouts rows are NEVER deleted. FK
-- `affiliate_id → affiliates.id ON DELETE CASCADE` is intentionally NOT used on
-- payouts — payouts is a financial ledger and survives the affiliate row.
-- affiliate_clicks / affiliate_conversions / affiliate_impressions use
-- `ON DELETE SET NULL` on `user_id` so the rows survive with user_id zeroed.
--
-- BL-6 invariant: `stripe_connect_account_id` is PRESERVED on the affiliate
-- row so the Edge Function step 6 can call `stripe.accounts.del(account_id)`.
-- If we nulled it here, the Edge Function would have no way to find the
-- account.
--
-- Pitfall 4 + 9 (reference_supabase_migration_gotchas):
--   `set_config('app.suppress_audit', 'true', true)` with is_local=true wraps
--   the cascade window. The 'true' third arg scopes the GUC to the current
--   transaction so concurrent sessions cannot observe or exploit it.
--
-- STRIDE register:
--   T-19-09-S Spoofing (deletion authorization): function is service_role only;
--     Edge Function enforces caller.user.id === p_user_id OR is_staff(caller).
--   T-19-09-E Elevation (GUC leak): is_local=true confines scope to txn.
--   T-19-09-PSV Privacy: payouts retained (no DELETE); FK ON DELETE SET NULL
--     on event tables preserves audit trace; email + display_name hashed.

create or replace function public.finalize_affiliate_cascade(p_user_id uuid)
returns text
language plpgsql
security invoker
set search_path = public, auth, extensions, pg_catalog
as $$
declare
  v_open_payouts integer;
  v_aff_id uuid;
  v_email text;
begin
  -- D-33 step 1: PRE-FLIGHT — open payouts block the cascade.
  -- The Edge Function maps P0010 → 409 { error: 'open_payouts', eta }.
  select count(*) into v_open_payouts
    from public.payouts p
    join public.affiliates a on a.id = p.affiliate_id
   where a.user_id = p_user_id
     and p.status in ('pending', 'processing');
  if v_open_payouts > 0 then
    raise exception 'open_payouts' using errcode = 'P0010';
  end if;

  -- Read ORIGINAL email BEFORE anonymize (BL-6 return contract).
  select id, email
    into v_aff_id, v_email
    from public.affiliates
   where user_id = p_user_id
   limit 1;
  if v_aff_id is null then
    -- Caller has no affiliate row — clean no-op. The Edge Function still
    -- proceeds with the rest of the user-delete cascade (Stripe customer
    -- delete, auth.users delete, etc.) — it just skips the Connect-account
    -- + Resend-audience steps.
    return null;
  end if;

  -- Suppress audit-trigger fires for the anonymize UPDATE (Pitfall 4 + 9).
  -- We write the cascade-survives audit skeleton ourselves below.
  perform set_config('app.suppress_audit', 'true', true);

  -- D-33 step 2: anonymize affiliate row.
  -- BL-6: PRESERVE stripe_connect_account_id (Edge Function step 6 needs it).
  -- BL-6: PRESERVE id, user_id (FK target), commission_rate_cents,
  --       tax_threshold_cents, status (so ledger queries still classify).
  update public.affiliates
     set email              = encode(digest(email::bytea, 'sha256'), 'hex'),
         display_name       = 'deleted_user_' || id::text,
         photo_path         = null,
         blurb              = null,
         calendly_url       = null,
         testimonial_quote  = null,
         fingerprint_signup = null,
         ip_signup          = null,
         updated_at         = now()
   where id = v_aff_id;

  -- D-33 step 3 + 4: affiliate_clicks / affiliate_conversions /
  -- affiliate_impressions use ON DELETE SET NULL on user_id (Plan 19-01).
  -- payouts table is intentionally retained (IRS 7yr) — no DELETE here.

  -- Cascade-surviving audit skeleton. user_id_hash (not-null below) preserves
  -- attribution after auth.users delete cascades NULL onto audit_logs.user_id.
  insert into public.audit_logs
    (user_id, user_id_hash, table_name, row_id, action, before_hash, after_hash)
  values (
    p_user_id,
    encode(digest(p_user_id::text::bytea, 'sha256'), 'hex'),
    'public.affiliates',
    v_aff_id::text,
    'affiliate_deleted_anonymized',
    null, null
  );

  perform set_config('app.suppress_audit', 'false', true);

  return v_email;
end;
$$;

revoke all on function public.finalize_affiliate_cascade(uuid) from public;
grant execute on function public.finalize_affiliate_cascade(uuid) to service_role;

comment on function public.finalize_affiliate_cascade(uuid) is
  'Phase 19 BL-6: anonymizes the affiliate row for a deleted user. Returns the original email (pre-anonymize) so the account-delete Edge Function can call Resend contacts.remove. Returns NULL when no affiliate row exists. Preserves stripe_connect_account_id for downstream stripe.accounts.del.';
