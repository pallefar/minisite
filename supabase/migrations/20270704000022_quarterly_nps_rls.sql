-- Phase 42 Plan 42-07 (POLISH-12) — RLS policies for quarterly NPS tables.
--
-- T-42-07-03 (Information Disclosure): per-user policy on quarterly_nps_responses
-- — user A cannot SELECT user B's row. Admins (`is_admin_at_least('admin')`)
-- can SELECT all rows for the /admin/nps/quarterly dashboard (D-24).
--
-- T-42-07-01 (Spoofing): the nonces table is service-role only. No
-- authenticated direct access — even read — because the respond Fn runs
-- under service-role and is the ONLY consumer.
--
-- INSERT path: quarterly_nps_responses INSERTs come from two paths:
--   1. Email-respond Edge Fn: runs under service-role (bypasses RLS).
--   2. In-app fallback (Plan 42-10): authenticated user POSTing their own
--      response — gated by an authenticated INSERT policy below.
--
-- The schema migration created the tables; we only need to ENABLE RLS + write
-- policies here.

-- ─── quarterly_nps_responses ─────────────────────────────────────────────────

ALTER TABLE public.quarterly_nps_responses ENABLE ROW LEVEL SECURITY;

-- Authenticated SELECT: user can read their own rows; admins can read all.
DROP POLICY IF EXISTS qnr_select_self_or_admin ON public.quarterly_nps_responses;
CREATE POLICY qnr_select_self_or_admin
  ON public.quarterly_nps_responses
  FOR SELECT
  TO authenticated
  USING (
    auth.uid() = user_id
    OR public.is_admin_at_least('admin'::public.admin_role)
  );

-- Authenticated INSERT: user can insert their own row (used by the in-app
-- fallback in Plan 42-10). UNIQUE(user_id, quarter) enforces single-use.
DROP POLICY IF EXISTS qnr_insert_self ON public.quarterly_nps_responses;
CREATE POLICY qnr_insert_self
  ON public.quarterly_nps_responses
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- No authenticated UPDATE/DELETE policies — responses are immutable from the
-- client side. Admins use service-role / privileged RPCs only (out of scope here).

-- ─── quarterly_nps_nonces (service-role only) ────────────────────────────────

ALTER TABLE public.quarterly_nps_nonces ENABLE ROW LEVEL SECURITY;

-- No authenticated policies. RLS-enabled-with-no-policies denies authenticated
-- (and anon) by default. The service-role key bypasses RLS, which is the
-- only access path used by the enqueue + respond Edge Functions.
--
-- Belt-and-suspenders: explicit REVOKE on the authenticated/anon roles in
-- case grants drift via future migrations.
REVOKE ALL ON public.quarterly_nps_nonces FROM anon, authenticated;
