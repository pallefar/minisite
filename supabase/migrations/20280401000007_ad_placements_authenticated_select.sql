-- Phase 56 Review Fix — CR-04
-- Add authenticated SELECT policy on ad_placements so fetchPlacements()
-- called from the browser (free/past_due users) can read enabled placements.
--
-- Without this, PostgREST returns [] for every non-admin user, making the
-- entire ad-serving pipeline dead on arrival (AdRenderer never receives
-- placement config and never renders ads).
--
-- Only enabled placements are exposed: disabled/draft rows remain hidden
-- from non-admin users. Admin full-CRUD via existing ad_placements_admin_all
-- policy is preserved unchanged.
--
-- Forward-dated past 20280401000006 (ad_config_anon_select ceiling).

begin;

create policy "ad_placements_authenticated_select"
  on public.ad_placements
  for select
  to authenticated
  using (enabled = true);   -- only expose enabled placements; draft/disabled rows hidden

commit;
