-- Phase 71 Plan 71-01 (PU-02) — Additive evolution of public.changelog_entries.
--
-- Adds: version (text, nullable), status (draft|published|archived, default
-- 'published'), created_by (uuid -> auth.users), a (status, published_at DESC)
-- list index, and TIGHTENS the SELECT RLS so non-admins see published rows only.
--
-- Forward-timestamp rationale: the newest migration in the working tree is
-- 20290108000011_fix_accept_org_patient_invite_email_binding.sql. This file uses
-- 20290110000001 (strictly greater) so `supabase db push` applies it AFTER every
-- existing migration without re-ordering history (per 71-CONTEXT: migration
-- timestamp must be ≥ newest applied; remote PG lacks the policy IF-NOT-EXISTS form).
--
-- Purely ADDITIVE — no destructive DDL. Does NOT recreate the table, its index,
-- the touch-updated_at trigger, or the existing INSERT/UPDATE/DELETE admin
-- policies (all already gate on is_admin_at_least('admin')). The base table +
-- RLS live in 20270704000010_changelog_entries.sql + 20270704000012_changelog_rls.sql.
--
-- Idempotent: every column add uses ADD COLUMN IF NOT EXISTS; the CHECK
-- constraint is guarded by a pg_constraint lookup; the index uses CREATE INDEX
-- IF NOT EXISTS; the policy uses the canonical drop-then-bare-create pattern.

-- 1. version — nullable; historical Phase-42 rows have no version.
ALTER TABLE public.changelog_entries
  ADD COLUMN IF NOT EXISTS version text;

-- 2. status — default 'published' so existing rows + the WhatsNewDrawer behaviour
--    are unchanged (PU-03 non-regression). The CHECK is added idempotently.
ALTER TABLE public.changelog_entries
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'published';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'changelog_entries_status_check'
  ) THEN
    ALTER TABLE public.changelog_entries
      ADD CONSTRAINT changelog_entries_status_check
      CHECK (status IN ('draft', 'published', 'archived'));
  END IF;
END
$$;

-- 3. created_by — nullable; backfilled only for new rows authored via the admin
--    "Push Updates" module. ON DELETE SET NULL so author removal doesn't cascade.
ALTER TABLE public.changelog_entries
  ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;

-- 4. Partial index for the admin list ordering (status filter + newest-first).
CREATE INDEX IF NOT EXISTS changelog_entries_status_published_at_idx
  ON public.changelog_entries (status, published_at DESC);

-- 5. TIGHTEN the SELECT policy: non-admins see published rows only
--    (defense-in-depth half 1; the useChangelog query filter is half 2).
--    Idempotent drop-then-bare-create — remote PG lacks the policy IF-NOT-EXISTS form.
DROP POLICY IF EXISTS changelog_entries_select_authenticated
  ON public.changelog_entries;
DROP POLICY IF EXISTS changelog_entries_select_published_or_admin
  ON public.changelog_entries;
CREATE POLICY changelog_entries_select_published_or_admin
  ON public.changelog_entries
  FOR SELECT
  TO authenticated
  USING (status = 'published' OR public.is_admin_at_least('admin'::public.admin_role));

-- INSERT/UPDATE/DELETE admin policies from 20270704000012 are left untouched
-- (already is_admin_at_least('admin')).

COMMENT ON COLUMN public.changelog_entries.status IS
  'Phase 71 PU-02: draft|published|archived; non-admins SELECT published only via RLS.';
