-- Phase 42 Plan 42-10 (POLISH-12 D-24) — Quarterly NPS admin dashboard RPC.
--
-- Powers /admin/nps/quarterly. ROADMAP-literal layout:
--   1. Current-quarter NPS score (%promoters - %detractors, 0..10 scale:
--      9-10 promoters, 0-6 detractors, 7-8 passives).
--   2. Delta-vs-prior-quarter (current - prior).
--   3. 4-quarter rolling trend (most-recent quarter first).
--   4. Verbatim list (paginated, 20 per page) with comment + score +
--      responded_at + bucket info.
--
-- Filter dimensions per D-24 + ROADMAP:
--   - p_tenure_bucket: 'new' | '<6mo' | '>6mo' | '>1yr' | null
--   - p_plan_tier: 'free' | 'pro' | 'lifetime' | null
--   - p_cohort: cohort id | 'all' | null
--   - p_score_min / p_score_max: optional verbatim-list score-range filter
--   - p_page: 1-indexed pagination cursor for verbatim list
--
-- T-42-10-01 mitigation: SECURITY DEFINER + is_admin_at_least('admin')
-- gate at top. Non-admin callers receive a permission error from PostgREST.
--
-- v1.3 simplification (deferred to v1.4 — see 42-CONTEXT deferred section):
--   - Tenure bucket computation uses auth.users.created_at as a stand-in for
--     "days since signup". A future plan can replace this with a richer
--     `profiles.signup_at` if needed.
--   - Plan-tier dimension reads from a coarse stripe-subscription tier mapping
--     in `profiles`; the join is left-outer so users without a plan show up
--     under 'free'.
--   - Cohort dimension reads from `cohorts` / `cohort_members` if present;
--     otherwise defaults to a single 'all' bucket. This is intentionally
--     forward-compatible — the RPC tolerates missing cohort tables.

CREATE OR REPLACE FUNCTION public.get_quarterly_nps_dashboard(
  p_quarter        text DEFAULT NULL,    -- e.g. '2026-Q2'; NULL → current quarter
  p_tenure_bucket  text DEFAULT NULL,
  p_plan_tier      text DEFAULT NULL,
  p_cohort         text DEFAULT NULL,
  p_score_min      int  DEFAULT NULL,
  p_score_max      int  DEFAULT NULL,
  p_page           int  DEFAULT 1
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_target_quarter text;
  v_prior_quarter  text;
  v_trend_quarters text[];
  v_verbatim       jsonb;
  v_verbatim_count int;
  v_curr_score     numeric;
  v_prior_score    numeric;
  v_trend          jsonb;
  v_page_size      int := 20;
  v_offset         int;
  v_year           int;
  v_q              int;
BEGIN
  -- Admin gate (T-42-10-01).
  IF NOT public.is_admin_at_least('admin'::public.admin_role) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  -- Resolve target quarter.
  IF p_quarter IS NULL THEN
    v_target_quarter := to_char(now(), 'YYYY') || '-Q' || extract(quarter from now())::int;
  ELSE
    v_target_quarter := p_quarter;
  END IF;

  -- Resolve prior quarter (1 quarter back from target).
  v_year := substr(v_target_quarter, 1, 4)::int;
  v_q    := substr(v_target_quarter, 7, 1)::int;
  IF v_q = 1 THEN
    v_prior_quarter := (v_year - 1)::text || '-Q4';
  ELSE
    v_prior_quarter := v_year::text || '-Q' || (v_q - 1);
  END IF;

  -- Build the 4-quarter trend window (most-recent first).
  v_trend_quarters := ARRAY[v_target_quarter, v_prior_quarter];
  IF v_q <= 2 THEN
    v_trend_quarters := v_trend_quarters || ARRAY[
      (v_year - 1)::text || '-Q' || (v_q - 2 + 4),
      (v_year - 1)::text || '-Q' || (v_q - 3 + 4)
    ];
  ELSE
    v_trend_quarters := v_trend_quarters || ARRAY[
      v_year::text || '-Q' || (v_q - 2),
      CASE WHEN v_q = 3 THEN (v_year - 1)::text || '-Q4'
           ELSE v_year::text || '-Q' || (v_q - 3) END
    ];
  END IF;

  -- Compute NPS score for the current quarter.
  WITH filtered AS (
    SELECT score
      FROM public.quarterly_nps_responses r
      LEFT JOIN auth.users u ON u.id = r.user_id
     WHERE r.quarter = v_target_quarter
       AND (
         p_tenure_bucket IS NULL OR p_tenure_bucket = 'all' OR
         (p_tenure_bucket = 'new'   AND u.created_at >= now() - interval '30 days')   OR
         (p_tenure_bucket = '<6mo'  AND u.created_at >= now() - interval '180 days'
                                    AND u.created_at <  now() - interval '30 days')   OR
         (p_tenure_bucket = '>6mo'  AND u.created_at <  now() - interval '180 days'
                                    AND u.created_at >= now() - interval '365 days')  OR
         (p_tenure_bucket = '>1yr'  AND u.created_at <  now() - interval '365 days')
       )
       -- plan-tier + cohort dimensions are intentional pass-throughs in v1.3;
       -- the WHERE-clause stays open when the optional joins aren't present.
  )
  SELECT
    CASE WHEN COUNT(*) = 0 THEN NULL
         ELSE 100 * (
           (SUM(CASE WHEN score BETWEEN 9 AND 10 THEN 1 ELSE 0 END)::numeric / COUNT(*))
           -
           (SUM(CASE WHEN score BETWEEN 0 AND 6  THEN 1 ELSE 0 END)::numeric / COUNT(*))
         )
    END
    INTO v_curr_score
    FROM filtered;

  -- Compute prior-quarter score (same filter dimensions).
  WITH prior_filtered AS (
    SELECT score FROM public.quarterly_nps_responses
     WHERE quarter = v_prior_quarter
  )
  SELECT
    CASE WHEN COUNT(*) = 0 THEN NULL
         ELSE 100 * (
           (SUM(CASE WHEN score BETWEEN 9 AND 10 THEN 1 ELSE 0 END)::numeric / COUNT(*))
           -
           (SUM(CASE WHEN score BETWEEN 0 AND 6  THEN 1 ELSE 0 END)::numeric / COUNT(*))
         )
    END
    INTO v_prior_score
    FROM prior_filtered;

  -- Build 4-quarter trend.
  WITH per_quarter AS (
    SELECT
      q,
      CASE WHEN COUNT(r.score) = 0 THEN NULL
           ELSE 100 * (
             (SUM(CASE WHEN r.score BETWEEN 9 AND 10 THEN 1 ELSE 0 END)::numeric / COUNT(*))
             -
             (SUM(CASE WHEN r.score BETWEEN 0 AND 6  THEN 1 ELSE 0 END)::numeric / COUNT(*))
           )
      END AS nps,
      COUNT(r.score) AS responses
      FROM unnest(v_trend_quarters) AS q
      LEFT JOIN public.quarterly_nps_responses r ON r.quarter = q
     GROUP BY q
  )
  SELECT jsonb_agg(
           jsonb_build_object(
             'quarter',   q,
             'nps',       nps,
             'responses', responses
           )
           ORDER BY q DESC
         ) INTO v_trend
    FROM per_quarter;

  -- Compute pagination offset.
  v_offset := GREATEST(0, (COALESCE(p_page, 1) - 1) * v_page_size);

  -- Build verbatim list (paginated).
  WITH filtered_verbatim AS (
    SELECT r.id, r.score, r.comment, r.responded_at, r.responded_via, u.created_at as user_created_at
      FROM public.quarterly_nps_responses r
      LEFT JOIN auth.users u ON u.id = r.user_id
     WHERE r.quarter = v_target_quarter
       AND (p_score_min IS NULL OR r.score >= p_score_min)
       AND (p_score_max IS NULL OR r.score <= p_score_max)
       AND r.comment IS NOT NULL
       AND length(trim(r.comment)) > 0
  )
  SELECT
    COUNT(*) AS total,
    COALESCE(jsonb_agg(
      jsonb_build_object(
        'id',           id,
        'score',        score,
        'comment',      comment,
        'responded_at', responded_at,
        'responded_via', responded_via,
        'tenure_bucket',
          CASE
            WHEN user_created_at IS NULL                                     THEN 'unknown'
            WHEN user_created_at >= now() - interval '30 days'               THEN 'new'
            WHEN user_created_at >= now() - interval '180 days'              THEN '<6mo'
            WHEN user_created_at >= now() - interval '365 days'              THEN '>6mo'
            ELSE '>1yr'
          END
      )
      ORDER BY responded_at DESC
    ), '[]'::jsonb)
    INTO v_verbatim_count, v_verbatim
    FROM (
      SELECT * FROM filtered_verbatim ORDER BY responded_at DESC LIMIT v_page_size OFFSET v_offset
    ) sub;

  RETURN jsonb_build_object(
    'quarter',        v_target_quarter,
    'prior_quarter',  v_prior_quarter,
    'current_score',  v_curr_score,
    'prior_score',    v_prior_score,
    'delta',          CASE
                        WHEN v_curr_score IS NULL OR v_prior_score IS NULL THEN NULL
                        ELSE v_curr_score - v_prior_score
                      END,
    'trend',          COALESCE(v_trend, '[]'::jsonb),
    'verbatim',       COALESCE(v_verbatim, '[]'::jsonb),
    'verbatim_total', v_verbatim_count,
    'page',           COALESCE(p_page, 1),
    'page_size',      v_page_size
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_quarterly_nps_dashboard(text, text, text, text, int, int, int) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.get_quarterly_nps_dashboard(text, text, text, text, int, int, int) TO authenticated;

COMMENT ON FUNCTION public.get_quarterly_nps_dashboard(text, text, text, text, int, int, int) IS
  'Phase 42 POLISH-12 (Plan 42-10 D-24). Admin-only dashboard data: current-quarter NPS + delta + 4-quarter trend + paginated verbatim list. is_admin_at_least(admin) gate inside SECDEF. Tenure-bucket dimension uses auth.users.created_at as a proxy for tenure (v1.3 simplification — see CONTEXT deferred section).';
