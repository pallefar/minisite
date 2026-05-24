-- Phase 48 Plan 48-02 — community_reports SELECT RLS widening.
--
-- Decision refs:
--   D-01 (triage workflow + reporter visibility): reporter sees their own
--     filed reports so status transitions (open → triaged → resolved /
--     dismissed) drive the in-app indicator without a separate notification
--     path. Platform staff (public.is_staff()) see ALL reports for cross-org
--     triage; clinic-org moderators see ONLY their own org's reports via
--     public.can_moderate_report_org (Task 1).
--   D-04 (clinic-org moderator tier = owner + support_admin): role membership
--     is checked inside the helper; this policy file does not enumerate roles
--     directly.
--
-- Threat model:
--   T-48-02 (I, cross-org info disclosure): clinic A moderator must NOT see
--     clinic B reports. Mitigation = can_moderate_report_org derives org_id
--     from community_spaces (target row), never from a caller-supplied
--     argument. This policy is the load-bearing surface; the helper is the
--     load-bearing predicate.
--
-- Memory refs:
--   reference_supabase_is_staff_helper — canonical staff guard via
--     public.is_staff(); no parallel staff_users table.
--   feedback_negation_grep_defeated_by_comment_string — no rejected-alternative
--     names (no `staff_users`; no `'admin'` as role value) appear in this file,
--     even in comments. Plan 48-02 documents rejection in PLAN.md / SUMMARY.md.
--
-- Phase 45 status note:
--   Phase 45 ships the canonical community_reports SELECT policy named
--   `community_reports_select` in migration 20270727000002_p45_rls.sql.
--   That migration applies before this one (lexicographic 20270727 < 20270901)
--   at Plan 48-12 close-out `supabase db push --linked`. The DROP POLICY IF
--   EXISTS is a no-op if Phase 45 policy name differs in transit; CREATE
--   POLICY name `community_reports_select_moderation` is unique to this plan
--   to avoid collision with any prior alias.
--
-- Write-path note (NOT in this file):
--   community_reports has NO INSERT / UPDATE / DELETE policies for the
--   authenticated role — all writes flow through SECDEF RPCs:
--     • report_content (Plan 48-02, this batch) — user-filed reports.
--     • triage_report / dismiss_report / resolve_report (Plan 48-10) —
--       admin transitions.
--     • banned-words trigger (Plan 48-08) + claude-moderation Edge Fn
--       (Plan 48-07) — both run via service_role and bypass RLS.

begin;

drop policy if exists community_reports_select on public.community_reports;

create policy community_reports_select_moderation
  on public.community_reports
  for select
  to authenticated
  using (
    public.is_staff()
    or public.can_moderate_report_org(community_reports.id)
    or reporter_user_id = auth.uid()
  );

commit;
