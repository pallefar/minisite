-- Phase 42 Plan 42-07 (POLISH-12) — Quarterly NPS responses table.
--
-- D-19: SEPARATE instrument from P36 review-prompt. New, dedicated schema.
--       quarterly_nps_responses is the single per-quarter response record per user.
--
-- D-22: Per-user lifetime tracking with channel (email | in-app) — one row per
--       (user_id, quarter); UNIQUE constraint enforces single-use per quarter
--       (Pitfall 11 mitigation: forwarded NPS email cannot create a duplicate row).
--
-- D-21: responded_via tracks the channel that won (first response wins; the other
--       channel observes the row and short-circuits).
--
-- D-24: admin dashboard at /admin/nps/quarterly reads this table directly
--       (no matview; v1.3 verbatim-only).

CREATE TABLE IF NOT EXISTS public.quarterly_nps_responses (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- Quarter format: 'YYYY-Q[1-4]', e.g. '2026-Q3'. Single-use per user.
  quarter       text NOT NULL CHECK (quarter ~ '^[0-9]{4}-Q[1-4]$'),
  score         int  NOT NULL CHECK (score BETWEEN 0 AND 10),
  comment       text,
  responded_via text NOT NULL CHECK (responded_via IN ('email', 'in-app')),
  responded_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT quarterly_nps_responses_user_quarter_uniq UNIQUE (user_id, quarter)
);

-- Admin dashboard queries: filter by quarter + sort by score / responded_at.
CREATE INDEX IF NOT EXISTS quarterly_nps_responses_quarter_idx
  ON public.quarterly_nps_responses (quarter);

CREATE INDEX IF NOT EXISTS quarterly_nps_responses_responded_at_idx
  ON public.quarterly_nps_responses (responded_at DESC);

COMMENT ON TABLE  public.quarterly_nps_responses IS
  'Phase 42 POLISH-12 D-19. Quarterly NPS check-in — SEPARATE instrument from P36 review-prompt. UNIQUE(user_id, quarter) enforces single-use per quarter (Pitfall 11).';
COMMENT ON COLUMN public.quarterly_nps_responses.quarter IS
  'YYYY-QN format (e.g. 2026-Q3). Per D-22, the cron job runs first-of-quarter and stamps this value.';
COMMENT ON COLUMN public.quarterly_nps_responses.responded_via IS
  'D-21: which channel won the response — email (signed-token link) or in-app (modal fallback after 30d).';
