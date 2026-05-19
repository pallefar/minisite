-- Phase 42 Plan 42-10 (POLISH-12) — Quarterly NPS eligibility RPC.
--
-- D-21 + D-23: in-app fallback fires when ALL of the following are true:
--   1. The user has been active in the last 90 days (`auth.users.last_sign_in_at`
--      >= now() - interval '90 days').
--   2. The user has NOT yet responded for the current quarter (no row in
--      public.quarterly_nps_responses with (user_id, quarter)).
--   3. An UNUSED nonce exists for that (user_id, quarter), AND that nonce was
--      created MORE THAN 30 days ago (email window has lapsed per D-21).
--      A nonce younger than 30 days means the email is still in flight; the
--      modal must not fire while the email path is the active channel.
--
-- Returns a single jsonb row: { "eligible": boolean, "nonce": text|null,
--                                "quarter": text }
-- The `nonce` field is non-null only when `eligible = true` — it's the nonce
-- the frontend will pass to the `nps-quarterly-respond` Edge Fn so the same
-- single-use ledger guards both the email path AND the in-app path
-- (Pitfall 11: forwarded NPS email URLs are bearer tokens).
--
-- T-42-10-01 (Elevation of Privilege): callers can only check their OWN
-- eligibility — the RPC uses auth.uid() rather than accepting a `p_user_id`
-- parameter. Passing an arbitrary uuid is not supported.
--
-- SECURITY DEFINER + tight search_path because the function reads from
-- auth.users which the `authenticated` role cannot directly SELECT.

CREATE OR REPLACE FUNCTION public.is_user_eligible_for_quarterly_nps()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_uid          uuid;
  v_quarter      text;
  v_last_sign_in timestamptz;
  v_already_responded boolean;
  v_nonce        text;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    -- Unauthenticated callers always get eligible=false. The respond Edge Fn
    -- separately verifies HMAC-signed tokens for the email path.
    RETURN jsonb_build_object('eligible', false, 'nonce', null, 'quarter', null);
  END IF;

  -- Compute current quarter in YYYY-QN format. extract(quarter from now())
  -- returns 1..4; format() composes the literal.
  v_quarter := to_char(now(), 'YYYY') || '-Q' || extract(quarter from now())::int;

  -- Eligibility check 1: user active in last 90 days.
  SELECT last_sign_in_at INTO v_last_sign_in
    FROM auth.users WHERE id = v_uid;
  IF v_last_sign_in IS NULL OR v_last_sign_in < (now() - interval '90 days') THEN
    RETURN jsonb_build_object('eligible', false, 'nonce', null, 'quarter', v_quarter);
  END IF;

  -- Eligibility check 2: no response yet for this quarter.
  SELECT EXISTS (
    SELECT 1 FROM public.quarterly_nps_responses
    WHERE user_id = v_uid AND quarter = v_quarter
  ) INTO v_already_responded;
  IF v_already_responded THEN
    RETURN jsonb_build_object('eligible', false, 'nonce', null, 'quarter', v_quarter);
  END IF;

  -- Eligibility check 3: unused nonce older than 30 days (email window lapsed).
  -- If no nonce exists yet, the cron hasn't enqueued this user — in-app modal
  -- should NOT pre-empt the email path; return eligible=false.
  -- If a nonce exists but is younger than 30 days, the email is still in
  -- flight — also eligible=false.
  SELECT nonce INTO v_nonce
    FROM public.quarterly_nps_nonces
   WHERE user_id    = v_uid
     AND quarter    = v_quarter
     AND used_at    IS NULL
     AND created_at <= (now() - interval '30 days')
   ORDER BY created_at ASC
   LIMIT 1;

  IF v_nonce IS NULL THEN
    RETURN jsonb_build_object('eligible', false, 'nonce', null, 'quarter', v_quarter);
  END IF;

  RETURN jsonb_build_object('eligible', true, 'nonce', v_nonce, 'quarter', v_quarter);
END;
$$;

REVOKE ALL ON FUNCTION public.is_user_eligible_for_quarterly_nps() FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.is_user_eligible_for_quarterly_nps() TO authenticated;

COMMENT ON FUNCTION public.is_user_eligible_for_quarterly_nps() IS
  'Phase 42 POLISH-12 (Plan 42-10 D-21/D-23). Returns { eligible, nonce, quarter } for the calling user. eligible=true only when active-90d + no current-quarter response + unused nonce older than 30 days (email window lapsed). The nonce field, when non-null, is reused as the single-use ledger key by the in-app modal POSTing to nps-quarterly-respond.';
