-- Phase 42 Plan 42-06 (POLISH-11) — RLS policies for changelog tables.
--
-- changelog_entries:
--   - All authenticated users may SELECT (changelog is public-to-tenant).
--   - INSERT/UPDATE/DELETE require admin (is_admin_at_least('admin')).
--
-- user_changelog_dismissed:
--   - Per-user RLS: a user may SELECT/INSERT/UPDATE only their own row.
--   - No DELETE policy — row deletes only via auth.users CASCADE on user deletion.
--   - Cross-tenant proof: user A's session cannot read user B's row (project
--     rule: every RLS surface gets a live cross-tenant impersonation test).
--
-- Threat model (T-42-06-02, T-42-06-03):
--   - Information disclosure: per-user RLS + cross-tenant proof.
--   - Spoofing: Edge Fn uses auth.uid() from JWT for upsert; cannot forge.
--
-- Reference memories:
--   - reference_supabase_migration_gotchas (search_path on SECDEF)
--   - reference_grep_gate_comment_strip (we use no SECDEF here; nothing to grep)

-- =============================================================================
-- changelog_entries
-- =============================================================================

ALTER TABLE public.changelog_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.changelog_entries FORCE ROW LEVEL SECURITY;

-- Idempotent drop-then-create
DROP POLICY IF EXISTS changelog_entries_select_authenticated
  ON public.changelog_entries;
CREATE POLICY changelog_entries_select_authenticated
  ON public.changelog_entries
  FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS changelog_entries_insert_admin
  ON public.changelog_entries;
CREATE POLICY changelog_entries_insert_admin
  ON public.changelog_entries
  FOR INSERT
  TO authenticated
  WITH CHECK (public.is_admin_at_least('admin'::public.admin_role));

DROP POLICY IF EXISTS changelog_entries_update_admin
  ON public.changelog_entries;
CREATE POLICY changelog_entries_update_admin
  ON public.changelog_entries
  FOR UPDATE
  TO authenticated
  USING (public.is_admin_at_least('admin'::public.admin_role))
  WITH CHECK (public.is_admin_at_least('admin'::public.admin_role));

DROP POLICY IF EXISTS changelog_entries_delete_admin
  ON public.changelog_entries;
CREATE POLICY changelog_entries_delete_admin
  ON public.changelog_entries
  FOR DELETE
  TO authenticated
  USING (public.is_admin_at_least('admin'::public.admin_role));

-- =============================================================================
-- user_changelog_dismissed
-- =============================================================================

ALTER TABLE public.user_changelog_dismissed ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_changelog_dismissed FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS user_changelog_dismissed_select_own
  ON public.user_changelog_dismissed;
CREATE POLICY user_changelog_dismissed_select_own
  ON public.user_changelog_dismissed
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS user_changelog_dismissed_insert_own
  ON public.user_changelog_dismissed;
CREATE POLICY user_changelog_dismissed_insert_own
  ON public.user_changelog_dismissed
  FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS user_changelog_dismissed_update_own
  ON public.user_changelog_dismissed;
CREATE POLICY user_changelog_dismissed_update_own
  ON public.user_changelog_dismissed
  FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- No DELETE policy → DELETE denied to all clients. Row removed via auth.users
-- CASCADE only.
