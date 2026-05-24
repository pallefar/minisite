-- Phase 47 Plan 01 — Events RLS policies.
--
-- Implements:
--   D-01: SELECT inherits community_spaces visibility (org_id IS NULL → tier-gate via
--         tier_effective; org_id IS NOT NULL → org_members membership). No new tier-check code.
--   D-18: column-level allowlist — clients NEVER see events.join_url or events.zoom_meeting_id
--         via direct SELECT; only the event_get_join_url SECDEF RPC (47-03) returns them after
--         rsvp_status='going' AND now() BETWEEN start_at - INTERVAL '15 minutes' AND end_at.
--   T-47-01..T-47-05 (threat register): mitigations for join_url leak, zoom_meeting_id leak,
--         cross-tenant org-event probe, non-staff INSERT, tier-gated event visible to free user.
--
-- Anti-patterns avoided:
--   - No GUC-based predicates — org check joins org_members directly (Phase 28 pattern)
--   - No tautological-bypass predicates
--   - Explicit per-verb policies (select / insert / update / delete) for audit clarity
--   - No reference to rejected alternative names (per memory feedback_negation_grep_defeated_by_comment_string)
--   - SECDEF helper search_path includes extensions (per memory reference_supabase_migration_gotchas)
--
-- Inlining: can_see_community_space(uuid, uuid) helper does NOT exist in Phase 44 SECDEF migration
-- (verified via grep). Predicate is inlined directly: tier-gate via tier_effective for org_id IS NULL
-- spaces; org_members membership for org_id IS NOT NULL spaces. Trial users get pro-level access
-- (matches Phase 44 cpost_select_tier convention).
--
-- D-09 column-level RLS choice: PG row-level RLS cannot hide individual columns directly. The
-- chosen mechanism is column-grant allowlist: REVOKE SELECT on events from authenticated + anon,
-- then GRANT SELECT (15-column allowlist) excluding join_url + zoom_meeting_id. RLS row policies
-- still gate which rows are visible at all; column-grant gates which columns within a visible row.

begin;

-- ============================================================
-- Enable RLS
-- ============================================================
alter table public.events enable row level security;

-- ============================================================
-- SELECT policy — inherits community_spaces visibility (D-01)
-- ============================================================
-- Tier-gate (free/pro/lifetime) when parent space is global (org_id IS NULL).
-- Org-membership when parent space is org-private (org_id IS NOT NULL).
-- Trial users get pro-level access (matches Phase 44 cpost_select_tier).
create policy event_select_via_space
  on public.events
  for select to authenticated
  using (
    exists (
      select 1 from public.community_spaces cs
      where cs.id = events.space_id
        and (
          -- Global space → tier-gate inherited
          (
            cs.org_id is null
            and exists (
              select 1 from public.tier_effective te
              where te.user_id = auth.uid()
                and (
                  cs.min_tier = 'free'
                  or (cs.min_tier = 'pro'      and te.tier_label in ('pro','lifetime','trial'))
                  or (cs.min_tier = 'lifetime' and te.tier_label = 'lifetime')
                )
            )
          )
          -- Org-private space → org membership required
          or (
            cs.org_id is not null
            and exists (
              select 1 from public.org_members om
              where om.org_id = cs.org_id
                and om.user_id = auth.uid()
            )
          )
        )
    )
  );

comment on policy event_select_via_space on public.events is 'P47 D-01: SELECT inherits community_spaces visibility (tier-gate for global; org_members for org-private). Mitigates T-47-03 + T-47-05.';

-- ============================================================
-- INSERT / UPDATE / DELETE — staff-only via public.is_staff() (D-01)
-- ============================================================
-- Admin event editor is the only path for write ops; users RSVP via SECDEF RPC (47-03).
-- Service-role bypasses RLS for cron + Edge Fn paths.

create policy event_insert_staff
  on public.events
  for insert to authenticated
  with check (public.is_staff());

comment on policy event_insert_staff on public.events is 'P47 D-01: INSERT only via public.is_staff(). Mitigates T-47-04 (non-staff fabrication).';

create policy event_update_staff
  on public.events
  for update to authenticated
  using (public.is_staff())
  with check (public.is_staff());

comment on policy event_update_staff on public.events is 'P47 D-01: UPDATE only via public.is_staff().';

create policy event_delete_staff
  on public.events
  for delete to authenticated
  using (public.is_staff());

comment on policy event_delete_staff on public.events is 'P47 D-01: DELETE only via public.is_staff().';

-- ============================================================
-- Column-level allowlist — hides join_url + zoom_meeting_id (D-18)
-- ============================================================
-- Strip the default table-wide SELECT, then grant only the 15-column allowlist.
-- Excluded: join_url, zoom_meeting_id. These flow ONLY through event_get_join_url
-- SECDEF RPC (47-03), which double-checks rsvp_status='going' AND the 15-min pre-window.
-- Mitigates T-47-01 + T-47-02.

revoke select on public.events from authenticated;
revoke select on public.events from anon;

grant select (
  id, space_id, title, description, start_at, end_at, capacity,
  zoom_managed, attach_to_module_id, cover_url,
  recording_mux_asset_id, recording_playback_id,
  created_by, created_at, updated_at
) on public.events to authenticated;

grant select (
  id, space_id, title, description, start_at, end_at, capacity,
  zoom_managed, attach_to_module_id, cover_url,
  recording_mux_asset_id, recording_playback_id,
  created_by, created_at, updated_at
) on public.events to anon;

-- Write grants (gated by RLS to is_staff()):
grant insert, update, delete on public.events to authenticated;

commit;
