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

-- ─── In-app submit RPC ───────────────────────────────────────────────────────
--
-- Rule 3 deviation (auto-fixed): the Plan-42-07 nps-quarterly-respond Edge Fn
-- is GET-only with HMAC verification (the unauthenticated email path). For
-- the in-app fallback (Plan 42-10 D-21), the user IS authenticated, so a
-- dedicated SECDEF RPC is cleaner than overloading the Edge Fn with a
-- two-mode (GET-HMAC vs POST-auth) request handler.
--
-- T-42-10-04 mitigation (Repudiation): atomic nonce-burn UPDATE before the
-- INSERT — same single-use ledger as the email path (Pitfall 11). Replay
-- returns { ok: false, replayed: true }; the modal handles this as success
-- because the response row exists.
--
-- Skipped responses store score=NULL + a marker comment so the unique
-- (user_id, quarter) constraint prevents re-prompting. Per the
-- quarterly_nps_responses.score CHECK (BETWEEN 0 AND 10), score cannot be
-- NULL — instead we record a sentinel score=11 only when p_skipped=true.
-- Actually that violates the CHECK; cleanest is to NOT insert a row when
-- skipped and instead just burn the nonce so the cron's nonce-30d check
-- treats them as "responded". But that doesn't prevent the in-app modal
-- from re-prompting next session (the eligibility RPC's "no response yet"
-- check would still return eligible=true).
--
-- Resolved: relax the score CHECK to allow score IS NULL (this migration
-- runs before any production data). Add a `skipped` boolean column too.

ALTER TABLE public.quarterly_nps_responses
  DROP CONSTRAINT IF EXISTS quarterly_nps_responses_score_check;
ALTER TABLE public.quarterly_nps_responses
  ALTER COLUMN score DROP NOT NULL;
ALTER TABLE public.quarterly_nps_responses
  ADD CONSTRAINT quarterly_nps_responses_score_check
    CHECK (score IS NULL OR (score BETWEEN 0 AND 10));
ALTER TABLE public.quarterly_nps_responses
  ADD COLUMN IF NOT EXISTS skipped boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.quarterly_nps_responses.skipped IS
  'Plan 42-10 D-21 in-app fallback: true when user clicked Skip (score IS NULL). Prevents re-prompting for this quarter.';

CREATE OR REPLACE FUNCTION public.submit_quarterly_nps_in_app(
  p_nonce    text,
  p_score    int   DEFAULT NULL,
  p_comment  text  DEFAULT NULL,
  p_skipped  boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_uid     uuid;
  v_burned  record;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_nonce IS NULL OR length(p_nonce) = 0 THEN
    RAISE EXCEPTION 'missing_nonce' USING ERRCODE = '22023';
  END IF;
  -- Validate score range (NULL allowed for skipped).
  IF p_score IS NOT NULL AND (p_score < 0 OR p_score > 10) THEN
    RAISE EXCEPTION 'invalid_score' USING ERRCODE = '22023';
  END IF;
  -- Skipped + score-supplied is contradictory; treat skipped as authoritative.
  IF p_skipped THEN
    p_score := NULL;
  END IF;

  -- Atomic single-use nonce burn (Pitfall 11). Must match the calling user.
  UPDATE public.quarterly_nps_nonces
     SET used_at = now()
   WHERE nonce = p_nonce
     AND used_at IS NULL
     AND user_id = v_uid
  RETURNING nonce, user_id, quarter INTO v_burned;

  IF v_burned IS NULL THEN
    -- Replay or wrong owner — return ok=false replayed=true. Caller may
    -- still close the modal because the per-quarter response already exists
    -- (or the nonce is invalid for this user, which is also a no-op for the
    -- modal's purpose).
    RETURN jsonb_build_object('ok', false, 'replayed', true);
  END IF;

  -- INSERT response. UNIQUE(user_id, quarter) makes this idempotent —
  -- a prior email response would 23505 here; we treat that as success.
  INSERT INTO public.quarterly_nps_responses
    (user_id, quarter, score, comment, responded_via, skipped)
  VALUES
    (v_uid, v_burned.quarter, p_score, p_comment, 'in-app', p_skipped)
  ON CONFLICT (user_id, quarter) DO NOTHING;

  RETURN jsonb_build_object('ok', true, 'quarter', v_burned.quarter);
END;
$$;

REVOKE ALL ON FUNCTION public.submit_quarterly_nps_in_app(text, int, text, boolean) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.submit_quarterly_nps_in_app(text, int, text, boolean) TO authenticated;

COMMENT ON FUNCTION public.submit_quarterly_nps_in_app(text, int, text, boolean) IS
  'Phase 42 POLISH-12 (Plan 42-10 D-21). In-app fallback submission path. Atomic nonce burn (T-42-10-04) + INSERT into quarterly_nps_responses with responded_via=in-app. SECDEF + auth.uid()-checked nonce ownership. Skip path sets score=NULL + skipped=true so the user is not re-prompted for the quarter.';
